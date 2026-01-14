const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_TTL_MS = 6 * 24 * 60 * 60 * 1000;
const DEFAULT_RENEW_WINDOW_MS = 12 * 60 * 60 * 1000;

function generateChannelId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
}

function parseExpiration(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
}

function ensureStateDir(statePath) {
  if (!statePath) {
    return;
  }
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadState(statePath, logger) {
  if (!statePath || !fs.existsSync(statePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    logger?.warn?.("drive_watch_state_read_failed", {
      error: error.message
    });
    return {};
  }
}

function saveState(statePath, state, logger) {
  if (!statePath) {
    return;
  }
  try {
    ensureStateDir(statePath);
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (error) {
    logger?.warn?.("drive_watch_state_write_failed", {
      error: error.message
    });
  }
}

function shouldRenewChannel(state, options = {}) {
  if (options.force) {
    return true;
  }
  if (!state?.channelId || !state?.resourceId) {
    return true;
  }
  if (!state.expirationMs) {
    return true;
  }
  if (options.fileId && state.fileId !== options.fileId) {
    return true;
  }
  if (options.address && state.address !== options.address) {
    return true;
  }
  if (options.token && state.token !== options.token) {
    return true;
  }

  const renewWindowMs =
    Number.isFinite(options.renewWindowMs) && options.renewWindowMs > 0
      ? options.renewWindowMs
      : DEFAULT_RENEW_WINDOW_MS;
  return Date.now() + renewWindowMs >= state.expirationMs;
}

async function stopChannel(driveApi, state, logger) {
  if (!driveApi || !state?.channelId || !state?.resourceId) {
    return;
  }
  try {
    await driveApi.channels.stop({
      requestBody: {
        id: state.channelId,
        resourceId: state.resourceId
      }
    });
    logger?.info?.("drive_watch_channel_stopped", {
      channelId: state.channelId
    });
  } catch (error) {
    logger?.warn?.("drive_watch_channel_stop_failed", {
      channelId: state.channelId,
      error: error.response?.data || error.message
    });
  }
}

async function registerChannel(driveApi, options, logger) {
  const channelId = options.channelId || generateChannelId();
  const requestBody = {
    id: channelId,
    type: "web_hook",
    address: options.address
  };
  if (options.token) {
    requestBody.token = options.token;
  }
  const ttlMs =
    Number.isFinite(options.ttlMs) && options.ttlMs > 0
      ? options.ttlMs
      : DEFAULT_TTL_MS;
  requestBody.params = { ttl: String(ttlMs) };

  const response = await driveApi.files.watch({
    fileId: options.fileId,
    supportsAllDrives: true,
    requestBody
  });

  const payload = response?.data || {};
  const state = {
    channelId: payload.id || channelId,
    resourceId: payload.resourceId || "",
    expirationMs: parseExpiration(payload.expiration),
    fileId: options.fileId,
    address: options.address,
    token: options.token || ""
  };

  logger?.info?.("drive_watch_channel_registered", {
    channelId: state.channelId,
    expiresAtMs: state.expirationMs
  });

  return state;
}

function parseNotificationHeaders(headers = {}) {
  return {
    channelId: headers["x-goog-channel-id"] || "",
    resourceId: headers["x-goog-resource-id"] || "",
    resourceState: headers["x-goog-resource-state"] || "",
    messageNumber: headers["x-goog-message-number"] || "",
    channelToken: headers["x-goog-channel-token"] || ""
  };
}

function validateNotification(headers, expectedToken, state) {
  const info = parseNotificationHeaders(headers);
  if (expectedToken && info.channelToken !== expectedToken) {
    return { ok: false, reason: "token_mismatch", info };
  }
  if (state?.channelId && info.channelId && state.channelId !== info.channelId) {
    return { ok: false, reason: "channel_mismatch", info };
  }
  if (info.resourceState !== "update") {
    return { ok: false, reason: "ignored_state", info };
  }
  return { ok: true, info };
}

function createDriveWatch(options = {}) {
  const {
    getDriveApi,
    fileId,
    address,
    token,
    statePath,
    ttlMs,
    renewWindowMs,
    logger
  } = options;

  const resolvedStatePath = statePath ? path.resolve(statePath) : "";

  async function ensureWatch(config = {}) {
    if (!fileId || !address) {
      logger?.warn?.("drive_watch_missing_config", {
        fileId: Boolean(fileId),
        address: Boolean(address)
      });
      return null;
    }

    const driveApi = await getDriveApi();
    if (!driveApi) {
      logger?.warn?.("drive_watch_drive_api_unavailable");
      return null;
    }

    const currentState = loadState(resolvedStatePath, logger);
    if (!shouldRenewChannel(currentState, { ...config, fileId, address, token, renewWindowMs })) {
      return currentState;
    }

    if (currentState?.channelId && currentState?.resourceId) {
      await stopChannel(driveApi, currentState, logger);
    }

    const nextState = await registerChannel(
      driveApi,
      { fileId, address, token, ttlMs },
      logger
    );
    saveState(resolvedStatePath, {
      ...nextState,
      updatedAt: new Date().toISOString()
    }, logger);

    return nextState;
  }

  function getState() {
    return loadState(resolvedStatePath, logger);
  }

  function checkNotification(headers) {
    const state = getState();
    return validateNotification(headers, token, state);
  }

  return {
    ensureWatch,
    getState,
    checkNotification
  };
}

module.exports = {
  createDriveWatch
};
