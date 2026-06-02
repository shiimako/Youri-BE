const { User, Recipe, SpritePackage, CookingHistory, Notification } = require("../models/model");

const dashboardController = {
  // ==========================================
  // GET USER DASHBOARD DATA
  // ==========================================
  getDashboard: async (req, res) => {
    try {
      const userId = req.user.id;

      // Applied .lean() for read-only optimization
      const user = await User.findById(userId).lean();
      if (!user) {
        return res.status(404).json({ message: "Data pengguna tidak ditemukan" });
      }

      // 1. Check Gamification Claims Status
      const unclaimedHistory = await CookingHistory.findOne({ 
        user_id: userId, 
        is_claimed: false 
      }).lean();
      
      const canClaimStatus = !!unclaimedHistory; 

      // 2. Check Recipe & Notification Statuses
      const takenDownRecipe = await Recipe.findOne({
        author_id: userId,
        status: "taken_down"
      }).lean();
      
      const isTakenDownStatus = !!takenDownRecipe;

      const mailboxNotification = await Notification.findOne({
        user_id: userId,
        is_read: false,
      }).lean();

      const isMailboxStatus = !!mailboxNotification;

      // 3. Retrieve Dynamic Sprite Assets
      let dynamicAssets = {
        badge: null,
        start_button: null,
        loading: null
      };

      if (user.gamification?.equipped_sprite_id) {
        const spritePkg = await SpritePackage.findOne({ 
          package_id: user.gamification.equipped_sprite_id 
        }).lean();

        if (spritePkg?.assets) {
          dynamicAssets = {
            badge: spritePkg.assets.badge || null,
            start_button: spritePkg.assets.start_button || null,
            loading: spritePkg.assets.loading || null
          };
        }
      }

      // 4. Construct Final Response
      return res.status(200).json({
        message: "Data dashboard berhasil dimuat",
        data: {
          username: user.username,
          role: user.role,
          avatar_url: user.avatar_url,
          favourite_category: user.favourite_category, 
          active_cooking_session: user.active_cooking_session,
          gamification_info: {
            level: user.gamification.level,
            title: user.gamification.title,
            current_xp: user.gamification.current_xp,
            next_xp: user.gamification.next_xp,
            streak_days: user.gamification.streak_days,
            can_claim: canClaimStatus,
            is_level_up: user.gamification.is_level_up,
            new_level_reached: user.gamification.level,
          },
          recipe: {
            is_taken_down: isTakenDownStatus, 
            is_mailbox: isMailboxStatus,
          },
          assets: dynamicAssets
        },
      });
    } catch (error) {
      console.error("[getDashboard] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal pada server" });
    }
  },

  // ==========================================
  // GET RECIPE RECOMMENDATIONS
  // ==========================================
  getRecommendations: async (req, res) => {
    try {
      const userId = req.user.id;
      
      // Read-only query optimized with select() and .lean()
      const user = await User.findById(userId).select("favourite_category").lean();
      if (!user) {
        return res.status(404).json({ message: "Data pengguna tidak ditemukan" });
      }

      let recipeQuery = { status: 'published' };
      if (user.favourite_category) {
        recipeQuery.categories = user.favourite_category; 
      }

      // Fetch random 20 published recipes matching user's favorite category
      let recipes = await Recipe.aggregate([
        { $match: recipeQuery },       
        { $sample: { size: 20 } }      
      ]);

      recipes = await Recipe.populate(recipes, {
        path: 'author_id',
        select: 'username'
      });

      // Fallback: If no recipes found in the favorite category, fetch 20 random published recipes
      if (recipes.length === 0 && user.favourite_category) {
        recipes = await Recipe.aggregate([
          { $match: { status: 'published' } },
          { $sample: { size: 20 } }     
        ]);
        
        recipes = await Recipe.populate(recipes, {
          path: 'author_id',
          select: 'username'
        });
      }

      const formattedRecipes = recipes.map(recipe => ({
        recipe_id: recipe._id,
        author_name: recipe.author_id ? recipe.author_id.username : "Unknown Chef",
        title: recipe.title,
        categories: recipe.categories,
        cooking_time: recipe.cook_time_mins,
        image_url: recipe.image_url
      }));

      return res.status(200).json({
        message: "Rekomendasi resep berhasil dimuat",
        data: formattedRecipes
      });

    } catch (error) {
      console.error("[getRecommendations] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan saat memuat rekomendasi resep" });
    }
  }
};

module.exports = dashboardController;