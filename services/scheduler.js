const env = require("../config/env");
const { BotEventType } = require("../events/event.types");
const { logger: defaultLogger } = require("../utils/logger");

function startScheduler(trackEvent, onTick, options = {}) {
  const intervalMinutes = env.SCHEDULED_INTERVAL_MINUTES;
  if (!intervalMinutes || intervalMinutes <= 0) {
    return;
  }

  const log = options.logger || defaultLogger;
  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(() => {
    if (trackEvent) {
      trackEvent(BotEventType.SCHEDULED, { intervalMinutes });
    }
    if (typeof onTick === "function") {
      Promise.resolve(onTick()).catch((error) => {
        log.warn("scheduled_task_failed", {
          error: error.message || error
        });
      });
    }
  }, intervalMs).unref();
}

module.exports = {
  startScheduler
};
