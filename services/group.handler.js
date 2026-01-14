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

function getThreadId(event) {
  const threadId =
    event?.message?.thread_id ||
    event?.thread_id ||
    null;
  if (typeof threadId === "string" && threadId.trim()) {
    return threadId.trim();
  }
  return null;
}

function buildSessionKey(groupId, threadId) {
  if (!groupId) {
    return null;
  }
  return threadId ? `${groupId}:${threadId}` : groupId;
}

function getMessageText(event) {
  if (typeof event?.message?.text === "string") {
    return event.message.text;
  }

  return (
    event?.message?.text?.plain_text ||
    event?.message?.text?.content ||
    event?.message?.text?.text ||
    event?.message?.content ||
    event?.text ||
    ""
  );
}

function extractEmails(text) {
  const matches = String(text || "").match(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
  );
  if (!matches) {
    return [];
  }
  const unique = new Set(matches.map((value) => value.toLowerCase()));
  return Array.from(unique);
}

function detectPendingIntent(text) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized.includes("greet") ||
    normalized.includes("say hi") ||
    normalized.includes("say hello")
  ) {
    return "greet";
  }
  if (normalized.includes("congratulat")) {
    return "congratulate";
  }
  return null;
}

function buildSessionContext(session) {
  if (!session || typeof session !== "object") {
    return "";
  }

  const lines = [];
  if (session.pendingIntent) {
    lines.push(`Pending request: ${session.pendingIntent}.`);
  }

  const employee = session.lastEmployee;
  if (employee && typeof employee === "object") {
    const details = [];
    if (employee.name) {
      details.push(`name=${employee.name}`);
    }
    if (employee.employee_code) {
      details.push(`employee_code=${employee.employee_code}`);
    }
    if (employee.email) {
      details.push(`email=${employee.email}`);
    }
    if (employee.employee_status !== undefined) {
      details.push(`status=${employee.employee_status}`);
    }
    if (details.length) {
      lines.push(`Last referenced employee: ${details.join(", ")}.`);
    }
  }

  if (
    session.lastMentionedEmail &&
    session.lastMentionedEmail !== employee?.email
  ) {
    lines.push(`Last provided email: ${session.lastMentionedEmail}.`);
  }

  if (!lines.length) {
    return "";
  }

  return `Session memory (may be stale): ${lines.join(" ")}`;
}

function updateSessionFromMessage(sessionStore, sessionKey, msgText) {
  if (!sessionStore || !sessionKey) {
    return null;
  }

  const update = {
    lastUserMessage: msgText,
    lastUserMessageAt: new Date().toISOString()
  };

  const emails = extractEmails(msgText);
  if (emails.length) {
    update.lastMentionedEmail = emails[0];
    update.lastMentionedEmails = emails;
  }

  const pendingIntent = detectPendingIntent(msgText);
  if (pendingIntent) {
    update.pendingIntent = pendingIntent;
  }

  return sessionStore.update(sessionKey, update);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripMentionedUsers(text, event, deps) {
  let result = String(text || "");
  const mentioned = event?.message?.text?.mentioned_list || event?.mentioned_list;

  if (Array.isArray(mentioned) && mentioned.length) {
    mentioned.forEach((mention) => {
      const username = mention?.username || mention?.name;
      if (!username) {
        return;
      }
      const pattern = new RegExp(`@?${escapeRegExp(username)}`, "ig");
      result = result.replace(pattern, " ");
    });
  }

  if (deps.stripBotMention) {
    result = deps.stripBotMention(result);
  }

  return result.replace(/\s+/g, " ").trim();
}

function isHelpRequest(text) {
  const normalized = String(text || "").toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  if (normalized === "help" || normalized === "commands") {
    return true;
  }

  return (
    normalized.includes("help me") ||
    normalized.includes("what can you do") ||
    normalized.includes("how can you help") ||
    normalized.includes("how do i") ||
    normalized.includes("how to") ||
    normalized.includes("usage")
  );
}

function isGreetingOnly(text) {
  const normalized = String(text || "").toLowerCase().trim();
  if (!normalized) {
    return true;
  }

  const greetings = new Set([
    "hi",
    "hello",
    "hey",
    "yo",
    "sup",
    "hi there",
    "hello there",
    "hey there",
    "good morning",
    "good afternoon",
    "good evening",
    "morning",
    "afternoon",
    "evening"
  ]);

  return greetings.has(normalized);
}

function isConversational(text) {
  const normalized = String(text || "").toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  const phrases = [
    "thank you",
    "thanks",
    "appreciate",
    "how are you",
    "how r u",
    "how is it going",
    "hows it going",
    "what's up",
    "whats up",
    "good morning",
    "good afternoon",
    "good evening",
    "do you want",
    "can you",
    "are you",
    "tell me about yourself"
  ];

  return phrases.some((phrase) => normalized.includes(phrase));
}

function isAgeQuestion(text) {
  const normalized = String(text || "").toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("how old are you") ||
    normalized.includes("what is your age") ||
    normalized.includes("when were you created") ||
    normalized.includes("when were you made") ||
    (normalized.includes("age") && normalized.includes("you"))
  );
}

