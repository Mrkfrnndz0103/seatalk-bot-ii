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
const commands = require("./commands");
const intentService = require("./services/intent.service");
const groupHandler = require("./services/group.handler");
const interactiveHandler = require("./services/interactive.handler");
const scheduler = require("./services/scheduler");
const { logger } = require("./utils/logger");
const { isValidSignature, getSignatureHeader } = require("./utils/signature");
const { BotEventType } = require("./events/event.types");
const { mapSeatalkEventType } = require("./events/event.mapper");
const { trackEvent } = require("./events/event.tracker");

const app = express();
const rateLimitState = new Map();

function rawBodySaver(req, res, buf) {
  if (buf && buf.length) {
    req.rawBody = buf;
  }
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || "unknown";
}

function rateLimit(req, res, next) {
  if (!env.RATE_LIMIT_MAX || env.RATE_LIMIT_MAX <= 0) {
    return next();
  }

  const ip = getClientIp(req);
  const now = Date.now();
  const entry = rateLimitState.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitState.set(ip, {
      count: 1,
      resetAt: now + env.RATE_LIMIT_WINDOW_MS
    });
    return next();
  }

  if (entry.count >= env.RATE_LIMIT_MAX) {
    return res.status(429).send("Too Many Requests");
  }

  entry.count += 1;
  return next();
}

function createRequestId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
}

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

app.use(
  express.json({
    verify: rawBodySaver,
    limit: env.REQUEST_BODY_LIMIT
  })
);
app.use(rateLimit);

const indexStore = new FileStore({ path: env.INDEX_STORE_PATH });
indexStore.load();

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

// Verify signature

const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const TOKEN_FALLBACK_TTL_MS = 2 * 60 * 60 * 1000;
let cachedAccessToken = null;
let accessTokenExpiresAtMs = 0;
let refreshPromise = null;

function hasTokenCredentials() {
  return Boolean(SEATALK_TOKEN_URL && SEATALK_APP_ID && SEATALK_APP_SECRET);
}

async function requestAccessToken() {
  const response = await axios.post(
    SEATALK_TOKEN_URL,
    {
      // Adjust keys to match the Seatalk token endpoint requirements.
      app_id: SEATALK_APP_ID,
      app_secret: SEATALK_APP_SECRET
    },
    { timeout: env.SEATALK_HTTP_TIMEOUT_MS }
  );

  const payload = response.data?.data || response.data;
  const token = payload?.access_token || payload?.app_access_token;
  const expiresIn = Number(
    payload?.expires_in ?? payload?.expire_in ?? payload?.expires ?? 0
  );

  if (!token) {
    throw new Error("Token endpoint response missing access token.");
  }

  cachedAccessToken = token;
  accessTokenExpiresAtMs =
    Date.now() + (expiresIn > 0 ? expiresIn * 1000 : TOKEN_FALLBACK_TTL_MS);
  return cachedAccessToken;
}

