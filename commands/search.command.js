const { retrieve } = require("../retrieval/retriever");
const { summarizeWithOpenRouter } = require("../retrieval/summarizer");

const MAX_SNIPPET_CHARS = 200;

function buildSnippet(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= MAX_SNIPPET_CHARS) {
    return cleaned;
  }
  return `${cleaned.slice(0, MAX_SNIPPET_CHARS)}...`;
}

function formatSource(chunk) {
  const sheet = chunk?.spreadsheetName || chunk?.spreadsheetId || "Unknown";
  const tab = chunk?.tabName || "Unknown";
  const range = chunk?.rangeA1 || chunk?.scanRangeA1 || "Unknown";
  return `${sheet} > ${tab} > ${range}`;
}

function formatSourcesList(chunks) {
  return chunks.map((chunk, index) => `${index + 1}) ${formatSource(chunk)}`);
}

async function handleSearch(query, ctx = {}) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return { text: "Usage: /search <query>" };
  }

  const store = ctx.store;
  if (!store || typeof store.load !== "function") {
    return { text: "Search failed: store is not configured." };
  }

  const topK =
    Number.isInteger(ctx.topK) && ctx.topK > 0 ? ctx.topK : 3;
  const results = retrieve(trimmed, { topK }, store);

  if (!results.length) {
    if (ctx.fallbackIfEmpty) {
      return null;
    }
    return { text: "No results found." };
  }

  const sourcesList = formatSourcesList(results);
  const summary = await summarizeWithOpenRouter(
    trimmed,
    results,
    sourcesList
  );
  if (summary) {
    return {
      text: `${summary}\n\nSources:\n${sourcesList.join("\n")}`
    };
  }

  const lines = ["Search results:"];
  results.forEach((chunk, index) => {
    lines.push(`${index + 1}) ${buildSnippet(chunk.text)}`);
    lines.push(`Source: ${formatSource(chunk)}`);
  });

  return { text: lines.join("\n") };
}

module.exports = {
  handleSearch
};
