const { User } = require('../models/model');
const cloudinary = require('cloudinary').v2;
const bcrypt = require('bcrypt');

const profileController = {
  // ==========================================
  // GET USER PROFILE
  // ==========================================
  getProfile: async (req, res) => {
    try {
      const userId = req.user.id; 

      // Optimized with .select() and .lean() for read-only operation
      const user = await User.findById(userId)
        .select('_id username email avatar_url')
        .lean();

      if (!user) {
        return res.status(404).json({ message: "Data pengguna tidak ditemukan" });
      }

      return res.status(200).json({
        message: "Profil berhasil dimuat",
        data: {
          user_id: user._id,
          username: user.username,
          email: user.email,
          avatar_url: user.avatar_url
        }
      });
    } catch (error) {
      console.error("[getProfile] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat memuat profil" });
    }
  },

  // ==========================================
  // UPDATE USER PROFILE
  // ==========================================
  updateProfile: async (req, res) => {
    try {
      const userId = req.user.id;
      const { username, avatar_url } = req.body;
      const errors = {};

      // Username Validation
      if (username) {
        if (username.length < 3) {
          errors.username = ["Username minimal 3 karakter"];
        } else {
          const existingUser = await User.findOne({ 
            username: username, 
            _id: { $ne: userId } 
          }).lean();
          
          if (existingUser) {
            errors.username = ["Username sudah digunakan oleh pengguna lain"];
          }
        }
      }

      if (Object.keys(errors).length > 0) {
        return res.status(400).json({
          message: "Gagal memperbarui profil",
          errors: errors
        });
      }

      const updateData = {};
      if (username) updateData.username = username;
      if (avatar_url) updateData.avatar_url = avatar_url;

      const updatedUser = await User.findByIdAndUpdate(
        userId, 
        updateData, 
        { new: true } 
      );

      if (!updatedUser) {
        return res.status(404).json({ message: "Data pengguna tidak ditemukan" });
      }

      return res.status(200).json({
        message: "Profil berhasil diperbarui",
        data: null
      });

    } catch (error) {
      console.error("[updateProfile] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat memperbarui profil" });
    }
  },

  // ==========================================
  // GET CLOUDINARY UPLOAD SIGNATURE
  // ==========================================
  getProfileUploadSignature: async (req, res) => {
    try {
      const timestamp = Math.round((new Date).getTime() / 1000);
      const targetFolder = 'Youri/youri_avatars';
      const customPublicId = `avatar_${req.user.id}`;

      const signature = cloudinary.utils.api_sign_request(
        {
          timestamp: timestamp,
          folder: targetFolder,
          public_id: customPublicId,
          overwrite: true,  
          invalidate: true
        },
        process.env.CLOUDINARY_API_SECRET
      );

      return res.status(200).json({
        message: "Signature profil berhasil dibuat",
        data: {
          signature: signature,
          timestamp: timestamp,
          api_key: process.env.CLOUDINARY_API_KEY,
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          folder: targetFolder, 
          public_id: customPublicId
        }
      });

    } catch (error) {
      console.error("[getProfileUploadSignature] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat membuat signature upload" });
    }
  },

  // ==========================================
  // UPDATE / SET PASSWORD
  // ==========================================
  updatePassword: async (req, res) => {
    try {
      const userId = req.user.id;
      const { old_password, new_password } = req.body; 

      if (!new_password || new_password.length < 6) {
        return res.status(400).json({ message: "Password baru minimal 6 karakter" });
      }

      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: "Data pengguna tidak ditemukan" });

      const isSsoUser = user.password_hash.startsWith("SSO_GOOGLE_");

      if (isSsoUser) {
        // Set password for SSO user
        user.password_hash = await bcrypt.hash(new_password, 10);
        await user.save();

        return res.status(200).json({ 
          message: "Password berhasil dibuat. Anda sekarang dapat login secara manual." 
        });

      } else {
        // Update password for regular user
        if (!old_password) {
          return res.status(400).json({ message: "Password lama wajib diisi" });
        }

        const isMatch = await bcrypt.compare(old_password, user.password_hash);
        if (!isMatch) {
          return res.status(401).json({ message: "Kredensial tidak valid: Password lama salah" });
        }

        user.password_hash = await bcrypt.hash(new_password, 10);
        await user.save();

        return res.status(200).json({ message: "Password berhasil diperbarui" });
      }
    } catch (error) {
      console.error("[updatePassword] Error:", error);
      res.status(500).json({ message: "Terjadi kesalahan internal saat memproses password" });
    }
  }
};

module.exports = profileController;