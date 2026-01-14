// index.js
const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

require("dotenv").config();
const env = require("./config/env");
const { FileStore } = require("./store/file.store");
const { SessionStore } = require("./store/session.store");
const commands = require("./commands");
const intentService = require("./services/intent.service");
const groupHandler = require("./services/group.handler");
const interactiveHandler = require("./services/interactive.handler");
const scheduler = require("./services/scheduler");
const { createDriveZipSync } = require("./services/drive.sync");
const { logger } = require("./utils/logger");
const { rawBodySaver } = require("./src/http/middleware/rawBody");
const {
  createRequestContextMiddleware,
  createRequestId
} = require("./src/http/middleware/requestContext");
const { createRateLimitMiddleware } = require("./src/http/middleware/rateLimit");
const { getClientIp } = require("./src/http/request.utils");
const { isValidSignature, getSignatureHeader } = require("./utils/signature");
const { BotEventType } = require("./events/event.types");
const { mapSeatalkEventType } = require("./events/event.mapper");
const { trackEvent } = require("./events/event.tracker");
const { SeatalkMcpClient } = require("./integrations/seatalk.mcp.client");
const { createSeatalkMcpTools } = require("./integrations/seatalk.mcp.tools");
const { createLlmAgent } = require("./services/llm.agent");
const { shouldUseEmployeeLookup } = require("./services/llm.tool.policy");
const { createSeatalkAuth } = require("./src/seatalk/auth");
const { createSeatalkMessaging } = require("./src/seatalk/messaging");
const { createProfileService } = require("./src/profile/profile.service");
const { createSubscriberHandler } = require("./services/subscriber.handler");
const { createBacklogsPublisher } = require("./src/backlogs/publisher");

const app = express();

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

function resolveBotEventType(value) {
  const normalized = String(value || "").toUpperCase().trim();
  if (Object.values(BotEventType).includes(normalized)) {
    return normalized;
  }
  return BotEventType.ERROR;
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

function validateStartupConfig() {
  const missing = getMissingRequiredConfig();
  if (missing.length) {
    logger.error("startup_config_invalid", { missing });
    process.exit(1);
  }
}

app.use(
  express.json({
    verify: rawBodySaver,
    limit: env.REQUEST_BODY_LIMIT
  })
);
app.use(
  createRequestContextMiddleware({
    logger,
    getClientIp
  })
);
app.use(
  createRateLimitMiddleware({
    max: env.RATE_LIMIT_MAX,
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    logger,
    getIp: getClientIp
  })
);

const indexStore = new FileStore({ path: env.INDEX_STORE_PATH });
indexStore.load();
const groupSessionStore = new SessionStore();

// ======================
// Your bot settings
// ======================
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
const GOOGLE_OAUTH_CLIENT_ID = env.GOOGLE_OAUTH_CLIENT_ID;
const GOOGLE_OAUTH_CLIENT_SECRET = env.GOOGLE_OAUTH_CLIENT_SECRET;
const GOOGLE_OAUTH_REDIRECT_URL = env.GOOGLE_OAUTH_REDIRECT_URL;
const GOOGLE_OAUTH_TOKEN_FILE = env.GOOGLE_OAUTH_TOKEN_FILE
  ? path.resolve(env.GOOGLE_OAUTH_TOKEN_FILE)
  : path.join(__dirname, "google-token.json");
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
const BACKLOGS_SCHEDULED_GROUP_ID = env.BACKLOGS_SCHEDULED_GROUP_ID;
const BACKLOGS_IMAGE_SHEET_ID = env.BACKLOGS_IMAGE_SHEET_ID;
const BACKLOGS_IMAGE_TAB_NAME = env.BACKLOGS_IMAGE_TAB_NAME;
const BACKLOGS_IMAGE_GID = env.BACKLOGS_IMAGE_GID;
const BACKLOGS_IMAGE_RANGE = env.BACKLOGS_IMAGE_RANGE;
const BACKLOGS_MONITOR_RANGE = env.BACKLOGS_MONITOR_RANGE;
const BACKLOGS_MONITOR_STATE_PATH = env.BACKLOGS_MONITOR_STATE_PATH;
const BACKLOGS_TIMEZONE = env.BACKLOGS_TIMEZONE;
const SYNC_DRIVE_FOLDER_ID = env.SYNC_DRIVE_FOLDER_ID;
const SYNC_SHEET_ID = env.SYNC_SHEET_ID;
const SYNC_SHEET_TAB_NAME = env.SYNC_SHEET_TAB_NAME;
const SYNC_START_CELL = env.SYNC_START_CELL;
const SYNC_STATE_PATH = env.SYNC_STATE_PATH;
const SYNC_MIN_CSV_WARN = env.SYNC_MIN_CSV_WARN;

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
  logger
});
const { buildGreeting } = profileService;

