require("dotenv").config();
const cloudinary = require("cloudinary").v2;

// ==========================================
// CLOUDINARY CONFIGURATION
// ==========================================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Initializes essential folder structure in Cloudinary
 */
const setupCloudinaryFolders = async () => {
  try {
    console.log("[Cloudinary] Initializing folder structures...");

    const folders = [
      "Youri/youri_assets",
      "Youri/youri_recipes",
      "Youri/youri_avatars",
      "Youri/youri_sprites",
    ];

    for (const folder of folders) {
      await cloudinary.api.create_folder(folder);
      console.log(`[Cloudinary] Folder verified: ${folder}`);
    }

    console.log("[Cloudinary] All core directories are ready.");
  } catch (error) {
    console.error("[Cloudinary] Initialization failed:", error.message);
  }
};

// Execute initialization
setupCloudinaryFolders();

module.exports = cloudinary;