const crypto = require("crypto");

function normalizeSignature(value) {
  if (!value) {
    return "";
  }
  return String(value).trim().replace(/^sha256=/i, "");
}

function safeCompareHex(a, b) {
  if (!a || !b) {
    return false;
  }
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function computeHmac(bodyBuffer, secret) {
  return crypto.createHmac("sha256", secret).update(bodyBuffer).digest("hex");
}

function computeLegacyHash(bodyBuffer, secret) {
  return crypto
    .createHash("sha256")
    .update(Buffer.concat([bodyBuffer, Buffer.from(secret)]))
    .digest("hex");
}

function isValidSignature(bodyBuffer, signature, secret) {
  if (!secret) {
    return false;
  }

  const normalized = normalizeSignature(signature);
  if (!normalized) {
    return false;
  }

  const buffer = Buffer.isBuffer(bodyBuffer)
    ? bodyBuffer
    : Buffer.from(String(bodyBuffer || ""));
  const hmac = computeHmac(buffer, secret);
  if (safeCompareHex(hmac, normalized)) {
    return true;
  }

  const legacy = computeLegacyHash(buffer, secret);
  return safeCompareHex(legacy, normalized);
}

function getSignatureHeader(headers) {
  return (
    headers["signature"] ||
    headers["x-sealtalk-signature"] ||
    headers["x-signature"] ||
    ""
  );
}

module.exports = {
  normalizeSignature,
  safeCompareHex,
  computeHmac,
  computeLegacyHash,
  isValidSignature,
  getSignatureHeader
};
