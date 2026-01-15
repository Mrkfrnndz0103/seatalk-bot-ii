const path = require("path");
const env = require("../config/env");
const { FileStore } = require("../store/file.store");
const { SessionStore } = require("../store/session.store");
const commands = require("../commands");
const intentService = require("../services/intent.service");
const groupHandler = require("../services/group.handler");
const interactiveHandler = require("../services/interactive.handler");
const scheduler = require("../services/scheduler");
const { logger } = require("../utils/logger");
const { BotEventType } = require("../events/event.types");
const { mapSeatalkEventType } = require("../events/event.mapper");
const { trackEvent } = require("../events/event.tracker");
const { SeatalkMcpClient } = require("../integrations/seatalk.mcp.client");
const { createSeatalkMcpTools } = require("../integrations/seatalk.mcp.tools");
const { createLlmAgent } = require("../services/llm.agent");
const { shouldUseEmployeeLookup } = require("../services/llm.tool.policy");
const { createSeatalkAuth } = require("../src/seatalk/auth");
const { createSeatalkMessaging } = require("../src/seatalk/messaging");
const { createProfileService } = require("../src/profile/profile.service");
const { createSubscriberHandler } = require("../services/subscriber.handler");
const { createGoogleAuth } = require("../src/sheets/google.auth");
const { createSheetsService } = require("../src/sheets/sheets.service");
const { createApp } = require("./app");
const { normalizeText, escapeRegExp } = require("../src/utils/text");

const KNOWN_COMMANDS = new Set(["help", "search", "reindex"]);

function normalizeOpenRouterBaseUrl(value) {
  if (!value) {
    return "";
  }

  return String(value).trim().replace(/\/+$/, "");
}

function getMissingRequiredConfig() {
  const missing = [];
  if (!env.SIGNING_SECRET) {
    missing.push("SIGNING_SECRET");
  }
  const hasSeatalkCreds = Boolean(
    env.BOT_ACCESS_TOKEN ||
      (env.SEATALK_TOKEN_URL && env.SEATALK_APP_ID && env.SEATALK_APP_SECRET)
  );
  if (!hasSeatalkCreds) {
    missing.push("SEATALK_CREDENTIALS");
  }
  return missing;
}

function validateStartupConfig(options = {}) {
  const missing = getMissingRequiredConfig();
  if (missing.length) {
    logger.error("startup_config_invalid", { missing });
    if (options.exitOnFailure !== false) {
      process.exit(1);
    }
  }
  return missing;
}

function createStripBotMention(botName) {
  return function stripBotMention(text) {
    if (!text) {
      return text;
    }

    const escaped = escapeRegExp(botName);
    const compact = escapeRegExp(botName.replace(/\s+/g, ""));
    const mentionPattern = new RegExp(`@?(?:${escaped}|${compact})`, "ig");
    return text.replace(mentionPattern, "").replace(/\s+/g, " ").trim();
  };
}

function getEventMessageText(event) {
  if (typeof event?.message?.text === "string") {
    return event.message.text;
  }

  return (
    event?.message?.text?.plain_text ||
    event?.message?.text?.content ||
    event?.message?.text?.text ||
    event?.message?.content ||
    event?.message?.text ||
    event?.text ||
    ""
  );
}

function isHelpRequest(text) {
  const normalized = normalizeText(text);
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
  const normalized = normalizeText(text);
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
  const normalized = normalizeText(text);
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
    "tell me about yourself",
    "say hi",
    "say hello",
    "say hey",
    "say hey there",
    "say hey there!",
    "greet",
    "tell",
    "tell me",
    "tell me a story",
    "tell me a joke"
  ];

  return phrases.some((phrase) => normalized.includes(phrase));
}

