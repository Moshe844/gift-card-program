const test = require("node:test");
const assert = require("node:assert/strict");

process.env.ADMIN_SESSION_SECRET = "test-secret-that-is-long-enough";
const { createSessionToken, verifySessionToken } = require("../services/adminAuth.service");

test("admin sessions reject tampering", () => {
  const token = createSessionToken("admin");
  assert.equal(verifySessionToken(token).username, "admin");
  assert.equal(verifySessionToken(`${token}x`), null);
});
