const { colToLetter } = require("../utils/a1");

const DEFAULT_ROWS_PER_CHUNK = 20;

function countNonEmptyCells(row) {
  return row.filter((cell) => String(cell ?? "").length > 0).length;
}

function formatRowText(row) {
  return row.map((cell) => String(cell ?? "")).join(" | ");
}

function detectHeaders(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const firstRow = Array.isArray(values[0]) ? values[0] : [];
  return countNonEmptyCells(firstRow) >= 2 ? firstRow : null;
}

function buildRangeA1(tabName, startRow, endRow, colCount) {
  const endCol = colToLetter(Math.max(colCount, 1));
  return `${tabName}!A${startRow}:${endCol}${endRow}`;
}

function toChunks(values, meta, options = {}) {
  if (!Array.isArray(values)) {
    throw new Error("values must be an array of rows.");
  }

  if (!meta || typeof meta !== "object") {
    throw new Error("meta is required.");
  }

  const {
    spreadsheetId,
    spreadsheetName,
    tabName,
    scanRangeA1
  } = meta;

  if (!spreadsheetId || !tabName) {
    throw new Error("meta.spreadsheetId and meta.tabName are required.");
  }

  const rowsPerChunk =
    Number.isInteger(options.rowsPerChunk) && options.rowsPerChunk > 0
      ? options.rowsPerChunk
      : DEFAULT_ROWS_PER_CHUNK;

  const headerRow = detectHeaders(values);
  const headerText = headerRow ? `Headers: ${formatRowText(headerRow)}` : "";
  const dataStartIndex = headerRow ? 1 : 0;
  const dataRows = values.slice(dataStartIndex);

  const chunks = [];
  for (let i = 0; i < dataRows.length; i += rowsPerChunk) {
    const chunkRows = dataRows.slice(i, i + rowsPerChunk);
    if (chunkRows.length === 0) {
      continue;
    }

    const startRow = dataStartIndex + i + 1;
    const endRow = startRow + chunkRows.length - 1;
    const colCount = Math.max(
      headerRow ? headerRow.length : 0,
      ...chunkRows.map((row) => (Array.isArray(row) ? row.length : 0))
    );

    const rowLines = chunkRows.map(
      (row, index) =>
        `Row ${startRow + index}: ${formatRowText(
          Array.isArray(row) ? row : []
        )}`
    );

    const textParts = [];
    if (headerText) {
      textParts.push(headerText);
    }
    textParts.push(...rowLines);

    chunks.push({
      id: `${spreadsheetId}|${tabName}|${startRow}-${endRow}`,
      spreadsheetId,
      spreadsheetName: spreadsheetName || "",
      tabName,
      scanRangeA1: scanRangeA1 || "",
      rangeA1: buildRangeA1(tabName, startRow, endRow, colCount),
      text: textParts.join("\n"),
      rows: chunkRows,
      updatedAt: new Date().toISOString()
    });
  }

  return chunks;
}

module.exports = {
  detectHeaders,
  toChunks
};
