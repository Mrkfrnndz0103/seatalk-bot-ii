const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const env = require("../config/env");
const { logger } = require("../utils/logger");

const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.metadata.readonly"];
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 300;

let driveClient = null;

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

function buildDriveClient() {
  if (driveClient) {
    return driveClient;
  }

  if (hasOAuthConfig()) {
    const token = loadOAuthToken(resolveTokenPath());
    if (token) {
      const oauthClient = buildOAuthClient(token);
      driveClient = google.drive({ version: "v3", auth: oauthClient });
      return driveClient;
    }
  }

  if (!env.GOOGLE_CLIENT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    throw new Error(
      "Missing OAuth token or GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY for Drive client."
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: env.GOOGLE_CLIENT_EMAIL,
      private_key: env.GOOGLE_PRIVATE_KEY,
      project_id: env.GOOGLE_PROJECT_ID || undefined
    },
    scopes: DRIVE_SCOPES
  });

  driveClient = google.drive({ version: "v3", auth });
  return driveClient;
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

function buildDriveQuery(folderId) {
  const baseQuery =
    "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
  if (folderId) {
    return `'${folderId}' in parents and ${baseQuery}`;
  }
  return baseQuery;
}

async function listSpreadsheetsInFolder(folderId) {
  if (folderId !== undefined && folderId !== null && typeof folderId !== "string") {
    throw new Error("folderId must be a string when provided.");
  }

  const normalizedFolderId = typeof folderId === "string" ? folderId.trim() : "";
  const drive = buildDriveClient();
  const results = [];
  let pageToken = undefined;

  do {
    const response = await withRetry(() =>
      drive.files.list(
        {
          q: buildDriveQuery(normalizedFolderId),
          fields: "nextPageToken, files(id, name, modifiedTime)",
          pageSize: 1000,
          pageToken,
          includeItemsFromAllDrives: true,
          supportsAllDrives: true,
          ...(normalizedFolderId ? {} : { corpora: "allDrives" })
        }
      )
    );

    const files = response.data?.files || [];
    for (const file of files) {
      results.push({
        id: file.id,
        name: file.name,
        modifiedTime: file.modifiedTime
      });
    }

    pageToken = response.data?.nextPageToken || undefined;
  } while (pageToken);

  return results;
}

module.exports = {
  listSpreadsheetsInFolder
};
