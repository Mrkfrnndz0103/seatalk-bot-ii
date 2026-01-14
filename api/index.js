require("dotenv").config();

const { createServerApp } = require("../server/server");

const { app } = createServerApp({
  enableScheduler: false,
  enableSheetRefreshTimer: false,
  exitOnInvalidConfig: false
});

module.exports = app;
