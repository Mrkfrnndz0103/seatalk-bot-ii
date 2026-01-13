function normalizeText(value) {
  return String(value || "").toLowerCase().trim();
}

function shouldPrefetchChatHistory(message) {
  const normalized = normalizeText(message);
  return normalized.includes("backlog") || normalized.includes("status");
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