const runDriveZipSync = createDriveZipSync({
  getDriveApi,
  getSheetsApi,
  logger,
  folderId: SYNC_DRIVE_FOLDER_ID,
  sheetId: SYNC_SHEET_ID,
  tabName: SYNC_SHEET_TAB_NAME,
  startCell: SYNC_START_CELL,
  statePath: SYNC_STATE_PATH,
  minCsvWarn: SYNC_MIN_CSV_WARN
});

// ======================
// Event types
// ======================
const EVENT_VERIFICATION = "event_verification";
const NEW_BOT_SUBSCRIBER = "new_bot_subscriber";
const MESSAGE_FROM_BOT_SUBSCRIBER = "message_from_bot_subscriber";
const INTERACTIVE_MESSAGE_CLICK = "interactive_message_click";
const BOT_ADDED_TO_GROUP_CHAT = "bot_added_to_group_chat";
const BOT_REMOVED_FROM_GROUP_CHAT = "bot_removed_from_group_chat";
const NEW_MENTIONED_MESSAGE_RECEIVED_FROM_GROUP_CHAT = "new_mentioned_message_received_from_group_chat";

// ======================
// Helpers
// ======================

const TAB_MATCH_MIN_SCORE = 0.65;
const TAB_SUGGEST_MIN_SCORE = 0.4;
const TAB_SUGGEST_LIMIT = 3;
const TAB_STOPWORDS = new Set([
  "tab",
  "shift",
  "schedule",
  "the",
  "and",
  "for",
  "are",
  "with",
  "that",
  "this",
  "from",
  "your",
  "you",
  "about",
  "what",
  "when",
  "where",
  "which",
  "who",
  "how",
  "can",
  "could",
  "would",
  "should",
  "please",
  "thanks",
  "hello",
  "hi",
  "hey"
]);

function normalizeOpenRouterBaseUrl(value) {
  if (!value) {
    return "";
  }

  return String(value).trim().replace(/\/+$/, "");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(a\.m\.|am)\b/g, "am")
    .replace(/\b(p\.m\.|pm)\b/g, "pm")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTimes(value) {
  const matches = [];
  const regex = /(\d{1,2})(?::\d{2})?\s*(am|pm)/gi;
  let match;
  while ((match = regex.exec(String(value || "")))) {
    matches.push(`${match[1]}${match[2].toLowerCase()}`);
  }
  return matches;
}

function buildTimeRange(times) {
  if (times.length >= 2) {
    return `${times[0]}-${times[1]}`;
  }
  return times[0] || "";
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token && !TAB_STOPWORDS.has(token));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

const KNOWN_COMMANDS = new Set(["help", "search", "reindex"]);

function stripBotMention(text) {
  if (!text) {
    return text;
  }

  const escaped = escapeRegExp(BOT_NAME);
  const compact = escapeRegExp(BOT_NAME.replace(/\s+/g, ""));
  const mentionPattern = new RegExp(`@?(?:${escaped}|${compact})`, "ig");
  return text.replace(mentionPattern, "").replace(/\s+/g, " ").trim();
}

// Profile lookup moved to src/profile/profile.service.js

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

async function readSheetRange(spreadsheetId, range) {
  const sheetsApi = await getSheetsApi();
  if (!sheetsApi) {
    return null;
  }

  const response = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range
  });

  return response.data?.values || [];
}

