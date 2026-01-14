const express = require("express");
const { createRequestId } = require("../src/http/middleware/requestContext");
const { isValidSignature, getSignatureHeader } = require("../utils/signature");

function createSeatalkNotifyRouter(options = {}) {
  const {
    signingSecret,
    logger,
    BotEventType,
    trackEvent,
    sendGroupMessage,
    sendSubscriberMessage
  } = options;
  const router = express.Router();

  router.post("/seatalk/notify", async (req, res) => {
    const requestId =
      req.requestId || req.headers["x-request-id"] || createRequestId();
    const bodyRaw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const signature = getSignatureHeader(req.headers);

    if (!isValidSignature(bodyRaw, signature, signingSecret)) {
      logger?.warn?.("invalid_signature_notification", { requestId });
      return res.status(400).send("Invalid signature");
    }

    const { group_id, employee_code, message } = req.body || {};
    if (!message) {
      return res.status(400).send("Missing message");
    }

    trackEvent({
      type: BotEventType.NOTIFICATION,
      requestId,
      seatalkEventType: "notification",
      event: req.body || {},
      logger,
      details: {
        group_id: group_id || null,
        employee_code: employee_code || null
      }
    });

    if (group_id) {
      await sendGroupMessage(group_id, message);
      return res.json({ status: "ok", target: "group" });
    }

    if (employee_code) {
      await sendSubscriberMessage(employee_code, message);
      return res.json({ status: "ok", target: "dm" });
    }

    return res.status(400).send("Missing group_id or employee_code");
  });

  return router;
}

module.exports = {
  createSeatalkNotifyRouter
};
