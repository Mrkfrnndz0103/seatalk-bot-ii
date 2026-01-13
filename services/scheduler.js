const env = require("../config/env");
const { BotEventType } = require("../events/event.types");

function startScheduler(trackEvent) {
  const intervalMinutes = env.SCHEDULED_INTERVAL_MINUTES;
  if (!intervalMinutes || intervalMinutes <= 0) {
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(() => {
    if (trackEvent) {
      trackEvent(BotEventType.SCHEDULED, { intervalMinutes });
    }
  }, intervalMs).unref();
}

module.exports = {
  startScheduler
};
