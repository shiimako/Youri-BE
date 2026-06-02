require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const cloudinary = require("cloudinary").v2;
const cron = require("node-cron");

// Import Controllers & Routes
const metadataController = require("./controllers/MetadataController");
const userRoutes = require("./routes/userRoutes");
const cookingRoutes = require("./routes/cookingRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();

// ==========================================
// MIDDLEWARE CONFIGURATION
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// DATABASE CONNECTION
// ==========================================
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("[Database] MongoDB Atlas connected successfully."))
  .catch((err) => console.error("[Database] Connection error:", err.message));

// ==========================================
// EXTERNAL SERVICES CONFIGURATION
// ==========================================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// ==========================================
// API ROUTES DEFINITION
// ==========================================
const v1Router = express.Router();

v1Router.get("/health", (req, res) => {
  res.status(200).json({ message: "Youri API v1.0 is operational." });
});

// Route Mountings
v1Router.use("/cooking", cookingRoutes);
v1Router.use("/user", userRoutes);
v1Router.use("/admin", adminRoutes);

// Metadata Endpoints
v1Router.get("/ingredients", metadataController.searchIngredients);
v1Router.get("/categories", metadataController.searchCategories);
v1Router.post("/process-ingredients", metadataController.processPendingIngredients);

app.use("/v1", v1Router);

// ==========================================
// BACKGROUND TASKS
// ==========================================
// Schedule ingredient curation every 5 hours
cron.schedule('0 */5 * * *', () => {
  metadataController.processPendingIngredientsCron();
});

// ==========================================
// SERVER INITIALIZATION
// ==========================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`[Server] Youri Backend active on port: ${PORT}`);
});