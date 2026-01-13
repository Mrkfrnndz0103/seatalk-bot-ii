const DATA_SHEET_ID = "1mf7WSmGnzDFt3l5oZqi0UISNxP_i0BGYAW8PM5vwPQ0";
const BACKLOGS_TAB_NAME = "backlogs";
const TRUCK_TAB_NAME = "truck_request";
const BACKLOGS_IMAGE_SHEET_ID = "17cvCc6ffMXNs6JYnpMYvDO_V8nBCRKRm3G78oINj_yo";
const BACKLOGS_IMAGE_TAB_NAME = "Backlogs Summary";
const LAST_COLUMN_INDEX = 10; // Column K.

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitRow(line) {
  const raw = String(line || "");
  const parts = raw.includes(" | ") ? raw.split(" | ") : raw.split("|");
  return parts.map((part) => part.trim());
}

function parseNumber(value) {
  const cleaned = String(value || "").replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateTime(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const numeric = Number(raw.replace(/,/g, ""));
  if (Number.isFinite(numeric) && numeric > 20000) {
    const excelEpochMs = (numeric - 25569) * 86400 * 1000;
    if (Number.isFinite(excelEpochMs)) {
      return excelEpochMs;
    }
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

function colLetterToIndex(letter) {
  const code = String(letter || "A").toUpperCase().charCodeAt(0);
  return code - 65;
}

function getColumnOffset(rows) {
  const maxColumns = rows.reduce(
    (max, row) => Math.max(max, row.length),
    0
  );
  return maxColumns <= LAST_COLUMN_INDEX ? -1 : 0;
}

function getCell(rows, rowNumber, colLetter, offset) {
  const rowIndex = rowNumber - 1;
  if (rowIndex < 0 || rowIndex >= rows.length) {
    return "";
  }

  const colIndex = colLetterToIndex(colLetter) + offset;
  if (colIndex < 0) {
    return "";
  }

  const row = rows[rowIndex] || [];
  return row[colIndex] || "";
}

function getSheetRows(sheet) {
  return (sheet.lines || []).map(splitRow);
}

function extractGidFromUrl(url) {
  const match = String(url || "").match(/(?:[?#&]gid=)(\d+)/i);
  return match ? match[1] : "";
}

function buildSheetPngUrl(sheet) {
  if (!sheet) {
    return "";
  }

  const gid = sheet.gid || extractGidFromUrl(sheet.url);
  const gidParam = gid ? `&gid=${gid}` : "";
  return `https://docs.google.com/spreadsheets/d/${sheet.id}/export?format=png${gidParam}`;
}

function findSheetByTab(sheets, tabName, sheetId) {
  const normalizedTab = normalizeText(tabName);
  const candidates = (sheets || []).filter((sheet) => {
    if (sheetId && sheet.id !== sheetId) {
      return false;
    }
    return normalizeText(sheet.tabName) === normalizedTab;
  });
  if (!candidates.length) {
    return null;
  }

  if (sheetId) {
    const preferred = candidates.find((sheet) => sheet.id === sheetId);
    return preferred || candidates[0];
  }

  return candidates[0];
}

function matchValueFromMessage(message, values) {
  const normalizedMessage = normalizeText(message);
  const sorted = values
    .filter(Boolean)
    .map((value) => String(value))
    .sort((a, b) => b.length - a.length);

  for (const value of sorted) {
    const normalizedValue = normalizeText(value);
    if (normalizedValue.length < 2) {
      continue;
    }
    if (normalizedMessage.includes(normalizedValue)) {
      return value;
    }
  }
  return null;
}

function buildClarifyingReply() {
  return (
    "I can help with backlogs, top contributors by region, or truck requests. " +
    "Which one do you need? Example: \"top contributors for NCR\"."
  );
}

function detectIntent(message) {
  const normalized = normalizeText(message);
  if (!normalized) {
    return null;
  }

  if (/\bbacklog\b|\bbacklogs\b|\bdashboard\b|\bpending\b/.test(normalized)) {
    return "backlogs";
  }

  if (
    /\btop contributors?\b|\bcontributors?\b|\btop pending\b/.test(normalized)
  ) {
    return "contributors";
  }

  if (
    /\btruck\b.*\brequest\b|\btruck request\b|\blh request\b|\blhtrip\b/.test(
      normalized
    )
  ) {
    return "truck";
  }

  return null;
}

function buildBacklogsSummary(rows, offset) {
  const refresh = getCell(rows, 10, "J", offset);
  const totalBacklogs = getCell(rows, 11, "J", offset);
  const totalDispatch = getCell(rows, 12, "J", offset);
  const dataAsOf = getCell(rows, 13, "J", offset);

  let totalPending = 0;
  let hasPending = false;
  let latestPackedMs = null;
  let latestPackedLabel = "";

  for (let rowNumber = 2; rowNumber <= rows.length; rowNumber += 1) {
    const hub = getCell(rows, rowNumber, "B", offset);
    const pendingRaw = getCell(rows, rowNumber, "C", offset);
    const packedTime = getCell(rows, rowNumber, "D", offset);
    const cluster = getCell(rows, rowNumber, "F", offset);
    const region = getCell(rows, rowNumber, "G", offset);

    if (!hub && !pendingRaw && !packedTime && !cluster && !region) {
      continue;
    }

    const pending = parseNumber(pendingRaw);
    if (pending !== null) {
      totalPending += pending;
      hasPending = true;
    }

    const packedMs = parseDateTime(packedTime);
    if (packedMs !== null && (latestPackedMs === null || packedMs > latestPackedMs)) {
      latestPackedMs = packedMs;
      latestPackedLabel = packedTime;
    }
  }

  return {
    refresh,
    totalBacklogs,
    totalDispatch,
    dataAsOf,
    totalPending: hasPending ? totalPending : null,
    latestPackedTime: latestPackedLabel
  };
}

function extractContributors(rows, offset) {
  const entries = [];
  for (let rowNumber = 2; rowNumber <= 8; rowNumber += 1) {
    const region = getCell(rows, rowNumber, "I", offset);
    const hub = getCell(rows, rowNumber, "J", offset);
    const pendingRaw = getCell(rows, rowNumber, "K", offset);

    if (!region && !hub && !pendingRaw) {
      continue;
    }

    entries.push({
      region,
      hub,
      pending: parseNumber(pendingRaw),
      pendingRaw
    });
  }

  return entries;
}

function formatPending(entry) {
  if (entry.pending !== null) {
    return entry.pending;
  }
  return entry.pendingRaw || "N/A";
}

function buildTopContributorsLines(entries) {
  if (!entries.length) {
    return [];
  }

  const lines = ["Region | Hub | Pending"];
  entries.forEach((entry) => {
    if (!entry.region && !entry.hub && !entry.pendingRaw) {
      return;
    }
    lines.push(
      `${entry.region || ""} | ${entry.hub || ""} | ${formatPending(entry)}`.trim()
    );
  });

  return lines.filter(Boolean);
}

function handleBacklogsIntent(message, sheets) {
  const backlogsSheet =
    findSheetByTab(sheets, BACKLOGS_TAB_NAME, DATA_SHEET_ID) ||
    findSheetByTab(sheets, BACKLOGS_TAB_NAME, null);
  if (!backlogsSheet) {
    return {
      text: "I couldn't find the backlogs tab yet. Please check the sheet list."
    };
  }

  const imageSheet =
    findSheetByTab(sheets, BACKLOGS_IMAGE_TAB_NAME, BACKLOGS_IMAGE_SHEET_ID) ||
    findSheetByTab(sheets, BACKLOGS_IMAGE_TAB_NAME, null);

  const rows = getSheetRows(backlogsSheet);
  const offset = getColumnOffset(rows);
  const summary = buildBacklogsSummary(rows, offset);
  const entries = extractContributors(rows, offset);
  const topLines = buildTopContributorsLines(entries);
  const pngUrl = buildSheetPngUrl(imageSheet || backlogsSheet);

  const timestamp = summary.dataAsOf || summary.refresh || "now";
  const backlogsValue =
    summary.totalBacklogs || summary.totalPending || "N/A";
  const lines = [];
  if (pngUrl) {
    lines.push(`![Backlogs Summary](${pngUrl})`);
  }

  lines.push(
    `As of ${timestamp}, the current backlogs is ${backlogsValue}.`
  );

  if (summary.totalDispatch) {
    lines.push(`Total dispatch: ${summary.totalDispatch}`);
  }
  if (summary.latestPackedTime) {
    lines.push(`Latest packed time: ${summary.latestPackedTime}`);
  }

  if (topLines.length > 1) {
    lines.push("Top contributors:");
    lines.push(...topLines);
  } else {
    lines.push("Top contributors data is not available.");
  }

  return { text: lines.join("\n") };
}

function handleTopContributorsIntent(message, sheets) {
  const sheet =
    findSheetByTab(sheets, BACKLOGS_TAB_NAME, DATA_SHEET_ID) ||
    findSheetByTab(sheets, BACKLOGS_TAB_NAME, null);
  if (!sheet) {
    return {
      text: "I couldn't find top contributors yet."
    };
  }

  const rows = getSheetRows(sheet);
  const offset = getColumnOffset(rows);
  const entries = extractContributors(rows, offset);
  if (!entries.length) {
    return { text: "Top contributors data is unavailable." };
  }

  const regions = Array.from(
    new Set(entries.map((entry) => entry.region).filter((value) => value))
  );

  let requestedRegion = matchValueFromMessage(message, regions);
  if (!requestedRegion && regions.length === 1) {
    requestedRegion = regions[0];
  }

  if (regions.length > 1 && !requestedRegion) {
    return {
      text: `Which region should I use? Example: \"top contributors for ${regions[0]}\".`
    };
  }

  const filtered = requestedRegion
    ? entries.filter(
        (entry) =>
          normalizeText(entry.region) === normalizeText(requestedRegion)
      )
    : entries;

  if (!filtered.length) {
    return {
      text: `No contributor data found for region "${requestedRegion}".`
    };
  }

  const ranked = filtered
    .slice()
    .sort((a, b) => {
      const pendingA = a.pending ?? -Infinity;
      const pendingB = b.pending ?? -Infinity;
      if (pendingB !== pendingA) {
        return pendingB - pendingA;
      }
      return String(a.hub || "").localeCompare(String(b.hub || ""));
    })
    .slice(0, 5);

  const title = requestedRegion
    ? `Top contributors for ${requestedRegion}:`
    : "Top contributors:";
  const lines = [title, "Region | Hub | Pending"];
  ranked.forEach((entry) => {
    lines.push(
      `${entry.region || ""} | ${entry.hub || ""} | ${formatPending(entry)}`.trim()
    );
  });

  return { text: lines.join("\n") };
}

function extractTruckRequests(rows, offset) {
  const entries = [];
  for (let rowNumber = 3; rowNumber <= rows.length; rowNumber += 1) {
    const requestTime = getCell(rows, rowNumber, "B", offset);
    const cluster = getCell(rows, rowNumber, "C", offset);
    const truckSize = getCell(rows, rowNumber, "D", offset);
    const requestedBy = getCell(rows, rowNumber, "E", offset);
    const plate = getCell(rows, rowNumber, "F", offset);
    const provideTime = getCell(rows, rowNumber, "I", offset);
    const lhTrip = getCell(rows, rowNumber, "K", offset);

    if (
      !requestTime &&
      !cluster &&
      !truckSize &&
      !requestedBy &&
      !plate &&
      !provideTime &&
      !lhTrip
    ) {
      continue;
    }

    entries.push({
      cluster,
      requestTime,
      truckSize,
      requestedBy,
      plate,
      provideTime,
      lhTrip,
      timestamp: parseDateTime(requestTime),
      rowNumber
    });
  }

  return entries;
}

function handleTruckRequestIntent(message, sheets) {
  const sheet =
    findSheetByTab(sheets, TRUCK_TAB_NAME, DATA_SHEET_ID) ||
    findSheetByTab(sheets, TRUCK_TAB_NAME, null);
  if (!sheet) {
    return {
      text: "I couldn't find the truck request yet."
    };
  }

  const rows = getSheetRows(sheet);
  const offset = getColumnOffset(rows);
  const entries = extractTruckRequests(rows, offset);
  if (!entries.length) {
    return { text: "Truck request data is unavailable as of this time." };
  }

  const latestByCluster = new Map();
  entries.forEach((entry) => {
    if (!entry.cluster) {
      return;
    }

    const key = normalizeText(entry.cluster);
    const current = latestByCluster.get(key);
    const currentTime = current?.timeKey ?? -Infinity;
    const nextTime = entry.timestamp ?? entry.rowNumber;
    if (!current || nextTime > currentTime) {
      latestByCluster.set(key, {
        ...entry,
        timeKey: nextTime
      });
    }
  });

  const clusters = Array.from(latestByCluster.values()).map(
    (entry) => entry.cluster
  );
  const requestedCluster =
    matchValueFromMessage(message, clusters) ||
    (normalizeText(message).match(/\bcluster\s+([a-z0-9-]+)\b/i)?.[1] || null);

  if (!requestedCluster) {
    const example = clusters[0] || "your cluster";
    return {
      text: `Which cluster is this for? Example: \"truck request for ${example}\".`
    };
  }

  const entry = latestByCluster.get(normalizeText(requestedCluster));
  if (!entry) {
    return {
      text: `No recent request found for "${requestedCluster}".`
    };
  }

  const status = entry.provideTime ? "Provided" : "Pending";
  const plateText = entry.plate ? entry.plate : "Not assigned";

  const wantsStatus = /\bstatus\b/i.test(message);
  const wantsRequester =
    /\brequested by\b|\brequester\b|\bwho requested\b/i.test(message);
  const wantsTrip = /\blh\s*trip\b|\blhtrip\b/i.test(message);
  const wantsPlate = /\bplate\b|\bplate #\b|\bplate number\b/i.test(message);
  const wantsSize = /\btruck size\b|\bsize\b/i.test(message);
  const wantsProvide = /\bprovide time\b|\bprovided time\b/i.test(message);

  if (wantsStatus || wantsRequester || wantsTrip || wantsPlate || wantsSize || wantsProvide) {
    const parts = [];
    if (wantsStatus) {
      parts.push(`Status: ${status}`);
    }
    if (wantsRequester) {
      parts.push(`Requested by: ${entry.requestedBy || "Unknown"}`);
    }
    if (wantsTrip) {
      parts.push(`LHTrip: ${entry.lhTrip || "Unknown"}`);
    }
    if (wantsPlate) {
      parts.push(`Plate #: ${plateText}`);
    }
    if (wantsSize) {
      parts.push(`Truck size: ${entry.truckSize || "Unknown"}`);
    }
    if (wantsProvide) {
      parts.push(`Provide time: ${entry.provideTime || "Not set"}`);
    }
    return {
      text: `Latest request for ${entry.cluster}.\n${parts.join("\n")}`
    };
  }

  const lines = [
    `Latest request for ${entry.cluster}:`,
    `Status: ${status}`,
    `Requested by: ${entry.requestedBy || "Unknown"}`,
    `LHTrip: ${entry.lhTrip || "Unknown"}`,
    `Truck size: ${entry.truckSize || "Unknown"}`,
    `Plate #: ${plateText}`
  ];
  if (entry.provideTime) {
    lines.push(`Provide time: ${entry.provideTime}`);
  }
  if (entry.requestTime) {
    lines.push(`Request time: ${entry.requestTime}`);
  }

  return { text: lines.join("\n") };
}

async function handleIntentMessage(message, options = {}) {
  const intent = detectIntent(message);
  if (!intent) {
    if (options.includeFallback) {
      return { text: buildClarifyingReply() };
    }
    return null;
  }

  if (
    options.refreshSheetCache &&
    options.sheetCache &&
    (!options.sheetCache.sheets || !options.sheetCache.sheets.length)
  ) {
    await options.refreshSheetCache();
  }

  const sheets = options.sheetCache?.sheets || [];
  if (!sheets.length) {
    return {
      text: "Data Team is ongoing Please try again in a moment."
    };
  }

  switch (intent) {
    case "backlogs":
      return handleBacklogsIntent(message, sheets);
    case "contributors":
      return handleTopContributorsIntent(message, sheets);
    case "truck":
      return handleTruckRequestIntent(message, sheets);
    default:
      return null;
  }
}

module.exports = {
  buildClarifyingReply,
  detectIntent,
  handleIntentMessage
};
