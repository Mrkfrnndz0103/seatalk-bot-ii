require("dotenv").config();

const { createServerApp } = require("../server/server");

const { runScheduledTasks } = createServerApp({
  enableScheduler: false,
  enableSheetRefreshTimer: false,
  exitOnInvalidConfig: false
});

module.exports = async (req, res) => {
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    await runScheduledTasks();
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
};
