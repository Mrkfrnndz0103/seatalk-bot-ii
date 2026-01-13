const { BotEventType } = require("./event.types");
const { getThreadId } = require("./event.mapper");

function getMessageText(event) {
  return (
    event?.message?.text?.content ||
    event?.message?.text?.text ||
    event?.message?.content ||
    event?.text ||
    ""
  );
}

function buildEventPayload({ type, requestId, seatalkEventType, event, details }) {
  const chatId =
    event?.group_id ||
    event?.chat_id ||
    event?.conversation_id ||
    event?.chat?.chat_id ||
    null;
  const chatType =
    event?.chat?.chat_type ||
    (event?.group_id ? "group" : "dm");
  const threadId = getThreadId(event);
  const messageId = event?.message?.message_id || event?.message_id || null;
  const actor = event?.actor || null;
  const text = getMessageText(event);

  return {
    type: type || BotEventType.ERROR,
    requestId: requestId || "unknown",
    seatalkEventType: seatalkEventType || "unknown",
    chatId,
    chatType,
    threadId,
    messageId,
    actor,
    text,
    details: details || null
  };
}

function trackEvent({ type, requestId, seatalkEventType, event, logger, details }) {
  const payload = buildEventPayload({
    type,
    requestId,
    seatalkEventType,
    event,
    details
  });

  if (logger && typeof logger.info === "function") {
    logger.info("bot_event", payload);
  } else {
    console.log("bot_event", payload);
  }

  return payload;
}

module.exports = {
  trackEvent,
  buildEventPayload
};
