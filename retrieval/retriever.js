const { normalize, tokenize } = require("../utils/text");
const { score } = require("./ranker");

function getCandidateIndices(queryTokens, invertedIndex) {
  if (!queryTokens.length || !invertedIndex) {
    return null;
  }

  const candidates = new Set();
  queryTokens.forEach((token) => {
    const matches = invertedIndex.get(token);
    if (!matches) {
      return;
    }
    for (const index of matches) {
      candidates.add(index);
    }
  });

  return candidates.size ? candidates : null;
}

function computeTitleBonus(queryNormalized, item) {
  if (!queryNormalized) {
    return 0;
  }

  const tabName = normalize(item?.tabName || "");
  const sheetName = normalize(item?.spreadsheetName || "");
  let bonus = 0;

  if (tabName && tabName.includes(queryNormalized)) {
    bonus += 3;
  }
  if (sheetName && sheetName.includes(queryNormalized)) {
    bonus += 1;
  }

  return bonus;
}

function retrieve(query, options = {}, store) {
  if (!store || typeof store.load !== "function") {
    throw new Error("store with load() is required.");
  }

  const topK =
    Number.isInteger(options.topK) && options.topK > 0 ? options.topK : 3;

  const items = Array.isArray(store.items) ? store.items : store.load();
  if (!query) {
    return items.slice(0, topK);
  }

  const queryNormalized = normalize(query);
  const queryTokens = tokenize(queryNormalized);
  const candidateIndices = getCandidateIndices(
    queryTokens,
    store.invertedIndex
  );
  const candidates = candidateIndices
    ? Array.from(candidateIndices).map((index) => items[index])
    : items;
  const scored = candidates
    .map((item, index) => {
      const tokens = Array.isArray(item?.tokens)
        ? item.tokens
        : tokenize(item?.text || "");
      const baseScore = score(queryTokens, tokens, { maxPerToken: 2 });
      const phraseBonus =
        queryNormalized && normalize(item?.text || "").includes(queryNormalized)
          ? 2
          : 0;
      const titleBonus = computeTitleBonus(queryNormalized, item);
      const totalScore = baseScore + phraseBonus + titleBonus;
      return {
        item,
        score: totalScore,
        originalIndex: index
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const aTime = Date.parse(a.item?.updatedAt || "") || 0;
      const bTime = Date.parse(b.item?.updatedAt || "") || 0;
      if (bTime !== aTime) {
        return bTime - aTime;
      }
      return a.originalIndex - b.originalIndex;
    });

  return scored.slice(0, topK).map((entry) => entry.item);
}

module.exports = {
  retrieve
};
