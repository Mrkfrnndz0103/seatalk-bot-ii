const { runFullReindex } = require("../indexing/indexer");

async function handleReindex(ctx = {}) {
  const store = ctx.store;
  if (!store || typeof store.clear !== "function") {
    return { text: "Reindex failed: store is not configured." };
  }

  try {
    const stats = await runFullReindex(store);
    return {
      text:
        "Reindex complete. " +
        `Sheets indexed: ${stats.sheetsIndexed}. ` +
        `Tabs indexed: ${stats.tabsIndexed}. ` +
        `Chunks written: ${stats.chunksWritten}.`
    };
  } catch (error) {
    return { text: `Reindex failed: ${error.message}` };
  }
}

module.exports = {
  handleReindex
};
