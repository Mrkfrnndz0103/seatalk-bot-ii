const fs = require("fs");
const path = require("path");
const env = require("../config/env");
const { listSpreadsheetsInFolder } = require("../clients/drive.client");
const { getTabsAndGrid, readValues } = require("../clients/sheets.client");
const { buildRange, colToLetter } = require("../utils/a1");
const { logger } = require("../utils/logger");
const { toChunks } = require("./chunker");

const TAB_READ_DELAY_MS = 400;

function rowHasContent(row) {
  return row.some((cell) => String(cell ?? "").trim().length > 0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPermissionError(error) {
  const status = error?.response?.status || error?.code;
  if (status === 403) {
    return true;
  }
  return /permission/i.test(error?.message || "");
}

function trimValues(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { trimmed: [], finalRows: 0, finalCols: 0 };
  }

  let maxRowIndex = -1;
  let maxColIndex = -1;

  values.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) {
      return;
    }
    let rowHasData = false;
    row.forEach((cell, colIndex) => {
      if (String(cell ?? "").trim().length > 0) {
        rowHasData = true;
        if (rowIndex > maxRowIndex) {
          maxRowIndex = rowIndex;
        }
        if (colIndex > maxColIndex) {
          maxColIndex = colIndex;
        }
      }
    });
    if (!rowHasData && maxRowIndex < rowIndex) {
      return;
    }
  });

  if (maxRowIndex < 0 || maxColIndex < 0) {
    return { trimmed: [], finalRows: 0, finalCols: 0 };
  }

  const trimmed = values
    .slice(0, maxRowIndex + 1)
    .map((row) => {
      const safeRow = Array.isArray(row) ? row : [];
      return safeRow.slice(0, maxColIndex + 1);
    });

  return {
    trimmed,
    finalRows: maxRowIndex + 1,
    finalCols: maxColIndex + 1
  };
}

function parseSheetLink(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const idMatch = trimmed.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) {
    return null;
  }

  return {
    id: idMatch[1],
    url: trimmed
  };
}

function loadSheetsFromFile(filePath) {
  if (!filePath) {
    return [];
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return [];
  }

  const raw = fs.readFileSync(resolved, "utf8");
  const lines = raw.split(/\r?\n/);
  const sheets = [];
  let pendingLabel = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      pendingLabel = trimmed.replace(/^#+\s*/, "").trim();
      continue;
    }

    const link = parseSheetLink(trimmed);
    if (!link) {
      continue;
    }

    sheets.push({
      id: link.id,
      name: pendingLabel,
      url: link.url
    });
    pendingLabel = "";
  }

  return sheets;
}

function buildFinalRange(tabTitle, finalRows, finalCols) {
  if (!finalRows || !finalCols) {
    return "";
  }
  const endCol = colToLetter(finalCols);
  return `${tabTitle}!A1:${endCol}${finalRows}`;
}

async function indexDriveFolder(store) {
  if (!store || typeof store.clear !== "function") {
    throw new Error("store with clear() is required.");
  }

  const sheetsFromFile = loadSheetsFromFile(env.SHEETS_FILE);
  const folderId = env.DRIVE_FOLDER_ID ? env.DRIVE_FOLDER_ID.trim() : "";
  const spreadsheets =
    sheetsFromFile.length > 0
      ? sheetsFromFile
      : await listSpreadsheetsInFolder(folderId || undefined);
  let tabsIndexed = 0;
  const allChunks = [];

  for (const sheet of spreadsheets) {
    const spreadsheetId = sheet.id;
    const spreadsheetName = sheet.name;
    let tabs = [];
    try {
      tabs = await getTabsAndGrid(spreadsheetId);
    } catch (error) {
      if (isPermissionError(error)) {
        logger.warn("indexer_permission_skip_spreadsheet", { spreadsheetId });
        continue;
      }
      throw error;
    }

    for (const tab of tabs) {
      if (!tab.title) {
        continue;
      }

      const maxRows = env.MAX_ROWS_TO_SCAN;
      const maxCols = env.MAX_COLS_TO_SCAN;
      const rowCount = tab.rowCount || 0;
      const colCount = tab.colCount || 0;

      const rowsToScan =
        maxRows > 0 ? Math.min(rowCount, maxRows) : rowCount;
      const colsToScan =
        maxCols > 0 ? Math.min(colCount, maxCols) : colCount;

      if (rowsToScan <= 0 || colsToScan <= 0) {
        continue;
      }

      const scanRangeA1 = buildRange(tab.title, rowsToScan, colsToScan);
      let values = [];
      try {
        values = await readValues(spreadsheetId, scanRangeA1);
      } catch (error) {
        if (isPermissionError(error)) {
          logger.warn("indexer_permission_skip_tab", {
            spreadsheetId,
            tabName: tab.title
          });
          if (TAB_READ_DELAY_MS > 0) {
            await sleep(TAB_READ_DELAY_MS);
          }
          continue;
        }
        throw error;
      }

      const { trimmed, finalRows, finalCols } = trimValues(values);
      if (trimmed.length === 0 || finalRows === 0 || finalCols === 0) {
        if (TAB_READ_DELAY_MS > 0) {
          await sleep(TAB_READ_DELAY_MS);
        }
        continue;
      }

      const rangeA1 = buildFinalRange(tab.title, finalRows, finalCols);
      const chunks = toChunks(trimmed, {
        spreadsheetId,
        spreadsheetName,
        tabName: tab.title,
        scanRangeA1
      });

      for (const chunk of chunks) {
        chunk.rangeA1 = rangeA1;
      }

      allChunks.push(...chunks);
      tabsIndexed += 1;

      if (TAB_READ_DELAY_MS > 0) {
        await sleep(TAB_READ_DELAY_MS);
      }
    }
  }

  store.clear();
  store.upsertChunks(allChunks);

  return {
    sheetsIndexed: spreadsheets.length,
    tabsIndexed,
    chunksWritten: allChunks.length
  };
}

async function runFullReindex(store) {
  return indexDriveFolder(store);
}

module.exports = {
  indexDriveFolder,
  runFullReindex
};
