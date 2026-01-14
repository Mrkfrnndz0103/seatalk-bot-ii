const Sentry = require("@sentry/node");

let didInit = false;
let enabled = false;

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

function parseSampleRate(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed <= 0) {
    return 0;
  }
  if (parsed >= 1) {
    return 1;
  }
  return parsed;
}

function initSentry() {
  if (didInit) {
    return { Sentry, enabled };
  }

  didInit = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    enabled = false;
    return { Sentry, enabled };
  }

  const tracesSampleRate = parseSampleRate(
    process.env.SENTRY_TRACES_SAMPLE_RATE,
    0
  );
  const integrations = tracesSampleRate
    ? [Sentry.expressIntegration()]
    : undefined;

  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ||
      process.env.VERCEL_ENV ||
      process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate,
    sendDefaultPii: parseBoolean(process.env.SENTRY_SEND_DEFAULT_PII, false),
    enableLogs: parseBoolean(process.env.SENTRY_ENABLE_LOGS, false),
    integrations
  });

  enabled = true;
  return { Sentry, enabled };
}

function setupExpressErrorHandler(app) {
  const status = initSentry();
  if (!status.enabled) {
    return;
  }

  Sentry.setupExpressErrorHandler(app);
}

function captureException(error, context) {
  const status = initSentry();
  if (!status.enabled) {
    return;
  }

  Sentry.captureException(error, context);
}

async function flush(timeoutMs = 2000) {
  const status = initSentry();
  if (!status.enabled) {
    return;
  }

  await Sentry.flush(timeoutMs);
}

module.exports = {
  initSentry,
  setupExpressErrorHandler,
  captureException,
  flush
};
