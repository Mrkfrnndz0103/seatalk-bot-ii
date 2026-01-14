const express = require("express");
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

  app.use(
    express.json({
      verify: rawBodySaver,
      limit: requestBodyLimit
    })
  );
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

  return app;
}

module.exports = {
  createApp
};
