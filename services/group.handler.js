const { BotEventType } = require("../events/event.types");

function getGroupId(event) {
  return (
    event?.group_id ||
    event?.group?.group_id ||
    event?.group?.id ||
    event?.group?.chat_id ||
    event?.chat_id ||
    event?.conversation_id ||
    null
  );
}

function getMessageText(event) {
  return (
    event?.message?.text?.content ||
    event?.message?.text?.text ||
    event?.message?.content ||
    event?.text ||
    ""
  );
}

async function sendGroupTextMessage(groupId, content, deps) {
  const apiBaseUrl = deps.apiBaseUrl;
  if (!apiBaseUrl) {
    throw new Error("Missing SEATALK_API_BASE_URL for group messages.");
  }

  await deps.postWithAuth(`${apiBaseUrl}/messaging/v2/group_chat`, {
    group_id: groupId,
    message: {
      tag: "text",
      text: {
        format: 1,
        content
      }
    },
    usable_platform: "all"
  });
}

async function handleGroupMention(event, deps) {
  const groupId = getGroupId(event);
  if (!groupId) {
    console.warn("Group mention missing group id.");
    return;
  }

  const rawText = getMessageText(event);
  const msgText = deps.stripBotMention
    ? deps.stripBotMention(rawText)
    : String(rawText || "").trim();

  if (!msgText) {
    return;
  }

  const parsedCommand =
    typeof deps.parseCommand === "function"
      ? deps.parseCommand(msgText)
      : null;
  if (parsedCommand && deps.trackEvent) {
    deps.trackEvent(BotEventType.COMMAND, { command: parsedCommand.cmd });
    if (parsedCommand.cmd === "help") {
      deps.trackEvent(BotEventType.HELP_REQUEST, { command: parsedCommand.cmd });
    } else if (
      deps.knownCommands &&
      !deps.knownCommands.has(parsedCommand.cmd)
    ) {
      deps.trackEvent(BotEventType.INVALID_COMMAND, { command: parsedCommand.cmd });
    }
  }

  const intentType =
    typeof deps.detectIntent === "function"
      ? deps.detectIntent(msgText)
      : null;
  if (intentType && deps.trackEvent) {
    deps.trackEvent(BotEventType.KEYWORD_TRIGGER, { intent: intentType });
  } else if (deps.trackEvent) {
    deps.trackEvent(BotEventType.FALLBACK, { reason: "no_intent" });
  }

  const reply = await deps.handleIntentMessage(msgText, {
    sheetCache: deps.sheetCache,
    refreshSheetCache: deps.refreshSheetCache,
    includeFallback: true
  });

  if (reply && reply.text) {
    const greeting = deps.buildGreeting ? deps.buildGreeting(event) : "";
    const content = greeting ? `${greeting}\n${reply.text}` : reply.text;
    await sendGroupTextMessage(groupId, content, deps);
  }
}

module.exports = {
  handleGroupMention
};
