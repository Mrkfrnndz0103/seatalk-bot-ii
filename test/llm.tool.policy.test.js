const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  shouldPrefetchChatHistory,
  shouldUseEmployeeLookup
} = require("../services/llm.tool.policy");

test("shouldPrefetchChatHistory detects backlog/status", () => {
  assert.equal(shouldPrefetchChatHistory("latest backlog?"), true);
  assert.equal(shouldPrefetchChatHistory("status update"), true);
  assert.equal(shouldPrefetchChatHistory("hello"), false);
});

test("shouldUseEmployeeLookup detects employee lookup intent", () => {
  assert.equal(shouldUseEmployeeLookup("who is Mark?"), true);
  assert.equal(shouldUseEmployeeLookup("employee code for Jane"), true);
  assert.equal(shouldUseEmployeeLookup("find employee email"), true);
  assert.equal(shouldUseEmployeeLookup("latest backlog"), false);
});
