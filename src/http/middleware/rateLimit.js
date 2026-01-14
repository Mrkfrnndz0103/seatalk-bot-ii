const { logger: defaultLogger } = require("../../../utils/logger");
const { getClientIp } = require("../request.utils");

function createRateLimitMiddleware(options = {}) {
  const {
    max = 0,
    windowMs = 0,
    logger = defaultLogger,
    getIp = getClientIp
  } = options;
  const rateLimitState = new Map();

  if (max > 0 && windowMs > 0) {
    const cleanupIntervalMs = Math.max(windowMs || 0, 60 * 1000);
    setInterval(() => {
      const now = Date.now();
      for (const [ip, entry] of rateLimitState.entries()) {
        if (!entry || now > entry.resetAt) {
          rateLimitState.delete(ip);
        }
      }
    }, cleanupIntervalMs).unref();
  }

  return function rateLimit(req, res, next) {
    if (!max || max <= 0 || !windowMs || windowMs <= 0) {
      return next();
    }

    const ip = getIp(req);
    const now = Date.now();
    const entry = rateLimitState.get(ip);
    if (!entry || now > entry.resetAt) {
      rateLimitState.set(ip, {
        count: 1,
        resetAt: now + windowMs
      });
      return next();
    }

    if (entry.count >= max) {
      if (logger && logger.warn) {
        logger.warn("rate_limit_exceeded", { ip });
      }
      return res.status(429).send("Too Many Requests");
    }

    entry.count += 1;
    return next();
  };
}

module.exports = {
  createRateLimitMiddleware
};
