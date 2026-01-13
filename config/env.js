const DEFAULT_INDEX_STORE_PATH = "./data/chunks.jsonl";
const DEFAULT_SHEETS_FILE = "./sheets.txt";
const DEFAULT_MAX_ROWS_TO_SCAN = 2000;
const DEFAULT_MAX_COLS_TO_SCAN = 200;

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

const env = {
  DRIVE_FOLDER_ID: process.env.DRIVE_FOLDER_ID || "",
  GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID || "",
  GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL || "",
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : "",
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
  GOOGLE_OAUTH_REDIRECT_URL: process.env.GOOGLE_OAUTH_REDIRECT_URL || "",
  GOOGLE_OAUTH_TOKEN_FILE: process.env.GOOGLE_OAUTH_TOKEN_FILE || "",
  SHEETS_FILE: process.env.SHEETS_FILE || DEFAULT_SHEETS_FILE,
  INDEX_STORE_PATH: process.env.INDEX_STORE_PATH || DEFAULT_INDEX_STORE_PATH,
  MAX_ROWS_TO_SCAN: parseNonNegativeInt(
    process.env.MAX_ROWS_TO_SCAN,
    DEFAULT_MAX_ROWS_TO_SCAN
  ),
  MAX_COLS_TO_SCAN: parseNonNegativeInt(
    process.env.MAX_COLS_TO_SCAN,
    DEFAULT_MAX_COLS_TO_SCAN
  ),
  SEATALK_BOT_TOKEN: process.env.SEATALK_BOT_TOKEN || "",
  SEATALK_SIGNING_SECRET: process.env.SEATALK_SIGNING_SECRET || ""
};

module.exports = env;
