const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function buildSheetPngExportUrl(spreadsheetId, gid, range) {
  const gidParam = gid ? `&gid=${gid}` : "";
  const rangeParam = range ? `&range=${encodeURIComponent(range)}` : "";
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=png${gidParam}${rangeParam}`;
}

function isHtmlResponse(data, headers = {}) {
  const contentType = String(headers["content-type"] || "").toLowerCase();
  if (contentType.includes("text/html")) {
    return true;
  }
  if (!data) {
    return false;
  }
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const prefix = buffer.slice(0, 32).toString("utf8").toLowerCase().trim();
  return prefix.startsWith("<!doctype html") || prefix.startsWith("<html");
}

async function tryFetchSheetPng(exportUrl, token, source) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    const response = await axios.get(exportUrl, {
      responseType: "arraybuffer",
      headers,
      validateStatus: () => true
    });
    if (
      response.status >= 200 &&
      response.status < 300 &&
      !isHtmlResponse(response.data, response.headers)
    ) {
      return { ok: true, data: response.data };
    }
    return {
      ok: false,
      error: {
        source,
        status: response.status,
        contentType: response.headers?.["content-type"] || ""
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        source,
        status: error.response?.status || null,
        message: error.message
      }
    };
  }
}

async function fetchSheetPngBase64(options) {
  const {
    spreadsheetId,
    tabName,
    range,
    imageGid,
    fetchSheetTabId,
    getGoogleAccessTokenCandidates,
    logger
  } = options;

  if (!spreadsheetId) {
    return null;
  }

  let gid = imageGid || "";
  if (!gid && tabName) {
    gid = await fetchSheetTabId(spreadsheetId, tabName);
  }

  const exportUrl = buildSheetPngExportUrl(spreadsheetId, gid, range);
  const attempts = [];
  const candidates = await getGoogleAccessTokenCandidates();

  for (const candidate of candidates) {
    const result = await tryFetchSheetPng(
      exportUrl,
      candidate.token,
      candidate.source
    );
    if (result.ok) {
      return Buffer.from(result.data).toString("base64");
    }
    if (result.error) {
      attempts.push(result.error);
    }
  }

  if (!candidates.length) {
    const result = await tryFetchSheetPng(exportUrl, null, "unauthenticated");
    if (result.ok) {
      return Buffer.from(result.data).toString("base64");
    }
    if (result.error) {
      attempts.push(result.error);
    }
  }

  if (attempts.length && logger?.warn) {
    logger.warn("backlogs_image_fetch_failed", { attempts });
  }
  return null;
}

function escapeSheetTabName(tabName) {
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

function buildBacklogsMonitorRange(tabName, range) {
  const trimmedRange = String(range || "").trim();
  if (!trimmedRange) {
    return "";
  }
  if (trimmedRange.includes("!")) {
    return trimmedRange;
  }
  const safeTab = escapeSheetTabName(tabName);
  return safeTab ? `${safeTab}!${trimmedRange}` : trimmedRange;
}

function computeRangeSignature(values) {
  const payload = JSON.stringify(values || []);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function loadBacklogsMonitorState(statePath, logger) {
  if (!statePath) {
    return {};
  }
  if (!fs.existsSync(statePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    logger.warn("backlogs_monitor_state_read_failed", {
      error: error.message
    });
    return {};
  }
}

function updateBacklogsMonitorState(statePath, currentState, nextState, logger) {
  if (!nextState || typeof nextState !== "object") {
    return currentState;
  }
  const merged = {
    ...(currentState || {}),
    ...nextState
  };

  if (!statePath) {
    return merged;
  }
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(statePath, JSON.stringify(merged, null, 2));
  return merged;
}

async function fetchBacklogsMonitorSignature(options) {
  const {
    sheetId,
    tabName,
    monitorRange,
    imageRange,
    readSheetRange,
    logger
  } = options;
  if (!sheetId) {
    return null;
  }
  const range = buildBacklogsMonitorRange(tabName, monitorRange || imageRange);
  if (!range) {
    logger.warn("backlogs_monitor_missing_range");
    return null;
  }
  const values = await readSheetRange(sheetId, range);
  if (values === null) {
    return null;
  }
  return computeRangeSignature(values);
}

function formatBacklogsTimestamp(date = new Date(), timeZone = "UTC") {
  try {
    const timeLabel = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone
    }).format(date);
    const dateLabel = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      timeZone
    }).format(date);
    return `${timeLabel} - ${dateLabel}`;
  } catch (error) {
    const timeLabel = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(date);
    const dateLabel = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit"
    }).format(date);
    return `${timeLabel} - ${dateLabel}`;
  }
}

function buildBacklogsScheduledText(date, timeZone) {
  const timestamp = formatBacklogsTimestamp(date, timeZone);
  return `@all Sharing OB Pending for Dispatch as of ${timestamp}`;
}

function createBacklogsPublisher(options = {}) {
  const {
    sheetId,
    tabName,
    imageRange,
    monitorRange,
    monitorStatePath,
    timezone,
    groupId,
    imageGid,
    readSheetRange,
    fetchSheetTabId,
    getGoogleAccessTokenCandidates,
    sendGroupMessage,
    trackEvent,
    logger
  } = options;

  let backlogsUpdateInFlight = false;
  let backlogsMonitorState = loadBacklogsMonitorState(
    monitorStatePath,
    logger
  );

  async function sendBacklogsScheduledUpdate() {
    if (!groupId) {
      return;
    }
    if (!sheetId) {
      logger.warn("backlogs_schedule_missing_sheet_id");
      return;
    }
    if (backlogsUpdateInFlight) {
      logger.warn("backlogs_schedule_skip_overlap");
      return;
    }

    backlogsUpdateInFlight = true;
    try {
      const nowIso = new Date().toISOString();
      const signature = await fetchBacklogsMonitorSignature({
        sheetId,
        tabName,
        monitorRange,
        imageRange,
        readSheetRange,
        logger
      });
      if (!signature) {
        backlogsMonitorState = updateBacklogsMonitorState(
          monitorStatePath,
          backlogsMonitorState,
          { lastCheckedAt: nowIso },
          logger
        );
        logger.warn("backlogs_monitor_signature_failed");
        return;
      }

      if (!backlogsMonitorState?.lastSignature) {
        backlogsMonitorState = updateBacklogsMonitorState(
          monitorStatePath,
          backlogsMonitorState,
          {
            lastSignature: signature,
            lastCheckedAt: nowIso,
            baselineAt: nowIso
          },
          logger
        );
        logger.info("backlogs_monitor_baseline_set");
        return;
      }

      if (backlogsMonitorState.lastSignature === signature) {
        backlogsMonitorState = updateBacklogsMonitorState(
          monitorStatePath,
          backlogsMonitorState,
          { lastCheckedAt: nowIso },
          logger
        );
        logger.info("backlogs_monitor_no_change");
        return;
      }

      const messageText = buildBacklogsScheduledText(new Date(), timezone);
      if (!messageText) {
        logger.warn("backlogs_schedule_missing_text");
        return;
      }

      const imageBase64 = await fetchSheetPngBase64({
        spreadsheetId: sheetId,
        tabName,
        range: imageRange,
        imageGid,
        fetchSheetTabId,
        getGoogleAccessTokenCandidates,
        logger
      });
      if (!imageBase64) {
        logger.warn("backlogs_schedule_missing_image");
        return;
      }

      const imageSent = await sendGroupMessage(groupId, {
        tag: "image",
        image: {
          content: imageBase64
        }
      });
      if (!imageSent) {
        logger.warn("backlogs_schedule_image_send_failed");
        return;
      }

      const textSent = await sendGroupMessage(groupId, messageText);
      if (!textSent) {
        logger.warn("backlogs_schedule_text_send_failed");
        return;
      }
      backlogsMonitorState = updateBacklogsMonitorState(
        monitorStatePath,
        backlogsMonitorState,
        {
          lastSignature: signature,
          lastCheckedAt: nowIso,
          lastSentAt: nowIso,
          lastChangeAt: nowIso
        },
        logger
      );
      if (trackEvent) {
        trackEvent({ groupId });
      }
      logger.info("backlogs_schedule_sent", {
        groupId,
        hasImage: Boolean(imageBase64)
      });
    } catch (error) {
      logger.error("backlogs_schedule_failed", {
        error: error.response?.data || error.message
      });
    } finally {
      backlogsUpdateInFlight = false;
    }
  }

  return {
    sendBacklogsScheduledUpdate
  };
}

module.exports = {
  createBacklogsPublisher
};
