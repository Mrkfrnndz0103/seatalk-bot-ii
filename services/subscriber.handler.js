function createSubscriberHandler(deps = {}) {
  return async function handleSubscriberMessage(event, ctx = {}) {
    const requestId = ctx.requestId || "unknown";
    const log = ctx.logger || deps.logger;
    const startedAt = Date.now();
    const track = typeof ctx.trackEvent === "function" ? ctx.trackEvent : null;

    try {
      const employeeCode = event.employee_code;
      const rawText = deps.getEventMessageText(event).trim();
      const msgText = deps.stripBotMention(rawText);
      const replyWithText = async (text, options = {}) => {
        if (!text) {
          return;
        }
        const lead = options.addLead ? deps.getPositiveLead() : "";
        const content = lead ? `${lead}\n\n${text}` : text;
        await deps.sendSubscriberMessage(employeeCode, content);
      };

      if (!employeeCode) {
        log.warn("subscriber_missing_employee_code", { requestId });
        if (track) {
          track(deps.BotEventType.ERROR, { reason: "missing_employee_code" });
        }
        return;
      }

      deps.sendSubscriberTyping(employeeCode).catch((error) => {
        log.warn("subscriber_typing_failed", {
          requestId,
          error: error.message
        });
      });

      if (!msgText) {
        await replyWithText("I can only read text messages right now.");
        return;
      }

      if (deps.isGreetingOnly(msgText)) {
        const greeting = await deps.buildGreeting(event);
        await deps.sendSubscriberMessage(employeeCode, greeting);
        return;
      }

      const parsedCommand =
        typeof deps.parseCommand === "function"
          ? deps.parseCommand(msgText)
          : null;
      const isHelp = !parsedCommand && deps.isHelpRequest(msgText);
      if (parsedCommand) {
        log.info("command_received", {
          requestId,
          command: parsedCommand.cmd
        });
        if (track) {
          track(deps.BotEventType.COMMAND, { command: parsedCommand.cmd });
          if (parsedCommand.cmd === "help") {
            track(deps.BotEventType.HELP_REQUEST, { command: parsedCommand.cmd });
          } else if (!deps.knownCommands.has(parsedCommand.cmd)) {
            track(deps.BotEventType.INVALID_COMMAND, {
              command: parsedCommand.cmd
            });
          }
        }
      } else if (isHelp && track) {
        track(deps.BotEventType.HELP_REQUEST, { source: "keyword" });
      }

      if (isHelp) {
        const helpReply = await deps.handleCommand("/help", {
          store: deps.indexStore,
          logger: log,
          requestId
        });
        if (helpReply && helpReply.text) {
          await replyWithText(helpReply.text);
          return;
        }
      }

      if (deps.isAgeQuestion(msgText)) {
        await replyWithText(
          "I don't have a real age. I'm a bot here to help you with questions."
        );
        return;
      }

      if (deps.isConversational(msgText)) {
        const convoReply = await deps.generateIntelligentReply(msgText, {
          skipSheetContext: true,
          conversation: true,
          useTools: false,
          logger: log,
          requestId
        });
        await replyWithText(convoReply || "I'm here if you need anything.");
        return;
      }

      const commandReply = await deps.handleCommand(msgText, {
        store: deps.indexStore,
        logger: log,
        requestId
      });
      if (commandReply && commandReply.text) {
        await replyWithText(commandReply.text);
        return;
      }

      const intentType = deps.detectIntent(msgText);
      if (intentType && track) {
        track(deps.BotEventType.KEYWORD_TRIGGER, { intent: intentType });
      }

      const intentReply = await deps.handleIntentMessage(msgText, {
        sheetCache: deps.sheetCache,
        refreshSheetCache: deps.refreshSheetCache,
        readSheetRange: deps.readSheetRange
      });
      if (intentReply && intentReply.text) {
        await replyWithText(intentReply.text, { addLead: true });
        return;
      }

      if (deps.shouldUseEmployeeLookup(msgText)) {
        const lookupReply = await deps.generateIntelligentReply(msgText, {
          skipSheetContext: true,
          conversation: false
        });
        await replyWithText(lookupReply || "I couldn't find that employee.");
        return;
      }

      const loadedIndex = Array.isArray(deps.indexStore.items)
        ? deps.indexStore.items
        : [];
      if (!loadedIndex.length) {
        await replyWithText("Index is empty. Run /reindex to build it.");
        return;
      }

      const searchReply = await deps.handleCommand(`/search ${msgText}`, {
        store: deps.indexStore,
        topK: 3,
        fallbackIfEmpty: true,
        logger: log,
        requestId
      });
      if (searchReply && searchReply.text) {
        await replyWithText(searchReply.text, { addLead: true });
        return;
      }

      if (track) {
        track(deps.BotEventType.FALLBACK, { reason: "no_intent_no_search" });
      }

      const fallbackReply = await deps.generateIntelligentReply(msgText, {
        skipSheetContext: false,
        logger: log,
        requestId
      });
      await replyWithText(fallbackReply || "Thanks for your message.");
    } catch (error) {
      log.error("subscriber_message_error", {
        requestId,
        error: error.message
      });
      if (track) {
        track(deps.BotEventType.ERROR, { error: error.message });
      }
      if (event?.employee_code) {
        await deps.sendSubscriberMessage(
          event.employee_code,
          "Sorry, I ran into an error while processing your request."
        );
      }
    } finally {
      log.info("subscriber_message_handled", {
        requestId,
        durationMs: Date.now() - startedAt
      });
    }
  };
}

module.exports = {
  createSubscriberHandler
};
