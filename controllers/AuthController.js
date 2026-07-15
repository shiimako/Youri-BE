const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const nodemailer = require("nodemailer");
const { User } = require("../models/model");
const { Resend } = require("resend");

const authController = {
  // ==========================================
  // REGISTER USER
  // ==========================================
  register: async (req, res) => {
    try {
      const { username, email, password, confirm_password } = req.body;
      const errors = {};

      // Username Validation
      if (!username) {
        errors.username = ["Kolom username harus diisi"];
      } else if (username.length < 3) {
        errors.username = ["Username minimal 3 karakter"];
      }

      // Email Validation
      if (!email) {
        errors.email = ["Kolom email harus diisi"];
      } else {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          errors.email = ["Format email tidak valid"];
        } else {
          const existingUser = await User.findOne({ email });
          if (existingUser) {
            errors.email = ["Email sudah terdaftar"];
          }
        }
      }

      // Password Validation
      if (!password) {
        errors.password = ["Kolom password harus diisi"];
      } else {
        errors.password = [];
        if (password.length < 6)
          errors.password.push("Password minimal 6 karakter");
        if (!/[A-Z]/.test(password))
          errors.password.push("Password harus memiliki minimal 1 huruf besar");
        if (!/[0-9]/.test(password))
          errors.password.push("Password harus memiliki minimal 1 angka");

        if (errors.password.length === 0) delete errors.password;
      }

      // Confirm Password Validation
      if (!confirm_password) {
        errors.confirm_password = ["Kolom konfirmasi password harus diisi"];
      } else if (password !== confirm_password) {
        errors.confirm_password = [
          "Password dan konfirmasi password tidak cocok",
        ];
      }

      // Return Validation Errors
      if (Object.keys(errors).length > 0) {
        return res.status(400).json({
          message: "Validasi registrasi gagal",
          errors,
        });
      }

      // Hash Password & Save User
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      const newUser = new User({
        username,
        email,
        password_hash: hashedPassword,
      });
      await newUser.save();

      return res.status(201).json({
        message: "Registrasi berhasil, silakan login",
        data: null,
      });
    } catch (error) {
      console.error("[Register Error]:", error);
      res.status(500).json({
        message: "Terjadi kesalahan internal server saat registrasi",
        errors: error.message,
      });
    }
  },

  // ==========================================
  // LOGIN USER
  // ==========================================
  login: async (req, res) => {
    try {
      const { email, password } = req.body;
      const errors = {};

      // Basic Input Validation
      if (!email) {
        errors.email = ["Kolom email harus diisi"];
      } else {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email))
          errors.email = ["Format email tidak valid"];
      }

      if (!password) {
        errors.password = ["Kolom password harus diisi"];
      }

      if (Object.keys(errors).length > 0) {
        return res.status(400).json({
          message: "Validasi login gagal",
          errors,
        });
      }

      // Find User & Verify Password
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(401).json({
          message: "Kredensial tidak valid",
          errors: { email: ["Email tidak terdaftar"] },
        });
      }

      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return res.status(401).json({
          message: "Kredensial tidak valid",
          errors: { password: ["Password salah"] },
        });
      }

      // Generate JWT Token
      const secretKey = process.env.JWT_SECRET;
      const expiresIn = 86400; // 24 Hours in seconds

      const token = jwt.sign(
        { id: user._id, email: user.email, role: user.role },
        secretKey,
        { expiresIn },
      );

      return res.status(200).json({
        message: "Login berhasil",
        data: {
          access_token: token,
          token_type: "Bearer",
          expires_in: expiresIn,
        },
      });
    } catch (error) {
      console.error("[Login Error]:", error);
      res
        .status(500)
        .json({ message: "Terjadi kesalahan internal server saat login" });
    }
  },

  // ==========================================
  // GOOGLE SSO AUTHENTICATION
  // ==========================================
  googleAuth: async (req, res) => {
    try {
      const { google_token } = req.body;

      // Fetch user profile from Google
      const googleResponse = await axios.get(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          headers: { Authorization: `Bearer ${google_token}` },
        },
      );

      const { email, name, picture } = googleResponse.data;

      // Upsert User
      let user = await User.findOne({ email });

      if (!user) {
        user = new User({
          username: name,
          email: email,
          password_hash: `SSO_GOOGLE_${Math.random().toString(36).slice(-8)}`,
          avatar_url: picture,
          role: "user",
        });
        await user.save();
      } else if (!user.avatar_url && picture) {
        // Update avatar if previously empty
        user.avatar_url = picture;
        await user.save();
      }

      // Generate App JWT
      const access_token = jwt.sign(
        { id: user._id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "1d" },
      );

      return res.status(200).json({
        message: "Autentikasi Google berhasil",
        data: {
          access_token: access_token,
          user: {
            username: user.username,
            avatar_url: user.avatar_url,
            role: user.role,
          },
        },
      });
    } catch (error) {
      console.error("[Google SSO Error]:", error.message);
      return res.status(401).json({
        message: "Token Google tidak valid atau sudah kedaluwarsa",
      });
    }
  },

  // ==========================================
  // REQUEST PASSWORD RESET OTP
  // ==========================================
  requestPasswordReset: async (req, res) => {
    try {
      const { email } = req.body;
      const user = await User.findOne({ email });
      const resend = new Resend(process.env.RESEND_API_KEY);

      if (!user) {
        return res
          .status(404)
          .json({ message: "Email tidak terdaftar di sistem" });
      }

      // Generate 6-digit OTP & Set Expiry (15 minutes)
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      user.reset_otp = otpCode;
      user.reset_otp_expires = Date.now() + 15 * 60 * 1000;
      await user.save();

      // Email Configuration
      await resend.emails.send({
        from: "Youri Support <onboarding@resend.dev>",
        to: user.email,
        subject: "Kode Pemulihan Sandi",
        html: `
      <h3>Halo, ${user.username}</h3>
      <p>Seseorang meminta untuk mengatur ulang kata sandi akun Anda.</p>
      <p>Ini adalah kode OTP pemulihan Anda: <strong><span style="font-size: 24px; color: #C18A5E;">${otpCode}</span></strong></p>
      <p>Kode ini berlaku selama 15 menit. Jika Anda tidak meminta pemulihan sandi, abaikan email ini.</p>
    `,
      });
      console.log(`Email berhasil dikirim via Resend ke ${user.email}!`);

      return res
        .status(200)
        .json({ message: `Kode OTP pemulihan telah dikirim ke email ${user.email}` });
    } catch (error) {
      console.error("[Request Reset Password Error]:", error);
      res
        .status(500)
        .json({ message: "Gagal memproses permintaan pemulihan sandi" });
    }
  },

  // ==========================================
  // VERIFY OTP VALIDITY
  // ==========================================
  verifyOTP: async (req, res) => {
    try {
      const { email, otp } = req.body;

      const user = await User.findOne({ email });
      if (!user)
        return res.status(404).json({ message: "Pengguna tidak ditemukan" });

      if (user.reset_otp !== otp || user.reset_otp_expires < Date.now()) {
        return res
          .status(400)
          .json({ message: "Kode OTP tidak valid atau sudah kedaluwarsa" });
      }

      return res.status(200).json({ message: "Kode OTP valid" });
    } catch (error) {
      console.error("[Verify OTP Error]:", error);
      res
        .status(500)
        .json({ message: "Terjadi kesalahan internal saat memverifikasi OTP" });
    }
  },

  // ==========================================
  // RESET PASSWORD ACTION
  // ==========================================
  resetPassword: async (req, res) => {
    try {
      const { email, otp, new_password } = req.body;

      if (!new_password || new_password.length < 6) {
        return res
          .status(400)
          .json({ message: "Password baru minimal 6 karakter" });
      }

      const user = await User.findOne({ email });
      if (!user)
        return res.status(404).json({ message: "Pengguna tidak ditemukan" });

      if (user.reset_otp !== otp || user.reset_otp_expires < Date.now()) {
        return res
          .status(400)
          .json({ message: "Kode OTP tidak valid atau sudah kedaluwarsa" });
      }

      // Hash new password & clear OTP fields
      const saltRounds = 10;
      user.password_hash = await bcrypt.hash(new_password, saltRounds);
      user.reset_otp = null;
      user.reset_otp_expires = null;
      await user.save();

      return res
        .status(200)
        .json({
          message: "Kata sandi berhasil diperbarui, silakan login kembali",
        });
    } catch (error) {
      console.error("[Reset Password Error]:", error);
      res.status(500).json({ message: "Gagal mengatur ulang kata sandi" });
    }
  },
};

module.exports = authController;
