function buildGroupMessagePayload(content) {
  if (content && typeof content === "object" && content.tag) {
    return content;
  }
  if (content && typeof content === "object") {
    const nestedText =
      typeof content.text === "string"
        ? content.text
        : content.text?.content;
    if (nestedText) {
      return {
        tag: "text",
        text: {
          format: 1,
          content: String(nestedText)
        }
      };
    }
  }
  const text = String(content || "").trim();
  if (!text) {
    return null;
  }
  return {
    tag: "text",
    text: {
      format: 1,
      content: text
    }
  };
}

function createSeatalkMessaging(options = {}) {
  const {
    apiBaseUrl,
    mcpTools,
    postWithAuth,
    logger,
    groupTypingUrl,
    singleTypingUrl
  } = options;

  async function sendSubscriberMessage(employeeCode, content) {
    const messagePayload = {
      tag: "text",
      text: {
        format: 1,
        content: content
      }
    };

    if (mcpTools) {
      try {
        const response = await mcpTools.sendMessageToBotUser(
          employeeCode,
          messagePayload
        );
        if (response?.code === 0) {
          logger.info("subscriber_message_sent", {
            messageId: response.message_id
          });
          return;
        }
        if (response?.code) {
          logger.error("subscriber_message_failed", { response });
        }
      } catch (error) {
        logger.error("subscriber_message_error", {
          error: error.message || error
        });
      }
    }

    if (!apiBaseUrl) {
      throw new Error("Missing SEATALK_API_BASE_URL for subscriber messages.");
    }

    try {
      const response = await postWithAuth(
        `${apiBaseUrl}/messaging/v2/single_chat`,
        {
          employee_code: employeeCode,
          message: messagePayload,
          usable_platform: "all"
        }
      );

      if (response.data.code === 0) {
        logger.info("subscriber_message_sent", {
          messageId: response.data.message_id
        });
      } else {
        logger.error("subscriber_message_failed", { response: response.data });
      }
    } catch (error) {
      logger.error("subscriber_message_error", {
        error: error.response?.data || error.message
      });
    }
  }

  async function sendSubscriberTyping(employeeCode) {
    if (!singleTypingUrl || !employeeCode) {
      return;
    }

    await postWithAuth(singleTypingUrl, {
      employee_code: employeeCode
    });
  }

  async function sendGroupMessage(groupId, content) {
    const messagePayload = buildGroupMessagePayload(content);
    if (!messagePayload) {
      throw new Error("Missing group message content.");
    }

    if (mcpTools) {
      try {
        const response = await mcpTools.sendMessageToGroupChat(
          groupId,
          messagePayload
        );
        if (response?.code === 0) {
          logger.info("group_message_sent", { messageId: response.message_id });
          return true;
        }
        if (response?.code) {
          logger.error("group_message_failed", { response });
        }
      } catch (error) {
        logger.error("group_message_error", {
          error: error.message || error
        });
      }
    }

    if (!apiBaseUrl) {
      throw new Error("Missing SEATALK_API_BASE_URL for group messages.");
    }

    try {
      const response = await postWithAuth(
        `${apiBaseUrl}/messaging/v2/group_chat`,
        {
          group_id: groupId,
          message: messagePayload,
          usable_platform: "all"
        }
      );

      if (response.data.code === 0) {
        logger.info("group_message_sent", {
          messageId: response.data.message_id
        });
        return true;
      }
      logger.error("group_message_failed", { response: response.data });
    } catch (error) {
      logger.error("group_message_error", {
        error: error.response?.data || error.message
      });
    }
    return false;
  }

  async function sendGroupTyping(groupId, threadId) {
    if (!groupTypingUrl || !groupId) {
      return;
    }

    const payload = { group_id: groupId };
    if (threadId) {
      payload.thread_id = threadId;
    }

    await postWithAuth(groupTypingUrl, payload);
  }

  return {
    sendSubscriberMessage,
    sendSubscriberTyping,
    sendGroupMessage,
    sendGroupTyping
  };
}

module.exports = {
  createSeatalkMessaging
};
