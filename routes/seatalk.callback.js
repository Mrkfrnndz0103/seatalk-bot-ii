const express = require("express");
const { createRequestId } = require("../src/http/middleware/requestContext");
const { isValidSignature, getSignatureHeader } = require("../utils/signature");

const EVENT_VERIFICATION = "event_verification";
const NEW_BOT_SUBSCRIBER = "new_bot_subscriber";
const MESSAGE_FROM_BOT_SUBSCRIBER = "message_from_bot_subscriber";
const INTERACTIVE_MESSAGE_CLICK = "interactive_message_click";
const BOT_ADDED_TO_GROUP_CHAT = "bot_added_to_group_chat";
const BOT_REMOVED_FROM_GROUP_CHAT = "bot_removed_from_group_chat";
const NEW_MENTIONED_MESSAGE_RECEIVED_FROM_GROUP_CHAT =
  "new_mentioned_message_received_from_group_chat";

function createSeatalkCallbackRouter(options = {}) {
  const {
    signingSecret,
    logger,
    BotEventType,
    mapSeatalkEventType,
    trackEvent,
    interactiveHandler,
    groupHandler,
    handleSubscriberMessage,
    sheetCache,
    refreshSheetCache,
    stripBotMention,
    handleIntentMessage,
    parseCommand,
    handleCommand,
    knownCommands,
    detectIntent,
    buildGreeting,
    generateIntelligentReply,
    readSheetRange,
    sendGroupMessage,
    sendGroupTyping,
    postWithAuth,
    apiBaseUrl,
    indexStore,
    groupSessionStore
  } = options;

  const router = express.Router();

  router.post("/seatalk/callback", async (req, res) => {
    const requestId =
      req.requestId || req.headers["x-request-id"] || createRequestId();
    const startedAt = Date.now();
    const bodyRaw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const signature = getSignatureHeader(req.headers);

    if (!isValidSignature(bodyRaw, signature, signingSecret)) {
      logger?.warn?.("invalid_signature", { requestId });
      return res.status(400).send("Invalid signature");
    }

    const data = req.body || {};
    const eventType = data.event_type || "unknown";
    const eventPayload = data.event || data;
    const sender =
      eventPayload?.sender ||
      eventPayload?.message?.sender ||
      eventPayload?.actor ||
      null;
    const eventEmail =
      typeof eventPayload?.email === "string"
        ? eventPayload.email.trim()
        : "";
    const senderEmail =
      typeof sender?.email === "string" ? sender.email.trim() : "";
    const track = (type, details) =>
      trackEvent({
        type,
        requestId,
        seatalkEventType: eventType,
        event: eventPayload,
        logger,
        details
      });

    const mappedTypes = mapSeatalkEventType(eventType, eventPayload);
    mappedTypes.forEach((type) => track(type));

    logger?.info?.("seatalk_event_received", {
      requestId,
      eventType
    });
    logger?.info?.("seatalk_event_email_presence", {
      requestId,
      eventType,
      hasEventEmail: Boolean(eventEmail),
      hasSenderEmail: Boolean(senderEmail),
      senderKeys:
        sender && typeof sender === "object"
          ? Object.keys(sender).slice(0, 12)
          : []
    });

    if (eventType === EVENT_VERIFICATION) {
      logger?.info?.("seatalk_event_verified", { requestId });
      return res.send(data.event);
    }

    try {
      switch (eventType) {
        case NEW_BOT_SUBSCRIBER:
          logger?.info?.("new_subscriber", { requestId });
          break;

        case MESSAGE_FROM_BOT_SUBSCRIBER:
          logger?.info?.("subscriber_message", { requestId });
          await handleSubscriberMessage(data.event, {
            requestId,
            logger,
            trackEvent: track
          }).catch((err) => {
            logger?.error?.("subscriber_message_failed", {
              requestId,
              error: err.response?.data || err.message
            });
            track(BotEventType.ERROR, {
              error: err.response?.data || err.message
            });
          });
          break;

        case INTERACTIVE_MESSAGE_CLICK:
          logger?.info?.("interactive_message_click", { requestId });
          await interactiveHandler
            .handleInteractiveEvent(data.event, { trackEvent: track })
            .catch((err) => {
              logger?.error?.("interactive_event_failed", {
                requestId,
                error: err.response?.data || err.message
              });
              track(BotEventType.ERROR, {
                error: err.response?.data || err.message
              });
            });
          break;

        case BOT_ADDED_TO_GROUP_CHAT:
          logger?.info?.("bot_added_to_group", { requestId });
          break;

        case BOT_REMOVED_FROM_GROUP_CHAT:
          logger?.info?.("bot_removed_from_group", { requestId });
          break;

        case NEW_MENTIONED_MESSAGE_RECEIVED_FROM_GROUP_CHAT:
          logger?.info?.("bot_mentioned_in_group", { requestId });
          await groupHandler
            .handleGroupMention(data.event, {
              sheetCache,
              refreshSheetCache,
              stripBotMention,
              handleIntentMessage,
              parseCommand,
              handleCommand,
              commandContext: {
                store: indexStore,
                logger,
                requestId
              },
              knownCommands,
              detectIntent,
              trackEvent: track,
              buildGreeting,
              generateReply: generateIntelligentReply,
              requestId,
              logger,
              readSheetRange,
              sendGroupMessage,
              sendGroupTyping,
              postWithAuth,
              apiBaseUrl,
              sessionStore: groupSessionStore
            })
            .catch((err) => {
              logger?.error?.("group_mention_failed", {
                requestId,
                error: err.response?.data || err.message
              });
            });
          break;

        default:
          logger?.info?.("unknown_event", { requestId, eventType });
      }
    } catch (error) {
      logger?.error?.("seatalk_event_error", {
        requestId,
        eventType,
        error: error.message
      });
    }

    const durationMs = Date.now() - startedAt;
    logger?.info?.("seatalk_event_handled", {
      requestId,
      eventType,
      durationMs
    });

    res.status(200).send("");
  });

  return router;
}

module.exports = {
  createSeatalkCallbackRouter
};
