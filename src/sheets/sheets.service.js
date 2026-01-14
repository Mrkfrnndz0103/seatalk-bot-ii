const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { logger: defaultLogger } = require("../../utils/logger");
const {
  normalizeText,
  extractTimes,
  buildTimeRange,
  tokenize
} = require("../utils/text");

const DEFAULT_TAB_STOPWORDS = new Set([
  "tab",
  "shift",
  "schedule",
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

const DEFAULT_SHEET_STOPWORDS = new Set([
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

function createSheetsService(options = {}) {
  const {
    sheetsFile,
    defaultRange = "",
    scanAllTabs = false,
    maxTabs = 0,
    refreshMinutes = 0,
    maxMatchLines = 0,
    maxContextChars = 0,
    httpTimeoutMs = 0,
    tabMatchMinScore = 0.65,
    tabSuggestMinScore = 0.4,
    tabSuggestLimit = 3,
    tabStopwords = DEFAULT_TAB_STOPWORDS,
    sheetStopwords = DEFAULT_SHEET_STOPWORDS,
    getSheetsApi,
    hasOAuthConfig,
    serviceAccountFile,
    logger = defaultLogger
  } = options;

  const sheetsFilePath = sheetsFile ? path.resolve(sheetsFile) : "";

  const sheetCache = {
    lastLoadedAtMs: 0,
    sheets: []
  };
  let sheetRefreshPromise = null;

  async function readSheetRange(spreadsheetId, range) {
    const sheetsApi = await getSheetsApi();
    if (!sheetsApi) {
      return null;
    }

    const response = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range
    });

    return response.data?.values || [];
  }

  function parseSheetLink(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return null;
    }

    const idMatch = trimmed.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!idMatch) {
      return null;
    }

    const gidMatch = trimmed.match(/(?:[?#&]gid=)(\d+)/);
    return {
      id: idMatch[1],
      gid: gidMatch ? gidMatch[1] : null,
      url: trimmed
    };
  }

  function buildSheetExportUrl(sheet) {
    const gidParam = sheet.gid ? `&gid=${sheet.gid}` : "";
    return `https://docs.google.com/spreadsheets/d/${sheet.id}/export?format=csv${gidParam}`;
  }

  function buildSheetUrlWithGid(spreadsheetId, sheetId) {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`;
  }

  function formatSheetRow(row) {
    return row
      .map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim())
      .join(" | ")
      .trim();
  }

  async function fetchSheetValuesViaApi(api, sheet) {
    const meta = await api.spreadsheets.get({
      spreadsheetId: sheet.id,
      fields: "properties/title,sheets(properties(sheetId,title))"
    });

    const spreadsheetTitle = meta.data.properties?.title || "Unknown Spreadsheet";
    const sheets = meta.data.sheets || [];
    if (!sheets.length) {
      throw new Error("No tabs found in spreadsheet.");
    }

    if (sheet.gid) {
      const byId = sheets.find(
        (entry) => String(entry.properties?.sheetId) === String(sheet.gid)
      );
      const target = byId || sheets[0];
      const sheetTitle = target?.properties?.title;
      if (!sheetTitle) {
        throw new Error("Unable to determine sheet name.");
      }

      const range = defaultRange ? `${sheetTitle}!${defaultRange}` : sheetTitle;
      const valuesResponse = await api.spreadsheets.values.get({
        spreadsheetId: sheet.id,
        range
      });

      const values = valuesResponse.data.values || [];
      const lines = values.map(formatSheetRow).filter(Boolean);
      return [
        {
          ...sheet,
          spreadsheetTitle,
          tabName: sheetTitle,
          url: buildSheetUrlWithGid(sheet.id, target.properties.sheetId),
          lines
        }
      ];
    }

    if (!scanAllTabs) {
      const target = sheets[0];
      const sheetTitle = target?.properties?.title;
      if (!sheetTitle) {
        throw new Error("Unable to determine sheet name.");
      }

      const range = defaultRange ? `${sheetTitle}!${defaultRange}` : sheetTitle;
      const valuesResponse = await api.spreadsheets.values.get({
        spreadsheetId: sheet.id,
        range
      });

      const values = valuesResponse.data.values || [];
      const lines = values.map(formatSheetRow).filter(Boolean);
      return [
        {
          ...sheet,
          spreadsheetTitle,
          tabName: sheetTitle,
          url: buildSheetUrlWithGid(sheet.id, target.properties.sheetId),
          lines
        }
      ];
    }

    const tabs = sheets.slice(0, maxTabs || sheets.length);
    const ranges = tabs.map((entry) => {
      const title = entry.properties?.title;
      return defaultRange ? `${title}!${defaultRange}` : title;
    });

    const valuesResponse = await api.spreadsheets.values.batchGet({
      spreadsheetId: sheet.id,
      ranges
    });

    const valueRanges = valuesResponse.data.valueRanges || [];
    return valueRanges.map((range, index) => {
      const tab = tabs[index];
      const values = range.values || [];
      const lines = values.map(formatSheetRow).filter(Boolean);
      return {
        ...sheet,
        spreadsheetTitle,
        tabName: tab?.properties?.title || "Unknown",
        url: buildSheetUrlWithGid(sheet.id, tab?.properties?.sheetId),
        lines
      };
    });
  }

  async function fetchSheetCsv(sheet) {
    const exportUrl = buildSheetExportUrl(sheet);
    const response = await axios.get(exportUrl, {
      responseType: "text",
      timeout: httpTimeoutMs
    });
    const csvText = typeof response.data === "string" ? response.data : "";

    if (!csvText || /<html/i.test(csvText)) {
      throw new Error("Sheet is not public or returned HTML.");
    }

    const lines = csvText.split(/\r?\n/).filter((line) => line.length > 0);
    return {
      ...sheet,
      lines
    };
  }

  async function refreshSheetCache() {
    if (sheetRefreshPromise) {
      return sheetRefreshPromise;
    }

    sheetRefreshPromise = (async () => {
      if (!sheetsFilePath || !fs.existsSync(sheetsFilePath)) {
        sheetCache.sheets = [];
        sheetCache.lastLoadedAtMs = Date.now();
        return;
      }

      const raw = fs.readFileSync(sheetsFilePath, "utf8");
      const links = raw
        .split(/\r?\n/)
        .map(parseSheetLink)
        .filter(Boolean);

      const sheetsApi = await getSheetsApi();
      if (!sheetsApi && (hasOAuthConfig?.() || serviceAccountFile)) {
        logger.warn("sheets_api_unavailable");
      }

      const sheets = [];
      for (const link of links) {
        try {
          const sheetData = sheetsApi
            ? await fetchSheetValuesViaApi(sheetsApi, link)
            : await fetchSheetCsv(link);
          const entries = Array.isArray(sheetData) ? sheetData : [sheetData];
          sheets.push(...entries);
        } catch (error) {
          logger.warn("sheet_load_failed", {
            url: link.url,
            error: error.response?.data || error.message
          });
        }
      }

      sheetCache.sheets = sheets;
      sheetCache.lastLoadedAtMs = Date.now();
    })().finally(() => {
      sheetRefreshPromise = null;
    });

    return sheetRefreshPromise;
  }

  function extractKeywords(text) {
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !sheetStopwords.has(word));

    return Array.from(new Set(words));
  }

  function buildSheetContext(userMessage, options = {}) {
    if (!sheetCache.sheets.length) {
      return "";
    }

    const preferredTab = options.preferredTab || null;
    const sheetsToSearch = preferredTab
      ? sheetCache.sheets.filter(
          (sheet) =>
            sheet.id === preferredTab.id &&
            sheet.tabName === preferredTab.tabName
        )
      : sheetCache.sheets;

    const keywords = extractKeywords(userMessage);
    if (!keywords.length) {
      return "";
    }

    const parts = [];
    let totalChars = 0;

    for (const sheet of sheetsToSearch) {
      const matches = [];
      for (const line of sheet.lines) {
        const lower = line.toLowerCase();
        if (keywords.some((keyword) => lower.includes(keyword))) {
          matches.push(line);
        }
        if (matches.length >= maxMatchLines) {
          break;
        }
      }

      if (!matches.length) {
        continue;
      }

      const header = sheet.lines[0];
      const snippetLines = header ? [header, ...matches] : matches;
      const snippet = snippetLines.join("\n");
      const label = sheet.tabName
        ? `Sheet: ${sheet.url} (tab: ${sheet.tabName})`
        : `Sheet: ${sheet.url}`;
      const block = `${label}\n${snippet}`;

      if (totalChars + block.length > maxContextChars) {
        break;
      }

      parts.push(block);
      totalChars += block.length;
    }

    return parts.join("\n\n");
  }

  function scoreTabMatch(userMessage, tabName) {
    const normalizedQuery = normalizeText(userMessage);
    const normalizedTab = normalizeText(tabName);
    if (!normalizedTab) {
      return 0;
    }

    if (normalizedQuery.includes(normalizedTab)) {
      return 1;
    }

    const queryTimes = buildTimeRange(extractTimes(normalizedQuery));
    const tabTimes = buildTimeRange(extractTimes(normalizedTab));

    let score = 0;
    if (queryTimes && tabTimes && queryTimes === tabTimes) {
      score += 0.6;
    }

    const queryTokens = new Set(tokenize(normalizedQuery, tabStopwords));
    const tabTokens = new Set(tokenize(normalizedTab, tabStopwords));
    if (tabTokens.size > 0) {
      let matches = 0;
      for (const token of tabTokens) {
        if (queryTokens.has(token)) {
          matches += 1;
        }
      }
      const overlap = matches / tabTokens.size;
      score += overlap * 0.4;
    }

    return Math.min(1, score);
  }

  function shouldSuggestTabs(userMessage) {
    const normalized = normalizeText(userMessage);
    const hasShiftKeyword = /\b(shift|tab|schedule)\b/.test(normalized);
    const times = extractTimes(normalized);
    return hasShiftKeyword || times.length >= 2;
  }

  function findTabMatch(userMessage) {
    if (!sheetCache.sheets.length) {
      return null;
    }

    const candidates = sheetCache.sheets.filter((sheet) => sheet.tabName);
    if (!candidates.length) {
      return null;
    }

    const scored = candidates
      .map((sheet) => ({
        sheet,
        score: scoreTabMatch(userMessage, sheet.tabName)
      }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score <= 0) {
      return null;
    }

    const suggestions = scored
      .filter((entry) => entry.score >= tabSuggestMinScore)
      .slice(0, tabSuggestLimit)
      .map((entry) => entry.sheet);

    return {
      match: best.score >= tabMatchMinScore ? best.sheet : null,
      suggestions,
      bestScore: best.score
    };
  }

  function buildTabSuggestionReply(suggestions) {
    const formatted = suggestions
      .map((sheet) => {
        const label = sheet.spreadsheetTitle
          ? `${sheet.tabName} - ${sheet.spreadsheetTitle}`
          : sheet.tabName;
        return `- ${label}`;
      })
      .join("\n");

    return `Did you mean one of these tabs?\n${formatted}`;
  }

  async function fetchSheetTabId(spreadsheetId, tabName) {
    const sheetsApi = await getSheetsApi();
    if (!sheetsApi) {
      return null;
    }

    const response = await sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(sheetId,title))"
    });
    const sheets = response.data.sheets || [];
    const normalizedTarget = String(tabName || "").trim().toLowerCase();
    const match = sheets.find(
      (sheet) =>
        String(sheet.properties?.title || "").trim().toLowerCase() ===
        normalizedTarget
    );
    return match?.properties?.sheetId || null;
  }

  function startSheetRefreshTimer() {
    refreshSheetCache().catch((error) => {
      logger.warn("sheet_initial_load_failed", { error: error.message });
    });

    if (refreshMinutes > 0) {
      const intervalMs = refreshMinutes * 60 * 1000;
      setInterval(() => {
        refreshSheetCache().catch((error) => {
          logger.warn("sheet_refresh_failed", { error: error.message });
        });
      }, intervalMs).unref();
    }
  }

  return {
    sheetCache,
    readSheetRange,
    refreshSheetCache,
    startSheetRefreshTimer,
    buildSheetContext,
    findTabMatch,
    buildTabSuggestionReply,
    shouldSuggestTabs,
    fetchSheetTabId
  };
}

module.exports = {
  createSheetsService
};
