const TOOL_DEFINITIONS = [
  {
    name: "get_employee_profile",
    description: "Get an employee profile by employee code.",
    parameters: {
      type: "object",
      properties: {
        employee_code: { type: "string" }
      },
      required: ["employee_code"]
    }
  },
  {
    name: "get_employee_code_with_email",
    description: "Get employee codes by email addresses.",
    parameters: {
      type: "object",
      properties: {
        emails: { type: "array", items: { type: "string" } }
      },
      required: ["emails"]
    }
  },
  {
    name: "check_employee_existence",
    description: "Check if a Seatalk user exists by Seatalk ID.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "get_user_language_preference",
    description: "Get a user's language preference by employee code.",
    parameters: {
      type: "object",
      properties: {
        employee_code: { type: "string" }
      },
      required: ["employee_code"]
    }
  },
  {
    name: "get_joined_group_chat_list",
    description: "Get group chats the bot has joined.",
    parameters: {
      type: "object",
      properties: {
        page_size: { type: "number" },
        cursor: { type: "string" }
      }
    }
  },
  {
    name: "get_group_info",
    description: "Get information about a group chat.",
    parameters: {
      type: "object",
      properties: {
        group_id: { type: "string" }
      },
      required: ["group_id"]
    }
  },
  {
    name: "get_thread_by_thread_id",
    description: "Get messages within a group thread.",
    parameters: {
      type: "object",
      properties: {
        group_id: { type: "string" },
        thread_id: { type: "string" },
        page_size: { type: "number" },
        cursor: { type: "string" }
      },
      required: ["group_id", "thread_id"]
    }
  },
  {
    name: "get_message_by_message_id",
    description: "Get a message by its message id.",
    parameters: {
      type: "object",
      properties: {
        message_id: { type: "string" }
      },
      required: ["message_id"]
    }
  },
  {
    name: "get_chat_history",
    description: "Get recent chat history in a group chat.",
    parameters: {
      type: "object",
      properties: {
        group_id: { type: "string" },
        page_size: { type: "number" },
        cursor: { type: "string" }
      },
      required: ["group_id"]
    }
  },
  {
    name: "send_message_to_group_chat",
    description: "Send a message to a group chat.",
    parameters: {
      type: "object",
      properties: {
        group_id: { type: "string" },
        message: { type: "object" }
      },
      required: ["group_id", "message"]
    }
  },
  {
    name: "send_message_to_bot_user",
    description: "Send a message to a bot user via employee code.",
    parameters: {
      type: "object",
      properties: {
        employee_code: { type: "string" },
        message: { type: "object" }
      },
      required: ["employee_code", "message"]
    }
  }
];

function getToolDefinitions() {
  return TOOL_DEFINITIONS.map((tool) => ({
    type: "function",
    function: tool
  }));
}

function createSeatalkMcpTools(client, logger) {
  const call = async (name, args) => {
    if (!client) {
      const error = new Error("MCP client not configured.");
      error.tool = name;
      throw error;
    }
    const response = await client.callTool(name, args);
    if (logger && typeof logger.info === "function") {
      logger.info("mcp_tool_call", {
        tool: name,
        ok: response?.code === 0
      });
    }
    return response;
  };

  return {
    definitions: getToolDefinitions(),
    tools: {
      get_employee_profile: (args) => call("get_employee_profile", args),
      get_employee_code_with_email: (args) =>
        call("get_employee_code_with_email", args),
      check_employee_existence: (args) =>
        call("check_employee_existence", args),
      get_user_language_preference: (args) =>
        call("get_user_language_preference", args),
      get_joined_group_chat_list: (args) =>
        call("get_joined_group_chat_list", args),
      get_group_info: (args) => call("get_group_info", args),
      get_thread_by_thread_id: (args) =>
        call("get_thread_by_thread_id", args),
      get_message_by_message_id: (args) =>
        call("get_message_by_message_id", args),
      get_chat_history: (args) => call("get_chat_history", args),
      send_message_to_group_chat: (args) =>
        call("send_message_to_group_chat", args),
      send_message_to_bot_user: (args) => call("send_message_to_bot_user", args)
    },
    sendMessageToGroupChat: (group_id, message) =>
      call("send_message_to_group_chat", { group_id, message }),
    sendMessageToBotUser: (employee_code, message) =>
      call("send_message_to_bot_user", { employee_code, message })
  };
}

module.exports = {
  createSeatalkMcpTools,
  getToolDefinitions
};
