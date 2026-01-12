const DEFAULT_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "with",
  "that",
  "this",
  "from",
  "your",
  "you",
  "about",
  "what",
  "when",
  "where",
  "which",
  "who",
  "how",
  "can",
  "could",
  "would",
  "should",
  "please",
  "thanks",
  "hello",
  "hi",
  "hey"
]);

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text, options = {}) {
  const stopwords =
    options.stopwords === false ? null : options.stopwords || DEFAULT_STOPWORDS;
  const tokens = normalize(text).split(" ").filter(Boolean);

  if (!stopwords) {
    return tokens;
  }

  return tokens.filter((token) => !stopwords.has(token));
}

module.exports = {
  normalize,
  tokenize,
  DEFAULT_STOPWORDS
};
