const IS_VERCEL = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
const DEFAULT_INDEX_STORE_PATH = IS_VERCEL
  ? "/tmp/chunks.jsonl"
  : "./data/chunks.jsonl";
const DEFAULT_SHEETS_FILE = "./sheets.txt";
const DEFAULT_MAX_ROWS_TO_SCAN = 2000;
const DEFAULT_MAX_COLS_TO_SCAN = 200;
const DEFAULT_REQUEST_BODY_LIMIT = "1mb";
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX = 60;
const DEFAULT_PROFILE_CACHE_MINUTES = 60;
const DEFAULT_SHEETS_REFRESH_MINUTES = 15;
const DEFAULT_SHEETS_MAX_TABS = 10;
const DEFAULT_SHEETS_MAX_MATCH_LINES = 8;
const DEFAULT_SHEETS_MAX_CONTEXT_CHARS = 3000;
const DEFAULT_SEARCH_LLM_TIMEOUT_MS = 1800;
const DEFAULT_SEARCH_LLM_CACHE_TTL_MS = 120 * 1000;
const DEFAULT_HTTP_TIMEOUT_MS = 8000;
const DEFAULT_SCHEDULED_INTERVAL_MINUTES = 0;
const DEFAULT_PROFILE_LOOKUP_COOLDOWN_MS = 30 * 60 * 1000;
const DEFAULT_MCP_TIMEOUT_MS = 10000;
const DEFAULT_MCP_RETRY_MAX = 3;
const DEFAULT_MCP_RETRY_BASE_MS = 500;
const DEFAULT_GOOGLE_OAUTH_TOKEN_FILE = IS_VERCEL
  ? "/tmp/google-token.json"
  : "";
const DEFAULT_TRUCK_ALERT_START_ROW = 3155;
const DEFAULT_TRUCK_ALERT_STATE_PATH = IS_VERCEL
  ? "/tmp/truck-alert-state.json"
  : "./data/truck-alert-state.json";
const DEFAULT_BACKLOGS_DATA_SHEET_ID =
  "1mf7WSmGnzDFt3l5oZqi0UISNxP_i0BGYAW8PM5vwPQ0";
const DEFAULT_BACKLOGS_DATA_TAB_NAME = "backlogs";
const DEFAULT_TRUCK_REQUEST_TAB_NAME = "truck_request";

