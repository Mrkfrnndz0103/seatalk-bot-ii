const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const env = require("../config/env");
const { logger } = require("../utils/logger");

const SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 300;

let sheetsClient = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveTokenPath() {
  if (env.GOOGLE_OAUTH_TOKEN_FILE) {
    return path.resolve(env.GOOGLE_OAUTH_TOKEN_FILE);
  }
  return path.join(__dirname, "..", "google-token.json");
}

function loadOAuthToken(tokenPath) {
  if (!fs.existsSync(tokenPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(tokenPath, "utf8"));
  } catch (error) {
    logger.warn("google_oauth_token_parse_failed", { error: error.message });
    return null;
  }
}

function hasOAuthConfig() {
  return Boolean(
    env.GOOGLE_OAUTH_CLIENT_ID &&
      env.GOOGLE_OAUTH_CLIENT_SECRET &&
      env.GOOGLE_OAUTH_REDIRECT_URL
  );
}

function buildOAuthClient(token) {
  const client = new google.auth.OAuth2(
    env.GOOGLE_OAUTH_CLIENT_ID,
    env.GOOGLE_OAUTH_CLIENT_SECRET,
    env.GOOGLE_OAUTH_REDIRECT_URL
  );
  client.setCredentials(token);
  return client;
}

function buildSheetsClient() {
  if (sheetsClient) {
    return sheetsClient;
  }

  if (hasOAuthConfig()) {
    const token = loadOAuthToken(resolveTokenPath());
    if (token) {
      const oauthClient = buildOAuthClient(token);
      sheetsClient = google.sheets({ version: "v4", auth: oauthClient });
      return sheetsClient;
    }
  }

  if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new Error(
      "Missing OAuth token or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY for Sheets client."
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: env.GOOGLE_CLIENT_EMAIL,
      private_key: env.GOOGLE_PRIVATE_KEY,
      project_id: env.GOOGLE_PROJECT_ID || undefined
    },
    scopes: SHEETS_SCOPES
  });

  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

async function withRetry(task) {
  let attempt = 0;
  while (true) {
    try {
      return await task();
    } catch (error) {
      const status = error?.response?.status;
      if (!RETRYABLE_STATUS.has(status) || attempt >= MAX_RETRIES) {
        throw error;
      }

      const delay = BASE_DELAY_MS * 2 ** attempt;
      const jitter = Math.floor(Math.random() * 100);
      await sleep(delay + jitter);
      attempt += 1;
    }
  }
}

async function getTabsAndGrid(spreadsheetId) {
  if (typeof spreadsheetId !== "string" || !spreadsheetId.trim()) {
    throw new Error("spreadsheetId must be a non-empty string.");
  }

  const sheetsApi = buildSheetsClient();
  const response = await withRetry(() =>
    sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(title,gridProperties(rowCount,columnCount)))"
    })
  );

  const sheets = response.data?.sheets || [];
  return sheets.map((sheet) => ({
    title: sheet.properties?.title || "",
    rowCount: sheet.properties?.gridProperties?.rowCount ?? 0,
    colCount: sheet.properties?.gridProperties?.columnCount ?? 0
  }));
}

async function readValues(spreadsheetId, rangeA1) {
  if (typeof spreadsheetId !== "string" || !spreadsheetId.trim()) {
    throw new Error("spreadsheetId must be a non-empty string.");
  }

  if (typeof rangeA1 !== "string" || !rangeA1.trim()) {
    throw new Error("rangeA1 must be a non-empty string.");
  }

  const sheetsApi = buildSheetsClient();
  const response = await withRetry(() =>
    sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: rangeA1
    })
  );

  return response.data?.values || [];
}

module.exports = {
  getTabsAndGrid,
  readValues
};
