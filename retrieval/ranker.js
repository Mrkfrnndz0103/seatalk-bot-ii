function buildFrequency(tokens) {
  const freq = new Map();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }
  return freq;
}

function score(queryTokens, chunkTextTokens, options = {}) {
  if (!Array.isArray(queryTokens) || !Array.isArray(chunkTextTokens)) {
    return 0;
  }

  if (queryTokens.length === 0 || chunkTextTokens.length === 0) {
    return 0;
  }

  const maxPerToken =
    Number.isFinite(options.maxPerToken) && options.maxPerToken > 0
      ? options.maxPerToken
      : 2;
  const queryFreq = buildFrequency(queryTokens);
  const chunkFreq = buildFrequency(chunkTextTokens);
  let overlap = 0;

  for (const [token, count] of queryFreq.entries()) {
    if (chunkFreq.has(token)) {
      overlap += Math.min(count, chunkFreq.get(token), maxPerToken);
    }
  }

  return overlap;
}

module.exports = {
  score
};