function isAgeQuestion(text) {
  const normalized = normalizeText(text);
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

function createServerApp(options = {}) {
  const {
    enableScheduler = true,
    enableSheetRefreshTimer = true,
    exitOnInvalidConfig = true
  } = options;
  const indexStore = new FileStore({ path: env.INDEX_STORE_PATH });
  indexStore.load();
  const groupSessionStore = new SessionStore();

  const SIGNING_SECRET = env.SIGNING_SECRET;
  const STATIC_BOT_ACCESS_TOKEN = env.BOT_ACCESS_TOKEN;
  const SEATALK_API_BASE_URL = env.SEATALK_API_BASE_URL;
  const SEATALK_TOKEN_URL = env.SEATALK_TOKEN_URL;
  const SEATALK_APP_ID = env.SEATALK_APP_ID;
  const SEATALK_APP_SECRET = env.SEATALK_APP_SECRET;
  const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
  const OPENROUTER_MODEL = env.OPENROUTER_MODEL;
  const OPENROUTER_API_BASE_URL =
    normalizeOpenRouterBaseUrl(env.OPENROUTER_API_BASE_URL) ||
    "https://openrouter.ai/api/v1";
  const OPENROUTER_APP_URL = env.OPENROUTER_APP_URL || "";
  const OPENROUTER_APP_TITLE = env.OPENROUTER_APP_TITLE || "";
  const BOT_NAME = env.BOT_NAME || "OB Bot";
  const SEATALK_PROFILE_URL = env.SEATALK_PROFILE_URL || "";
  const SEATALK_PROFILE_METHOD = env.SEATALK_PROFILE_METHOD;
  const SEATALK_GROUP_TYPING_URL =
    env.SEATALK_GROUP_TYPING_URL ||
    (SEATALK_API_BASE_URL
      ? `${SEATALK_API_BASE_URL}/messaging/v2/group_chat_typing`
      : "");
  const SEATALK_SINGLE_CHAT_TYPING_URL =
    env.SEATALK_SINGLE_CHAT_TYPING_URL ||
    (SEATALK_API_BASE_URL
      ? `${SEATALK_API_BASE_URL}/messaging/v2/single_chat_typing`
      : "");
  const SEATALK_PROFILE_LOOKUP_ENABLED = env.SEATALK_PROFILE_LOOKUP_ENABLED;
  const SEATALK_PROFILE_LOOKUP_COOLDOWN_MS =
    env.SEATALK_PROFILE_LOOKUP_COOLDOWN_MS;
  const SEATALK_PROFILE_CACHE_MINUTES = env.SEATALK_PROFILE_CACHE_MINUTES;
  const SHEETS_FILE = path.resolve(env.SHEETS_FILE);
  const GOOGLE_SERVICE_ACCOUNT_FILE = env.GOOGLE_SERVICE_ACCOUNT_FILE
    ? path.resolve(env.GOOGLE_SERVICE_ACCOUNT_FILE)
    : null;
  const GOOGLE_OAUTH_TOKEN_FILE = env.GOOGLE_OAUTH_TOKEN_FILE
    ? path.resolve(env.GOOGLE_OAUTH_TOKEN_FILE)
    : path.join(__dirname, "..", "google-token.json");
  const GOOGLE_SHEETS_SCOPES = env.GOOGLE_SHEETS_SCOPES;
  const SHEETS_DEFAULT_RANGE = env.SHEETS_DEFAULT_RANGE;
  const SHEETS_SCAN_ALL_TABS = env.SHEETS_SCAN_ALL_TABS;
  const SHEETS_MAX_TABS = env.SHEETS_MAX_TABS;
  const SHEETS_REFRESH_MINUTES = env.SHEETS_REFRESH_MINUTES;
  const SHEETS_MAX_MATCH_LINES = env.SHEETS_MAX_MATCH_LINES;
  const SHEETS_MAX_CONTEXT_CHARS = env.SHEETS_MAX_CONTEXT_CHARS;
  const MCP_ENDPOINT = env.MCP_ENDPOINT;
  const MCP_TRANSPORT = env.MCP_TRANSPORT;
  const MCP_SERVER_NAME = env.MCP_SERVER_NAME;
  const MCP_TIMEOUT_MS = env.MCP_TIMEOUT_MS;
  const MCP_RETRY_MAX = env.MCP_RETRY_MAX;
  const MCP_RETRY_BASE_MS = env.MCP_RETRY_BASE_MS;
  const serviceAccountCredentials =
    env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY
      ? {
          type: "service_account",
          project_id: env.GOOGLE_PROJECT_ID || undefined,
          client_email: env.GOOGLE_CLIENT_EMAIL,
          private_key: env.GOOGLE_PRIVATE_KEY
        }
      : null;

  const seatalkMcpClient = new SeatalkMcpClient({
    endpoint: MCP_ENDPOINT,
    transport: MCP_TRANSPORT,
    serverName: MCP_SERVER_NAME,
    spawnEnv: {
      SEATALK_APP_ID,
      SEATALK_APP_SECRET
    },
    timeoutMs: MCP_TIMEOUT_MS,
    retryMax: MCP_RETRY_MAX,
    retryBaseMs: MCP_RETRY_BASE_MS,
    logger
  });

  const seatalkMcpTools = createSeatalkMcpTools(seatalkMcpClient, logger);

  const llmAgent = createLlmAgent({
    apiKey: OPENROUTER_API_KEY,
    model: OPENROUTER_MODEL,
    baseUrl: OPENROUTER_API_BASE_URL,
    appUrl: OPENROUTER_APP_URL,
    appTitle: OPENROUTER_APP_TITLE,
    timeoutMs: env.OPENROUTER_HTTP_TIMEOUT_MS,
    botName: BOT_NAME,
    toolDefinitions: seatalkMcpTools.definitions,
    toolHandlers: seatalkMcpTools.tools,
    logger
  });

  const seatalkAuth = createSeatalkAuth({
    tokenUrl: SEATALK_TOKEN_URL,
    appId: SEATALK_APP_ID,
    appSecret: SEATALK_APP_SECRET,
    staticToken: STATIC_BOT_ACCESS_TOKEN,
    httpTimeoutMs: env.SEATALK_HTTP_TIMEOUT_MS,
    logger
  });
  const { requestWithAuth, postWithAuth } = seatalkAuth;

  const seatalkMessaging = createSeatalkMessaging({
    apiBaseUrl: SEATALK_API_BASE_URL,
    mcpTools: seatalkMcpTools,
    postWithAuth,
    logger,
    groupTypingUrl: SEATALK_GROUP_TYPING_URL,
    singleTypingUrl: SEATALK_SINGLE_CHAT_TYPING_URL
  });
  const {
    sendSubscriberMessage,
    sendSubscriberTyping,
    sendGroupMessage,
    sendGroupTyping
  } = seatalkMessaging;

  const profileService = createProfileService({
    seatalkMcpTools,
    requestWithAuth,
    profileUrl: SEATALK_PROFILE_URL,
    profileMethod: SEATALK_PROFILE_METHOD,
    profileLookupEnabled: SEATALK_PROFILE_LOOKUP_ENABLED,
    profileLookupCooldownMs: SEATALK_PROFILE_LOOKUP_COOLDOWN_MS,
    profileCacheMinutes: SEATALK_PROFILE_CACHE_MINUTES,
    greetingOverridesJson: env.GREETING_OVERRIDES_JSON,
    greetingOverridesFile: env.GREETING_OVERRIDES_FILE,
    logger
  });
  const { buildGreeting, getHonorificPrefix } = profileService;

  const googleAuth = createGoogleAuth({
    oauthClientId: env.GOOGLE_OAUTH_CLIENT_ID,
    oauthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    oauthRedirectUrl: env.GOOGLE_OAUTH_REDIRECT_URL,
    oauthTokenBase64: env.GOOGLE_OAUTH_TOKEN_BASE64,
    oauthTokenJson: env.GOOGLE_OAUTH_TOKEN_JSON,
    oauthTokenFile: GOOGLE_OAUTH_TOKEN_FILE,
    serviceAccountFile: GOOGLE_SERVICE_ACCOUNT_FILE,
    serviceAccountCredentials,
    scopes: GOOGLE_SHEETS_SCOPES,
    logger
  });

  const sheetsService = createSheetsService({
    sheetsFile: SHEETS_FILE,
    defaultRange: SHEETS_DEFAULT_RANGE,
    scanAllTabs: SHEETS_SCAN_ALL_TABS,
    maxTabs: SHEETS_MAX_TABS,
    refreshMinutes: SHEETS_REFRESH_MINUTES,
    maxMatchLines: SHEETS_MAX_MATCH_LINES,
    maxContextChars: SHEETS_MAX_CONTEXT_CHARS,
    httpTimeoutMs: env.SEATALK_HTTP_TIMEOUT_MS,
    getSheetsApi: googleAuth.getSheetsApi,
    hasOAuthConfig: googleAuth.hasOAuthConfig,
    serviceAccountFile: GOOGLE_SERVICE_ACCOUNT_FILE,
    logger
  });

  const stripBotMention = createStripBotMention(BOT_NAME);


  function trackSystemEvent(type, details) {
    trackEvent({
      type,
      requestId: "system",
      seatalkEventType: "system",
      event: {},
      logger,
      details
    });
  }

  async function generateIntelligentReply(userMessage, options = {}) {
    const sheetContext = options.skipSheetContext
      ? ""
      : sheetsService.buildSheetContext(userMessage, {
          preferredTab: options.preferredTab
        });

    let extraSystemContext = "";
    if (options.preferredTab) {
      const label = options.preferredTab.spreadsheetTitle
        ? `${options.preferredTab.tabName} - ${options.preferredTab.spreadsheetTitle}`
        : options.preferredTab.tabName;
      extraSystemContext = `Use data from the "${label}" tab only.`;
    }

    return llmAgent.generateReply(userMessage, {
      conversation: options.conversation,
      sheetContext,
      extraSystemContext,
      prefetchChatHistory: options.prefetchChatHistory,
      groupId: options.groupId,
      useTools: options.useTools,
      sessionContext: options.sessionContext,
      sessionStore: options.sessionStore,
      sessionKey: options.sessionKey,
      logger: options.logger,
      requestId: options.requestId
    });
  }

  const handleSubscriberMessage = createSubscriberHandler({
    BotEventType,
    logger,
    stripBotMention,
    isGreetingOnly,
    isHelpRequest,
    isAgeQuestion,
    isConversational,
    getPositiveLead,
    generateIntelligentReply,
    shouldUseEmployeeLookup,
    parseCommand: commands.parseCommand,
    handleCommand: commands.handle,
    detectIntent: intentService.detectIntent,
    handleIntentMessage: intentService.handleIntentMessage,
    sheetCache: sheetsService.sheetCache,
    refreshSheetCache: sheetsService.refreshSheetCache,
    readSheetRange: sheetsService.readSheetRange,
    indexStore,
    knownCommands: KNOWN_COMMANDS,
    buildGreeting,
    getHonorificPrefix,
    getEventMessageText,
    sendSubscriberMessage,
    sendSubscriberTyping
  });

  async function runScheduledTasks() {}

  const app = createApp({
    logger,
    requestBodyLimit: env.REQUEST_BODY_LIMIT,
    rateLimitMax: env.RATE_LIMIT_MAX,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
    googleOAuth: {
      googleAuth,
      sheetsScopes: GOOGLE_SHEETS_SCOPES,
      refreshSheetCache: sheetsService.refreshSheetCache,
      logger
    },
    health: {
      getMissingRequiredConfig,
      indexStore
    },
    seatalkEvents: {
      BotEventType,
      trackEvent,
      logger
    },
    seatalkNotify: {
      signingSecret: SIGNING_SECRET,
      logger,
      BotEventType,
      trackEvent,
      sendGroupMessage,
      sendSubscriberMessage
    },
    seatalkCallback: {
      signingSecret: SIGNING_SECRET,
      logger,
      BotEventType,
      mapSeatalkEventType,
      trackEvent,
      interactiveHandler,
      groupHandler,
      handleSubscriberMessage,
      sheetCache: sheetsService.sheetCache,
      refreshSheetCache: sheetsService.refreshSheetCache,
      stripBotMention,
      handleIntentMessage: intentService.handleIntentMessage,
      parseCommand: commands.parseCommand,
      handleCommand: commands.handle,
      knownCommands: KNOWN_COMMANDS,
      detectIntent: intentService.detectIntent,
      buildGreeting,
      getHonorificPrefix,
      generateIntelligentReply,
      readSheetRange: sheetsService.readSheetRange,
      sendGroupMessage,
      sendGroupTyping,
      postWithAuth,
      apiBaseUrl: SEATALK_API_BASE_URL,
      indexStore,
      groupSessionStore
    }
  });

  validateStartupConfig({ exitOnFailure: exitOnInvalidConfig });
  if (enableSheetRefreshTimer) {
    sheetsService.startSheetRefreshTimer();
  }
  if (enableScheduler) {
    scheduler.startScheduler(trackSystemEvent, runScheduledTasks, {
      logger
    });
  }

  return { app, runScheduledTasks };
}

function startServer() {
  const { app } = createServerApp();

  const PORT = env.PORT;
  const server = app.listen(PORT, () => {
    logger.info("server_started", { port: PORT });
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("unhandled_rejection", {
      error: reason?.stack || reason
    });
    process.exit(1);
  });

  process.on("uncaughtException", (error) => {
    logger.error("uncaught_exception", {
      error: error?.stack || error
    });
    process.exit(1);
  });

  process.on("SIGTERM", () => {
    logger.info("sigterm_received");
    server.close(() => {
      logger.info("server_closed");
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("sigterm_force_exit");
      process.exit(1);
    }, 10000).unref();
  });

  return server;
}

module.exports = {
  createServerApp,
  startServer,
  getMissingRequiredConfig
};
