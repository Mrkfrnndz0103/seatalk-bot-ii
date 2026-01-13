const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { FileStore } = require("../store/file.store");
const { retrieve } = require("../retrieval/retriever");

test("FileStore precomputes tokens and builds inverted index", () => {
  const testPath = path.join(__dirname, "..", "data", "test-chunks.jsonl");
  const store = new FileStore({ path: testPath });
  store.clear();

  const items = [
    {
      id: "1",
      text: "alpha beta",
      tabName: "Backlogs",
      spreadsheetName: "Ops",
      updatedAt: "2024-01-01T00:00:00Z"
    },
    {
      id: "2",
      text: "beta gamma",
      tabName: "Other",
      spreadsheetName: "Other",
      updatedAt: "2024-01-02T00:00:00Z"
    }
  ];

  store.upsertChunks(items);

  assert.ok(Array.isArray(store.items[0].tokens));
  assert.ok(store.invertedIndex.get("alpha").includes(0));

  if (fs.existsSync(testPath)) {
    fs.unlinkSync(testPath);
  }
});

test("retrieve prefers title matches and stable sorting", () => {
  const testPath = path.join(__dirname, "..", "data", "test-retrieve.jsonl");
  const store = new FileStore({ path: testPath });
  store.clear();

  const items = [
    {
      id: "1",
      text: "alpha beta",
      tabName: "Backlogs",
      spreadsheetName: "Ops",
      updatedAt: "2024-01-01T00:00:00Z"
    },
    {
      id: "2",
      text: "alpha beta",
      tabName: "Other",
      spreadsheetName: "Other",
      updatedAt: "2024-01-02T00:00:00Z"
    }
  ];
  store.upsertChunks(items);

  const results = retrieve("backlogs", { topK: 1 }, store);
  assert.equal(results[0].id, "1");

  if (fs.existsSync(testPath)) {
    fs.unlinkSync(testPath);
  }
});
