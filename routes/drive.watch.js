const express = require("express");

function createDriveWatchRouter(options = {}) {
  const { logger, driveWatch, onDriveChange } = options;
  const router = express.Router();

  router.post("/drive/webhook", async (req, res) => {
    if (!driveWatch || typeof driveWatch.checkNotification !== "function") {
      logger?.warn?.("drive_watch_not_configured");
      return res.status(200).send("ok");
    }

    const validation = driveWatch.checkNotification(req.headers);
    if (!validation.ok) {
      if (validation.reason === "token_mismatch") {
        logger?.warn?.("drive_watch_invalid_token", {
          channelId: validation.info?.channelId
        });
        return res.status(403).send("forbidden");
      }

      logger?.info?.("drive_watch_event_ignored", {
        reason: validation.reason,
        channelId: validation.info?.channelId,
        resourceState: validation.info?.resourceState
      });
      return res.status(200).send("ignored");
    }

    logger?.info?.("drive_watch_event_received", {
      channelId: validation.info?.channelId,
      resourceId: validation.info?.resourceId,
      messageNumber: validation.info?.messageNumber
    });

    if (typeof onDriveChange === "function") {
      try {
        await onDriveChange({ source: "drive_watch", ...validation.info });
      } catch (error) {
        logger?.warn?.("drive_watch_handler_failed", {
          error: error.message
        });
      }
    }

    return res.status(200).send("ok");
  });

  return router;
}

module.exports = {
  createDriveWatchRouter
};
