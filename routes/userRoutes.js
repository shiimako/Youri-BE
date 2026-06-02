const express = require('express');
const router = express.Router();

const authController = require("../controllers/AuthController");
const dashboardController = require("../controllers/DashboardController");
const profileController = require("../controllers/ProfileController");
const gamificationController = require('../controllers/GamificationController');
const recipeController = require('../controllers/RecipeController');
const notificationController = require('../controllers/NotificationController');

const authGuard = require("../middleware/authGuard");

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/google-auth', authController.googleAuth);
router.post('/request-password-reset', authController.requestPasswordReset);
router.post('/verify-otp', authController.verifyOTP);
router.post('/reset-password', authController.resetPassword);

// ==========================================
// DASHBOARD ROUTES
// ==========================================
router.get("/dashboard", authGuard, dashboardController.getDashboard);
router.get("/dashboard/recommendations", authGuard, dashboardController.getRecommendations);
router.patch("/acknowledge-levelup", authGuard, gamificationController.acknowledgeLevelUp);

// ==========================================
// USER PROFILE ROUTES
// ==========================================
router.get("/profile", authGuard, profileController.getProfile);
router.patch("/profile", authGuard, profileController.updateProfile);
router.get("/profile-upload-signature", authGuard, profileController.getProfileUploadSignature);
router.patch("/change-password", authGuard, profileController.updatePassword);

// ==========================================
// GAMIFICATION & HISTORY ROUTES
// ==========================================
router.get("/weekly-history", authGuard, gamificationController.getWeeklyHistory);
router.post("/weekly-history/claim", authGuard, gamificationController.claimWeeklyXp);
router.get("/sprites", authGuard, gamificationController.getSpritesCatalog);
router.post("/sprites", authGuard, gamificationController.equipSprite);

// ==========================================
// RECIPE MANAGEMENT ROUTES
// ==========================================
router.get("/recipes", authGuard, recipeController.getUserRecipes);
router.post("/recipes", authGuard, recipeController.createRecipe);
router.get("/recipes/:id", authGuard, recipeController.getRecipeDetail);
router.put("/recipes/:id", authGuard, recipeController.updateRecipe);
router.delete("/recipes/:id", authGuard, recipeController.deleteRecipe);
router.get("/recipe-upload-signature", authGuard, recipeController.getRecipeUploadSignature);
router.get("/recipe-edit-signature/:id", authGuard, recipeController.getRecipeEditSignature);

// ==========================================
// NOTIFICATION ROUTES
// ==========================================
router.get("/notifications", authGuard, notificationController.getNotifications);
router.patch("/notifications/:id/read", authGuard, notificationController.markNotificationRead);

module.exports = router;