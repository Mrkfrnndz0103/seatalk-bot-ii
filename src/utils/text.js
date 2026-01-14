const EMPTY_SET = new Set();

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(a\.m\.|am)\b/g, "am")
    .replace(/\b(p\.m\.|pm)\b/g, "pm")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTimes(value) {
  const matches = [];
  const regex = /(\d{1,2})(?::\d{2})?\s*(am|pm)/gi;
  let match;
  while ((match = regex.exec(String(value || "")))) {
    matches.push(`${match[1]}${match[2].toLowerCase()}`);
  }
  return matches;
}

function buildTimeRange(times) {
  if (times.length >= 2) {
    return `${times[0]}-${times[1]}`;
  }
  return times[0] || "";
}

function tokenize(value, stopwords = EMPTY_SET) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token && !stopwords.has(token));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  normalizeText,
  extractTimes,
  buildTimeRange,
  tokenize,
  escapeRegExp
};
