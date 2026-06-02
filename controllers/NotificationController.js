const { Notification } = require("../models/model");

const notificationController = {
  // ==========================================
  // GET USER NOTIFICATIONS
  // ==========================================
  getNotifications: async (req, res) => {
    try {
      const userId = req.user.id;
      const MAX_HISTORY_LIMIT = 50;

      // Fetch all unread notifications
      const unreadNotifs = await Notification.find({
        user_id: userId,
        is_read: false,
      })
        .sort({ created_at: -1 })
        .lean();

      // Calculate remaining quota for read notifications
      const remainingQuota = Math.max(
        0,
        MAX_HISTORY_LIMIT - unreadNotifs.length,
      );
      let readNotifs = [];

      if (remainingQuota > 0) {
        // Fetch read notifications up to the remaining quota
        readNotifs = await Notification.find({
          user_id: userId,
          is_read: true,
        })
          .sort({ created_at: -1 })
          .limit(remainingQuota)
          .lean();
      }

      // Merge and sort all notifications by date descending
      const allNotifs = [...unreadNotifs, ...readNotifs].sort((a, b) => {
        return new Date(b.created_at) - new Date(a.created_at);
      });

      const formattedNotifications = allNotifs.map((notif) => ({
        id: notif._id,
        title: notif.title,
        message: notif.message,
        is_read: notif.is_read,
        created_at: notif.created_at,
      }));

      return res.status(200).json({
        message: "Notifications retrieved successfully",
        data: formattedNotifications,
      });
    } catch (error) {
      console.error("[getNotifications] Error:", error);
      res
        .status(500)
        .json({ message: "Terjadi kesalahan internal saat memuat notifikasi" });
    }
  },

  // ==========================================
  // MARK NOTIFICATION AS READ
  // ==========================================
  markNotificationRead: async (req, res) => {
    try {
      const userId = req.user.id;
      const notifId = req.params.id;

      // Update notification and verify ownership
      const updatedNotif = await Notification.findOneAndUpdate(
        { _id: notifId, user_id: userId },
        { $set: { is_read: true } },
        { returnDocument: "after" },
      );

      if (!updatedNotif) {
        return res
          .status(404)
          .json({ message: "Notifikasi tidak ditemukan atau akses ditolak" });
      }

      return res.status(200).json({
        message: "Notification marked as read",
        data: null,
      });
    } catch (error) {
      console.error("[markNotificationRead] Error:", error);

      if (error.kind === "ObjectId") {
        return res
          .status(404)
          .json({ message: "Format ID notifikasi tidak valid" });
      }

      res
        .status(500)
        .json({
          message: "Terjadi kesalahan internal saat menandai notifikasi",
        });
    }
  },
};

module.exports = notificationController;
