const { createClient } = require('redis');

// ==========================================
// REDIS CLIENT CONFIGURATION
// ==========================================
const redisClient = createClient({
  url: process.env.REDIS_URL
});

// ==========================================
// EVENT LISTENERS
// ==========================================
redisClient.on('error', (err) => {
  console.error('[Redis] Connection Error:', err.message || err);
});

redisClient.on('connect', () => {
  console.log('[Redis] Successfully connected to Redis Cloud');
});

// ==========================================
// INITIALIZE CONNECTION
// ==========================================
(async () => {
  try {
    await redisClient.connect();
  } catch (error) {
    console.error('[Redis] Initialization Failed:', error.message || error);
  }
})();

module.exports = redisClient;