function scoreTabMatch(userMessage, tabName) {
  const normalizedQuery = normalizeText(userMessage);
  const normalizedTab = normalizeText(tabName);
  if (!normalizedTab) {
    return 0;
  }

  if (normalizedQuery.includes(normalizedTab)) {
    return 1;
  }

  const queryTimes = buildTimeRange(extractTimes(normalizedQuery));
  const tabTimes = buildTimeRange(extractTimes(normalizedTab));

  let score = 0;
  if (queryTimes && tabTimes && queryTimes === tabTimes) {
    score += 0.6;
  }

  const queryTokens = new Set(tokenize(normalizedQuery));
  const tabTokens = new Set(tokenize(normalizedTab));
  if (tabTokens.size > 0) {
    let matches = 0;
    for (const token of tabTokens) {
      if (queryTokens.has(token)) {
        matches += 1;
      }
    }
    const overlap = matches / tabTokens.size;
    score += overlap * 0.4;
  }

  return Math.min(1, score);
}

function shouldSuggestTabs(userMessage) {
  const normalized = normalizeText(userMessage);
  const hasShiftKeyword = /\b(shift|tab|schedule)\b/.test(normalized);
  const times = extractTimes(normalized);
  return hasShiftKeyword || times.length >= 2;
}

let sheetsApiClient = null;
let sheetsApiInitPromise = null;
let driveApiClient = null;
let driveApiInitPromise = null;
let oauthClient = null;
let oauthInitPromise = null;
let serviceAccountClient = null;
let serviceAccountInitPromise = null;

function hasOAuthConfig() {
  return Boolean(
    GOOGLE_OAUTH_CLIENT_ID &&
      GOOGLE_OAUTH_CLIENT_SECRET &&
      GOOGLE_OAUTH_REDIRECT_URL
  );
}

function loadOAuthToken() {
  if (!fs.existsSync(GOOGLE_OAUTH_TOKEN_FILE)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(GOOGLE_OAUTH_TOKEN_FILE, "utf8"));
  } catch (error) {
    logger.warn("google_oauth_token_parse_failed", { error: error.message });
    return null;
  }
}

function saveOAuthToken(token) {
  fs.writeFileSync(GOOGLE_OAUTH_TOKEN_FILE, JSON.stringify(token, null, 2));
}

function buildOAuthClient() {
  return new google.auth.OAuth2(
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URL
  );
}

async function initOAuthClient() {
  if (!hasOAuthConfig()) {
    return null;
  }

  const token = loadOAuthToken();
  if (!token) {
    return null;
  }

  const client = buildOAuthClient();
  client.setCredentials(token);
  return client;
}

async function initServiceAccountClient() {
  if (!GOOGLE_SERVICE_ACCOUNT_FILE) {
    return null;
  }

  if (!fs.existsSync(GOOGLE_SERVICE_ACCOUNT_FILE)) {
    logger.warn("google_service_account_missing", {
      path: GOOGLE_SERVICE_ACCOUNT_FILE
    });
    return null;
  }

  let credentials;
  try {
    credentials = JSON.parse(
      fs.readFileSync(GOOGLE_SERVICE_ACCOUNT_FILE, "utf8")
    );
  } catch (error) {
    logger.warn("google_service_account_parse_failed", {
      error: error.message
    });
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: GOOGLE_SHEETS_SCOPES
  });
  return auth.getClient();
}

async function getSheetsApi() {
  if (sheetsApiClient) {
    return sheetsApiClient;
  }

  if (!sheetsApiInitPromise) {
    sheetsApiInitPromise = (async () => {
      const oauthClient = await initOAuthClient();
      if (oauthClient) {
        sheetsApiClient = google.sheets({ version: "v4", auth: oauthClient });
        return sheetsApiClient;
      }

      const serviceAccountClient = await initServiceAccountClient();
      if (serviceAccountClient) {
        sheetsApiClient = google.sheets({
          version: "v4",
          auth: serviceAccountClient
        });
        return sheetsApiClient;
      }

      return null;
    })().finally(() => {
      sheetsApiInitPromise = null;
    });
  }

  return sheetsApiInitPromise;
}

