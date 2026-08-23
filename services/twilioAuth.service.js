const crypto = require("crypto");
const { BASE_URL } = require("../config");

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function expectedSignature(url, params, authToken) {
  let value = url;
  for (const key of Object.keys(params || {}).sort()) value += key + String(params[key]);
  return crypto.createHmac("sha1", authToken).update(value).digest("base64");
}

function validateTwilioRequest(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return next();

  const baseUrl = (process.env.TWILIO_WEBHOOK_BASE_URL || BASE_URL).replace(/\/$/, "");
  const url = `${baseUrl}${req.originalUrl}`;
  const expected = expectedSignature(url, req.body, authToken);
  const provided = req.get("X-Twilio-Signature");

  if (!safeEqual(provided, expected)) {
    return res.status(403).type("text/plain").send("Invalid Twilio signature");
  }
  next();
}

module.exports = { expectedSignature, validateTwilioRequest };
