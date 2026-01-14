const crypto = require("crypto");
const { getClientIp } = require("../request.utils");
const { logger: defaultLogger } = require("../../../utils/logger");

function createRequestId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
}

function createRequestContextMiddleware(options = {}) {
  const log = options.logger || defaultLogger;
  const clientIp = options.getClientIp || getClientIp;

  return function requestContext(req, res, next) {
    const requestId =
      req.headers["x-request-id"] || req.requestId || createRequestId();
    req.requestId = requestId;
    res.setHeader("x-request-id", requestId);

    const startedAt = Date.now();
    res.on("finish", () => {
      log.info(
        {
          requestId,
          method: req.method,
          path: req.originalUrl || req.url,
          statusCode: res.statusCode,
          latencyMs: Date.now() - startedAt,
          clientIp: clientIp(req),
          userAgent: req.headers["user-agent"] || ""
        },
        "request_complete"
      );
    });

    next();
  };
}

module.exports = {
  createRequestContextMiddleware,
  createRequestId
};
