const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const { SpritePackage, User } = require('../../models/model');

const adminGamificationController = {
  // ==========================================
  // GET ALL SPRITE PACKAGES
  // ==========================================
  getAllSpritePackages: async (req, res) => {
    try {
      const packages = await SpritePackage.find().lean();

      const formattedPackages = packages.map((pkg) => {
        const assetsCount = pkg.assets ? Object.keys(pkg.assets).length : 0;
        return {
          package_id: pkg.package_id,
          package_name: pkg.package_name,
          unlock_at: pkg.unlock_at_level,
          is_active: pkg.is_active,
          assets_count: assetsCount
        };
      });

      return res.status(200).json({
        message: "Semua paket sprite berhasil dimuat",
        data: formattedPackages
      });

    } catch (error) {
      console.error("[getAllSpritePackages] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat memuat paket sprite" });
    }
  },

  // ==========================================
  // CREATE NEW SPRITE PACKAGE
  // ==========================================
  createSpritePackage: async (req, res) => {
    try {
      const { package_name, unlock_at, is_active } = req.body;

      if (!package_name || package_name.trim() === "") {
        return res.status(400).json({ message: "Nama paket sprite wajib diisi" });
      }
      
      if (unlock_at === undefined || unlock_at === null || isNaN(unlock_at) || unlock_at < 1) {
        return res.status(400).json({ message: "Level minimum (unlock_at) wajib diisi dengan angka minimal 1" });
      }

      const lastPackage = await SpritePackage.findOne().sort({ package_id: -1 });
      let packageId = "pkg_001";

      if (lastPackage && lastPackage.package_id.startsWith("pkg_")) {
        const lastNumber = parseInt(lastPackage.package_id.split("_")[1], 10);
        if (!isNaN(lastNumber)) {
          packageId = `pkg_${String(lastNumber + 1).padStart(3, '0')}`;
        }
      }

      const newPackage = await SpritePackage.create({
        package_id: packageId,
        package_name: package_name.trim(),
        unlock_at_level: parseInt(unlock_at, 10),
        is_active: is_active !== undefined ? is_active : true, 
        assets: {} 
      });

      return res.status(201).json({
        message: "Paket sprite berhasil dibuat",
        data: {
          package_id: newPackage.package_id
        }
      });

    } catch (error) {
      console.error("[createSpritePackage] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat membuat paket sprite baru" });
    }
  },

  // ==========================================
  // GET SPECIFIC SPRITE PACKAGE DETAIL
  // ==========================================
  getSpritePackageDetail: async (req, res) => {
    try {
      const { package_id } = req.params;

      const pkg = await SpritePackage.findOne({ package_id: package_id }).lean();

      if (!pkg) {
        return res.status(404).json({ message: "Paket sprite tidak ditemukan" });
      }

      const responseData = {
        package_id: pkg.package_id,
        package_name: pkg.package_name,
        unlock_at: pkg.unlock_at_level, 
        is_active: pkg.is_active,
        assets: pkg.assets || {} 
      };

      return res.status(200).json({
        message: "Detail paket sprite berhasil dimuat",
        data: responseData
      });

    } catch (error) {
      console.error("[getSpritePackageDetail] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat memuat detail paket sprite" });
    }
  },

  // ==========================================
  // UPDATE SPRITE PACKAGE METADATA
  // ==========================================
  updateSpritePackage: async (req, res) => {
    try {
      const { package_id } = req.params;
      const { package_name, unlock_at, is_active } = req.body;

      const pkg = await SpritePackage.findOne({ package_id: package_id });
      
      if (!pkg) {
        return res.status(404).json({ message: "Paket sprite tidak ditemukan" });
      }

      if (package_name !== undefined && package_name.trim() !== "") {
        pkg.package_name = package_name.trim();
      }
      if (unlock_at !== undefined && !isNaN(unlock_at) && unlock_at >= 1) {
        pkg.unlock_at_level = parseInt(unlock_at, 10);
      }
      if (is_active !== undefined) {
        pkg.is_active = is_active;
      }

      await pkg.save();

      return res.status(200).json({
        message: "Metadata paket sprite berhasil diperbarui",
        data: null
      });

    } catch (error) {
      console.error("[updateSpritePackage] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat memperbarui paket sprite" });
    }
  },

  // ==========================================
  // DELETE SPRITE PACKAGE (TRANSACTIONAL)
  // ==========================================
  deleteSpritePackage: async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { package_id } = req.params;

      const deletedPkg = await SpritePackage.findOneAndDelete({ package_id: package_id }).session(session);

      if (!deletedPkg) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: "Paket sprite tidak ditemukan" });
      }

      // Reset users equipped with this sprite to prevent broken images
      await User.updateMany(
        { "gamification.equipped_sprite_id": package_id },
        { $set: { "gamification.equipped_sprite_id": null } },
        { session }
      );

      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        message: "Paket sprite berhasil dihapus secara permanen",
        data: null
      });

    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("[deleteSpritePackage] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat menghapus paket sprite" });
    }
  },

  // ==========================================
  // ADD BULK SPRITE ASSETS
  // ==========================================
  addBulkSpriteAssets: async (req, res) => {
    try {
      const { package_id } = req.params;
      const { assets } = req.body;

      if (!assets || !Array.isArray(assets) || assets.length === 0) {
        return res.status(400).json({ 
          message: "Payload assets harus berupa array dan tidak boleh kosong" 
        });
      }

      const pkg = await SpritePackage.findOne({ package_id: package_id });
      
      if (!pkg) {
        return res.status(404).json({ message: "Paket sprite tidak ditemukan" });
      }

      if (!pkg.assets) {
        pkg.assets = {};
      }

      assets.forEach(item => {
        if (item.sprite_name && item.url) {
          const cleanKey = item.sprite_name.trim().toLowerCase();
          pkg.assets[cleanKey] = item.url.trim();
        }
      });

      // Notify Mongoose of changes to Mixed type object
      pkg.markModified('assets');

      await pkg.save();

      return res.status(200).json({
        message: "Aset sprite bulk berhasil ditambahkan",
        data: null
      });

    } catch (error) {
      console.error("[addBulkSpriteAssets] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat menyimpan aset sprite" });
    }
  },

  // ==========================================
  // DELETE SPECIFIC SPRITE ASSET
  // ==========================================
  deleteSpriteAsset: async (req, res) => {
    try {
      const { package_id, sprite_name } = req.params;

      const pkg = await SpritePackage.findOne({ package_id: package_id });
      
      if (!pkg) {
        return res.status(404).json({ message: "Paket sprite tidak ditemukan" });
      }

      if (!pkg.assets || !pkg.assets[sprite_name]) {
        return res.status(404).json({ 
          message: `Aset dengan nama pose '${sprite_name}' tidak ditemukan di paket ini` 
        });
      }

      delete pkg.assets[sprite_name];

      // Notify Mongoose of changes to Mixed type object
      pkg.markModified('assets');

      await pkg.save();

      return res.status(200).json({
        message: "Aset sprite berhasil dihapus",
        data: null
      });

    } catch (error) {
      console.error("[deleteSpriteAsset] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat menghapus aset sprite" });
    }
  },

  // ==========================================
  // GENERATE BULK CLOUDINARY SIGNATURES
  // ==========================================
  generateBulkSignatures: async (req, res) => {
    try {
      const { files } = req.body;

      if (!files || !Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ 
          message: "Payload 'files' harus berupa array dan tidak boleh kosong" 
        });
      }

      const signaturesList = files.map(file => {
        const timestamp = Math.round((new Date).getTime() / 1000);
        
        const publicId = file.sprite_name.trim();
        const folderPath = file.folder_path.trim();

        const signature = cloudinary.utils.api_sign_request(
          {
            timestamp: timestamp,
            folder: folderPath,
            public_id: publicId,
            overwrite: true, 
            invalidate: true
          },
          process.env.CLOUDINARY_API_SECRET
        );

        return {
          sprite_name: publicId,
          signature: signature,
          timestamp: timestamp,
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          folder: folderPath,
          public_id: publicId
        };
      });

      return res.status(200).json({
        message: "Bulk signatures generated successfully",
        data: signaturesList
      });

    } catch (error) {
      console.error("[generateBulkSignatures] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat membuat bulk signatures" });
    }
  }
};

module.exports = adminGamificationController;