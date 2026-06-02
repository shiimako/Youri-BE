// ==========================================
// ADMIN ROLE GUARD MIDDLEWARE
// ==========================================
const adminGuard = (req, res, next) => {
  try {
    // Verify if user object exists (populated by authGuard)
    if (!req.user) {
      return res.status(401).json({ 
        message: "Akses ditolak. Identitas pengguna tidak ditemukan." 
      });
    }

    // Verify admin role privileges
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        message: "Akses ditolak. Memerlukan hak akses administrator." 
      });
    }

    // Proceed to controller
    next();
  } catch (error) {
    console.error("[adminGuard] Error:", error);
    res.status(500).json({ message: "Terjadi kesalahan internal pada verifikasi akses" });
  }
};

module.exports = adminGuard;