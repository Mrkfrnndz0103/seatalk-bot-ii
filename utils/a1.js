// colToLetter(n)
// Example: colToLetter(1) === "A"
// Example: colToLetter(27) === "AA"
function colToLetter(n) {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error("Column number must be a positive integer.");
  }

  let result = "";
  let num = n;

  while (num > 0) {
    const remainder = (num - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    num = Math.floor((num - 1) / 26);
  }

  return result;
}

// buildRange(tabTitle, rows, cols)
// Example: buildRange("Sheet1", 10, 3) === "Sheet1!A1:C10"
// Example: buildRange("Ops", 1, 1) === "Ops!A1:A1"
function buildRange(tabTitle, rows, cols) {
  if (typeof tabTitle !== "string" || !tabTitle.trim()) {
    throw new Error("tabTitle must be a non-empty string.");
  }

  if (!Number.isInteger(rows) || rows < 1) {
    throw new Error("rows must be a positive integer.");
  }

  if (!Number.isInteger(cols) || cols < 1) {
    throw new Error("cols must be a positive integer.");
  }

  return `${tabTitle}!A1:${colToLetter(cols)}${rows}`;
}

module.exports = {
  colToLetter,
  buildRange
};
