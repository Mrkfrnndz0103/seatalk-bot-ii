const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const AdmZip = require("adm-zip");

const HEADER_ALIASES = {
  "to number": "toNumber",
  "spx tracking number": "trackingNumber",
  "receiver name": "receiverName",
  "receiver type": "receiverType",
  "current station": "currentStation",
  "receive status": "receiveStatus",
  "to order quantity": "orderQuantity",
  operator: "operator",
  "create time": "createTime",
  "complete time": "completeTime"
};

const REQUIRED_KEYS = [
  "toNumber",
  "trackingNumber",
  "receiverName",
  "orderQuantity",
  "operator",
  "createTime",
  "completeTime",
  "receiverType",
  "currentStation",
  "receiveStatus"
];

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\ufeff/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeCell(value) {
  return String(value || "").trim();
}

function normalizeComparison(value) {
  return normalizeCell(value).toLowerCase();
}

function parseCompleteTime(value) {
  const raw = normalizeCell(value);
  if (!raw) {
    return 0;
  }
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }

  const match = raw.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) {
    return 0;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4] || 0);
  const minute = Number(match[5] || 0);
  const second = Number(match[6] || 0);
  const date = new Date(year, month, day, hour, minute, second);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += char;
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") {
      rows.push(row);
    }
  }

  return rows;
}

function buildHeaderIndex(headerRow) {
  const index = {};
  headerRow.forEach((header, idx) => {
    const normalized = normalizeHeader(header);
    const key = HEADER_ALIASES[normalized];
    if (key && index[key] === undefined) {
      index[key] = idx;
    }
  });
  return index;
}

function hasRequiredHeaders(index) {
  return REQUIRED_KEYS.every((key) => Number.isInteger(index[key]));
}

function getCell(row, index) {
  if (!Number.isInteger(index)) {
    return "";
  }
  return row[index] ?? "";
}

function extractRowsFromCsv(csvText, logger, sourceName) {
  const rows = parseCsv(csvText);
  if (!rows.length) {
    return [];
  }

  const headerIndex = buildHeaderIndex(rows[0]);
  if (!hasRequiredHeaders(headerIndex)) {
    if (logger && logger.warn) {
      logger.warn("drive_sync_missing_headers", {
        sourceName,
        headers: rows[0]
      });
    }
    return [];
  }

  return rows.slice(1).map((row) => ({
    toNumber: getCell(row, headerIndex.toNumber),
    trackingNumber: getCell(row, headerIndex.trackingNumber),
    receiverName: getCell(row, headerIndex.receiverName),
    orderQuantity: getCell(row, headerIndex.orderQuantity),
    operator: getCell(row, headerIndex.operator),
    createTime: getCell(row, headerIndex.createTime),
    completeTime: getCell(row, headerIndex.completeTime),
    receiverType: getCell(row, headerIndex.receiverType),
    currentStation: getCell(row, headerIndex.currentStation),
    receiveStatus: getCell(row, headerIndex.receiveStatus)
  }));
}

function extractRowsFromZip(buffer, logger) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries().filter((entry) => {
    if (entry.isDirectory) {
      return false;
    }
    return /\.csv$/i.test(entry.entryName || "");
  });

  const csvCount = entries.length;
  const allRows = [];

  entries.forEach((entry) => {
    const data = entry.getData();
    const csvText = data ? data.toString("utf8") : "";
    if (!csvText) {
      return;
    }
    const rows = extractRowsFromCsv(csvText, logger, entry.entryName);
    allRows.push(...rows);
  });

  return { csvCount, rows: allRows };
}

function extractRowsFromCsvFiles(files, readFile, logger) {
  const allRows = [];
  for (const file of files) {
    const csvText = readFile(file);
    if (!csvText) {
      continue;
    }
    const rows = extractRowsFromCsv(csvText, logger, file.name);
    allRows.push(...rows);
  }
  return allRows;
}

function dedupeRows(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = normalizeComparison(row.toNumber);
    if (!key) {
      return;
    }
    const completeTimeMs = parseCompleteTime(row.completeTime);
    const existing = map.get(key);
    if (!existing || completeTimeMs > existing.completeTimeMs) {
      map.set(key, { ...row, completeTimeMs });
    }
  });
  return Array.from(map.values());
}

