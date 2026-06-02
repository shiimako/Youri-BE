const express = require("express");
const router = express.Router();

const cookingController = require("../controllers/cookingController");
const recipeController = require("../controllers/RecipeController");
const authGuard = require("../middleware/authGuard");

// ==========================================
// COOKING FLOW ROUTES
// ==========================================

router.post("/match", authGuard, cookingController.matchRecipe);
router.post("/preparing", authGuard, cookingController.prepareCooking);
router.get("/ai-result/:task_id", authGuard, cookingController.getAiTaskResult);
router.post("/start", authGuard, cookingController.startCooking);
router.post("/cancel", authGuard, cookingController.cancelCooking);
router.get("/proof-upload-signature", authGuard, cookingController.getProofCloudinarySignature);
router.post("/finish", authGuard, cookingController.finishCooking);
router.get("/:id", authGuard, cookingController.getRecipeToCook);
router.post("/:id/report", authGuard, recipeController.submitRecipeReport);

module.exports = router;