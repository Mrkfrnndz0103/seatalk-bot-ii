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

    const indexLoaded =
      Array.isArray(indexStore?.items) && indexStore.items.length > 0;
    if (!indexLoaded) {
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