function filterRows(rows) {
  return rows.filter((row) => {
    if (normalizeComparison(row.receiverType) !== "station") {
      return false;
    }
    if (normalizeComparison(row.currentStation) !== "soc 5") {
      return false;
    }
    if (normalizeComparison(row.receiveStatus) !== "pending receive") {
      return false;
    }
    return true;
  });
}

function projectRows(rows) {
  return rows.map((row) => [
    row.toNumber,
    row.trackingNumber,
    row.receiverName,
    row.orderQuantity,
    row.operator,
    row.createTime,
    row.completeTime
  ]);
}

function ensureStateDir(statePath) {
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadSyncState(statePath) {
  if (!statePath || !fs.existsSync(statePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function saveSyncState(statePath, state) {
  if (!statePath) {
    return;
  }
  ensureStateDir(statePath);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function parseStartCell(startCell) {
  const match = String(startCell || "").trim().match(/^([A-Za-z]+)(\d+)$/);
  if (!match) {
    return null;
  }
  return { col: match[1].toUpperCase(), row: Number(match[2]) };
}

function columnToIndex(column) {
  let result = 0;
  for (let i = 0; i < column.length; i += 1) {
    result = result * 26 + (column.charCodeAt(i) - 64);
  }
  return result;
}

function indexToColumn(index) {
  let result = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function buildClearRange(tabName, startCell, columnCount) {
  const parsed = parseStartCell(startCell);
  if (!parsed) {
    return `${tabName}!A2:G`;
  }
  const startIndex = columnToIndex(parsed.col);
  const endColumn = indexToColumn(startIndex + columnCount - 1);
  return `${tabName}!${parsed.col}${parsed.row}:${endColumn}`;
}

function sanitizeTabName(tabName) {
  const trimmed = String(tabName || "").trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes("'")) {
    return `'${trimmed.replace(/'/g, "''")}'`;
  }
  if (/\s/.test(trimmed)) {
    return `'${trimmed}'`;
  }
  return trimmed;
}

async function downloadDriveFile(driveApi, fileId) {
  const response = await driveApi.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(response.data);
}

function isCsvFile(file) {
  const name = String(file?.name || "");
  const mimeType = String(file?.mimeType || "").toLowerCase();
  if (/\.csv$/i.test(name)) {
    return true;
  }
  return mimeType.includes("csv");
}

function isZipFile(file) {
  const name = String(file?.name || "");
  const mimeType = String(file?.mimeType || "").toLowerCase();
  if (/\.zip$/i.test(name)) {
    return true;
  }
  return mimeType === "application/zip";
}

function sortByModifiedDesc(files) {
  return [...files].sort((a, b) => {
    const aTime = Date.parse(a.modifiedTime || a.createdTime || 0) || 0;
    const bTime = Date.parse(b.modifiedTime || b.createdTime || 0) || 0;
    return bTime - aTime;
  });
}

async function listDriveFiles(driveApi, folderId) {
  const response = await driveApi.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id,name,mimeType,modifiedTime,createdTime,size)",
    orderBy: "modifiedTime desc",
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });
  const files = response.data.files || [];
  const csvFiles = files.filter(isCsvFile);
  const zipFiles = files.filter(isZipFile);
  return {
    csvFiles: sortByModifiedDesc(csvFiles),
    zipFiles: sortByModifiedDesc(zipFiles)
  };
}

function buildFilesFingerprint(files) {
  const sorted = [...files].sort((a, b) =>
    String(a.id || "").localeCompare(String(b.id || ""))
  );
  const payload = sorted
    .map(
      (file) =>
        `${file.id || ""}:${file.modifiedTime || ""}:${file.size || ""}`
    )
    .join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

async function writeSheetRows({
  sheetsApi,
  spreadsheetId,
  tabName,
  startCell,
  rows
}) {
  const safeTabName = sanitizeTabName(tabName);
  if (!safeTabName) {
    return false;
  }

  const clearRange = buildClearRange(safeTabName, startCell, 7);
  await sheetsApi.spreadsheets.values.clear({
    spreadsheetId,
    range: clearRange
  });

  if (!rows.length) {
    return true;
  }

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `${safeTabName}!${startCell}`,
    valueInputOption: "RAW",
    requestBody: { values: rows }
  });

  return true;
}

function createDriveZipSync(options = {}) {
  const {
    getDriveApi,
    getSheetsApi,
    logger,
    folderId,
    sheetId,
    tabName,
    startCell,
    statePath,
    minCsvWarn = 0
  } = options;

  let syncInFlight = false;

  return async function runDriveZipSync() {
    if (syncInFlight) {
      return;
    }

    if (!folderId || !sheetId || !tabName) {
      if (logger && logger.warn) {
        logger.warn("drive_sync_missing_config");
      }
      return;
    }

    syncInFlight = true;
    try {
      const driveApi = await getDriveApi();
      if (!driveApi) {
        if (logger && logger.warn) {
          logger.warn("drive_sync_drive_api_unavailable");
        }
        return;
      }

      const sheetsApi = await getSheetsApi();
      if (!sheetsApi) {
        if (logger && logger.warn) {
          logger.warn("drive_sync_sheets_api_unavailable");
        }
        return;
      }

      const { csvFiles, zipFiles } = await listDriveFiles(driveApi, folderId);
      if (!csvFiles.length && !zipFiles.length) {
        if (logger && logger.info) {
          logger.info("drive_sync_no_files");
        }
        return;
      }

      const state = loadSyncState(statePath);
      let sourceLabel = "";
      let csvCount = 0;
      let rows = [];
      let fingerprint = "";
      let stateUpdate = {};

      if (csvFiles.length) {
        fingerprint = buildFilesFingerprint(csvFiles);
        if (state.lastProcessedFingerprint === fingerprint) {
          if (logger && logger.info) {
            logger.info("drive_sync_no_new_csv", {
              fileCount: csvFiles.length
            });
          }
          return;
        }

        const csvContents = new Map();
        for (const file of csvFiles) {
          try {
            const buffer = await downloadDriveFile(driveApi, file.id);
            if (buffer) {
              csvContents.set(file.id, buffer.toString("utf8"));
            }
          } catch (error) {
            if (logger && logger.warn) {
              logger.warn("drive_sync_csv_download_failed", {
                fileId: file.id,
                name: file.name,
                error: error.response?.data || error.message
              });
            }
          }
        }

        const rowsFromCsv = extractRowsFromCsvFiles(
          csvFiles,
          (file) => csvContents.get(file.id) || "",
          logger
        );
        rows = rowsFromCsv;
        csvCount = csvFiles.length;
        sourceLabel = "csv";
        stateUpdate = {
          lastProcessedFingerprint: fingerprint,
          lastProcessedFileCount: csvFiles.length
        };
      } else {
        const latest = zipFiles[0];
        fingerprint = buildFilesFingerprint([latest]);
        if (
          state.lastProcessedFingerprint === fingerprint ||
          (state.lastProcessedFileId === latest.id &&
            state.lastProcessedModifiedTime === latest.modifiedTime)
        ) {
          if (logger && logger.info) {
            logger.info("drive_sync_no_new_zip", {
              fileId: latest.id,
              name: latest.name
            });
          }
          return;
        }

        const buffer = await downloadDriveFile(driveApi, latest.id);
        const extracted = extractRowsFromZip(buffer, logger);
        csvCount = extracted.csvCount;
        rows = extracted.rows;
        sourceLabel = "zip";
        stateUpdate = {
          lastProcessedFileId: latest.id,
          lastProcessedModifiedTime: latest.modifiedTime,
          lastProcessedName: latest.name,
          lastProcessedFingerprint: fingerprint
        };
      }

      if (minCsvWarn && csvCount < minCsvWarn && logger && logger.warn) {
        logger.warn("drive_sync_low_csv_count", {
          source: sourceLabel,
          csvCount
        });
      }

      const deduped = dedupeRows(rows);
      const filtered = filterRows(deduped);
      const outputRows = projectRows(filtered);

      await writeSheetRows({
        sheetsApi,
        spreadsheetId: sheetId,
        tabName,
        startCell,
        rows: outputRows
      });

      saveSyncState(statePath, {
        ...stateUpdate,
        lastProcessedAt: new Date().toISOString(),
        csvCount,
        totalRows: rows.length,
        dedupedRows: deduped.length,
        filteredRows: filtered.length,
        outputRows: outputRows.length
      });

      if (logger && logger.info) {
        logger.info("drive_sync_complete", {
          source: sourceLabel,
          csvCount,
          totalRows: rows.length,
          dedupedRows: deduped.length,
          filteredRows: filtered.length,
          outputRows: outputRows.length
        });
      }
    } catch (error) {
      if (logger && logger.error) {
        logger.error("drive_sync_failed", {
          error: error.response?.data || error.message
        });
      }
    } finally {
      syncInFlight = false;
    }
  };
}

module.exports = {
  createDriveZipSync
};
