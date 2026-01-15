const path = require("path");
const express = require("express");
const { setupExpressErrorHandler } = require("./sentry");
const { rawBodySaver } = require("../src/http/middleware/rawBody");
const {
  createRequestContextMiddleware
} = require("../src/http/middleware/requestContext");
const { createRateLimitMiddleware } = require("../src/http/middleware/rateLimit");
const { getClientIp } = require("../src/http/request.utils");
const { createGoogleOAuthRouter } = require("../routes/google.oauth");
const { createHealthRouter } = require("../routes/health");
const { createSeatalkEventsRouter } = require("../routes/seatalk.events");
const { createSeatalkNotifyRouter } = require("../routes/seatalk.notify");
const { createSeatalkCallbackRouter } = require("../routes/seatalk.callback");

function createApp(options = {}) {
  const {
    logger,
    requestBodyLimit,
    rateLimitMax,
    rateLimitWindowMs,
    googleOAuth,
    health,
    seatalkEvents,
    seatalkNotify,
    seatalkCallback
  } = options;

  const app = express();
  const publicDir = path.join(__dirname, "..", "public");

  app.use(
    express.json({
      verify: rawBodySaver,
      limit: requestBodyLimit
    })
  );
  app.use(express.static(publicDir, { fallthrough: true }));
  app.use(
    createRequestContextMiddleware({
      logger,
      getClientIp
    })
  );
  app.use(
    createRateLimitMiddleware({
      max: rateLimitMax,
      windowMs: rateLimitWindowMs,
      logger,
      getIp: getClientIp
    })
  );

  app.use(createGoogleOAuthRouter(googleOAuth));
  app.use(createHealthRouter(health));
  app.use(createSeatalkEventsRouter(seatalkEvents));
  app.use(createSeatalkNotifyRouter(seatalkNotify));
  app.use(createSeatalkCallbackRouter(seatalkCallback));
  app.get(["/favicon.ico", "/favicon.png"], (req, res) => {
    const faviconPath = path.join(publicDir, "favicon.png");
    res.type("png");
    res.sendFile(faviconPath, (err) => {
      if (err) {
        res.status(err.statusCode || 500).end();
      }
    });
  });
  app.get("/", (req, res) => {
    res.status(200).send("Seatalk bot service is running.");
  });
  setupExpressErrorHandler(app);

  return app;
}

module.exports = {
  createApp
};
