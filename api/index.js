require("dotenv").config();

const { initSentry } = require("../server/sentry");
initSentry();

const { createServerApp } = require("../server/server");

const { app } = createServerApp({
  enableScheduler: false,
  enableSheetRefreshTimer: false,
  exitOnInvalidConfig: false
});

module.exports = app;
