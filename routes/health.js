const express = require("express");

function createHealthRouter(options = {}) {
  const { getMissingRequiredConfig, indexStore } = options;
  const router = express.Router();

  router.get("/health", (req, res) => {
    res.status(200).send("OK");
  });

  router.get("/ready", (req, res) => {
    const missing =
      typeof getMissingRequiredConfig === "function"
        ? getMissingRequiredConfig()
        : [];

    const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
    const indexLoaded =
      Array.isArray(indexStore?.items) && indexStore.items.length > 0;
    if (!isVercel && !indexLoaded) {
      missing.push("INDEX_STORE");
    }

    const ok = missing.length === 0;
    res.status(ok ? 200 : 503).json({
      ok,
      missing,
      indexLoaded
    });
  });

  return router;
}

module.exports = {
  createHealthRouter
};
