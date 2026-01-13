const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeHmac,
  computeLegacyHash,
  isValidSignature,
  normalizeSignature,
  getSignatureHeader
} = require("../utils/signature");

test("isValidSignature accepts HMAC signatures", () => {
  const secret = "shh";
  const body = Buffer.from("hello world");
  const signature = computeHmac(body, secret);

  assert.equal(isValidSignature(body, signature, secret), true);
  assert.equal(
    isValidSignature(body, `sha256=${signature}`, secret),
    true
  );
});

test("isValidSignature accepts legacy hash signatures", () => {
  const secret = "legacy";
  const body = Buffer.from("{\"ok\":true}");
  const signature = computeLegacyHash(body, secret);

  assert.equal(isValidSignature(body, signature, secret), true);
});

test("isValidSignature rejects invalid signatures", () => {
  const secret = "secret";
  const body = Buffer.from("payload");
  const signature = computeHmac(body, secret);

  assert.equal(isValidSignature(body, `${signature}00`, secret), false);
  assert.equal(isValidSignature(body, signature, "wrong"), false);
});

test("normalizeSignature strips sha256 prefix", () => {
  assert.equal(normalizeSignature("sha256=abcd"), "abcd");
  assert.equal(normalizeSignature("abcd"), "abcd");
});

test("getSignatureHeader supports fallback headers", () => {
  assert.equal(
    getSignatureHeader({ signature: "sig" }),
    "sig"
  );
  assert.equal(
    getSignatureHeader({ "x-sealtalk-signature": "seatalk" }),
    "seatalk"
  );
  assert.equal(
    getSignatureHeader({ "x-signature": "generic" }),
    "generic"
  );
});
