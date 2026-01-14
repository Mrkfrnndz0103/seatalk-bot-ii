require("dotenv").config();

const { initSentry } = require("./server/sentry");
initSentry();

const { startServer } = require("./server/server");

startServer();
