const mongoose = require("mongoose");

// ==========================================
// 1. USER SCHEMA (Profile & Gamification)
// ==========================================
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password_hash: { type: String, required: true },
    role: { type: String, default: "user" },
    avatar_url: { type: String, default: null },

    favourite_category: { type: String, default: null },

    active_cooking_session: {
      type: String,
      default: null,
      description: "Stores recipe_id. Null if the user is not currently cooking.",
    },

    gamification: {
      level: { type: Number, default: 1 },
      current_xp: { type: Number, default: 0 },
      next_xp: { type: Number, default: 100 },
      is_level_up: { type: Boolean, default: false },
      title: { type: String, default: "Beginner" },
      streak_days: {
        type: [Boolean],
        default: [false, false, false, false, false, false, false],
      },
      equipped_sprite_id: { type: String, default: "pkg_001" },
    },
    reset_otp: { type: String, default: null },
    reset_otp_expires: { type: Date, default: null }
  },
  { 
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, 
    collection: "users" 
  }
);

// ==========================================
// 2. RECIPE SCHEMA (User Recipe Management)
// ==========================================
const recipeSchema = new mongoose.Schema(
  {
    author_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true },
    image_url: { type: String, required: true }, 
    cook_time_mins: { type: Number, required: true },
    description: { type: String },
    categories: [{ type: String }],
    steps: [{ type: String }],
    ingredients: [
      {
        ingredient_id: { type: String, default: null }, // Null for newly custom user ingredients
        name: { type: String, required: true },
        qty: { type: Number, required: true, default: 0 },
        metric: { type: String, required: true, default: "secukupnya" },
        is_core: { type: Boolean, default: false },
        raw: { type: String, required: true }, // Raw string input from user
      },
    ],
    status: {
      type: String,
      enum: ["published", "taken_down", "deleted"],
      default: "published",
    },
  },
  { 
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" }, 
    collection: "recipes" 
  }
);

// ==========================================
// 3. NOTIFICATION SCHEMA (User Mailbox)
// ==========================================
const notificationSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true },
    context: { 
      context_type: { type: String, enum: ["recipe", "sprite"], required: true },
      item_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    },
    message: { type: String, required: true },
    is_read: { type: Boolean, default: false },
  },
  { 
    timestamps: { createdAt: "created_at", updatedAt: false }, 
    collection: "notifications" 
  }
);

// ==========================================
// 4. SPRITE PACKAGE SCHEMA (Mascot Cosmetics)
// ==========================================
const spritePackageSchema = new mongoose.Schema(
  {
    package_id: { type: String, required: true, unique: true },
    package_name: { type: String, required: true },
    unlock_at_level: { type: Number, default: 1 },
    is_active: { type: Boolean, default: true },
    assets: {
      badge: { type: String },
      start_button: { type: String },
      thinking: { type: String },
      fail: { type: String },
      happy: { type: String },
    },
  },
  { 
    timestamps: { createdAt: "created_at", updatedAt: false }, 
    collection: "sprite_packages" 
  }
);

// ==========================================
// 5. INGREDIENT MASTER SCHEMA (AI Dictionary)
// ==========================================
const ingredientMasterSchema = new mongoose.Schema(
  {
    ingredient_id: { type: String, required: true, unique: true },
    clean_name: { type: String, required: true, unique: true }, 
    display_name: { type: String, required: true }, 
    food_group: { type: String, required: true }, 
    flavor_vector: { type: [Number], default: [] }, // Numerical vector from AI embedding
  },
  { collection: "ingredients_master" }
);

// ==========================================
// 6. SUBSTITUTION RULES SCHEMA (AI Smart Cache)
// ==========================================
const substitutionRulesSchema = new mongoose.Schema(
  {
    base_id: { type: String, required: true, index: true }, 
    sub_id: { type: String, required: true },
    ratio: { type: Number, default: 1.0 },
    confidence_score: { type: Number, default: 0.85 },
  },
  { collection: "substitution_rules" }
);

// ==========================================
// 7. CATEGORY MASTER SCHEMA
// ==========================================
const categoryMasterSchema = new mongoose.Schema(
  {
    category_id: { type: String, required: true, unique: true }, 
    name: { type: String, required: true },
    usage_count: { type: Number, default: 0 }, // Counters for recipe usage
  },
  { collection: "categories_master" }
);

// ==========================================
// 8. COOKING HISTORY SCHEMA
// ==========================================
const cookingHistorySchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipe_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Recipe",
      required: true,
    },
    categories: [{ type: String }],
    saved_ingredients: [{ type: String }],
    proof_image_url: { type: String, required: true },
    is_claimed: { type: Boolean, default: false },
  },
  { 
    timestamps: { createdAt: "cooked_at", updatedAt: false }, 
    collection: "cooking_history" 
  }
);

// ==========================================
// 9. TEMP INGREDIENTS SCHEMA (Curation Queue)
// ==========================================
const tempIngredientSchema = new mongoose.Schema(
  {
    raw_name: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["pending", "approved", "declined"],
      default: "pending",
    },
    decline_reason: { type: String, default: null },
  },
  { 
    timestamps: true, 
    collection: "temp_ingredients" 
  }
);

// ==========================================
// 10. RECIPE REPORT SCHEMA (Content Moderation)
// ==========================================
const recipeReportSchema = new mongoose.Schema(
  {
    recipe_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Recipe",
      required: true,
    },
    reporter_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    category: {
      type: String,
      enum: ["spam", "inappropriate", "irrelevant", "fake_recipe"],
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "resolved", "dismissed"],
      default: "pending",
      required: true,
    },
  },
  {
    timestamps: true,
    collection: "recipe_reports",
  }
);

module.exports = {
  User: mongoose.model("User", userSchema),
  Recipe: mongoose.model("Recipe", recipeSchema),
  Notification: mongoose.model("Notification", notificationSchema),
  SpritePackage: mongoose.model("SpritePackage", spritePackageSchema),
  IngredientMaster: mongoose.model("IngredientMaster", ingredientMasterSchema),
  SubstitutionRule: mongoose.model("SubstitutionRule", substitutionRulesSchema),
  CategoryMaster: mongoose.model("CategoryMaster", categoryMasterSchema),
  CookingHistory: mongoose.model("CookingHistory", cookingHistorySchema),
  TempIngredients: mongoose.model("TempIngredients", tempIngredientSchema),
  RecipeReport: mongoose.model("RecipeReport", recipeReportSchema),
};