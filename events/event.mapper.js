const { BotEventType } = require("./event.types");

function normalize(value) {
  return String(value || "").toLowerCase().trim();
}

function getThreadId(event) {
  return (
    event?.thread_id ||
    event?.chat?.thread_id ||
    event?.message?.thread_id ||
    event?.message?.reply_to_thread_id ||
    null
  );
}

function isThreadReply(event) {
  return Boolean(getThreadId(event));
}

function detectInteractiveType(event) {
  const actionType =
    event?.action?.type ||
    event?.interaction?.type ||
    event?.type ||
    event?.message?.type ||
    "";
  const normalized = normalize(actionType);

  if (normalized.includes("dropdown") || normalized.includes("select")) {
    return BotEventType.DROPDOWN_SELECTION;
  }
  if (normalized.includes("modal") || normalized.includes("form")) {
    return BotEventType.MODAL_SUBMISSION;
  }

  return BotEventType.BUTTON_CLICK;
}

function mapSeatalkEventType(eventType, event) {
  switch (eventType) {
    case "message_from_bot_subscriber": {
      const types = [BotEventType.DIRECT_MESSAGE];
      if (isThreadReply(event)) {
        types.push(BotEventType.THREAD_REPLY);
      }
      return types;
    }
    case "new_mentioned_message_received_from_group_chat": {
      const types = [BotEventType.MENTION];
      if (isThreadReply(event)) {
        types.push(BotEventType.THREAD_REPLY);
      }
      return types;
    }
    case "interactive_message_click":
      return [detectInteractiveType(event)];
    case "new_bot_subscriber":
      return [BotEventType.USER_JOIN];
    case "bot_added_to_group_chat":
      return [BotEventType.PERMISSION_CHANGE, BotEventType.USER_JOIN];
    case "bot_removed_from_group_chat":
      return [BotEventType.PERMISSION_CHANGE, BotEventType.USER_LEAVE];
    default:
      return [];
  }
}

module.exports = {
  detectInteractiveType,
  isThreadReply,
  mapSeatalkEventType,
  getThreadId
};
