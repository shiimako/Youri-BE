const jwt = require('jsonwebtoken');

// ==========================================
// JWT AUTHENTICATION GUARD MIDDLEWARE
// ==========================================
const authGuard = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Validate Authorization header existence and format
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        message: "Akses ditolak. Token tidak ditemukan atau format tidak valid." 
      });
    }

    // Extract and verify token
    const token = authHeader.split(' ')[1];
    
    // Security Fix: Removed hardcoded fallback secret to enforce secure environment variables
    const secretKey = process.env.JWT_SECRET; 
    
    const decoded = jwt.verify(token, secretKey);

    // Inject decoded user payload into request object
    req.user = decoded;
    
    // Proceed to next middleware or controller
    next();
  } catch (error) {
    console.error("[authGuard] Error:", error.message);
    return res.status(401).json({ 
      message: "Sesi telah kedaluwarsa atau token tidak valid. Silakan login kembali." 
    });
  }
};

module.exports = authGuard;