const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { logger: defaultLogger } = require("../../utils/logger");

function createGoogleAuth(options = {}) {
  const {
    oauthClientId,
    oauthClientSecret,
    oauthRedirectUrl,
    oauthTokenFile,
    serviceAccountFile,
    scopes = [],
    logger = defaultLogger
  } = options;

  const tokenFilePath = oauthTokenFile
    ? path.resolve(oauthTokenFile)
    : path.join(process.cwd(), "google-token.json");
  const serviceAccountPath = serviceAccountFile
    ? path.resolve(serviceAccountFile)
    : null;

  let sheetsApiClient = null;
  let driveApiClient = null;
  let sheetsApiInitPromise = null;
  let driveApiInitPromise = null;
  let oauthClient = null;
  let oauthInitPromise = null;
  let serviceAccountClient = null;
  let serviceAccountInitPromise = null;

  function hasOAuthConfig() {
    return Boolean(oauthClientId && oauthClientSecret && oauthRedirectUrl);
  }

  function loadOAuthToken() {
    if (!fs.existsSync(tokenFilePath)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(tokenFilePath, "utf8"));
    } catch (error) {
      logger.warn("google_oauth_token_parse_failed", { error: error.message });
      return null;
    }
  }

  function saveOAuthToken(token) {
    fs.writeFileSync(tokenFilePath, JSON.stringify(token, null, 2));
  }

  function buildOAuthClient() {
    return new google.auth.OAuth2(
      oauthClientId,
      oauthClientSecret,
      oauthRedirectUrl
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
    if (!serviceAccountPath) {
      return null;
    }

    if (!fs.existsSync(serviceAccountPath)) {
      logger.warn("google_service_account_missing", {
        path: serviceAccountPath
      });
      return null;
    }

    let credentials;
    try {
      credentials = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
    } catch (error) {
      logger.warn("google_service_account_parse_failed", {
        error: error.message
      });
      return null;
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes
    });
    return auth.getClient();
  }

  async function getSheetsApi() {
    if (sheetsApiClient) {
      return sheetsApiClient;
    }

    if (!sheetsApiInitPromise) {
      sheetsApiInitPromise = (async () => {
        const oauth = await initOAuthClient();
        if (oauth) {
          sheetsApiClient = google.sheets({ version: "v4", auth: oauth });
          return sheetsApiClient;
        }

        const serviceClient = await initServiceAccountClient();
        if (serviceClient) {
          sheetsApiClient = google.sheets({
            version: "v4",
            auth: serviceClient
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
        const oauth = await initOAuthClient();
        if (oauth) {
          driveApiClient = google.drive({ version: "v3", auth: oauth });
          return driveApiClient;
        }

        const serviceClient = await initServiceAccountClient();
        if (serviceClient) {
          driveApiClient = google.drive({
            version: "v3",
            auth: serviceClient
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

  function setOAuthTokens(tokens) {
    if (!tokens) {
      return null;
    }
    saveOAuthToken(tokens);
    if (!hasOAuthConfig()) {
      return null;
    }
    const client = buildOAuthClient();
    client.setCredentials(tokens);
    oauthClient = client;
    sheetsApiClient = google.sheets({ version: "v4", auth: client });
    driveApiClient = google.drive({ version: "v3", auth: client });
    return client;
  }

  return {
    hasOAuthConfig,
    buildOAuthClient,
    loadOAuthToken,
    saveOAuthToken,
    getSheetsApi,
    getDriveApi,
    getGoogleAccessTokenCandidates,
    setOAuthTokens
  };
}

module.exports = {
  createGoogleAuth
};
