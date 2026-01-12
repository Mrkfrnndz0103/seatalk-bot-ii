const { tokenize } = require("../utils/text");
const { score } = require("./ranker");

function retrieve(query, options = {}, store) {
  if (!store || typeof store.load !== "function") {
    throw new Error("store with load() is required.");
  }

  const topK =
    Number.isInteger(options.topK) && options.topK > 0 ? options.topK : 3;

  const items = store.load();
  if (!query) {
    return items.slice(0, topK);
  }

  const queryTokens = tokenize(query);
  const scored = items
    .map((item) => {
      const tokens = tokenize(item?.text || "");
      return {
        item,
        score: score(queryTokens, tokens)
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const aTime = Date.parse(a.item?.updatedAt || "") || 0;
      const bTime = Date.parse(b.item?.updatedAt || "") || 0;
      return bTime - aTime;
    });

  return scored.slice(0, topK).map((entry) => entry.item);
}

module.exports = {
  retrieve
};
