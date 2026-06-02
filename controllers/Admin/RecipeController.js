const mongoose = require('mongoose');
const { RecipeReport, Recipe, User, Notification, SpritePackage } = require('../../models/model');

const adminRecipeController = {
  // ==========================================
  // GET LIST OF REPORTS (PAGINATED)
  // ==========================================
  getReports: async (req, res) => {
    try {
      let { status = 'unsolved', sort = 'newest', page = 1, limit = 10 } = req.query;
      
      page = parseInt(page);
      limit = parseInt(limit);
      const dbStatus = status === 'unsolved' ? 'pending' : status;
      const sortOption = sort === 'oldest' ? { createdAt: 1 } : { createdAt: -1 };
      const skip = (page - 1) * limit;
      const query = { status: dbStatus };

      const [reports, totalItems] = await Promise.all([
        RecipeReport.find(query)
          .sort(sortOption)
          .skip(skip)
          .limit(limit)
          .populate('recipe_id', 'title') 
          .populate('reporter_id', 'username')
          .lean(),
        RecipeReport.countDocuments(query)
      ]);

      const totalPages = Math.ceil(totalItems / limit) || 1;

      const formattedReports = reports.map(report => {
        const recipeName = report.recipe_id ? report.recipe_id.title : "Resep Tidak Tersedia/Dihapus";
        const actualRecipeId = report.recipe_id ? report.recipe_id._id : null;
        const reporterName = report.reporter_id ? report.reporter_id.username : "Unknown User";

        return {
          report_id: report._id,
          recipe_id: actualRecipeId,
          recipe_name: recipeName,
          reporter_id: report.reporter_id,
          reporter_name: reporterName,
          category: report.category,
          reason: report.reason,
          status: report.status === 'pending' ? 'unsolved' : report.status,
          created_at: report.createdAt
        };
      });

      return res.status(200).json({
        message: "Reports loaded successfully",
        data: formattedReports,
        meta: {
          current_page: page,
          total_pages: totalPages,
          total_items: totalItems
        }
      });

    } catch (error) {
      console.error("[getReports] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat memuat daftar laporan" });
    }
  },

  // ==========================================
  // RESOLVE REPORT & AUTO-CLOSE DUPLICATES
  // ==========================================
  resolveReport: async (req, res) => {
    try {
      const { report_id } = req.params;
      const { action, custom_message } = req.body;

      if (!['takedown_recipe', 'ignore_report'].includes(action)) {
        return res.status(400).json({ message: "Action tidak valid." });
      }

      const mainReport = await RecipeReport.findById(report_id).lean();
      if (!mainReport) return res.status(404).json({ message: "Laporan tidak ditemukan" });

      const targetRecipeId = mainReport.recipe_id;
      
      // Read-only query optimized with .lean()
      const allPendingReports = await RecipeReport.find({ 
        recipe_id: targetRecipeId, 
        status: 'pending' 
      }).lean();

      const duplicatesAutoClosed = allPendingReports.length > 1 ? allPendingReports.length - 1 : 0;
      let totalXpDistributed = 0;
      let responseMessage = "";

      // Initialize Transaction
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        if (action === 'takedown_recipe') {
          const STATIC_XP = 15;

          // Process Recipe Takedown
          const targetRecipe = await Recipe.findByIdAndUpdate(
            targetRecipeId, 
            { status: 'taken_down' }, 
            { session, new: true }
          );

          // Identify unique reporters
          const uniqueReporterIds = [...new Set(allPendingReports.map(r => r.reporter_id.toString()))];

          // Distribute XP & Notifications to Reporters
          if (uniqueReporterIds.length > 0) {
            const notificationsToInsert = [];

            await Promise.all(uniqueReporterIds.map(async (reporterId) => {
              const user = await User.findById(reporterId).session(session);
              if (!user) return; 

              const oldLevel = user.gamification.level;
              user.gamification.current_xp += STATIC_XP;

              // Process Level Up Logic
              while (user.gamification.current_xp >= user.gamification.next_xp) {
                user.gamification.current_xp -= user.gamification.next_xp;
                user.gamification.level += 1;
                user.gamification.is_level_up = true;
                user.gamification.next_xp = Math.floor(user.gamification.next_xp * 1.7);
              }

              const newLevel = user.gamification.level;

              // Prepare Reward Notification
              notificationsToInsert.push({
                user_id: reporterId,
                title: "Laporan Terverifikasi",
                context: { context_type: "recipe", item_id: targetRecipeId },
                message: `Laporanmu mengenai resep "${targetRecipe?.title || 'pelanggar'}" terbukti benar. Kamu mendapat +${STATIC_XP} XP.`,
                is_read: false
              });

              // Process Unlockable Sprites
              if (newLevel > oldLevel) {
                const unlockedSprites = await SpritePackage.find({
                  unlock_at_level: { $gt: oldLevel, $lte: newLevel }
                }).session(session).lean();

                unlockedSprites.forEach(sprite => {
                  notificationsToInsert.push({
                    user_id: reporterId,
                    title: "Kosmetik Baru Terbuka!",
                    context: { context_type: "sprite", item_id: sprite._id },
                    message: `Selamat! Mencapai Level ${sprite.unlock_at_level} membuka paket kosmetik "${sprite.package_name}".`,
                    is_read: false
                  });
                });
              }

              await user.save({ session });
            }));

            // Bulk Insert Notifications
            if (notificationsToInsert.length > 0) {
              await Notification.insertMany(notificationsToInsert, { session });
            }

            totalXpDistributed = uniqueReporterIds.length * STATIC_XP;
          }

          // Notify Recipe Author
          if (targetRecipe && targetRecipe.author_id) {
            const templates = {
              spam: "mengandung unsur spam atau promosi iklan.",
              inappropriate: "mengandung gambar atau teks yang tidak pantas.",
              irrelevant: "tidak sesuai dengan kategori atau pedoman resep kami.",
              fake_recipe: "terdeteksi sebagai resep palsu dengan instruksi yang tidak masuk akal."
            };
            
            const finalReason = custom_message && custom_message.trim() !== "" 
              ? custom_message 
              : (templates[mainReport.category] || "melanggar panduan komunitas kami.");

            await Notification.create([{
              user_id: targetRecipe.author_id,
              title: "Resep Diturunkan oleh Admin",
              context: { context_type: "recipe", item_id: targetRecipeId },
              message: `Maaf, resep "${targetRecipe.title}" telah diturunkan karena ${finalReason} Jika ini adalah kesalahan, hubungi dukungan kami.`,
              is_read: false
            }], { session });
          }

          // Update Reports Status
          await RecipeReport.updateMany(
            { recipe_id: targetRecipeId, status: 'pending' },
            { $set: { status: 'resolved' } },
            { session }
          );

          responseMessage = "Laporan diselesaikan, resep diturunkan, dan notifikasi dikirim";

        } else if (action === 'ignore_report') {
          await RecipeReport.updateMany(
            { recipe_id: targetRecipeId, status: 'pending' },
            { $set: { status: 'dismissed' } },
            { session }
          );
          responseMessage = "Laporan diabaikan dan duplikat ditolak";
        }

        // Commit Transaction
        await session.commitTransaction();
        
        return res.status(200).json({
          message: responseMessage,
          data: { 
            action_taken: action, 
            duplicates_auto_closed: duplicatesAutoClosed, 
            total_xp_distributed: totalXpDistributed 
          }
        });

      } catch (dbError) {
        await session.abortTransaction();
        throw dbError; 
      } finally {
        session.endSession();
      }

    } catch (error) {
      console.error("[resolveReport] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat memproses laporan" });
    }
  },

  // ==========================================
  // ADMIN DIRECT TAKEDOWN
  // ==========================================
  adminTakedownDirect: async (req, res) => {
    try {
      const { id, reason } = req.body; 

      if (!reason || reason.trim() === "") {
        return res.status(400).json({ message: "Alasan takedown wajib diisi oleh Admin" });
      }

      // Initialize Transaction
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        // 1. Update Recipe Status
        const recipe = await Recipe.findByIdAndUpdate(
          id, 
          { status: 'taken_down' },
          { session, new: true }
        );

        if (!recipe) {
          await session.abortTransaction();
          return res.status(404).json({ message: "Resep tidak ditemukan" });
        }

        // 2. Notify Recipe Author
        if (recipe.author_id) {
          await Notification.create([{
            user_id: recipe.author_id,
            title: "Resep Diturunkan oleh Admin",
            context: { context_type: "recipe", item_id: recipe._id }, 
            message: `Resep berjudul "${recipe.title}" telah diturunkan oleh Admin dengan alasan: "${reason.trim()}".`,
            is_read: false
          }], { session });
        }

        // 3. Resolve Pending Reports for this Recipe
        await RecipeReport.updateMany(
          { recipe_id: id, status: 'pending' },
          { $set: { status: 'resolved' } },
          { session }
        );

        // Commit Transaction
        await session.commitTransaction();

        return res.status(200).json({
          message: "Resep berhasil di-takedown secara instan",
          data: { recipe_id: id }
        });

      } catch (dbError) {
        await session.abortTransaction();
        throw dbError;
      } finally {
        session.endSession();
      }

    } catch (error) {
      console.error("[adminTakedownDirect] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat takedown resep" });
    }
  }
};

module.exports = adminRecipeController;