require("dotenv").config();

const env = require("../config/env");
const { FileStore } = require("../store/file.store");
const { runFullReindex } = require("../indexing/indexer");

(async () => {
  try {
    const store = new FileStore({ path: env.INDEX_STORE_PATH });
    const stats = await runFullReindex(store);
    console.log("Reindex stats:", stats);
  } catch (error) {
    console.error("Reindex failed:", error.message);
    process.exitCode = 1;
  }
})();
