const { BotEventType } = require("../events/event.types");
const { detectInteractiveType } = require("../events/event.mapper");

async function handleInteractiveEvent(event, deps = {}) {
  const eventType = detectInteractiveType(event);
  if (deps.trackEvent) {
    deps.trackEvent(eventType, { source: "interactive" });
  }

  if (eventType === BotEventType.BUTTON_CLICK) {
    return { text: "Button received." };
  }

  if (eventType === BotEventType.DROPDOWN_SELECTION) {
    return { text: "Selection received." };
  }

  if (eventType === BotEventType.MODAL_SUBMISSION) {
    return { text: "Form submitted." };
  }

  return null;
}

module.exports = {
  handleInteractiveEvent
};
