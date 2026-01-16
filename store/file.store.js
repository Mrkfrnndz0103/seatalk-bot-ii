const fs = require("fs");
const os = require("os");
const path = require("path");
const { tokenize } = require("../utils/text");
const { logger } = require("../utils/logger");

class FileStore {
  constructor(options = {}) {
    const filePath = options.path;
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw new Error("FileStore requires a non-empty path.");
    }

    this.filePath = path.resolve(filePath);
    this.items = [];
    this.invertedIndex = new Map();
    this.enabled = true;
    this.allowTempFallback =
      typeof options.allowTempFallback === "boolean"
        ? options.allowTempFallback
        : Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
    this.ensureDirectory();
  }

  ensureDirectory() {
    if (!this.enabled) {
      return false;
    }
    const dir = path.dirname(this.filePath);
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      return true;
    } catch (error) {
      if (this.allowTempFallback) {
        const tmpPath = path.join(os.tmpdir(), path.basename(this.filePath));
        if (tmpPath !== this.filePath) {
          logger.warn("filestore_tmp_fallback", {
            from: this.filePath,
            to: tmpPath,
            error: error.message
          });
          this.filePath = tmpPath;
          return this.ensureDirectory();
        }
      }
      logger.error("filestore_directory_failed", {
        dir,
        error: error.message
      });
      this.enabled = false;
      return false;
    }
  }

  load() {
    if (!this.ensureDirectory()) {
      this.items = [];
      this.invertedIndex = new Map();
      return this.items;
    }

    if (!fs.existsSync(this.filePath)) {
      this.items = [];
      return this.items;
    }

    const raw = fs.readFileSync(this.filePath, "utf8");
    if (!raw.trim()) {
      this.items = [];
      return this.items;
    }

    const lines = raw.split(/\r?\n/).filter(Boolean);
    const parsed = [];

    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch (error) {
        logger.warn("filestore_invalid_jsonl", { error: error.message });
      }
    }

    this.items = parsed;
    this.buildIndex(parsed);
    return this.items;
  }

  clear() {
    if (!this.ensureDirectory()) {
      this.items = [];
      this.invertedIndex = new Map();
      return;
    }
    fs.writeFileSync(this.filePath, "");
    this.items = [];
    this.invertedIndex = new Map();
  }

  upsertChunks(chunks) {
    if (!Array.isArray(chunks)) {
      throw new Error("upsertChunks expects an array.");
    }

    this.items = chunks;
    this.buildIndex(chunks);
    if (!this.ensureDirectory()) {
      return this.items;
    }

    const payload = chunks.map((chunk) => JSON.stringify(chunk)).join("\n");
    fs.writeFileSync(this.filePath, payload ? `${payload}\n` : "");
    return this.items;
  }

  buildIndex(items) {
    const index = new Map();
    items.forEach((item, itemIndex) => {
      const tokens = Array.isArray(item.tokens)
        ? item.tokens
        : tokenize(item?.text || "");
      item.tokens = tokens;
      const unique = new Set(tokens);
      for (const token of unique) {
        if (!index.has(token)) {
          index.set(token, []);
        }
        index.get(token).push(itemIndex);
      }
    });
    this.invertedIndex = index;
  }

  search(query, topK = 5) {
    const limit = Number.isInteger(topK) && topK > 0 ? topK : 5;
    if (!query) {
      return this.items.slice(0, limit);
    }

    const normalized = String(query).toLowerCase();
    const matches = this.items.filter((item) =>
      String(item?.text || "").toLowerCase().includes(normalized)
    );

    return matches.slice(0, limit);
  }
}

module.exports = {
  FileStore
};
