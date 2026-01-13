const env = require("../config/env");
const { retrieve } = require("../retrieval/retriever");
const { summarizeWithOpenRouter } = require("../retrieval/summarizer");
const { normalize } = require("../utils/text");

const MAX_SNIPPET_CHARS = 200;
const SUMMARY_CACHE = new Map();

function getCachedSummary(key) {
  const cached = SUMMARY_CACHE.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() > cached.expiresAt) {
    SUMMARY_CACHE.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedSummary(key, value) {
  const ttlMs = env.SEARCH_LLM_CACHE_TTL_MS;
  if (!ttlMs || ttlMs <= 0) {
    return;
  }
  SUMMARY_CACHE.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function stripAiFlag(query) {
  const cleaned = String(query || "")
    .replace(/\s--ai\b/gi, "")
    .replace(/\s-ai\b/gi, "")
    .trim();
  return cleaned;
}

function wantsAiSummary(query) {
  return /\s--ai\b|\s-ai\b/i.test(String(query || ""));
}

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

function withRequestId(ctx, payload) {
  if (ctx.requestId) {
    return { requestId: ctx.requestId, ...payload };
  }
  return payload;
}

async function handleSearch(query, ctx = {}) {
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return { text: "Usage: /search <query>" };
  }

  const forceAi = wantsAiSummary(trimmed);
  const cleanedQuery = stripAiFlag(trimmed);
  if (!cleanedQuery) {
    return { text: "Usage: /search <query>" };
  }

  const store = ctx.store;
  if (!store || typeof store.load !== "function") {
    return { text: "Search failed: store is not configured." };
  }

  const topK =
    Number.isInteger(ctx.topK) && ctx.topK > 0 ? ctx.topK : 3;
  const retrievalStart = Date.now();
  const results = retrieve(cleanedQuery, { topK }, store);
  const retrievalMs = Date.now() - retrievalStart;

  if (!results.length) {
    if (ctx.fallbackIfEmpty) {
      return null;
    }
    return { text: "No results found." };
  }

  if (ctx.logger && typeof ctx.logger.info === "function") {
    ctx.logger.info("search_retrieval_ms", withRequestId(ctx, {
      ms: retrievalMs,
      results: results.length
    }));
  }

  const sourcesList = formatSourcesList(results);
  const useAi = forceAi || env.SEARCH_USE_LLM_SUMMARY;
  if (useAi) {
    const cacheKey = `${normalize(cleanedQuery)}::${results
      .map((item) => item.id)
      .join(",")}`;
    const cached = getCachedSummary(cacheKey);
    if (cached) {
      return {
        text: `${cached}\n\nSources:\n${sourcesList.join("\n")}`
      };
    }

    const summaryStart = Date.now();
    const summarize = ctx.summarize || summarizeWithOpenRouter;
    const summary = await summarize(
      cleanedQuery,
      results,
      sourcesList,
      {
        timeoutMs: env.SEARCH_LLM_TIMEOUT_MS
      }
    );
    const summaryMs = Date.now() - summaryStart;
    if (ctx.logger && typeof ctx.logger.info === "function") {
      ctx.logger.info(
        "search_llm_ms",
        withRequestId(ctx, { ms: summaryMs, used: Boolean(summary) })
      );
    }
    if (summary) {
      setCachedSummary(cacheKey, summary);
      return {
        text: `${summary}\n\nSources:\n${sourcesList.join("\n")}`
      };
    }
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
