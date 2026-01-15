const env = require("../config/env");

const DATA_SHEET_ID = env.BACKLOGS_DATA_SHEET_ID;
const BACKLOGS_TAB_NAME = env.BACKLOGS_DATA_TAB_NAME;
const TRUCK_TAB_NAME = env.TRUCK_REQUEST_TAB_NAME;
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
  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  const normalized = raw.toLowerCase().replace(/\s+/g, "");
  const ampmMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/i);
  if (ampmMatch) {
    let hours = Number(ampmMatch[1]);
    const minutes = Number(ampmMatch[2] || 0);
    const meridiem = ampmMatch[3].toLowerCase();
    if (hours === 12) {
      hours = meridiem === "am" ? 0 : 12;
    } else if (meridiem === "pm") {
      hours += 12;
    }
    return hours * 60 + minutes;
  }

  const timeMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return hours * 60 + minutes;
    }
  }

  return null;
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
    "....."
  );
}

function detectIntent(message) {
  const normalized = normalizeText(message);
  if (!normalized) {
    return null;
  }

  if (
    /\bbacklogs?\b|\bbaclogs?\b|\bdashboard\b|\bpending\b/.test(normalized)
  ) {
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

function buildTopContributorLines(rows, offset) {
  const labels = [
    "GMA SOL",
    "SOL IIS",
    "SOL",
    "InterSOC",
    "MM/GMA",
    "RC",
    "Mindanao"
  ];

  const regionMap = new Map();
  for (let rowNumber = 2; rowNumber <= 8; rowNumber += 1) {
    const region = getCell(rows, rowNumber, "I", offset);
    if (!region) {
      continue;
    }
    const hub = getCell(rows, rowNumber, "J", offset);
    const pending = getCell(rows, rowNumber, "K", offset);
    let resolvedHub = hub;
    let resolvedPending = pending;

    if (!resolvedPending && parseNumber(resolvedHub) !== null) {
      resolvedPending = resolvedHub;
      resolvedHub = region;
    }

    regionMap.set(normalizeText(region), {
      hub: resolvedHub,
      pending: resolvedPending
    });
  }

  return labels.map((label, index) => {
    const key = normalizeText(label);
    const mapped = regionMap.get(key);
    let hub = mapped?.hub || "";
    let pending = mapped?.pending || "";

    if (!hub && !pending) {
      const rowNumber = 2 + index;
      hub = getCell(rows, rowNumber, "J", offset) || "";
      pending = getCell(rows, rowNumber, "K", offset) || "";
    }

    return `${label} - ${hub || "N/A"} : ${pending || "N/A"}`;
  });
}

function pickRandom(values) {
  if (!values.length) {
    return "";
  }
  const index = Math.floor(Math.random() * values.length);
  return values[index];
}

function normalizeRegion(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function buildTopContributorLinesFromRange(values) {
  const labels = [
    "GMA SOL",
    "SOL IIS",
    "SOL",
    "InterSOC",
    "MM/GMA",
    "RC",
    "Mindanao"
  ];

  const rows = (values || []).map((row) => row || []);
  const regionMap = new Map();
  rows.forEach((row) => {
    const region = row[0];
    if (!region) {
      return;
    }
    let hub = row[1] || "";
    let pending = row[2] || "";
    if (!pending && parseNumber(hub) !== null) {
      pending = hub;
      hub = region;
    }
    regionMap.set(normalizeRegion(region), { hub, pending });
  });

  return labels.map((label) => {
    const mapped = regionMap.get(normalizeRegion(label));
    const hub = mapped?.hub || "N/A";
    const pending = mapped?.pending || "N/A";
    return `${label} - ${hub} : ${pending}`;
  });
}

function buildContributorEntriesFromRange(values) {
  const rows = (values || []).map((row) => row || []);
  return rows
    .map((row) => {
      const region = row[0] || "";
      let hub = row[1] || "";
      let pendingRaw = row[2] || "";
      let pending = parseNumber(pendingRaw);

      if (!pendingRaw && parseNumber(hub) !== null) {
        pendingRaw = hub;
        pending = parseNumber(hub);
        hub = region;
      }

      return {
        region,
        hub,
        pending,
        pendingRaw
      };
    })
    .filter((entry) => entry.region || entry.hub || entry.pendingRaw);
}

function findHighestContributor(values) {
  let best = null;
  values.forEach((row) => {
    const region = row?.[0] || "";
    const pendingRaw = row?.[1] || "";
    if (!region) {
      return;
    }
    const pending = parseNumber(pendingRaw);
    if (pending === null) {
      return;
    }
    if (!best || pending > best.pending) {
      best = { region, pending, pendingRaw: String(pendingRaw) };
    }
  });

  if (best) {
    return best;
  }

  for (const row of values || []) {
    const region = row?.[0] || "";
    const pendingRaw = row?.[1] || "";
    if (region && pendingRaw) {
      return { region, pending: null, pendingRaw: String(pendingRaw) };
    }
  }

  return null;
}

function getClusterRangeForRegion(region) {
  const key = normalizeRegion(region);
  const ranges = {
    intersoc: "J33:K35",
    rc: "J58:K59",
    mmgma: "J17:K19",
    gma: "J39:K41",
    gmasol: "J39:K41",
    sol: "J25:K27",
    soliis: "J47:K49",
    mindanao: "J55:K56",
    vismin: "J55:K56"
  };
  return ranges[key] || "";
}

function buildClusterLines(values) {
  const lines = [];
  (values || []).forEach((row) => {
    const cluster = row?.[0] || "";
    const pending = row?.[1] || "";
    if (!cluster && !pending) {
      return;
    }
    lines.push(`${cluster || "N/A"} - ${pending || "N/A"}`);
  });
  return lines;
}

function buildClusterLinesFromRows(rows, offset, startRow, endRow) {
  const lines = [];
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber += 1) {
    const cluster = getCell(rows, rowNumber, "J", offset);
    const pending = getCell(rows, rowNumber, "K", offset);
    if (!cluster && !pending) {
      continue;
    }
    lines.push(`${cluster || "N/A"} - ${pending || "N/A"}`);
  }
  return lines;
}

function extractTopContributorFromRows(rows, offset) {
  let best = null;
  for (let rowNumber = 2; rowNumber <= 8; rowNumber += 1) {
    const region = getCell(rows, rowNumber, "I", offset);
    const pendingRaw = getCell(rows, rowNumber, "J", offset);
    if (!region) {
      continue;
    }
    const pending = parseNumber(pendingRaw);
    if (pending === null) {
      continue;
    }
    if (!best || pending > best.pending) {
      best = { region, pending, pendingRaw: String(pendingRaw) };
    }
  }
  return best;
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

async function handleBacklogsIntent(message, sheets, options = {}) {
  const backlogsSheet =
    findSheetByTab(sheets, BACKLOGS_TAB_NAME, DATA_SHEET_ID) ||
    findSheetByTab(sheets, BACKLOGS_TAB_NAME, null);

  let rows = [];
  let offset = 0;
  let topContributor = null;
  let clusterLines = [];
  let refreshTs = "";
  let backlogsValue = "N/A";

  if (backlogsSheet) {
    rows = getSheetRows(backlogsSheet);
    offset = getColumnOffset(rows);
    refreshTs = getCell(rows, 10, "J", offset);
    backlogsValue = getCell(rows, 11, "J", offset) || "N/A";
  }

  if (typeof options.readSheetRange === "function") {
    try {
      const tabName = BACKLOGS_TAB_NAME;
      const spreadsheetId = DATA_SHEET_ID;
      const summaryValues = await options.readSheetRange(
        spreadsheetId,
        `${tabName}!J10:J11`
      );
      if (Array.isArray(summaryValues)) {
        refreshTs = summaryValues[0]?.[0] || refreshTs;
        backlogsValue = summaryValues[1]?.[0] || backlogsValue;
      }

      const contributorsValues = await options.readSheetRange(
        spreadsheetId,
        `${tabName}!I2:J8`
      );
      if (Array.isArray(contributorsValues) && contributorsValues.length) {
        topContributor = findHighestContributor(contributorsValues);
      }

      if (topContributor) {
        const clusterRange = getClusterRangeForRegion(topContributor.region);
        if (clusterRange) {
          const clusters = await options.readSheetRange(
            spreadsheetId,
            `${tabName}!${clusterRange}`
          );
          clusterLines = buildClusterLines(clusters);
        }
      }
    } catch (error) {
      // Fallback to cached sheet values if API read fails.
    }
  }

  if (!topContributor && rows.length) {
    topContributor = extractTopContributorFromRows(rows, offset);
  }

  if (topContributor && !clusterLines.length && rows.length) {
    const range = getClusterRangeForRegion(topContributor.region);
    const match = range.match(/J(\d+):K(\d+)/i);
    if (match) {
      const startRow = Number(match[1]);
      const endRow = Number(match[2]);
      if (Number.isFinite(startRow) && Number.isFinite(endRow)) {
        clusterLines = buildClusterLinesFromRows(rows, offset, startRow, endRow);
      }
    }
  }

  if (!topContributor && backlogsValue === "N/A") {
    return {
      text: "I couldn't find the backlogs tab yet. Please check the sheet list."
    };
  }

  const asOf = refreshTs || "now";
  const lines = [
    "**BACKLOGS Summary**",
    `> ${backlogsValue} <`,
    `as of ${asOf}`,
    "",
    "**Top Contributor**"
  ];

  if (topContributor) {
    const pendingDisplay = topContributor.pendingRaw || "N/A";
    lines.push(`> **${topContributor.region} at ${pendingDisplay}**`);
  } else {
    lines.push("> **N/A**");
  }

  if (clusterLines.length) {
    const bulleted = clusterLines.map((line) => `- ${line}`);
    lines.push("", "**Top 3 Contributor's:**", ...bulleted);
  }

  const numericBacklogs = parseNumber(backlogsValue);
  if (numericBacklogs !== null) {
    const highRange = [
      "\u{1F62E} Okay, that\u2019s higher than expected",
      "\u{1F605} \u201CManageable\u201D is starting to feel optimistic",
      "\u{1F62C} Alright\u2026 this needs attention",
      "\u{1F631} That\u2019s a spicy number",
      "\u{1F62C} \u201CManageable\u201D has left the chat",
      "\u{1F6A8} This is getting interesting now."
    ];
    const lowRange = [
      "\u{1F60C} All good \u2014 barely breaking a sweat.",
      "\u{1F642} Looking okay\u2026 keeping an eye on it.",
      "\u{1F914} Hmm\u2026 seems manageable for now.",
      "\u{1F642} Still within acceptable range",
      "\u{1F642} Looking healthy",
      "\u{1F60C} All good \u2014 no surprises"
    ];
    const ladder =
      numericBacklogs >= 100000 ? pickRandom(highRange) : pickRandom(lowRange);
    if (ladder) {
      lines.push("", ladder);
    }
  }

  return { text: lines.join("\n") };
}

async function handleTopContributorsIntent(message, sheets, options = {}) {
  let entries = [];

  if (typeof options.readSheetRange === "function") {
    try {
      const values = await options.readSheetRange(
        DATA_SHEET_ID,
        `${BACKLOGS_TAB_NAME}!I2:K8`
      );
      entries = buildContributorEntriesFromRange(values);
    } catch (error) {
      // fallback to cached sheet values
    }
  }

  if (!entries.length) {
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
    entries = extractContributors(rows, offset);
  }

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

function extractTruckRequestsFromRange(values) {
  const entries = [];
  const rows = (values || []).map((row) => row || []);
  rows.forEach((row, index) => {
    const requestTime = row[0] || "";
    const cluster = row[1] || "";
    const truckSize = row[2] || "";
    const requestedBy = row[3] || "";
    const plate = row[4] || "";
    const provideTime = row[7] || "";
    const lhTrip = row[9] || "";

    if (
      !requestTime &&
      !cluster &&
      !truckSize &&
      !requestedBy &&
      !plate &&
      !provideTime &&
      !lhTrip
    ) {
      return;
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
      rowNumber: index + 3
    });
  });

  return entries;
}

async function handleTruckRequestIntent(message, sheets, options = {}) {
  let entries = [];

  if (typeof options.readSheetRange === "function") {
    try {
      const values = await options.readSheetRange(
        DATA_SHEET_ID,
        `${TRUCK_TAB_NAME}!B3:K`
      );
      entries = extractTruckRequestsFromRange(values);
    } catch (error) {
      // fallback to cached sheet values
    }
  }

  if (!entries.length) {
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
    entries = extractTruckRequests(rows, offset);
  }

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

    const lines = [
      "Latest request for:",
      `> **${entry.cluster}**`
    ];
    if (parts.length) {
      lines.push("", parts.join("\n"));
    }

    return { text: lines.join("\n") };
  }

  const lines = [
    "Latest request for:",
    `> **${entry.cluster}**`
  ];
  if (entry.requestTime) {
    lines.push("", `Request time: ${entry.requestTime}`);
  }
  lines.push(
    "",
    `Status: ${status}`,
    `Requested by: ${entry.requestedBy || "Unknown"}`
  );
  if (entry.lhTrip) {
    lines.push(`LHTrip: ${entry.lhTrip || "Unknown"}`);
  }
  if (entry.truckSize) {
    lines.push(`Truck size: ${entry.truckSize || "Unknown"}`);
  }
  if (plateText) {
    lines.push(`Plate #: ${plateText}`);
  }
  if (entry.provideTime) {
    lines.push(`Provide time: ${entry.provideTime}`);
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
  const hasDirectRead = typeof options.readSheetRange === "function";
  if (!sheets.length && !hasDirectRead) {
    return {
      text: "Data Team is ongoing Please try again in a moment."
    };
  }

  switch (intent) {
    case "backlogs":
      return await handleBacklogsIntent(message, sheets, options);
    case "contributors":
      return await handleTopContributorsIntent(message, sheets, options);
    case "truck":
      return await handleTruckRequestIntent(message, sheets, options);
    default:
      return null;
  }
}

module.exports = {
  buildClarifyingReply,
  detectIntent,
  handleIntentMessage
};


