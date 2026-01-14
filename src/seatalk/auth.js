const axios = require("axios");

function createSeatalkAuth(options = {}) {
  const {
    tokenUrl,
    appId,
    appSecret,
    staticToken,
    httpTimeoutMs,
    logger
  } = options;

  const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
  const TOKEN_FALLBACK_TTL_MS = 2 * 60 * 60 * 1000;
  let cachedAccessToken = null;
  let accessTokenExpiresAtMs = 0;
  let refreshPromise = null;

  function hasTokenCredentials() {
    return Boolean(tokenUrl && appId && appSecret);
  }

  async function requestAccessToken() {
    const response = await axios.post(
      tokenUrl,
      {
        app_id: appId,
        app_secret: appSecret
      },
      { timeout: httpTimeoutMs }
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
      if (!staticToken) {
        throw new Error(
          "Missing BOT_ACCESS_TOKEN or Seatalk app credentials for refresh."
        );
      }
      return staticToken;
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
      timeout: httpTimeoutMs,
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
      if (logger && logger.warn) {
        logger.warn("seatalk_request_failed", {
          error: error.response?.data || error.message
        });
      }
      throw error;
    }
  }

  async function postWithAuth(url, payload) {
    return requestWithAuth("post", url, payload);
  }

  return {
    getAccessToken,
    requestWithAuth,
    postWithAuth
  };
}

module.exports = {
  createSeatalkAuth
};
