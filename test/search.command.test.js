const { test } = require("node:test");
const assert = require("node:assert/strict");
const env = require("../config/env");
const { handleSearch } = require("../commands/search.command");

test("handleSearch returns snippets when AI is disabled", async () => {
  const store = {
    items: [
      {
        id: "1",
        text: "hello world",
        spreadsheetName: "Sheet",
        tabName: "Tab",
        rangeA1: "A1:B2"
      }
    ],
    load() {
      return this.items;
    }
  };

  env.SEARCH_USE_LLM_SUMMARY = false;
  let summarizeCalled = false;
  const summarize = async () => {
    summarizeCalled = true;
    return "summary";
  };

  const reply = await handleSearch("hello", { store, summarize });
  assert.equal(summarizeCalled, false);
  assert.ok(reply.text.startsWith("Search results:"));
});

test("handleSearch uses AI when --ai is provided", async () => {
  const store = {
    items: [
      {
        id: "1",
        text: "hello world",
        spreadsheetName: "Sheet",
        tabName: "Tab",
        rangeA1: "A1:B2"
      }
    ],
    load() {
      return this.items;
    }
  };

  env.SEARCH_USE_LLM_SUMMARY = false;
  let summarizeCalled = false;
  const summarize = async () => {
    summarizeCalled = true;
    return "summary result";
  };

  const reply = await handleSearch("hello --ai", { store, summarize });
  assert.equal(summarizeCalled, true);
  assert.ok(reply.text.includes("summary result"));
});
