const express = require("express");
const { createRequestId } = require("../src/http/middleware/requestContext");

function resolveBotEventType(value, BotEventType) {
  const normalized = String(value || "").toUpperCase().trim();
  if (Object.values(BotEventType).includes(normalized)) {
    return normalized;
  }
  return BotEventType.ERROR;
}

function createSeatalkEventsRouter(options = {}) {
  const { BotEventType, trackEvent, logger } = options;
  const router = express.Router();

  router.post("/v1/bot/events", (req, res) => {
    const requestId =
      req.requestId || req.headers["x-request-id"] || createRequestId();
    const payload = req.body || {};
    const required = ["event_id", "event_type", "mode", "occurred_at"];
    const missing = required.filter((key) => !payload[key]);
    if (missing.length) {
      return res
        .status(400)
        .json({ status: "error", message: `Missing ${missing.join(", ")}` });
    }

    const resolvedType = resolveBotEventType(payload.event_type, BotEventType);
    trackEvent({
      type: resolvedType,
      requestId,
      seatalkEventType: payload.event_type,
      event: payload,
      logger,
      details: {
        event_id: payload.event_id,
        mode: payload.mode,
        occurred_at: payload.occurred_at,
        tenant_id: payload.tenant_id || null,
        metadata: payload.metadata || null
      }
    });

    return res.json({ status: "ok", event_id: payload.event_id });
  });

  return router;
}

module.exports = {
  createSeatalkEventsRouter
};
