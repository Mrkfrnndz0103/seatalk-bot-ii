const axios = require("axios");
const {
  shouldPrefetchChatHistory,
  shouldUseEmployeeLookup
} = require("./llm.tool.policy");

const DEFAULT_MAX_TOOL_ROUNDS = 2;

function buildToolMessage(toolCallId, content) {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: typeof content === "string" ? content : JSON.stringify(content)
  };
}

function extractToolCalls(message) {
  if (!message) {
    return [];
  }
  if (Array.isArray(message.tool_calls)) {
    return message.tool_calls;
  }
  if (message.function_call) {
    return [
      {
        id: "legacy",
        type: "function",
        function: message.function_call
      }
    ];
  }
  return [];
}

function parseToolArguments(args) {
  if (!args) {
    return {};
  }
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch (error) {
      return {};
    }
  }
  return args;
}

function buildSystemPrompt(options) {
  const botName = options.botName || "SeaTalk Bot";
  if (options.conversation) {
    return `You are ${botName}, a friendly SeaTalk bot. Respond naturally and concisely (1-3 sentences).`;
  }

  return (
    `You are ${botName}, a helpful SeaTalk bot. Respond intelligently, short, and concise (1-3 sentences). Do not include greetings. ` +
    "If the request is about backlogs, top contributors by region, or truck requests, answer using the provided sheet context. " +
    "If it is unclear or does not match, ask one brief clarifying question and give one example query."
  );
}

function sanitizeToolArgs(args) {
  const copy = { ...(args || {}) };
  if (copy.message) {
    copy.message = "[redacted]";
  }
  if (copy.text) {
    copy.text = "[redacted]";
  }
  return copy;
}

function isToolUseNotSupportedError(error) {
  const message =
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    "";
  return String(message)
    .toLowerCase()
    .includes("support tool use");
}

async function runChatCompletion(config, payload) {
  const response = await axios.post(
    `${config.baseUrl}/chat/completions`,
    payload,
    {
      timeout: config.timeoutMs,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "HTTP-Referer": config.appUrl || undefined,
        "X-Title": config.appTitle || undefined,
        "Content-Type": "application/json"
      }
    }
  );
  return response.data;
}

function createLlmAgent(options) {
  const config = {
    apiKey: options.apiKey,
    model: options.model,
    baseUrl: options.baseUrl,
    appUrl: options.appUrl,
    appTitle: options.appTitle,
    timeoutMs: options.timeoutMs || 8000,
    botName: options.botName || "SeaTalk Bot"
  };
  const toolDefinitions = options.toolDefinitions || [];
  const toolHandlers = options.toolHandlers || {};
  const logger = options.logger || null;

  async function generateReply(message, replyOptions = {}) {
    if (!config.apiKey || !config.model) {
      return "Thanks for your message.";
    }

    try {
      const systemPrompt = buildSystemPrompt({
        botName: config.botName,
        conversation: replyOptions.conversation
      });

      const messages = [{ role: "system", content: systemPrompt }];
      const allowTools =
        replyOptions.useTools !== false && toolDefinitions.length > 0;
      if (allowTools) {
        const toolNote = shouldUseEmployeeLookup(message)
          ? "Use employee lookup tools if needed. Use send_message tools only when the user explicitly asks to send a message."
          : "Use SeaTalk tools if needed. Use send_message tools only when the user explicitly asks to send a message.";
        messages.push({
          role: "system",
          content: toolNote
        });
      }

      if (replyOptions.extraSystemContext) {
        messages.push({
          role: "system",
          content: replyOptions.extraSystemContext
        });
      }

      if (replyOptions.sheetContext) {
        messages.push({
          role: "system",
          content: `Context from team sheets (partial, may be outdated):\n${replyOptions.sheetContext}`
        });
      }

      if (
        replyOptions.prefetchChatHistory &&
        replyOptions.groupId &&
        toolHandlers.get_chat_history &&
        shouldPrefetchChatHistory(message)
      ) {
        try {
          const history = await toolHandlers.get_chat_history({
            group_id: replyOptions.groupId,
            page_size: 5
          });
          if (history && history.messages) {
            messages.push({
              role: "system",
              content: `Recent chat history (last 5):\n${JSON.stringify(history.messages)}`
            });
          }
        } catch (error) {
          if (logger && logger.warn) {
            logger.warn("mcp_prefetch_failed", { reason: error.message });
          }
        }
      }

      messages.push({ role: "user", content: message });

      let rounds = 0;
      let response;
      let useTools = allowTools;
      try {
        response = await runChatCompletion(config, {
          model: config.model,
          messages,
          tools: useTools ? toolDefinitions : undefined,
          tool_choice: useTools ? "auto" : undefined,
          temperature: 0.3,
          max_tokens: 220
        });
      } catch (error) {
        if (useTools && isToolUseNotSupportedError(error)) {
          useTools = false;
          response = await runChatCompletion(config, {
            model: config.model,
            messages,
            temperature: 0.3,
            max_tokens: 220
          });
        } else {
          throw error;
        }
      }

      while (rounds < DEFAULT_MAX_TOOL_ROUNDS) {
        const messageObj = response?.choices?.[0]?.message;
        const toolCalls = extractToolCalls(messageObj);
        if (!toolCalls.length) {
          return messageObj?.content?.trim() || "Thanks for your message.";
        }
        if (!useTools) {
          return messageObj?.content?.trim() || "Thanks for your message.";
        }

        for (const toolCall of toolCalls) {
          const fn = toolCall.function;
          const name = fn?.name;
          const args = parseToolArguments(fn?.arguments);
          if (!name || typeof toolHandlers[name] !== "function") {
            messages.push(
              buildToolMessage(
                toolCall.id || "unknown",
                { error: `Unknown tool: ${name}` }
              )
            );
            continue;
          }

          if (logger && logger.info) {
            logger.info("llm_tool_call", {
              tool: name,
              args: sanitizeToolArgs(args)
            });
          }

          try {
            const result = await toolHandlers[name](args);
            messages.push(buildToolMessage(toolCall.id || "tool", result));
          } catch (error) {
            const message =
              error.userMessage || error.message || "Tool call failed";
            messages.push(
              buildToolMessage(toolCall.id || "tool", {
                error: message
              })
            );
          }
        }

        rounds += 1;
        response = await runChatCompletion(config, {
          model: config.model,
          messages,
          temperature: 0.3,
          max_tokens: 220
        });
      }

      return (
        response?.choices?.[0]?.message?.content?.trim() ||
        "Thanks for your message."
      );
    } catch (error) {
      if (logger && logger.warn) {
        logger.warn("llm_reply_failed", {
          error: error.response?.data || error.message
        });
      }
      return "Thanks for your message.";
    }
  }

  return {
    generateReply
  };
}

module.exports = {
  createLlmAgent
};
