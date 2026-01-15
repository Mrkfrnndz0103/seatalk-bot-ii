const fs = require("fs");
const path = require("path");

function normalizeCell(value) {
  return String(value || "").trim();
}

function readAlertState(filePath, logger) {
  if (!filePath) {
    return { notified: {} };
  }

  if (!fs.existsSync(filePath)) {
    return { notified: {} };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      return { notified: {} };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { notified: {} };
    }
    const notified =
      parsed.notified && typeof parsed.notified === "object"
        ? parsed.notified
        : {};
    return { notified };
  } catch (error) {
    logger?.warn?.("truck_alert_state_read_failed", {
      error: error.message
    });
    return { notified: {} };
  }
}

function writeAlertState(filePath, state, logger) {
  if (!filePath) {
    return;
  }

  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  } catch (error) {
    logger?.warn?.("truck_alert_state_write_failed", {
      error: error.message
    });
  }
}

function buildAlertMessage(row) {
  const plateF = normalizeCell(row[4]);
  const plateG = normalizeCell(row[5]);
  const cluster = normalizeCell(row[1]);
  const provideTime = normalizeCell(row[7]);

  const plateLine = plateG ? `${plateF} | ${plateG}` : plateF;
  const clusterLine = cluster || "N/A";
  const timeLine = provideTime || "N/A";

  return `${plateLine}\n${clusterLine}\n${timeLine}`;
}

function createTruckPlateAlert(options = {}) {
  const {
    spreadsheetId,
    tabName,
    startRow,
    groupId,
    statePath,
    readSheetRange,
    sendGroupMessage,
    logger
  } = options;

  const resolvedStatePath = statePath ? path.resolve(statePath) : "";

  async function run() {
    if (
      !spreadsheetId ||
      !tabName ||
      !startRow ||
      !groupId ||
      typeof readSheetRange !== "function" ||
      typeof sendGroupMessage !== "function"
    ) {
      return;
    }

    const range = `${tabName}!B${startRow}:I`;
    let rows = [];

    try {
      const values = await readSheetRange(spreadsheetId, range);
      rows = Array.isArray(values) ? values : [];
    } catch (error) {
      logger?.warn?.("truck_alert_read_failed", {
        error: error.message
      });
      return;
    }

    if (!rows.length) {
      return;
    }

    const state = readAlertState(resolvedStatePath, logger);
    const notified = state.notified || {};
    let updated = false;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || [];
      const plateF = normalizeCell(row[4]);
      if (!plateF) {
        continue;
      }

      const rowNumber = startRow + index;
      if (notified[rowNumber] === plateF) {
        continue;
      }

      const message = buildAlertMessage(row);
      const sent = await sendGroupMessage(groupId, message);
      if (sent) {
        notified[rowNumber] = plateF;
        updated = true;
        logger?.info?.("truck_alert_sent", {
          rowNumber,
          groupId
        });
      } else {
        logger?.warn?.("truck_alert_send_failed", {
          rowNumber,
          groupId
        });
      }
    }

    if (updated) {
      writeAlertState(
        resolvedStatePath,
        {
          notified,
          updatedAt: new Date().toISOString()
        },
        logger
      );
    }
  }

  return { run };
}

module.exports = {
  createTruckPlateAlert
};