async function getAccessToken(options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);

  if (!hasTokenCredentials()) {
    if (!STATIC_BOT_ACCESS_TOKEN) {
      throw new Error(
        "Missing BOT_ACCESS_TOKEN or Seatalk app credentials for refresh."
      );
    }
    return STATIC_BOT_ACCESS_TOKEN;
  }

  const now = Date.now();
  const isFresh =
    cachedAccessToken &&
    now < accessTokenExpiresAtMs - TOKEN_REFRESH_BUFFER_MS;

  if (!forceRefresh && isFresh) {
    return cachedAccessToken;
  }

  if (!refreshPromise) {
    refreshPromise = requestAccessToken().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

function isUnauthorized(error) {
  return (
    error.response?.status === 401 || error.response?.data?.code === 401
  );
}

async function requestWithAuth(method, url, payload) {
  const token = await getAccessToken();
  const normalizedMethod = String(method || "post").toLowerCase();
  const config = {
    method: normalizedMethod,
    url,
    timeout: env.SEATALK_HTTP_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  };

  if (normalizedMethod === "get") {
    config.params = payload;
  } else {
    config.data = payload;
  }

  try {
    return await axios(config);
  } catch (error) {
    if (hasTokenCredentials() && isUnauthorized(error)) {
      const refreshedToken = await getAccessToken({ forceRefresh: true });
      config.headers.Authorization = `Bearer ${refreshedToken}`;
      return await axios(config);
    }
    throw error;
  }
}

async function postWithAuth(url, payload) {
  return requestWithAuth("post", url, payload);
}

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

function toTitleCase(value) {
  return String(value)
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatUserName(event) {
  if (event?.name) {
    return event.name;
  }

  if (event?.email) {
    const localPart = String(event.email).split("@")[0] || "";
    const cleaned = localPart.replace(/[._-]+/g, " ").trim();
    if (cleaned) {
      return toTitleCase(cleaned);
    }
  }

  if (event?.employee_code) {
    return `Employee ${event.employee_code}`;
  }

  if (event?.seatalk_id) {
    return `User ${event.seatalk_id}`;
  }

  return "there";
}

function formatFirstName(value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) {
    return "there";
  }
  return cleaned.split(/\s+/)[0];
}

function buildGreeting(event) {
  const firstName = formatFirstName(formatUserName(event));
  return `Hi ${firstName} 👋 How can I help you today?`;
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

const profileCache = new Map();

function getProfileCacheKey(event) {
  return event?.seatalk_id || event?.employee_code || event?.email || null;
}

function getCachedProfileName(key) {
  if (!key || !profileCache.has(key)) {
    return null;
  }

  const entry = profileCache.get(key);
  if (!entry || Date.now() > entry.expiresAtMs) {
    profileCache.delete(key);
    return null;
  }

  return entry.name;
}

function cacheProfileName(key, name) {
  if (!key || !name || SEATALK_PROFILE_CACHE_MINUTES <= 0) {
    return;
  }

  profileCache.set(key, {
    name,
    expiresAtMs: Date.now() + SEATALK_PROFILE_CACHE_MINUTES * 60 * 1000
  });
}

function extractDisplayName(profile) {
  if (!profile) {
    return null;
  }

  if (Array.isArray(profile)) {
    return extractDisplayName(profile[0]);
  }

  if (typeof profile === "string") {
    return profile.trim() || null;
  }

  const candidates = [
    profile.name,
    profile.display_name,
    profile.displayName,
    profile.employee_name,
    profile.user_name,
    profile.full_name,
    profile.fullName,
    profile.nickname,
    profile.user?.name,
    profile.user?.display_name,
    profile.employee?.name,
    profile.employee?.display_name
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

async function fetchSeatalkProfileName(event) {
  if (!SEATALK_PROFILE_URL) {
    return null;
  }

  const payload = {};
  if (event?.seatalk_id) {
    payload.seatalk_id = event.seatalk_id;
  }
  if (event?.employee_code) {
    payload.employee_code = event.employee_code;
  }
  if (event?.email) {
    payload.email = event.email;
  }

  if (!Object.keys(payload).length) {
    return null;
  }

  try {
    const response = await requestWithAuth(
      SEATALK_PROFILE_METHOD,
      SEATALK_PROFILE_URL,
      payload
    );
    const data = response.data?.data ?? response.data;
    return extractDisplayName(data);
  } catch (error) {
    console.warn(
      "Failed to fetch Seatalk profile name:",
      error.response?.data || error.message
    );
    return null;
  }
}

async function getSeatalkDisplayName(event) {
  if (event?.name) {
    return event.name;
  }

  const cacheKey = getProfileCacheKey(event);
  const cached = getCachedProfileName(cacheKey);
  if (cached) {
    return cached;
  }

  const fetched = await fetchSeatalkProfileName(event);
  if (fetched) {
    cacheProfileName(cacheKey, fetched);
    return fetched;
  }

  return formatUserName(event);
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
    console.warn("Failed to parse Google OAuth token file:", error.message);
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
    console.warn(
      `Google service account file not found: ${GOOGLE_SERVICE_ACCOUNT_FILE}`
    );
    return null;
  }

  let credentials;
  try {
    credentials = JSON.parse(
      fs.readFileSync(GOOGLE_SERVICE_ACCOUNT_FILE, "utf8")
    );
  } catch (error) {
    console.warn(
      "Failed to parse Google service account file:",
      error.message
    );
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
      console.warn(
        "Google Sheets API client not available. Check OAuth or service account config."
      );
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
        console.warn(
          `Failed to load sheet ${link.url}:`,
          error.response?.data || error.message
        );
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
    console.warn("Initial sheet load failed:", error.message);
  });

  if (SHEETS_REFRESH_MINUTES > 0) {
    const intervalMs = SHEETS_REFRESH_MINUTES * 60 * 1000;
    setInterval(() => {
      refreshSheetCache().catch((error) => {
        console.warn("Sheet refresh failed:", error.message);
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
  if (!OPENROUTER_API_KEY || !OPENROUTER_MODEL) {
    return "Thanks for your message! (AI not configured yet.)";
  }

  const systemPrompt =
    `You are ${BOT_NAME}, a helpful SeaTalk bot. Respond intelligently, short, and concise (1-3 sentences). Do not include greetings. ` +
    "If the request is about backlogs, top contributors by region, or truck requests, answer using the provided sheet context. " +
    "If it is unclear or does not match, ask one brief clarifying question and give one example query.";
  const sheetContext = options.skipSheetContext
    ? ""
    : buildSheetContext(userMessage, {
        preferredTab: options.preferredTab
      });
  const messages = [{ role: "system", content: systemPrompt }];

  if (options.preferredTab) {
    const label = options.preferredTab.spreadsheetTitle
      ? `${options.preferredTab.tabName} - ${options.preferredTab.spreadsheetTitle}`
      : options.preferredTab.tabName;
    messages.push({
      role: "system",
      content: `Use data from the "${label}" tab only.`
    });
  }

  if (sheetContext) {
    messages.push({
      role: "system",
      content: `Context from team sheets (partial, may be outdated):\n${sheetContext}`
    });
  }

  try {
    const startedAt = Date.now();
    const response = await axios.post(
      `${OPENROUTER_API_BASE_URL}/chat/completions`,
      {
        model: OPENROUTER_MODEL,
        messages: [...messages, { role: "user", content: userMessage }],
        temperature: 0.3,
        max_tokens: 120
      },
      {
        timeout: options.timeoutMs || env.OPENROUTER_HTTP_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": OPENROUTER_APP_URL || undefined,
          "X-Title": OPENROUTER_APP_TITLE || undefined,
          "Content-Type": "application/json"
        }
      }
    );

    if (options.logger && typeof options.logger.info === "function") {
      const payload = { ms: Date.now() - startedAt };
      if (options.requestId) {
        payload.requestId = options.requestId;
      }
      options.logger.info("llm_reply_ms", payload);
    }

    const reply = response.data?.choices?.[0]?.message?.content?.trim();
    return reply || "Thanks for your message.";
  } catch (error) {
    console.error(
      "OpenRouter reply failed:",
      error.response?.data || error.message
    );
    return "Thanks for your message. I'm having trouble responding right now.";
  }
}

async function handleSubscriberMessage(event, ctx = {}) {
  const requestId = ctx.requestId || "unknown";
  const log = ctx.logger || logger;
  const startedAt = Date.now();
  const track = typeof ctx.trackEvent === "function" ? ctx.trackEvent : null;

  try {
    const employee_code = event.employee_code;
    const rawText = event.message?.text?.content?.trim();
    const msgText = stripBotMention(rawText);
    const greeting = buildGreeting(event);

    const replyWithGreeting = async (text) => {
      const content = text ? `${greeting}\n${text}` : greeting;
      await replyToSubscriber(employee_code, content);
    };

    if (!employee_code) {
      log.warn("subscriber_missing_employee_code", { requestId });
      if (track) {
        track(BotEventType.ERROR, { reason: "missing_employee_code" });
      }
      return;
    }

    if (!msgText) {
      await replyWithGreeting("I can only read text messages right now.");
      return;
    }

    const parsedCommand =
      typeof commands.parseCommand === "function"
        ? commands.parseCommand(msgText)
        : null;
    if (parsedCommand) {
      log.info("command_received", {
        requestId,
        command: parsedCommand.cmd
      });
      if (track) {
        track(BotEventType.COMMAND, { command: parsedCommand.cmd });
        if (parsedCommand.cmd === "help") {
          track(BotEventType.HELP_REQUEST, { command: parsedCommand.cmd });
        } else if (!KNOWN_COMMANDS.has(parsedCommand.cmd)) {
          track(BotEventType.INVALID_COMMAND, { command: parsedCommand.cmd });
        }
      }
    }

    const commandReply = await commands.handle(msgText, {
      store: indexStore,
      logger: log,
      requestId
    });
    if (commandReply && commandReply.text) {
      await replyWithGreeting(commandReply.text);
      return;
    }

    const intentType = intentService.detectIntent(msgText);
    if (intentType && track) {
      track(BotEventType.KEYWORD_TRIGGER, { intent: intentType });
    }

    const intentReply = await intentService.handleIntentMessage(msgText, {
      sheetCache,
      refreshSheetCache
    });
    if (intentReply && intentReply.text) {
      await replyWithGreeting(intentReply.text);
      return;
    }

    const loadedIndex = Array.isArray(indexStore.items) ? indexStore.items : [];
    if (!loadedIndex.length) {
      await replyWithGreeting("Index is empty. Run /reindex to build it.");
      return;
    }

    const searchReply = await commands.handle(`/search ${msgText}`, {
      store: indexStore,
      topK: 3,
      fallbackIfEmpty: true,
      logger: log,
      requestId
    });
    if (searchReply && searchReply.text) {
      await replyWithGreeting(searchReply.text);
      return;
    }

    if (track) {
      track(BotEventType.FALLBACK, { reason: "no_intent_no_search" });
    }

    const fallbackReply = await generateIntelligentReply(msgText, {
      skipSheetContext: false,
      logger: log,
      requestId
    });
    await replyWithGreeting(fallbackReply || "Thanks for your message.");
  } catch (error) {
    log.error("subscriber_message_error", {
      requestId,
      error: error.message
    });
    if (track) {
      track(BotEventType.ERROR, { error: error.message });
    }
    if (event?.employee_code) {
      await replyToSubscriber(
        event.employee_code,
        "Sorry, I ran into an error while processing your request."
      );
    }
  } finally {
    log.info("subscriber_message_handled", {
      requestId,
      durationMs: Date.now() - startedAt
    });
  }
}



// Send text message to subscriber
async function replyToSubscriber(employee_code, content) {
  try {
    const response = await postWithAuth(
      `${SEATALK_API_BASE_URL}/messaging/v2/single_chat`,
      {
        employee_code: employee_code,
        message: {
          tag: "text",
          text: {
            format: 1, // 1 = markdown, 2 = plain text
            content: content
          }
        },
        usable_platform: "all"
      }
    );

    if (response.data.code === 0) {
      console.log("Message sent successfully:", response.data.message_id);
    } else {
      console.error("Failed to send message:", response.data);
    }
  } catch (err) {
    console.error("Error sending message:", err.response?.data || err.message);
  }
}

async function sendGroupMessage(group_id, content) {
  try {
    const response = await postWithAuth(
      `${SEATALK_API_BASE_URL}/messaging/v2/group_chat`,
      {
        group_id,
        message: {
          tag: "text",
          text: {
            format: 1,
            content
          }
        },
        usable_platform: "all"
      }
    );

    if (response.data.code === 0) {
      console.log("Group message sent successfully:", response.data.message_id);
    } else {
      console.error("Failed to send group message:", response.data);
    }
  } catch (err) {
    console.error(
      "Error sending group message:",
      err.response?.data || err.message
    );
  }
}

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
      console.warn("Sheet refresh failed after OAuth:", refreshError.message);
    });

    return res.send(
      "Google OAuth connected. You can close this tab and use the bot."
    );
  } catch (oauthError) {
    console.error(
      "Google OAuth callback failed:",
      oauthError.response?.data || oauthError.message
    );
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

app.post("/seatalk/notify", async (req, res) => {
  const requestId = req.headers["x-request-id"] || createRequestId();
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
    await replyToSubscriber(employee_code, message);
    return res.json({ status: "ok", target: "dm" });
  }

  return res.status(400).send("Missing group_id or employee_code");
});

// ======================
// Callback endpoint
// ======================
app.post("/seatalk/callback", (req, res) => {
  const requestId = req.headers["x-request-id"] || createRequestId();
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
            knownCommands: KNOWN_COMMANDS,
            detectIntent: intentService.detectIntent,
            trackEvent: track,
            buildGreeting,
            postWithAuth,
            apiBaseUrl: SEATALK_API_BASE_URL
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
startSheetRefreshTimer();
scheduler.startScheduler(trackSystemEvent);

const PORT = env.PORT;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
