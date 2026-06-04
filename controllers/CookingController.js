const {
  Recipe,
  User,
  CookingHistory,
  SpritePackage,
  Notification,
} = require("../models/model");
const cloudinary = require("cloudinary").v2;
const crypto = require("crypto");
const axios = require("axios");
const redisClient = require("../config/redis");

const cookingController = {
  // ==========================================
  // GET FULL RECIPE DETAILS
  // ==========================================
  getRecipeToCook: async (req, res) => {
    try {
      const recipeId = req.params.id;

      // Note: Using .lean() for faster read performance as data won't be modified.
      const recipe = await Recipe.findById(recipeId)
        .populate("author_id", "username")
        .lean();

      if (!recipe || recipe.status !== "published") {
        return res.status(404).json({
          message: "Resep tidak ditemukan atau tidak tersedia.",
          errors: null,
        });
      }

      const formattedIngredients = (recipe.ingredients || []).map(
        (ing) => `${ing.raw}`,
      );

      const responseData = {
        id: recipe._id,
        title: recipe.title,
        image_url: recipe.image_url,
        author_name: recipe.author_id
          ? recipe.author_id.username
          : "Unknown Chef",
        cook_time_mins: recipe.cook_time_mins,
        categories: recipe.categories,
        description: recipe.description,
        ingredients: formattedIngredients,
        steps: recipe.steps || [],
      };

      return res.status(200).json({
        message: "Detail resep berhasil dimuat",
        data: responseData,
      });
    } catch (error) {
      console.error("[getRecipeToCook] Error:", error);
      if (error.kind === "ObjectId") {
        return res
          .status(404)
          .json({ message: "Format ID resep tidak valid", errors: null });
      }
      res
        .status(500)
        .json({
          message: "Terjadi kesalahan internal saat memuat detail resep",
        });
    }
  },

  // ==========================================
  // MATCH RECIPES VIA AI SERVICE
  // ==========================================
  matchRecipe: async (req, res) => {
    try {
      const payload = req.body;

      if (!payload.ingredients || !Array.isArray(payload.ingredients)) {
        return res.status(400).json({ message: "Payload bahan tidak valid" });
      }

      const mlServiceUrl =
        process.env.INTERNAL_AI_SERVICE_URL || "http://localhost:8000";
      let mlResponse;

      try {
        mlResponse = await axios.post(
          `${mlServiceUrl}/ai/cooking/match`,
          payload,
          {
            headers: {
              "x-internal-api-key": process.env.INTERNAL_AI_API_KEY,
              "Content-Type": "application/json",
            },
          },
        );
      } catch (aiError) {
        console.error(
          "[matchRecipe] AI Service Error:",
          aiError.response?.data || aiError.message,
        );
        return res.status(503).json({
          message: "Layanan AI sedang tidak tersedia atau gagal memproses data",
        });
      }

      const matchData = mlResponse.data.data;

      if (!matchData || matchData.length === 0) {
        return res.status(200).json({
          message: "Tidak ditemukan resep yang cocok",
          data: [],
        });
      }

      const recipeIds = matchData.map((item) => item.recipe_id);

      const recipesFromDb = await Recipe.find({ _id: { $in: recipeIds } })
        .select("_id title image_url cook_time_mins")
        .lean();

      const finalMatchedRecipes = matchData
        .map((aiItem) => {
          const dbRecipe = recipesFromDb.find(
            (r) => r._id.toString() === aiItem.recipe_id,
          );
          return {
            id: aiItem.recipe_id,
            name: dbRecipe ? dbRecipe.title : "Resep Tidak Dikenal",
            image_url: dbRecipe ? dbRecipe.image_url : null,
            match_percentage: aiItem.match_percentage,
          };
        })
        .sort((a, b) => b.match_percentage - a.match_percentage);

      return res.status(200).json({
        message: "Resep berhasil dicocokkan",
        data: finalMatchedRecipes,
      });
    } catch (error) {
      console.error("[matchRecipe] Internal Error:", error);
      res
        .status(500)
        .json({ message: "Terjadi kesalahan internal saat mencocokkan resep" });
    }
  },

  // ==========================================
  // PREPARE COOKING & TRIGGER AI SUBSTITUTION
  // ==========================================
  prepareCooking: async (req, res) => {
    try {
      const userId = req.user.id;
      const { recipe_id, ingredients } = req.body;

      const recipe = await Recipe.findById(recipe_id).lean();
      if (!recipe) {
        return res.status(404).json({ message: "Resep tidak ditemukan" });
      }

      const missingIngredients = [];
      const surplusIngredients = [];

      // Determine Missing Ingredients
      recipe.ingredients.forEach((rIng) => {
        const isFound = ingredients.find(
          (uIng) =>
            (uIng.ingredient_id && uIng.ingredient_id === rIng.ingredient_id) ||
            uIng.name.toLowerCase() === rIng.name.toLowerCase(),
        );
        if (!isFound) {
          missingIngredients.push({
            id: rIng.ingredient_id,
            name: rIng.name,
            is_core: rIng.is_core,
          });
        }
      });

      // Determine Surplus Ingredients
      ingredients.forEach((uIng) => {
        const isNeeded = recipe.ingredients.find(
          (rIng) =>
            (rIng.ingredient_id && rIng.ingredient_id === uIng.ingredient_id) ||
            rIng.name.toLowerCase() === uIng.name.toLowerCase(),
        );
        if (!isNeeded) {
          surplusIngredients.push({
            id: uIng.ingredient_id,
            name: uIng.name,
            is_valid: uIng.is_valid,
          });
        }
      });

      // Retrieve User Sprite Data
      const user = await User.findById(userId).lean();
      let thinkingSprite =
        "https://res.cloudinary.com/cloud_senpai/image/upload/v1/sprites/default_thinking.png";

      if (user?.gamification?.equipped_sprite_id) {
        const spritePkg = await SpritePackage.findOne({
          package_id: user.gamification.equipped_sprite_id,
        }).lean();
        if (spritePkg?.assets?.thinking) {
          thinkingSprite = spritePkg.assets.thinking;
        }
      }

      let aiTaskId = null;
      let dialogText = "Semua bahan lengkap. Selamat memasak!";

      // Async AI Trigger
      if (missingIngredients.length > 0) {
        aiTaskId = `task_ai_${crypto.randomBytes(8).toString("hex")}`;
        dialogText =
          "Menganalisis alternatif bahan yang kurang, mohon tunggu sebentar.";

        const aiPayload = {
          task_id: aiTaskId,
          recipe_id: recipe_id,
          missing_ingredients: missingIngredients,
          surplus_ingredients: surplusIngredients,
        };

        const mlServiceUrl =
          process.env.INTERNAL_AI_SERVICE_URL || "http://localhost:8000";

        // Fire and forget mechanism
        axios
          .post(`${mlServiceUrl}/ai/cooking/ai-substitution`, aiPayload, {
            headers: { "x-internal-api-key": process.env.INTERNAL_AI_API_KEY },
          })
          .catch((err) => {
            console.error(
              `[AI Sub Error] Task ${aiTaskId} failed:`,
              err.message,
            );
          });
      }

      return res.status(200).json({
        message: "Persiapan memasak berhasil dimuat",
        data: {
          ai_task_id: aiTaskId,
          recipe: {
            id: recipe._id,
            name: recipe.title,
            match_percentage: req.body.match_percentage || 100,
            description: recipe.description,
            cook_time_mins: recipe.cook_time_mins,
            image_url: recipe.image_url,
            steps: recipe.steps || [],
            ingredients: recipe.ingredients.map((i) => `${i.qty} ${i.name}`),
          },
          missing_ingredients: missingIngredients,
          character: {
            sprite: thinkingSprite,
            dialog: dialogText,
          },
        },
      });
    } catch (error) {
      console.error("[prepareCooking] Error:", error);
      res
        .status(500)
        .json({
          message: "Terjadi kesalahan internal saat menyiapkan masakan",
        });
    }
  },

  // ==========================================
  // POLLING AI TASK RESULT
  // ==========================================
  getAiTaskResult: async (req, res) => {
    try {
      const taskId = req.params.task_id;
      const userId = req.user.id;
      const mlServiceUrl =
        process.env.INTERNAL_AI_SERVICE_URL || "http://localhost:8000";

      let mlResponse;
      try {
        mlResponse = await axios.get(
          `${mlServiceUrl}/ai/cooking/ai-result/${taskId}`,
          {
            headers: {
              "x-internal-api-key": process.env.INTERNAL_AI_API_KEY,
              Accept: "application/json",
            },
          },
        );
      } catch (aiError) {
        if (aiError.response?.status === 404) {
          return res
            .status(404)
            .json({
              message: "Tugas AI tidak ditemukan atau kedaluwarsa",
              data: null,
            });
        }
        console.error("[getAiTaskResult] API Error:", aiError.message);
        return res.status(503).json({ message: "Layanan AI tidak tersedia" });
      }

      const taskData = mlResponse.data.data;

      let updatedSpriteUrl = null;
      if (taskData.status === "completed" && taskData.result) {
        const user = await User.findById(userId)
          .select("gamification.equipped_sprite_id")
          .lean();
        const spritePkg = await SpritePackage.findOne({
          package_id: user.gamification.equipped_sprite_id,
        }).lean();

        // Map AI result status to corresponding sprite asset
        const statusMap = {
          fully_success: "happy",
          mid_success: "happy",
          fail: "fail",
        };

        const assetKey =
          statusMap[taskData.result.character.status] || "thinking";
        updatedSpriteUrl = spritePkg?.assets?.[assetKey] || null;

        const substitutions = taskData.result.substitutions_mapping || [];
        await redisClient.setEx(
          `ai_substitutions:${userId}`,
          3600,
          JSON.stringify(substitutions),
        );
      }

      return res.status(200).json({
        message: `Status tugas AI: ${taskData.status}`,
        data: {
          status: taskData.status,
          result: taskData.status === "completed" ? taskData.result : null,
          updated_sprite_url: updatedSpriteUrl,
        },
      });
    } catch (error) {
      console.error("[getAiTaskResult] Internal Error:", error);
      res
        .status(500)
        .json({ message: "Terjadi kesalahan internal saat memuat status AI" });
    }
  },

  // ==========================================
  // START COOKING SESSION
  // ==========================================
  startCooking: async (req, res) => {
    try {
      const userId = req.user.id;
      const { recipe_id } = req.body;

      if (!recipe_id) {
        return res.status(400).json({ message: "ID Resep wajib disertakan" });
      }

      const recipe = await Recipe.findById(recipe_id).lean();
      if (!recipe || recipe.status !== "published") {
        return res.status(404).json({ message: "Resep tidak tersedia" });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res
          .status(404)
          .json({ message: "Data pengguna tidak ditemukan" });
      }

      // Merge Original Ingredients with AI Substitutions
      const aiSubData = await redisClient.get(`ai_substitutions:${userId}`);
      let substitutions = [];

      if (aiSubData) {
        substitutions = JSON.parse(aiSubData);
        await redisClient.del(`ai_substitutions:${userId}`);
      }

      let finalIngredientsUsed = recipe.ingredients.map((ing) => ing.name);

      if (substitutions.length > 0) {
        substitutions.forEach((sub) => {
          const index = finalIngredientsUsed.findIndex(
            (name) =>
              name.toLowerCase() === sub.missing_item.name.toLowerCase(),
          );

          if (index !== -1) {
            finalIngredientsUsed[index] = sub.replaced_with.name;
          } else {
            finalIngredientsUsed.push(sub.replaced_with.name);
          }
        });
      }

      // Cache used ingredients for 24 hours
      await redisClient.setEx(
        `saved_ingredients:${userId}`,
        86400,
        JSON.stringify(finalIngredientsUsed),
      );

      user.active_cooking_session = recipe._id;
      await user.save();

      return res.status(200).json({
        message: "Sesi memasak berhasil dimulai",
        data: { active_recipe_id: recipe._id },
      });
    } catch (error) {
      console.error("[startCooking] Error:", error);
      if (error.kind === "ObjectId") {
        return res.status(404).json({ message: "Format ID resep tidak valid" });
      }
      res
        .status(500)
        .json({ message: "Terjadi kesalahan internal saat memulai sesi" });
    }
  },

  // ==========================================
  // CANCEL COOKING SESSION
  // ==========================================
  cancelCooking: async (req, res) => {
    try {
      const userId = req.user.id;
      const user = await User.findById(userId);

      if (!user)
        return res.status(404).json({ message: "Pengguna tidak ditemukan" });

      user.active_cooking_session = null;
      await user.save();
      await redisClient.del(`saved_ingredients:${userId}`);

      return res.status(200).json({
        message: "Sesi memasak dibatalkan",
        data: { active_cooking_session: null },
      });
    } catch (error) {
      console.error("[cancelCooking] Error:", error);
      res
        .status(500)
        .json({ message: "Terjadi kesalahan internal saat membatalkan sesi" });
    }
  },

  // ==========================================
  // CLOUDINARY SIGNATURE GENERATOR
  // ==========================================
  getProofCloudinarySignature: async (req, res) => {
    try {
      const userId = req.user.id;
      const timestamp = Math.floor(Date.now() / 1000);
      const folderName = `Youri/youri_cooking_proofs/${userId}`;

      const paramsToSign = {
        timestamp: timestamp,
        folder: folderName,
      };

      const signature = cloudinary.utils.api_sign_request(
        paramsToSign,
        process.env.CLOUDINARY_API_SECRET,
      );

      return res.status(200).json({
        message: "Signature Cloudinary berhasil dibuat",
        data: {
          signature,
          timestamp,
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          folder: folderName,
        },
      });
    } catch (error) {
      console.error("[getProofCloudinarySignature] Error:", error);
      res.status(500).json({ message: "Gagal membuat signature Cloudinary" });
    }
  },

  // ==========================================
  // FINISH COOKING & PROCESS GAMIFICATION
  // ==========================================
  finishCooking: async (req, res) => {
    try {
      const userId = req.user.id;
      const { recipe_id, proof_image_url } = req.body;

      if (!recipe_id || !proof_image_url) {
        return res
          .status(400)
          .json({ message: "ID Resep dan Foto Bukti wajib dilampirkan" });
      }

      const user = await User.findById(userId);
      if (!user)
        return res.status(404).json({ message: "Pengguna tidak ditemukan" });

      const recipe = await Recipe.findById(recipe_id)
        .select("categories")
        .lean();
      if (!recipe)
        return res.status(404).json({ message: "Data resep tidak ditemukan" });

      // Retrieve cached ingredients
      const redisKey = `saved_ingredients:${userId}`;
      const redisData = await redisClient.get(redisKey);
      let savedIngredients = [];

      if (redisData) {
        savedIngredients = JSON.parse(redisData);
        await redisClient.del(redisKey);
      }

      // Record History
      const newHistory = new CookingHistory({
        user_id: userId,
        recipe_id: recipe_id,
        categories: recipe.categories,
        proof_image_url: proof_image_url,
        saved_ingredients: savedIngredients,
        is_claimed: false,
      });
      await newHistory.save();

      // ----------------------------------------------------
      // GAMIFICATION PROCESSING
      // ----------------------------------------------------

      // Calculate Most Frequent Category
      const allHistories = await CookingHistory.find({ user_id: userId })
        .select("categories")
        .lean();
      const categoryCounts = {};

      allHistories.forEach((history) => {
        history.categories.forEach((cat) => {
          categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
        });
      });

      let maxCount = 0;
      let topCategory = user.favourite_category;
      for (const cat in categoryCounts) {
        if (categoryCounts[cat] > maxCount) {
          maxCount = categoryCounts[cat];
          topCategory = cat;
        }
      }
      user.favourite_category = topCategory;

      // Update Weekly Streak
      const now = new Date();
      const dayOfWeek = now.getDay();
      const diffToMonday =
        now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      const startOfWeek = new Date(now.setDate(diffToMonday));
      startOfWeek.setHours(0, 0, 0, 0);

      const thisWeekHistories = await CookingHistory.find({
        user_id: userId,
        cooked_at: { $gte: startOfWeek },
      }).lean();

      const newStreak = [false, false, false, false, false, false, false];
      thisWeekHistories.forEach((history) => {
        const cookDate = new Date(history.cooked_at);
        const streakIndex = cookDate.getDay() === 0 ? 6 : cookDate.getDay() - 1;
        newStreak[streakIndex] = true;
      });

      user.gamification.streak_days = newStreak;
      user.markModified("gamification.streak_days");

      // Calculate EXP & Leveling
      let earnedXp = user.gamification.level >= 99 ? 0 : 50;
      const oldLevel = user.gamification.level;
      user.gamification.current_xp += earnedXp;

      while (user.gamification.current_xp >= user.gamification.next_xp) {
        user.gamification.current_xp -= user.gamification.next_xp;
        user.gamification.level += 1;
        user.gamification.is_level_up = true;
        user.gamification.next_xp = Math.floor(user.gamification.next_xp * 1.7);
      }

      user.active_cooking_session = null;
      const newLevel = user.gamification.level;

      // Process Unlocked Sprites (Level Up Rewards)
      if (newLevel > oldLevel) {
        const unlockedSprites = await SpritePackage.find({
          unlock_at_level: { $gt: oldLevel, $lte: newLevel },
        }).lean();

        if (unlockedSprites.length > 0) {
          const notifications = unlockedSprites.map((sprite) => ({
            user_id: userId,
            title: "Kosmetik Baru Terbuka!",
            context: { context_type: "sprite", item_id: sprite._id },
            message: `Selamat! Mencapai Level ${sprite.unlock_at_level} membuka paket kosmetik "${sprite.package_name}".`,
            is_read: false,
          }));
          await Notification.insertMany(notifications);
        }
      }

      await user.save();

      // Retrieve Sprite Asset
      const SpritePkg = await SpritePackage.findOne({
        package_id: user.gamification.equipped_sprite_id,
      }).lean();

      return res.status(200).json({
        message: "Sesi memasak berhasil diselesaikan",
        data: {
          saved_ingredients: savedIngredients,
          categories_earned: recipe.categories,
          favourite_category: user.favourite_category,
          streak_days: user.gamification.streak_days,
          gamification: {
            exp_earned: earnedXp,
            level: user.gamification.level,
            current_xp: user.gamification.current_xp,
            next_xp: user.gamification.next_xp,
            is_level_up: user.gamification.is_level_up,
          },
          happy_sprite: SpritePkg?.assets?.happy || null,
        },
      });
    } catch (error) {
      console.error("[finishCooking] Error:", error);
      res
        .status(500)
        .json({
          message:
            "Terjadi kesalahan internal saat menyelesaikan proses masakan",
        });
    }
  },
};

module.exports = cookingController;
