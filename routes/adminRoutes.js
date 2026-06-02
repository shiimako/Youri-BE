const express = require("express");
const router = express.Router();

const GamificationController = require("../controllers/Admin/GamificationController");
const RecipeController = require("../controllers/Admin/RecipeController");
const authGuard = require("../middleware/authGuard"); 
const adminGuard = require("../middleware/adminGuard"); 

// ==========================================
// GAMIFICATION ROUTES
// ==========================================

// Packages CRUD
router.get("/sprites/packages", authGuard, adminGuard, GamificationController.getAllSpritePackages);
router.post("/sprites/packages", authGuard, adminGuard, GamificationController.createSpritePackage);
router.get("/sprites/packages/:package_id", authGuard, adminGuard, GamificationController.getSpritePackageDetail);
router.patch("/sprites/packages/:package_id", authGuard, adminGuard, GamificationController.updateSpritePackage);
router.delete("/sprites/packages/:package_id", authGuard, adminGuard, GamificationController.deleteSpritePackage);

// Assets Management
router.post("/sprites/packages/:package_id/assets/bulk", authGuard, adminGuard, GamificationController.addBulkSpriteAssets);
router.delete("/sprites/packages/:package_id/assets/:sprite_name", authGuard, adminGuard, GamificationController.deleteSpriteAsset);

// Signatures
router.post("/upload/bulk-signatures", authGuard, adminGuard, GamificationController.generateBulkSignatures);

// ==========================================
// RECIPE MODERATION ROUTES
// ==========================================

router.get("/reports", authGuard, adminGuard, RecipeController.getReports);
router.post("/reports/:report_id/action", authGuard, adminGuard, RecipeController.resolveReport);
router.post("/recipes/:recipe_id/takedown", authGuard, adminGuard, RecipeController.adminTakedownDirect);

module.exports = router;