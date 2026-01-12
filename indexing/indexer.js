const env = require("../config/env");
const { listSpreadsheetsInFolder } = require("../clients/drive.client");
const { getTabsAndGrid, readValues } = require("../clients/sheets.client");
const { buildRange, colToLetter } = require("../utils/a1");
const { toChunks } = require("./chunker");

function rowHasContent(row) {
  return row.some((cell) => String(cell ?? "").trim().length > 0);
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

  const folderId = env.DRIVE_FOLDER_ID ? env.DRIVE_FOLDER_ID.trim() : "";
  const spreadsheets = await listSpreadsheetsInFolder(
    folderId || undefined
  );
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
        console.warn(
          `Skipping spreadsheet ${spreadsheetId} due to permission error.`
        );
        continue;
      }
      throw error;
    }

    for (const tab of tabs) {
      if (!tab.title) {
        continue;
      }

      const rowsToScan = Math.min(
        tab.rowCount || 0,
        env.MAX_ROWS_TO_SCAN
      );
      const colsToScan = Math.min(
        tab.colCount || 0,
        env.MAX_COLS_TO_SCAN
      );

      if (rowsToScan <= 0 || colsToScan <= 0) {
        continue;
      }

      const scanRangeA1 = buildRange(tab.title, rowsToScan, colsToScan);
      let values = [];
      try {
        values = await readValues(spreadsheetId, scanRangeA1);
      } catch (error) {
        if (isPermissionError(error)) {
          console.warn(
            `Skipping tab ${tab.title} in ${spreadsheetId} due to permission error.`
          );
          continue;
        }
        throw error;
      }

      const { trimmed, finalRows, finalCols } = trimValues(values);
      if (trimmed.length === 0 || finalRows === 0 || finalCols === 0) {
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