async function sendGroupTextMessage(groupId, content, deps) {
  if (typeof deps.sendGroupMessage === "function") {
    await deps.sendGroupMessage(groupId, content);
    return;
  }

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

function getPositiveLead() {
  const options = [
    "Got it! Here's the update:",
    "On it - here's the latest:",
    "Quick update for you:",
    "Happy to help. Here's what I found:",
    "Here's the latest snapshot:"
  ];
  return options[Math.floor(Math.random() * options.length)];
}

async function handleGroupMention(event, deps) {
  const groupId = getGroupId(event);
  if (!groupId) {
    console.warn("Group mention missing group id.");
    return;
  }

  const threadId = getThreadId(event);
  if (typeof deps.sendGroupTyping === "function") {
    deps.sendGroupTyping(groupId, threadId).catch((error) => {
      if (deps.logger && deps.logger.warn) {
        deps.logger.warn("group_typing_failed", { error: error.message });
      }
    });
  }

  const rawText = getMessageText(event);
  const msgText = stripMentionedUsers(rawText, event, deps);
  const sessionKey = deps.sessionStore
    ? buildSessionKey(groupId, threadId)
    : null;
  if (sessionKey) {
    updateSessionFromMessage(deps.sessionStore, sessionKey, msgText);
  }
  const sessionContext = sessionKey
    ? buildSessionContext(deps.sessionStore.get(sessionKey))
    : "";

  if (isGreetingOnly(msgText)) {
    if (deps.buildGreeting) {
      const greeting = await deps.buildGreeting(event);
      await sendGroupTextMessage(groupId, greeting, deps);
    }
    return;
  }

  if (isAgeQuestion(msgText)) {
    await sendGroupTextMessage(
      groupId,
      "I don't have a real age. I'm a bot here to help you with questions.",
      deps
    );
    return;
  }

  if (isConversational(msgText) && typeof deps.generateReply === "function") {
    const convoReply = await deps.generateReply(msgText, {
      skipSheetContext: true,
      conversation: true,
      useTools: false,
      prefetchChatHistory: true,
      groupId,
      sessionContext,
      sessionStore: deps.sessionStore,
      sessionKey,
      logger: deps.logger,
      requestId: deps.requestId
    });
    if (convoReply) {
      await sendGroupTextMessage(groupId, convoReply, deps);
      return;
    }
  }

  const parsedCommand =
    typeof deps.parseCommand === "function"
      ? deps.parseCommand(msgText)
      : null;
  const wantsHelp = !parsedCommand && isHelpRequest(msgText);
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
  } else if (wantsHelp && deps.trackEvent) {
    deps.trackEvent(BotEventType.HELP_REQUEST, { source: "keyword" });
  }

  if (wantsHelp && typeof deps.handleCommand === "function") {
    const helpReply = await deps.handleCommand("/help", deps.commandContext || {});
    if (helpReply && helpReply.text) {
      await sendGroupTextMessage(groupId, helpReply.text, deps);
      return;
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
    includeFallback: false,
    readSheetRange: deps.readSheetRange
  });

  if (reply && reply.text) {
    const lead = getPositiveLead();
    const content = lead ? `${lead}\n\n${reply.text}` : reply.text;
    await sendGroupTextMessage(groupId, content, deps);
    return;
  }

  if (typeof deps.generateReply === "function") {
    const fallbackReply = await deps.generateReply(msgText, {
      skipSheetContext: true,
      conversation: true,
      prefetchChatHistory: true,
      groupId,
      sessionContext,
      sessionStore: deps.sessionStore,
      sessionKey,
      logger: deps.logger,
      requestId: deps.requestId
    });
    if (fallbackReply) {
      await sendGroupTextMessage(groupId, fallbackReply, deps);
    }
  }
}

module.exports = {
  handleGroupMention
};
