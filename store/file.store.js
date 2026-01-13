const fs = require("fs");
const path = require("path");
const { tokenize } = require("../utils/text");

class FileStore {
  constructor(options = {}) {
    const filePath = options.path;
    if (typeof filePath !== "string" || !filePath.trim()) {
      throw new Error("FileStore requires a non-empty path.");
    }

    this.filePath = path.resolve(filePath);
    this.items = [];
    this.invertedIndex = new Map();
    this.ensureDirectory();
  }

  ensureDirectory() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  load() {
    this.ensureDirectory();

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
        console.warn("Skipping invalid JSONL line:", error.message);
      }
    }

    this.items = parsed;
    this.buildIndex(parsed);
    return this.items;
  }

  clear() {
    this.ensureDirectory();
    fs.writeFileSync(this.filePath, "");
    this.items = [];
    this.invertedIndex = new Map();
  }

  upsertChunks(chunks) {
    if (!Array.isArray(chunks)) {
      throw new Error("upsertChunks expects an array.");
    }

    this.ensureDirectory();
    this.items = chunks;
    this.buildIndex(chunks);

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
