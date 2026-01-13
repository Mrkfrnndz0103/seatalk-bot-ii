const env = require("../config/env");
const { BotEventType } = require("../events/event.types");

function startScheduler(trackEvent, onTick) {
  const intervalMinutes = env.SCHEDULED_INTERVAL_MINUTES;
  if (!intervalMinutes || intervalMinutes <= 0) {
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(() => {
    if (trackEvent) {
      trackEvent(BotEventType.SCHEDULED, { intervalMinutes });
    }
    if (typeof onTick === "function") {
      Promise.resolve(onTick()).catch((error) => {
        console.warn("Scheduled task failed:", error.message || error);
      });
    }
  }, intervalMs).unref();
}

module.exports = {
  startScheduler
};