async function getDriveApi() {
  if (driveApiClient) {
    return driveApiClient;
  }

  if (!driveApiInitPromise) {
    driveApiInitPromise = (async () => {
      const oauthClient = await initOAuthClient();
      if (oauthClient) {
        driveApiClient = google.drive({ version: "v3", auth: oauthClient });
        return driveApiClient;
      }

      const serviceAccountClient = await initServiceAccountClient();
      if (serviceAccountClient) {
        driveApiClient = google.drive({
          version: "v3",
          auth: serviceAccountClient
        });
        return driveApiClient;
      }

      return null;
    })().finally(() => {
      driveApiInitPromise = null;
    });
  }

  return driveApiInitPromise;
}

async function getGoogleOAuthClient() {
  if (oauthClient) {
    return oauthClient;
  }
  if (!oauthInitPromise) {
    oauthInitPromise = initOAuthClient().finally(() => {
      oauthInitPromise = null;
    });
  }
  oauthClient = await oauthInitPromise;
  return oauthClient;
}

async function getGoogleServiceAccountClient() {
  if (serviceAccountClient) {
    return serviceAccountClient;
  }
  if (!serviceAccountInitPromise) {
    serviceAccountInitPromise = initServiceAccountClient().finally(() => {
      serviceAccountInitPromise = null;
    });
  }
  serviceAccountClient = await serviceAccountInitPromise;
  return serviceAccountClient;
}

async function getAccessTokenForClient(authClient) {
  if (!authClient) {
    return null;
  }
  const tokenResponse = await authClient.getAccessToken();
  if (typeof tokenResponse === "string") {
    return tokenResponse;
  }
  return tokenResponse?.token || null;
}

async function getGoogleAccessTokenCandidates() {
  const candidates = [];
  const oauth = await getGoogleOAuthClient();
  const oauthToken = await getAccessTokenForClient(oauth);
  if (oauthToken) {
    candidates.push({ token: oauthToken, source: "oauth" });
  }

  const serviceClient = await getGoogleServiceAccountClient();
  const serviceToken = await getAccessTokenForClient(serviceClient);
  if (serviceToken && serviceToken !== oauthToken) {
    candidates.push({ token: serviceToken, source: "service_account" });
  }

  return candidates;
}

async function fetchSheetTabId(spreadsheetId, tabName) {
  const sheetsApi = await getSheetsApi();
  if (!sheetsApi) {
    return null;
  }

  const response = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))"
  });
  const sheets = response.data.sheets || [];
  const normalizedTarget = String(tabName || "").trim().toLowerCase();
  const match = sheets.find(
    (sheet) =>
      String(sheet.properties?.title || "").trim().toLowerCase() ===
      normalizedTarget
  );
  return match?.properties?.sheetId || null;
}

const backlogsPublisher = createBacklogsPublisher({
  sheetId: BACKLOGS_IMAGE_SHEET_ID,
  tabName: BACKLOGS_IMAGE_TAB_NAME,
  imageRange: BACKLOGS_IMAGE_RANGE,
  monitorRange: BACKLOGS_MONITOR_RANGE,
  monitorStatePath: BACKLOGS_MONITOR_STATE_PATH,
  timezone: BACKLOGS_TIMEZONE,
  groupId: BACKLOGS_SCHEDULED_GROUP_ID,
  imageGid: BACKLOGS_IMAGE_GID,
  readSheetRange,
  fetchSheetTabId,
  getGoogleAccessTokenCandidates,
  sendGroupMessage,
  trackEvent: (details) =>
    trackSystemEvent(BotEventType.BACKLOGS_SCHEDULED, details),
  logger
});
const { sendBacklogsScheduledUpdate } = backlogsPublisher;

const SHEET_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "with",
  "that",
  "this",
  "from",
  "your",
  "you",
  "about",
  "what",
  "when",
  "where",
  "which",
  "who",
  "how",
  "can",
  "could",
  "would",
  "should",
  "please",
  "thanks",
  "hello",
  "hi",
  "hey"
]);

