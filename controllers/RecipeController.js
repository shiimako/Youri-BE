const mongoose = require("mongoose");
const {
  Recipe,
  TempIngredients,
  IngredientMaster,
  CategoryMaster,
  RecipeReport,
  User,
  SpritePackage,
  Notification,
} = require("../models/model");
const cloudinary = require("cloudinary").v2;

const recipeController = {
  // ==========================================
  // GET USER PERSONAL RECIPES
  // ==========================================
  getUserRecipes: async (req, res) => {
    try {
      const userId = req.user.id;
      const { search, page = 1, limit = 10 } = req.query;

      const queryFilter = { author_id: userId, status: { $ne: "deleted" } };

      if (search && search.trim() !== "") {
        queryFilter.title = { $regex: search.trim(), $options: "i" };
      }

      const currentPage = parseInt(page);
      const limitData = parseInt(limit);
      const skipData = (currentPage - 1) * limitData;

      const totalData = await Recipe.countDocuments(queryFilter);
      const totalPages = Math.ceil(totalData / limitData);

      // Read-only operation optimized with .lean()
      const recipes = await Recipe.find(queryFilter)
        .sort({ created_at: -1 })
        .skip(skipData)
        .limit(limitData)
        .lean();

      const takenDownRecipeIds = recipes
        .filter((r) => r.status === "taken_down")
        .map((r) => r._id);

      let takedownNotifs = [];
      if (takenDownRecipeIds.length > 0) {
        takedownNotifs = await Notification.find({
          user_id: userId,
          "context.context_type": "recipe",
          "context.item_id": { $in: takenDownRecipeIds },
        })
          .sort({ created_at: -1 })
          .lean();
      }

      const formattedRecipes = recipes.map((recipe) => {
        const dateObj = new Date(recipe.created_at);
        const formattedDate = dateObj.toISOString().split("T")[0];

        const notifMatch = takedownNotifs.find(
          (n) => n.context.item_id.toString() === recipe._id.toString()
        );

        return {
          recipe_id: recipe._id,
          title: recipe.title,
          image_url: recipe.image_url,
          created_at: formattedDate,
          status: recipe.status,
          message_takedown: recipe.status === "taken_down" && notifMatch ? notifMatch.message : null,
        };
      });

      return res.status(200).json({
        message: "Daftar resep berhasil dimuat",
        data: formattedRecipes,
        pagination: {
          current_page: currentPage,
          total_pages: totalPages,
          total_data: totalData,
          limit: limitData,
        },
      });
    } catch (error) {
      console.error("[getUserRecipes] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat memuat daftar resep" });
    }
  },

  // ==========================================
  // CREATE NEW RECIPE (TRANSACTIONAL)
  // ==========================================
  createRecipe: async (req, res) => {
    try {
      const userId = req.user.id;
      const {
        recipe_id, title, image_url, time_value, time_unit,
        description, ingredients, steps, categories,
      } = req.body;
      const errors = {};

      // Data Validation
      if (!title || title.trim() === "") errors.title = ["Judul resep wajib diisi"];
      if (!image_url || image_url.trim() === "") errors.image_url = ["Gambar resep wajib diunggah"];
      if (!time_value || isNaN(time_value)) errors.time_value = ["Waktu memasak harus berupa angka"];
      if (!time_unit || time_unit.trim() === "") errors.time_unit = ["Satuan waktu memasak wajib diisi"];
      if (!description || description.trim() === "") errors.description = ["Deskripsi resep wajib diisi"];
      if (!steps || !Array.isArray(steps) || steps.length === 0) errors.steps = ["Minimal harus ada satu langkah memasak"];

      if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
        errors.ingredients = ["Minimal harus ada satu bahan"];
      } else {
        ingredients.forEach((ing) => {
          if (!ing.name || ing.name.trim() === "") {
            errors.ingredients = errors.ingredients || [];
            if (!errors.ingredients.includes("Nama bahan tidak boleh kosong")) errors.ingredients.push("Nama bahan tidak boleh kosong");
          }
          if (ing.qty === "" || ing.qty === null || ing.qty === undefined) {
            errors.ingredients = errors.ingredients || [];
            if (!errors.ingredients.includes("Kuantitas bahan wajib diisi")) errors.ingredients.push("Kuantitas bahan wajib diisi");
          }
          if (!ing.metric || ing.metric.trim() === "") {
            errors.ingredients = errors.ingredients || [];
            if (!errors.ingredients.includes("Satuan metrik bahan wajib dipilih")) errors.ingredients.push("Satuan metrik bahan wajib dipilih");
          }
        });
      }

      if (Object.keys(errors).length > 0) {
        return res.status(400).json({ message: "Gagal membuat resep karena data tidak lengkap", errors });
      }

      let cookTimeMins = parseInt(time_value);
      if (time_unit.toLowerCase().includes("jam")) cookTimeMins *= 60;

      // Initialize Transaction
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const formattedCategories = [];
        if (categories && Array.isArray(categories)) {
          for (const catName of categories) {
            const cleanCatName = catName.trim();
            if (!cleanCatName) continue;

            const existingCat = await CategoryMaster.findOne({
              name: { $regex: new RegExp(`^${cleanCatName}$`, "i") },
            }).session(session);

            if (existingCat) {
              existingCat.usage_count += 1;
              await existingCat.save({ session });
              formattedCategories.push(existingCat.name);
            } else {
              const newCategoryId = `CAT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
              await CategoryMaster.create([{
                category_id: newCategoryId,
                name: cleanCatName,
                usage_count: 1,
              }], { session });
              formattedCategories.push(cleanCatName);
            }
          }
        }

        const formattedIngredients = [];
        for (const ing of ingredients) {
          const cleanName = ing.name.trim().toLowerCase();
          let ingredientId = ing.ingredient_id || null;
          let qtyNum = parseFloat(ing.qty) || 0;

          let rawString = ing.metric.toLowerCase() === "secukupnya"
            ? `secukupnya ${ing.name.trim()}`
            : `${qtyNum} ${ing.metric.trim()} ${ing.name.trim()}`;

          if (ing.is_valid === false) {
            const existingTemp = await TempIngredients.findOne({ raw_name: cleanName }).session(session);
            if (!existingTemp) {
              const existingMaster = await IngredientMaster.findOne({ clean_name: cleanName }).session(session);
              if (!existingMaster) {
                await TempIngredients.create([{ raw_name: cleanName, status: "pending" }], { session });
              } else {
                ingredientId = existingMaster.ingredient_id;
              }
            }
          }

          formattedIngredients.push({
            ingredient_id: ingredientId,
            name: ing.name.trim(),
            qty: qtyNum,
            metric: ing.metric.trim(),
            is_core: ing.is_core ?? false,
            raw: rawString,
          });
        }

        const newRecipe = new Recipe({
          _id: recipe_id,
          author_id: userId,
          title: title,
          image_url: image_url,
          cook_time_mins: cookTimeMins,
          description: description,
          steps: steps,
          categories: formattedCategories,
          ingredients: formattedIngredients,
          status: "published",
        });

        await newRecipe.save({ session });

        // Gamification Processing
        const user = await User.findById(userId).session(session);
        let isLevelUp = false;
        const xpGained = 80;

        if (user) {
          const oldLevel = user.gamification.level; 
          user.gamification.current_xp += xpGained;

          while (user.gamification.current_xp >= user.gamification.next_xp) {
            user.gamification.current_xp -= user.gamification.next_xp;
            user.gamification.level += 1;
            user.gamification.is_level_up = true;
            isLevelUp = true;
            user.gamification.next_xp = Math.floor(user.gamification.next_xp * 1.7);
          }

          const newLevel = user.gamification.level;

          if (newLevel > oldLevel) {
            const unlockedSprites = await SpritePackage.find({
              unlock_at_level: { $gt: oldLevel, $lte: newLevel },
            }).session(session).lean(); 

            if (unlockedSprites.length > 0) {
              const notifications = unlockedSprites.map((sprite) => ({
                user_id: userId,
                title: "Kosmetik Baru Terbuka!",
                context: { context_type: "sprite", item_id: sprite._id },
                message: `Selamat! Berkat pencapaian Level ${sprite.unlock_at_level}, kamu membuka paket kosmetik "${sprite.package_name}".`,
                is_read: false,
              }));
              await Notification.insertMany(notifications, { session });
            }
          }

          await user.save({ session });
        }

        let happySpriteUrl = null;
        if (user) {
          const equippedSprite = await SpritePackage.findOne({
            package_id: user.gamification.equipped_sprite_id,
          }).session(session).lean();
          happySpriteUrl = equippedSprite?.assets?.happy || null;
        }

        await session.commitTransaction();
        
        return res.status(201).json({
          message: `Resep berhasil diunggah. Kamu mendapat ${xpGained} XP!`,
          data: {
            gamification: {
              exp_earned: xpGained,
              level: user?.gamification?.level || 1,
              current_xp: user?.gamification?.current_xp || 0,
              next_xp: user?.gamification?.next_xp || 100,
              is_level_up: isLevelUp,
            },
            happy_sprite: happySpriteUrl,
          },
        });
      } catch (dbError) {
        await session.abortTransaction();
        throw dbError; 
      } finally {
        session.endSession();
      }
    } catch (error) {
      console.error("[createRecipe] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat membuat resep" });
    }
  },

  // ==========================================
  // GET RECIPE DETAIL FOR EDIT FORM
  // ==========================================
  getRecipeDetail: async (req, res) => {
    try {
      const userId = req.user.id;
      const recipeId = req.params.id;

      const recipe = await Recipe.findById(recipeId).where("status").ne("deleted").lean();
      
      if (!recipe) return res.status(404).json({ message: "Resep tidak ditemukan" });
      if (recipe.author_id.toString() !== userId) {
        return res.status(403).json({ message: "Akses ditolak. Anda bukan pemilik resep ini." });
      }

      let takedownMessage = null;
      if (recipe.status === "taken_down") {
        const takedownNotif = await Notification.findOne({
          user_id: userId,
          "context.context_type": "recipe",
          "context.item_id": recipe._id,
        })
          .sort({ created_at: -1 })
          .lean();

        if (takedownNotif) takedownMessage = takedownNotif.message;
      }

      const responseData = {
        recipe_id: recipe._id,
        title: recipe.title,
        image_url: recipe.image_url,
        time_value: recipe.cook_time_mins, 
        time_unit: "Menit",
        description: recipe.description,
        categories: recipe.categories || [],
        ingredients: recipe.ingredients || [], 
        steps: recipe.steps || [],
        status: recipe.status,
        message_takedown: takedownMessage,
      };

      return res.status(200).json({ message: "Detail resep berhasil dimuat", data: responseData });
    } catch (error) {
      console.error("[getRecipeDetail] Error:", error);
      if (error.kind === "ObjectId") return res.status(404).json({ message: "Format ID tidak valid" });
      res.status(500).json({ message: "Terjadi kesalahan internal saat memuat detail resep" });
    }
  },

  // ==========================================
  // UPDATE EXISTING RECIPE (TRANSACTIONAL)
  // ==========================================
  updateRecipe: async (req, res) => {
    try {
      const userId = req.user.id;
      const recipeId = req.params.id;
      const {
        title, image_url, time_value, time_unit,
        description, ingredients, steps, categories,
      } = req.body;
      const errors = {};

      if (!title || title.trim() === "") errors.title = ["Judul resep wajib diisi"];
      if (!image_url || image_url.trim() === "") errors.image_url = ["Gambar resep wajib diunggah"];
      if (!time_value || isNaN(time_value)) errors.time_value = ["Waktu memasak wajib diisi"];
      if (!description || description.trim() === "") errors.description = ["Deskripsi resep wajib diisi"];
      if (!steps || !Array.isArray(steps) || steps.length === 0) errors.steps = ["Minimal harus ada satu langkah memasak"];
      
      if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
        errors.ingredients = ["Minimal harus ada satu bahan"];
      } else {
        ingredients.forEach((ing) => {
          if (!ing.name || ing.name.trim() === "") errors.ingredients = ["Nama bahan tidak boleh kosong"];
          if (ing.qty === "" || ing.qty === null) errors.ingredients = ["Kuantitas bahan wajib diisi"];
        });
      }

      if (Object.keys(errors).length > 0) {
        return res.status(400).json({ message: "Data resep tidak lengkap", errors });
      }

      let cookTimeMins = parseInt(time_value);
      if (time_unit.toLowerCase().includes("jam")) cookTimeMins *= 60;

      // Initialize Transaction
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const recipe = await Recipe.findById(recipeId).where("status").ne("deleted").session(session);
        if (!recipe) {
          await session.abortTransaction();
          return res.status(404).json({ message: "Resep tidak ditemukan" });
        }
        if (recipe.author_id.toString() !== userId) {
          await session.abortTransaction();
          return res.status(403).json({ message: "Akses ditolak" });
        }

        const formattedCategories = [];
        if (categories && Array.isArray(categories)) {
          for (const catName of categories) {
            const cleanCatName = catName.trim();
            if (!cleanCatName) continue;
            
            const existingCat = await CategoryMaster.findOne({
              name: { $regex: new RegExp(`^${cleanCatName}$`, "i") },
            }).session(session);

            if (existingCat) {
              formattedCategories.push(existingCat.name);
            } else {
              const newCategoryId = `CAT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
              await CategoryMaster.create([{
                category_id: newCategoryId,
                name: cleanCatName,
                usage_count: 1,
              }], { session });
              formattedCategories.push(cleanCatName);
            }
          }
        }

        const formattedIngredients = [];
        for (const ing of ingredients) {
          const cleanName = ing.name.trim().toLowerCase();
          let ingredientId = ing.ingredient_id || null;
          let qtyNum = parseFloat(ing.qty) || 0;
          let rawString = ing.metric.toLowerCase() === "secukupnya"
            ? `secukupnya ${ing.name.trim()}`
            : `${qtyNum} ${ing.metric.trim()} ${ing.name.trim()}`;

          if (ing.is_valid === false) {
            const existingTemp = await TempIngredients.findOne({ raw_name: cleanName }).session(session);
            if (!existingTemp) {
              const existingMaster = await IngredientMaster.findOne({ clean_name: cleanName }).session(session);
              if (!existingMaster) {
                await TempIngredients.create([{ raw_name: cleanName, status: "pending" }], { session });
              } else {
                ingredientId = existingMaster.ingredient_id;
              }
            }
          }
          
          formattedIngredients.push({
            ingredient_id: ingredientId,
            name: ing.name.trim(),
            qty: qtyNum,
            metric: ing.metric.trim(),
            is_core: ing.is_core ?? false,
            raw: rawString,
          });
        }

        recipe.title = title;
        recipe.image_url = image_url;
        recipe.cook_time_mins = cookTimeMins;
        recipe.description = description;
        recipe.categories = formattedCategories;
        recipe.ingredients = formattedIngredients;
        recipe.steps = steps;
        recipe.status = "published";

        await recipe.save({ session });
        await session.commitTransaction();

        return res.status(200).json({ message: "Resep berhasil diperbarui", data: null });
      } catch (dbError) {
        await session.abortTransaction();
        throw dbError;
      } finally {
        session.endSession();
      }
    } catch (error) {
      console.error("[updateRecipe] Error:", error);
      if (error.kind === "ObjectId") return res.status(404).json({ message: "Format ID tidak valid" });
      res.status(500).json({ message: "Terjadi kesalahan internal saat memperbarui resep" });
    }
  },

  // ==========================================
  // DELETE RECIPE (TRANSACTIONAL SOFT DELETE)
  // ==========================================
  deleteRecipe: async (req, res) => {
    try {
      const userId = req.user.id;
      const recipeId = req.params.id;

      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        const recipe = await Recipe.findById(recipeId).session(session);

        if (!recipe) {
          await session.abortTransaction();
          return res.status(404).json({ message: "Resep tidak ditemukan" });
        }

        if (recipe.author_id.toString() !== userId) {
          await session.abortTransaction();
          return res.status(403).json({ message: "Akses ditolak. Anda hanya dapat menghapus resep milik Anda sendiri." });
        }

        if (recipe.status === "deleted") {
          await session.abortTransaction();
          return res.status(400).json({ message: "Resep ini sudah dalam status terhapus" });
        }

        // Reduce category usage counts
        if (recipe.categories && recipe.categories.length > 0) {
          await CategoryMaster.updateMany(
            { name: { $in: recipe.categories } },
            { $inc: { usage_count: -1 } },
            { session }
          );
        }

        recipe.status = "deleted";
        recipe.image_url = "https://res.cloudinary.com/YOUR_CLOUD_NAME/image/upload/v1/Youri/assets/deleted_recipe_placeholder.jpg";

        await recipe.save({ session });

        // Cleanup pending reports for this deleted recipe
        await RecipeReport.deleteMany({ recipe_id: recipeId }).session(session);

        await session.commitTransaction();
      } catch (dbError) {
        await session.abortTransaction();
        throw dbError;
      } finally {
        session.endSession();
      }

      // Cloudinary deletion handled outside transaction to prevent rollback issues if network fails
      try {
        const targetPublicId = `Youri/youri_recipes/${userId}/${recipeId}`;
        await cloudinary.uploader.destroy(targetPublicId);
      } catch (cloudError) {
        console.error("[deleteRecipe] Warning: Cloudinary deletion failed:", cloudError.message);
      }

      return res.status(200).json({
        message: "Resep berhasil ditarik dan diarsipkan",
        data: null,
      });
    } catch (error) {
      console.error("[deleteRecipe] Error:", error);
      if (error.kind === "ObjectId") return res.status(404).json({ message: "Format ID resep tidak valid" });
      res.status(500).json({ message: "Terjadi kesalahan internal saat menghapus resep" });
    }
  },

  // ==========================================
  // GET CLOUDINARY UPLOAD SIGNATURE
  // ==========================================
  getRecipeUploadSignature: async (req, res) => {
    try {
      const userId = req.user.id;
      const timestamp = Math.round(new Date().getTime() / 1000);

      const preGeneratedRecipeId = new mongoose.Types.ObjectId().toString();
      const targetFolder = `Youri/youri_recipes/${userId}`;

      const signature = cloudinary.utils.api_sign_request(
        {
          timestamp: timestamp,
          folder: targetFolder,
          public_id: preGeneratedRecipeId,
          overwrite: true,
          invalidate: true,
        },
        process.env.CLOUDINARY_API_SECRET
      );

      return res.status(200).json({
        message: "Signature unggah resep berhasil dibuat",
        data: {
          signature: signature,
          timestamp: timestamp,
          api_key: process.env.CLOUDINARY_API_KEY,
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          folder: targetFolder,
          public_id: preGeneratedRecipeId,
        },
      });
    } catch (error) {
      console.error("[getRecipeUploadSignature] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat membuat signature" });
    }
  },

  // ==========================================
  // GET CLOUDINARY EDIT SIGNATURE
  // ==========================================
  getRecipeEditSignature: async (req, res) => {
    try {
      const userId = req.user.id;
      const recipeId = req.params.id;

      const recipe = await Recipe.findById(recipeId).select("author_id").lean();
      
      if (!recipe) return res.status(404).json({ message: "Resep tidak ditemukan" });
      if (recipe.author_id.toString() !== userId) return res.status(403).json({ message: "Akses ditolak" });

      const timestamp = Math.round(new Date().getTime() / 1000);
      const targetFolder = `Youri/youri_recipes/${userId}`;
      const signature = cloudinary.utils.api_sign_request(
        {
          timestamp: timestamp,
          folder: targetFolder,
          public_id: recipeId,
          overwrite: true,
          invalidate: true,
        },
        process.env.CLOUDINARY_API_SECRET
      );

      return res.status(200).json({
        message: "Signature edit resep berhasil dibuat",
        data: {
          signature: signature,
          timestamp: timestamp,
          api_key: process.env.CLOUDINARY_API_KEY,
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          folder: targetFolder,
          public_id: recipeId,
        },
      });
    } catch (error) {
      console.error("[getRecipeEditSignature] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat membuat signature" });
    }
  },

  // ==========================================
  // SUBMIT RECIPE REPORT
  // ==========================================
  submitRecipeReport: async (req, res) => {
    try {
      const recipeId = req.params.id;
      const userId = req.user.id;
      const { category, reason } = req.body;

      const validCategories = ["spam", "inappropriate", "irrelevant", "fake_recipe"];
      if (!category || !validCategories.includes(category)) {
        return res.status(400).json({
          message: "Kategori laporan tidak valid",
        });
      }

      if (!reason || reason.trim() === "") {
        return res.status(400).json({ message: "Alasan pelaporan wajib diisi" });
      }

      // No transaction needed as this is an isolated write operation
      const recipe = await Recipe.findById(recipeId).select("_id").lean();
      if (!recipe) {
        return res.status(404).json({ message: "Resep tidak ditemukan" });
      }

      const existingReport = await RecipeReport.findOne({
        recipe_id: recipeId,
        reporter_id: userId,
        status: "pending",
      }).lean();

      if (existingReport) {
        return res.status(400).json({
          message: "Anda telah melaporkan resep ini sebelumnya. Menunggu tinjauan Admin.",
        });
      }

      await RecipeReport.create({
        recipe_id: recipeId,
        reporter_id: userId,
        category: category,
        reason: reason.trim(),
        status: "pending", 
      });

      return res.status(201).json({
        message: "Laporan berhasil dikirim. Terima kasih telah membantu menjaga Youri tetap aman.",
        data: null,
      });

    } catch (error) {
      console.error("[submitRecipeReport] Error:", error);
      if (error.kind === "ObjectId") {
        return res.status(404).json({ message: "Format ID resep tidak valid" });
      }
      res.status(500).json({ message: "Terjadi kesalahan internal saat mengirim laporan" });
    }
  },
};

module.exports = recipeController;