function parseNonNegativeInt(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parsePositiveInt(value, fallback) {
  const parsed = parseNonNegativeInt(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(normalized)) {
    return false;
  }
  return fallback;
}

const env = {
  PORT: parsePositiveInt(process.env.PORT, 3000),
  REQUEST_BODY_LIMIT:
    process.env.REQUEST_BODY_LIMIT || DEFAULT_REQUEST_BODY_LIMIT,
  RATE_LIMIT_WINDOW_MS: parsePositiveInt(
    process.env.RATE_LIMIT_WINDOW_MS,
    DEFAULT_RATE_LIMIT_WINDOW_MS
  ),
  RATE_LIMIT_MAX: parsePositiveInt(
    process.env.RATE_LIMIT_MAX,
    DEFAULT_RATE_LIMIT_MAX
  ),
  SIGNING_SECRET: process.env.SIGNING_SECRET || "",
  BOT_ACCESS_TOKEN: process.env.BOT_ACCESS_TOKEN || "",
  SEATALK_API_BASE_URL:
    process.env.SEATALK_API_BASE_URL || "https://openapi.seatalk.io",
  SEATALK_TOKEN_URL: process.env.SEATALK_TOKEN_URL || "",
  SEATALK_APP_ID: process.env.SEATALK_APP_ID || "",
  SEATALK_APP_SECRET: process.env.SEATALK_APP_SECRET || "",
  SEATALK_PROFILE_URL: process.env.SEATALK_PROFILE_URL || "",
  SEATALK_PROFILE_METHOD: String(
    process.env.SEATALK_PROFILE_METHOD || "post"
  ).toLowerCase(),
  SEATALK_GROUP_TYPING_URL: process.env.SEATALK_GROUP_TYPING_URL || "",
  SEATALK_SINGLE_CHAT_TYPING_URL:
    process.env.SEATALK_SINGLE_CHAT_TYPING_URL || "",
  SEATALK_PROFILE_LOOKUP_ENABLED: parseBoolean(
    process.env.SEATALK_PROFILE_LOOKUP_ENABLED,
    true
  ),
  SEATALK_PROFILE_LOOKUP_COOLDOWN_MS: parsePositiveInt(
    process.env.SEATALK_PROFILE_LOOKUP_COOLDOWN_MS,
    DEFAULT_PROFILE_LOOKUP_COOLDOWN_MS
  ),
  SEATALK_PROFILE_CACHE_MINUTES: parsePositiveInt(
    process.env.SEATALK_PROFILE_CACHE_MINUTES,
    DEFAULT_PROFILE_CACHE_MINUTES
  ),
  SEATALK_HTTP_TIMEOUT_MS: parsePositiveInt(
    process.env.SEATALK_HTTP_TIMEOUT_MS,
    DEFAULT_HTTP_TIMEOUT_MS
  ),
  MCP_ENDPOINT: process.env.MCP_ENDPOINT || "",
  MCP_TRANSPORT: String(process.env.MCP_TRANSPORT || "auto").toLowerCase(),
  MCP_SERVER_NAME: process.env.MCP_SERVER_NAME || "seatalk-mcp-server",
  MCP_TIMEOUT_MS: parsePositiveInt(
    process.env.MCP_TIMEOUT_MS,
    DEFAULT_MCP_TIMEOUT_MS
  ),
  MCP_RETRY_MAX: parsePositiveInt(
    process.env.MCP_RETRY_MAX,
    DEFAULT_MCP_RETRY_MAX
  ),
  MCP_RETRY_BASE_MS: parsePositiveInt(
    process.env.MCP_RETRY_BASE_MS,
    DEFAULT_MCP_RETRY_BASE_MS
  ),
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || "",
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || "",
  OPENROUTER_API_BASE_URL: process.env.OPENROUTER_API_BASE_URL || "",
  OPENROUTER_APP_URL: process.env.OPENROUTER_APP_URL || "",
  OPENROUTER_APP_TITLE: process.env.OPENROUTER_APP_TITLE || "",
  OPENROUTER_HTTP_TIMEOUT_MS: parsePositiveInt(
    process.env.OPENROUTER_HTTP_TIMEOUT_MS,
    DEFAULT_HTTP_TIMEOUT_MS
  ),
  BOT_NAME: process.env.BOT_NAME || "SeaTalk Bot",
  GREETING_OVERRIDES_JSON: process.env.GREETING_OVERRIDES_JSON || "",
  GREETING_OVERRIDES_FILE: process.env.GREETING_OVERRIDES_FILE || "",
  DRIVE_FOLDER_ID: process.env.DRIVE_FOLDER_ID || "",
  GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID || "",
  GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL || "",
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : "",
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
  GOOGLE_OAUTH_REDIRECT_URL: process.env.GOOGLE_OAUTH_REDIRECT_URL || "",
  GOOGLE_OAUTH_TOKEN_BASE64: process.env.GOOGLE_OAUTH_TOKEN_BASE64 || "",
  GOOGLE_OAUTH_TOKEN_JSON: process.env.GOOGLE_OAUTH_TOKEN_JSON || "",
  GOOGLE_OAUTH_TOKEN_FILE:
    process.env.GOOGLE_OAUTH_TOKEN_FILE || DEFAULT_GOOGLE_OAUTH_TOKEN_FILE,
  GOOGLE_SERVICE_ACCOUNT_FILE: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || "",
  GOOGLE_SHEETS_SCOPES: (process.env.GOOGLE_SHEETS_SCOPES ||
    "https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/drive.readonly")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean),
  SHEETS_FILE: process.env.SHEETS_FILE || DEFAULT_SHEETS_FILE,
  INDEX_STORE_PATH: process.env.INDEX_STORE_PATH || DEFAULT_INDEX_STORE_PATH,
  SHEETS_DEFAULT_RANGE: process.env.SHEETS_DEFAULT_RANGE || "",
  SHEETS_SCAN_ALL_TABS: parseBoolean(process.env.SHEETS_SCAN_ALL_TABS, false),
  SHEETS_MAX_TABS: parsePositiveInt(
    process.env.SHEETS_MAX_TABS,
    DEFAULT_SHEETS_MAX_TABS
  ),
  SHEETS_REFRESH_MINUTES: parsePositiveInt(
    process.env.SHEETS_REFRESH_MINUTES,
    DEFAULT_SHEETS_REFRESH_MINUTES
  ),
  SHEETS_MAX_MATCH_LINES: parsePositiveInt(
    process.env.SHEETS_MAX_MATCH_LINES,
    DEFAULT_SHEETS_MAX_MATCH_LINES
  ),
  SHEETS_MAX_CONTEXT_CHARS: parsePositiveInt(
    process.env.SHEETS_MAX_CONTEXT_CHARS,
    DEFAULT_SHEETS_MAX_CONTEXT_CHARS
  ),
  MAX_ROWS_TO_SCAN: parseNonNegativeInt(
    process.env.MAX_ROWS_TO_SCAN,
    DEFAULT_MAX_ROWS_TO_SCAN
  ),
  MAX_COLS_TO_SCAN: parseNonNegativeInt(
    process.env.MAX_COLS_TO_SCAN,
    DEFAULT_MAX_COLS_TO_SCAN
  ),
  SEARCH_USE_LLM_SUMMARY: parseBoolean(
    process.env.SEARCH_USE_LLM_SUMMARY,
    false
  ),
  SEARCH_LLM_TIMEOUT_MS: parsePositiveInt(
    process.env.SEARCH_LLM_TIMEOUT_MS,
    DEFAULT_SEARCH_LLM_TIMEOUT_MS
  ),
  SEARCH_LLM_CACHE_TTL_MS: parsePositiveInt(
    process.env.SEARCH_LLM_CACHE_TTL_MS,
    DEFAULT_SEARCH_LLM_CACHE_TTL_MS
  ),
  SCHEDULED_INTERVAL_MINUTES: parsePositiveInt(
    process.env.SCHEDULED_INTERVAL_MINUTES,
    DEFAULT_SCHEDULED_INTERVAL_MINUTES
  ),
  BACKLOGS_DATA_SHEET_ID:
    process.env.BACKLOGS_DATA_SHEET_ID || DEFAULT_BACKLOGS_DATA_SHEET_ID,
  BACKLOGS_DATA_TAB_NAME:
    process.env.BACKLOGS_DATA_TAB_NAME || DEFAULT_BACKLOGS_DATA_TAB_NAME,
  TRUCK_REQUEST_TAB_NAME:
    process.env.TRUCK_REQUEST_TAB_NAME || DEFAULT_TRUCK_REQUEST_TAB_NAME,
  TRUCK_ALERT_SHEET_ID:
    process.env.TRUCK_ALERT_SHEET_ID || DEFAULT_BACKLOGS_DATA_SHEET_ID,
  TRUCK_ALERT_TAB_NAME:
    process.env.TRUCK_ALERT_TAB_NAME || DEFAULT_TRUCK_REQUEST_TAB_NAME,
  TRUCK_ALERT_START_ROW: parsePositiveInt(
    process.env.TRUCK_ALERT_START_ROW,
    DEFAULT_TRUCK_ALERT_START_ROW
  ),
  TRUCK_ALERT_GROUP_ID: process.env.TRUCK_ALERT_GROUP_ID || "",
  TRUCK_ALERT_STATE_PATH:
    process.env.TRUCK_ALERT_STATE_PATH || DEFAULT_TRUCK_ALERT_STATE_PATH
};

module.exports = env;
