const mongoose = require("mongoose"); // 🌸 YUKI'S FIX: Wajib di-import untuk Transaction!
const { CookingHistory, User, SpritePackage, Notification } = require("../models/model");

const gamificationController = {
  // ==========================================
  // GET WEEKLY HISTORY
  // ==========================================
  getWeeklyHistory: async (req, res) => {
    try {
      const userId = req.user.id;

      const now = new Date();
      const dayOfWeek = now.getDay();
      const diffToMonday = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);

      const startOfWeek = new Date(now.setDate(diffToMonday));
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      const histories = await CookingHistory.find({
        user_id: userId,
        cooked_at: { $gte: startOfWeek, $lte: endOfWeek },
      })
        .populate("recipe_id", "title")
        .sort({ cooked_at: -1 })
        .lean(); 

      let canClaim = false;
      let totalUnclaimedIngredients = 0;
      const groupedData = {};

      histories.forEach((history) => {
        if (!history.is_claimed && history.saved_ingredients.length > 0) {
          canClaim = true;
          totalUnclaimedIngredients += history.saved_ingredients.length;
        }

        const dateObj = new Date(history.cooked_at);
        const dateString = dateObj.toISOString().split("T")[0];
        const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
        const dayName = days[dateObj.getDay()];

        if (!groupedData[dateString]) {
          groupedData[dateString] = {
            date: dateString,
            day: dayName,
            records: [],
          };
        }

        groupedData[dateString].records.push({
          history_id: history._id,
          recipe_title: history.recipe_id ? history.recipe_id.title : "Resep Telah Dihapus",
          proof_image_url: history.proof_image_url,
          saved_ingredients: history.saved_ingredients,
          is_claimed: history.is_claimed,
          cooked_time: dateObj.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }),
        });
      });

      const weeklyHistoryArray = Object.values(groupedData);

      return res.status(200).json({
        message: "Arsip masak minggu ini berhasil dimuat",
        data: {
          can_claim: canClaim,
          potential_xp: totalUnclaimedIngredients * 10,
          histories: weeklyHistoryArray,
        },
      });
    } catch (error) {
      console.error("[getWeeklyHistory] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat memuat arsip" });
    }
  },

  // ==========================================
  // CLAIM WEEKLY HISTORY XP (TRANSACTION APPLIED)
  // ==========================================
  claimWeeklyXp: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const userId = req.user.id;

      const now = new Date();
      const dayOfWeek = now.getDay();
      const diffToMonday = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      const startOfWeek = new Date(now.setDate(diffToMonday));
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      const unclaimedHistories = await CookingHistory.find({
        user_id: userId,
        is_claimed: false,
        cooked_at: { $gte: startOfWeek, $lte: endOfWeek },
      }).session(session).lean(); // Masukkan ke dalam session

      let totalSavedIngredients = 0;
      unclaimedHistories.forEach((history) => {
        totalSavedIngredients += history.saved_ingredients.length;
      });

      if (totalSavedIngredients === 0) {
        await session.abortTransaction(); // Batalkan transaksi jika tidak ada yang diklaim
        session.endSession();
        return res.status(400).json({ message: "Tidak ada bahan yang bisa diklaim saat ini" });
      }

      const xpGained = totalSavedIngredients * 10;

      const user = await User.findById(userId).session(session);
      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Data pengguna tidak ditemukan" });
      }

      const oldLevel = user.gamification.level;
      
      user.gamification.current_xp += xpGained;

      while (user.gamification.current_xp >= user.gamification.next_xp) {
        user.gamification.current_xp -= user.gamification.next_xp;
        user.gamification.level += 1;
        user.gamification.is_level_up = true;
        user.gamification.next_xp = Math.floor(user.gamification.next_xp * 1.7);
      }

      const newLevel = user.gamification.level;

      // Process Unlockable Sprites
      if (newLevel > oldLevel) {
        const unlockedSprites = await SpritePackage.find({
          unlock_at_level: { $gt: oldLevel, $lte: newLevel }
        }).session(session).lean();

        if (unlockedSprites.length > 0) {
          const notifications = unlockedSprites.map(sprite => ({
            user_id: userId,
            title: "Kosmetik Baru Terbuka! 🎉",
            context: { 
              context_type: "sprite", 
              item_id: sprite._id 
            },
            message: `Selamat! Berkat pencapaian Level ${sprite.unlock_at_level}, kamu membuka paket kosmetik "${sprite.package_name}".`,
            is_read: false
          }));

          await Notification.insertMany(notifications, { session }); // Insert dengan session
        }
      }

      await user.save({ session }); // Save user dengan session

      const historyIds = unclaimedHistories.map((h) => h._id);
      await CookingHistory.updateMany(
        { _id: { $in: historyIds } },
        { $set: { is_claimed: true } },
        { session } // Update many dengan session
      );

      // COMMIT TRANSAKSI JIKA SEMUA SUKSES
      await session.commitTransaction();
      session.endSession();

      const equippedSprite = await SpritePackage.findOne({
        package_id: user.gamification.equipped_sprite_id,
      }).lean();
      
      const happyImageUrl = equippedSprite?.assets?.happy || null;

      return res.status(200).json({
        message: `Klaim berhasil! Kamu menyelamatkan ${totalSavedIngredients} bahan.`,
        data: {
          saved_count: totalSavedIngredients,
          gamification: {
            exp_earned: xpGained,
            level: user.gamification.level,
            current_xp: user.gamification.current_xp,
            next_xp: user.gamification.next_xp,
            is_level_up: user.gamification.is_level_up,
          },
          happy_sprite: happyImageUrl,
        },
      });
    } catch (error) {
      // ROLLBACK JIKA TERJADI ERROR DI TENGAH JALAN
      await session.abortTransaction();
      session.endSession();
      
      console.error("[claimWeeklyXp] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat mengklaim XP" });
    }
  },

  // ==========================================
  // GET SPRITES CATALOG
  // ==========================================
  getSpritesCatalog: async (req, res) => {
    try {
      const userId = req.user.id;

      const user = await User.findById(userId).select("gamification.equipped_sprite_id").lean();
      if (!user) {
        return res.status(404).json({ message: "Data pengguna tidak ditemukan" });
      }

      const equippedSpriteId = user.gamification.equipped_sprite_id;

      const sprites = await SpritePackage.find().sort({ unlock_at_level: 1 }).lean();

      const formattedSprites = sprites.map((sprite) => ({
        package_id: sprite.package_id,
        package_name: sprite.package_name,
        unlock_at_level: sprite.unlock_at_level,
        is_active: sprite.package_id === equippedSpriteId,
        assets: {
          badge: sprite.assets.badge,
          start_button: sprite.assets.start_button,
          thinking: sprite.assets.thinking,
          fail: sprite.assets.fail,
        },
      }));

      return res.status(200).json({
        message: "Katalog maskot berhasil dimuat",
        data: formattedSprites,
      });
    } catch (error) {
      console.error("[getSpritesCatalog] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat memuat katalog maskot" });
    }
  },

  // ==========================================
  // EQUIP SPRITE PACKAGE
  // ==========================================
  equipSprite: async (req, res) => {
    try {
      const userId = req.user.id;
      const { package_id } = req.body;

      if (!package_id) {
        return res.status(400).json({
          message: "Gagal memasang maskot",
          errors: { package_id: ["ID Paket Maskot wajib diisi"] },
        });
      }

      const spritePackage = await SpritePackage.findOne({ package_id: package_id }).lean();
      if (!spritePackage) {
        return res.status(404).json({ message: "Paket maskot tidak ditemukan di katalog" });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "Data pengguna tidak ditemukan" });
      }

      if (user.gamification.level < spritePackage.unlock_at_level) {
        return res.status(403).json({
          message: `Level tidak mencukupi untuk memakai ${spritePackage.package_name}. Diperlukan Level ${spritePackage.unlock_at_level}.`,
          errors: null,
        });
      }

      user.gamification.equipped_sprite_id = package_id;
      await user.save();

      return res.status(200).json({
        message: `${spritePackage.package_name} berhasil dipasang`,
        data: {
          equipped_package_id: spritePackage.package_id,
          equipped_package_name: spritePackage.package_name,
        },
      });
    } catch (error) {
      console.error("[equipSprite] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat memasang maskot" });
    }
  },

  // ==========================================
  // ACKNOWLEDGE LEVEL UP
  // ==========================================
  acknowledgeLevelUp: async (req, res) => {
    try {
      const userId = req.user.id;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "Data pengguna tidak ditemukan" });
      }

      if (user.gamification.is_level_up) {
        user.gamification.is_level_up = false;
        await user.save();

        return res.status(200).json({
          message: "Status level up telah diperbarui",
          data: null,
        });
      } else {
        return res.status(200).json({
          message: "Status level up sudah diakui sebelumnya",
          data: null,
        });
      }
    } catch (error) {
      console.error("[acknowledgeLevelUp] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal pada server" });
    }
  },
};

module.exports = gamificationController;