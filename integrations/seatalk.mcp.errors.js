function normalizeSeatalkError(payload) {
  const code = Number(payload?.code);
  if (!Number.isFinite(code)) {
    const fallback = {
      code: 2,
      type: "unknown",
      message: "Unknown SeaTalk error.",
      retryable: false
    };
    return {
      ...fallback,
      userMessage: buildUserFriendlyMessage(fallback)
    };
  }

  const base = {
    code,
    type: "unknown",
    message: payload?.message || "SeaTalk request failed.",
    retryable: false
  };

  let resolved;
  switch (code) {
    case 0:
      resolved = { ...base, type: "ok", message: "OK", retryable: false };
      break;
    case 100:
      resolved = {
        ...base,
        type: "auth_expired",
        message: "Seatalk token expired or invalid.",
        retryable: true
      };
      break;
    case 101:
      resolved = {
        ...base,
        type: "rate_limit",
        message: "Seatalk rate limit exceeded.",
        retryable: true
      };
      break;
    case 102:
      resolved = {
        ...base,
        type: "invalid_request",
        message: "Seatalk request input invalid.",
        retryable: false
      };
      break;
    case 103:
      resolved = {
        ...base,
        type: "permission_denied",
        message: "Seatalk permission denied.",
        retryable: false
      };
      break;
    case 104:
      resolved = {
        ...base,
        type: "capability_disabled",
        message: "Seatalk bot capability disabled.",
        retryable: false
      };
      break;
    case 105:
      resolved = {
        ...base,
        type: "app_offline",
        message: "Seatalk app is offline.",
        retryable: true
      };
      break;
    case 3000:
    case 3001:
    case 3002:
    case 3003:
      resolved = {
        ...base,
        type: "user_not_found",
        message: "Seatalk user not found.",
        retryable: false
      };
      break;
    case 4000:
    case 4001:
    case 4002:
    case 4003:
    case 4004:
    case 4005:
    case 4009:
    case 4010:
    case 4011:
    case 4012:
      resolved = {
        ...base,
        type: "message_error",
        message: "Seatalk message request failed.",
        retryable: false
      };
      break;
    case 7000:
      resolved = {
        ...base,
        type: "group_not_found",
        message: "Seatalk group not found.",
        retryable: false
      };
      break;
    case 7001:
      resolved = {
        ...base,
        type: "bot_not_in_group",
        message: "Seatalk bot is not in the group.",
        retryable: false
      };
      break;
    default:
      resolved = base;
      break;
  }

  return {
    ...resolved,
    userMessage: buildUserFriendlyMessage(resolved)
  };
}

function buildUserFriendlyMessage(error) {
  switch (error.type) {
    case "rate_limit":
      return "Seatalk is rate limiting requests right now. Please try again in a moment.";
    case "permission_denied":
      return "I don't have permission to perform that action.";
    case "bot_not_in_group":
      return "I'm not a member of that group chat.";
    case "user_not_found":
      return "I couldn't find that user in SeaTalk.";
    default:
      return "I ran into a Seatalk error while processing your request.";
  }
}

module.exports = {
  normalizeSeatalkError,
  buildUserFriendlyMessage
};
