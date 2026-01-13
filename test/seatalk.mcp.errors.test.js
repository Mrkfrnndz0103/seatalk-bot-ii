const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeSeatalkError
} = require("../integrations/seatalk.mcp.errors");

test("normalizeSeatalkError maps rate limit", () => {
  const err = normalizeSeatalkError({ code: 101 });
  assert.equal(err.retryable, true);
  assert.equal(err.type, "rate_limit");
  assert.ok(err.userMessage);
});

test("normalizeSeatalkError maps permission denied", () => {
  const err = normalizeSeatalkError({ code: 103 });
  assert.equal(err.retryable, false);
  assert.equal(err.type, "permission_denied");
});