const sheetCache = {
  lastLoadedAtMs: 0,
  sheets: []
};
let sheetRefreshPromise = null;

function parseSheetLink(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const idMatch = trimmed.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) {
    return null;
  }

  const gidMatch = trimmed.match(/(?:[?#&]gid=)(\d+)/);
  return {
    id: idMatch[1],
    gid: gidMatch ? gidMatch[1] : null,
    url: trimmed
  };
}

function buildSheetExportUrl(sheet) {
  const gidParam = sheet.gid ? `&gid=${sheet.gid}` : "";
  return `https://docs.google.com/spreadsheets/d/${sheet.id}/export?format=csv${gidParam}`;
}

function buildSheetUrlWithGid(spreadsheetId, sheetId) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`;
}

function formatSheetRow(row) {
  return row
    .map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim())
    .join(" | ")
    .trim();
}

async function fetchSheetValuesViaApi(api, sheet) {
  const meta = await api.spreadsheets.get({
    spreadsheetId: sheet.id,
    fields: "properties/title,sheets(properties(sheetId,title))"
  });

  const spreadsheetTitle = meta.data.properties?.title || "Unknown Spreadsheet";
  const sheets = meta.data.sheets || [];
  if (!sheets.length) {
    throw new Error("No tabs found in spreadsheet.");
  }

  if (sheet.gid) {
    const byId = sheets.find(
      (entry) => String(entry.properties?.sheetId) === String(sheet.gid)
    );
    const target = byId || sheets[0];
    const sheetTitle = target?.properties?.title;
    if (!sheetTitle) {
      throw new Error("Unable to determine sheet name.");
    }

    const range = SHEETS_DEFAULT_RANGE
      ? `${sheetTitle}!${SHEETS_DEFAULT_RANGE}`
      : sheetTitle;
    const valuesResponse = await api.spreadsheets.values.get({
      spreadsheetId: sheet.id,
      range
    });

    const values = valuesResponse.data.values || [];
    const lines = values.map(formatSheetRow).filter(Boolean);
    return [
      {
        ...sheet,
        spreadsheetTitle,
        tabName: sheetTitle,
        url: buildSheetUrlWithGid(sheet.id, target.properties.sheetId),
        lines
      }
    ];
  }

  if (!SHEETS_SCAN_ALL_TABS) {
    const target = sheets[0];
    const sheetTitle = target?.properties?.title;
    if (!sheetTitle) {
      throw new Error("Unable to determine sheet name.");
    }

    const range = SHEETS_DEFAULT_RANGE
      ? `${sheetTitle}!${SHEETS_DEFAULT_RANGE}`
      : sheetTitle;
    const valuesResponse = await api.spreadsheets.values.get({
      spreadsheetId: sheet.id,
      range
    });

    const values = valuesResponse.data.values || [];
    const lines = values.map(formatSheetRow).filter(Boolean);
    return [
      {
        ...sheet,
        spreadsheetTitle,
        tabName: sheetTitle,
        url: buildSheetUrlWithGid(sheet.id, target.properties.sheetId),
        lines
      }
    ];
  }

  const tabs = sheets.slice(0, SHEETS_MAX_TABS);
  const ranges = tabs.map((entry) => {
    const title = entry.properties?.title;
    return SHEETS_DEFAULT_RANGE ? `${title}!${SHEETS_DEFAULT_RANGE}` : title;
  });

  const valuesResponse = await api.spreadsheets.values.batchGet({
    spreadsheetId: sheet.id,
    ranges
  });

  const valueRanges = valuesResponse.data.valueRanges || [];
  return valueRanges.map((range, index) => {
    const tab = tabs[index];
    const values = range.values || [];
    const lines = values.map(formatSheetRow).filter(Boolean);
    return {
      ...sheet,
      spreadsheetTitle,
      tabName: tab?.properties?.title || "Unknown",
      url: buildSheetUrlWithGid(sheet.id, tab?.properties?.sheetId),
      lines
    };
  });
}

async function fetchSheetCsv(sheet) {
  const exportUrl = buildSheetExportUrl(sheet);
  const response = await axios.get(exportUrl, {
    responseType: "text",
    timeout: env.SEATALK_HTTP_TIMEOUT_MS
  });
  const csvText = typeof response.data === "string" ? response.data : "";

  if (!csvText || /<html/i.test(csvText)) {
    throw new Error("Sheet is not public or returned HTML.");
  }

  const lines = csvText.split(/\r?\n/).filter((line) => line.length > 0);
  return {
    ...sheet,
    lines
  };
}

async function refreshSheetCache() {
  if (sheetRefreshPromise) {
    return sheetRefreshPromise;
  }

  sheetRefreshPromise = (async () => {
    if (!fs.existsSync(SHEETS_FILE)) {
      sheetCache.sheets = [];
      sheetCache.lastLoadedAtMs = Date.now();
      return;
    }

    const raw = fs.readFileSync(SHEETS_FILE, "utf8");
    const links = raw
      .split(/\r?\n/)
      .map(parseSheetLink)
      .filter(Boolean);

    const sheetsApi = await getSheetsApi();
    if (!sheetsApi && (hasOAuthConfig() || GOOGLE_SERVICE_ACCOUNT_FILE)) {
      logger.warn("sheets_api_unavailable");
    }

    const sheets = [];
    for (const link of links) {
      try {
        const sheetData = sheetsApi
          ? await fetchSheetValuesViaApi(sheetsApi, link)
          : await fetchSheetCsv(link);
        const entries = Array.isArray(sheetData) ? sheetData : [sheetData];
        sheets.push(...entries);
      } catch (error) {
        logger.warn("sheet_load_failed", {
          url: link.url,
          error: error.response?.data || error.message
        });
      }
    }

    sheetCache.sheets = sheets;
    sheetCache.lastLoadedAtMs = Date.now();
  })().finally(() => {
    sheetRefreshPromise = null;
  });

  return sheetRefreshPromise;
}

function extractKeywords(text) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !SHEET_STOPWORDS.has(word));

  return Array.from(new Set(words));
}

function buildSheetContext(userMessage, options = {}) {
  if (!sheetCache.sheets.length) {
    return "";
  }

  const preferredTab = options.preferredTab || null;
  const sheetsToSearch = preferredTab
    ? sheetCache.sheets.filter(
        (sheet) =>
          sheet.id === preferredTab.id &&
          sheet.tabName === preferredTab.tabName
      )
    : sheetCache.sheets;

  const keywords = extractKeywords(userMessage);
  if (!keywords.length) {
    return "";
  }

  const parts = [];
  let totalChars = 0;

  for (const sheet of sheetsToSearch) {
    const matches = [];
    for (const line of sheet.lines) {
      const lower = line.toLowerCase();
      if (keywords.some((keyword) => lower.includes(keyword))) {
        matches.push(line);
      }
      if (matches.length >= SHEETS_MAX_MATCH_LINES) {
        break;
      }
    }

    if (!matches.length) {
      continue;
    }

    const header = sheet.lines[0];
    const snippetLines = header ? [header, ...matches] : matches;
    const snippet = snippetLines.join("\n");
    const label = sheet.tabName
      ? `Sheet: ${sheet.url} (tab: ${sheet.tabName})`
      : `Sheet: ${sheet.url}`;
    const block = `${label}\n${snippet}`;

    if (totalChars + block.length > SHEETS_MAX_CONTEXT_CHARS) {
      break;
    }

    parts.push(block);
    totalChars += block.length;
  }

  return parts.join("\n\n");
}

function startSheetRefreshTimer() {
  refreshSheetCache().catch((error) => {
    logger.warn("sheet_initial_load_failed", { error: error.message });
  });

  if (SHEETS_REFRESH_MINUTES > 0) {
    const intervalMs = SHEETS_REFRESH_MINUTES * 60 * 1000;
    setInterval(() => {
      refreshSheetCache().catch((error) => {
        logger.warn("sheet_refresh_failed", { error: error.message });
      });
    }, intervalMs).unref();
  }
}

function findTabMatch(userMessage) {
  if (!sheetCache.sheets.length) {
    return null;
  }

  const candidates = sheetCache.sheets.filter((sheet) => sheet.tabName);
  if (!candidates.length) {
    return null;
  }

  const scored = candidates
    .map((sheet) => ({
      sheet,
      score: scoreTabMatch(userMessage, sheet.tabName)
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score <= 0) {
    return null;
  }

  const suggestions = scored
    .filter((entry) => entry.score >= TAB_SUGGEST_MIN_SCORE)
    .slice(0, TAB_SUGGEST_LIMIT)
    .map((entry) => entry.sheet);

  return {
    match:
      best.score >= TAB_MATCH_MIN_SCORE ? best.sheet : null,
    suggestions,
    bestScore: best.score
  };
}

function buildTabSuggestionReply(suggestions) {
  const formatted = suggestions
    .map((sheet) => {
      const label = sheet.spreadsheetTitle
        ? `${sheet.tabName} - ${sheet.spreadsheetTitle}`
        : sheet.tabName;
      return `- ${label}`;
    })
    .join("\n");

  return `Did you mean one of these tabs?\n${formatted}`;
}

async function generateIntelligentReply(userMessage, options = {}) {
  const sheetContext = options.skipSheetContext
    ? ""
    : buildSheetContext(userMessage, {
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
    useTools: options.useTools
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
  sheetCache,
  refreshSheetCache,
  readSheetRange,
  indexStore,
  knownCommands: KNOWN_COMMANDS,
  buildGreeting,
  getEventMessageText,
  sendSubscriberMessage,
  sendSubscriberTyping
});

// ======================
// Google OAuth for Sheets
// ======================
app.get("/google/oauth/start", (req, res) => {
  if (!hasOAuthConfig()) {
    return res
      .status(500)
      .send("Google OAuth is not configured. Check your .env settings.");
  }

  const oauthClient = buildOAuthClient();
  const authUrl = oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SHEETS_SCOPES
  });

  return res.redirect(authUrl);
});

app.get("/google/oauth/callback", async (req, res) => {
  if (!hasOAuthConfig()) {
    return res
      .status(500)
      .send("Google OAuth is not configured. Check your .env settings.");
  }

  const code = Array.isArray(req.query.code)
    ? req.query.code[0]
    : req.query.code;
  const error = Array.isArray(req.query.error)
    ? req.query.error[0]
    : req.query.error;

  if (error) {
    return res.status(400).send(`OAuth error: ${error}`);
  }

  if (!code) {
    return res.status(400).send("Missing OAuth code.");
  }

  try {
    const oauthClient = buildOAuthClient();
    const { tokens } = await oauthClient.getToken(code);
    oauthClient.setCredentials(tokens);
    saveOAuthToken(tokens);
    sheetsApiClient = google.sheets({ version: "v4", auth: oauthClient });

    refreshSheetCache().catch((refreshError) => {
      logger.warn("sheet_refresh_after_oauth_failed", {
        error: refreshError.message
      });
    });

    return res.send(
      "Google OAuth connected. You can close this tab and use the bot."
    );
  } catch (oauthError) {
    logger.error("google_oauth_callback_failed", {
      error: oauthError.response?.data || oauthError.message
    });
    return res.status(500).send("OAuth failed. Check server logs.");
  }
});

// ======================
// Health endpoints
// ======================
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/ready", (req, res) => {
  const missing = getMissingRequiredConfig();

  const indexLoaded =
    Array.isArray(indexStore.items) && indexStore.items.length > 0;
  if (!indexLoaded) {
    missing.push("INDEX_STORE");
  }

  const ok = missing.length === 0;
  res.status(ok ? 200 : 503).json({
    ok,
    missing,
    indexLoaded
  });
});

app.post("/v1/bot/events", (req, res) => {
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

  const resolvedType = resolveBotEventType(payload.event_type);
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

app.post("/seatalk/notify", async (req, res) => {
  const requestId =
    req.requestId || req.headers["x-request-id"] || createRequestId();
  const bodyRaw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const signature = getSignatureHeader(req.headers);

  if (!isValidSignature(bodyRaw, signature, SIGNING_SECRET)) {
    logger.warn("invalid_signature_notification", { requestId });
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

// ======================
// Callback endpoint
// ======================
app.post("/seatalk/callback", (req, res) => {
  const requestId =
    req.requestId || req.headers["x-request-id"] || createRequestId();
  const startedAt = Date.now();
  const bodyRaw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const signature = getSignatureHeader(req.headers);

  // 1) Verify signature
  if (!isValidSignature(bodyRaw, signature, SIGNING_SECRET)) {
    logger.warn("invalid_signature", { requestId });
    return res.status(400).send("Invalid signature");
  }

  const data = req.body || {};
  const eventType = data.event_type || "unknown";
  const eventPayload = data.event || data;
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

  logger.info("seatalk_event_received", {
    requestId,
    eventType
  });

  // 2) Handle verification event
  if (eventType === EVENT_VERIFICATION) {
    logger.info("seatalk_event_verified", { requestId });
    return res.send(data.event);
  }

  // 3) Handle other events
  try {
    switch (eventType) {
      case NEW_BOT_SUBSCRIBER:
        logger.info("new_subscriber", { requestId });
        break;

    case MESSAGE_FROM_BOT_SUBSCRIBER:
      logger.info("subscriber_message", { requestId });
      handleSubscriberMessage(data.event, {
        requestId,
        logger,
        trackEvent: track
      }).catch((err) => {
        logger.error("subscriber_message_failed", {
          requestId,
          error: err.response?.data || err.message
        });
        track(BotEventType.ERROR, {
          error: err.response?.data || err.message
        });
      });
      break;

    case INTERACTIVE_MESSAGE_CLICK:
      logger.info("interactive_message_click", { requestId });
      interactiveHandler
        .handleInteractiveEvent(data.event, { trackEvent: track })
        .catch((err) => {
          logger.error("interactive_event_failed", {
            requestId,
            error: err.response?.data || err.message
          });
          track(BotEventType.ERROR, {
            error: err.response?.data || err.message
          });
        });
      break;

      case BOT_ADDED_TO_GROUP_CHAT:
        logger.info("bot_added_to_group", { requestId });
        break;

      case BOT_REMOVED_FROM_GROUP_CHAT:
        logger.info("bot_removed_from_group", { requestId });
        break;

      case NEW_MENTIONED_MESSAGE_RECEIVED_FROM_GROUP_CHAT:
        logger.info("bot_mentioned_in_group", { requestId });
        groupHandler
          .handleGroupMention(data.event, {
            sheetCache,
            refreshSheetCache,
            stripBotMention,
            handleIntentMessage: intentService.handleIntentMessage,
            parseCommand: commands.parseCommand,
            handleCommand: commands.handle,
            commandContext: {
              store: indexStore,
              logger,
              requestId
            },
            knownCommands: KNOWN_COMMANDS,
            detectIntent: intentService.detectIntent,
            trackEvent: track,
            buildGreeting,
            generateReply: generateIntelligentReply,
            requestId,
            logger,
            readSheetRange,
            sendGroupMessage,
            sendGroupTyping,
            postWithAuth,
            apiBaseUrl: SEATALK_API_BASE_URL,
            sessionStore: groupSessionStore
          })
          .catch((err) => {
            logger.error("group_mention_failed", {
              requestId,
              error: err.response?.data || err.message
            });
          });
        break;

      default:
        logger.info("unknown_event", { requestId, eventType });
    }
  } catch (error) {
    logger.error("seatalk_event_error", {
      requestId,
      eventType,
      error: error.message
    });
  }

  const durationMs = Date.now() - startedAt;
  logger.info("seatalk_event_handled", {
    requestId,
    eventType,
    durationMs
  });

  res.status(200).send(""); // Must respond 200 OK
});

// ======================
// Start server
// ======================
async function runScheduledTasks() {
  await runDriveZipSync();
  await sendBacklogsScheduledUpdate();
}

validateStartupConfig();
startSheetRefreshTimer();
scheduler.startScheduler(trackSystemEvent, runScheduledTasks, {
  logger
});

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
