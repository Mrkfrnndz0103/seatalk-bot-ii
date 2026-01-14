function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function shouldPrefetchChatHistory(message) {
  const normalized = normalizeText(message);
  if (!normalized) {
    return false;
  }

  if (normalized.includes("backlog") || normalized.includes("status")) {
    return true;
  }

  const historyHints = [
    "greet",
    "same",
    "as above",
    "as mentioned",
    "as discussed",
    "previous",
    "earlier",
    "last",
    "that one",
    "this one",
    "follow up",
    "follow-up",
    "continue",
    "do it",
    "do that",
    "go ahead",
    "proceed",
    "send it",
    "send that"
  ];
  if (historyHints.some((hint) => normalized.includes(hint))) {
    return true;
  }

  const quickReplies = new Set([
    "ok",
    "okay",
    "yes",
    "yep",
    "yeah",
    "sure",
    "please",
    "no",
    "nope",
    "thanks",
    "thank you"
  ]);
  if (quickReplies.has(normalized)) {
    return true;
  }

  const pronounTokens = new Set([
    "him",
    "her",
    "them",
    "it",
    "that",
    "this",
    "those",
    "these",
    "he",
    "she",
    "they",
    "his",
    "hers",
    "their"
  ]);
  const tokens = normalized.split(/\s+/);
  if (tokens.length > 0 && tokens.length <= 5) {
    return true;
  }
  return tokens.some((token) => pronounTokens.has(token));
}

function shouldUseEmployeeLookup(message) {
  const normalized = normalizeText(message);
  return (
    normalized.includes("who is") ||
    normalized.includes("employee code") ||
    normalized.includes("employee email") ||
    normalized.includes("email of") ||
    normalized.includes("find employee")
  );
}

module.exports = {
  shouldPrefetchChatHistory,
  shouldUseEmployeeLookup
};
