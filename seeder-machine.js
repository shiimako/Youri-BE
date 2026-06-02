require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");

const {
  User,
  Recipe,
  Notification,
  SpritePackage,
  IngredientMaster,
  SubstitutionRule,
  CategoryMaster,
  CookingHistory,
  TempIngredients,
  RecipeReport,
} = require("./models/model");

const ADMIN_ID = "60d5ecb8b392d700153ef21c";

/**
 * Initializes and seeds the database with initial dataset.
 */
const seedDatabase = async () => {
  try {
    console.log("[Seeding] Connecting to database...");

    const mongoURI = process.env.MONGODB_URI || "mongodb://localhost:27017/youri_db";
    await mongoose.connect(mongoURI);
    console.log("[Seeding] Database connection established.");

    console.log("[Seeding] Wiping existing data...");
    await Promise.all([
      User.deleteMany({}),
      Recipe.deleteMany({}),
      Notification.deleteMany({}),
      SpritePackage.deleteMany({}),
      IngredientMaster.deleteMany({}),
      CategoryMaster.deleteMany({}),
      SubstitutionRule.deleteMany({}),
      CookingHistory.deleteMany({}),
      TempIngredients.deleteMany({}),
      RecipeReport.deleteMany({})
    ]);
    console.log("[Seeding] Data wipe complete.");

    // Load data from seed files
    const users = JSON.parse(fs.readFileSync(path.join(__dirname, "seeders/seed_user.json"), "utf8"));
    const ingredients = JSON.parse(fs.readFileSync(path.join(__dirname, "seeders/seed_ingredients.json"), "utf8"));
    const categories = JSON.parse(fs.readFileSync(path.join(__dirname, "seeders/seed_category.json"), "utf8"));
    const recipes = JSON.parse(fs.readFileSync(path.join(__dirname, "seeders/seed_resep.json"), "utf8"));
    
    // Clean and parse JSONC file
    const rawSprite = fs.readFileSync(path.join(__dirname, "seeders/seed_sprite.jsonc"), "utf8");
    const sprites = JSON.parse(rawSprite.replace(/\/\/.*$/gm, ""));

    console.log("[Seeding] Processing data injection...");

    // 1. Insert Users
    const mappedUsers = users.map((u) => {
      const hashedPassword = bcrypt.hashSync(u.password_hash, 10);
      if (u.role === "admin") {
        return {
          ...u,
          _id: new mongoose.Types.ObjectId(ADMIN_ID),
          password_hash: hashedPassword,
          gamification: { ...u.gamification, next_xp: 167504 },
        };
      }
      return { ...u, password_hash: hashedPassword };
    });

    await User.insertMany(mappedUsers);
    console.log(`[Seeding] ${mappedUsers.length} Users imported.`);

    // 2. Insert Collections
    await CategoryMaster.insertMany(categories);
    console.log(`[Seeding] ${categories.length} Categories imported.`);

    await IngredientMaster.insertMany(ingredients);
    console.log(`[Seeding] ${ingredients.length} Ingredients imported.`);

    await SpritePackage.insertMany(sprites);
    console.log(`[Seeding] ${sprites.length} Sprite Packages imported.`);

    await Recipe.insertMany(recipes);
    console.log(`[Seeding] ${recipes.length} Recipes imported.`);

    console.log("[Seeding] Database initialization complete.");
    process.exit(0);
  } catch (error) {
    console.error("[Seeding] Critical Error:", error.message);
    process.exit(1);
  }
};

seedDatabase();