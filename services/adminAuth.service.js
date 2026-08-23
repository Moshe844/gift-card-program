const crypto = require("crypto");

const COOKIE_NAME = "gift_admin_session";
const SESSION_MS = 8 * 60 * 60 * 1000;

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").map(value => value.trim()).filter(Boolean).map(pair => {
      const index = pair.indexOf("=");
      return [decodeURIComponent(pair.slice(0, index)), decodeURIComponent(pair.slice(index + 1))];
    })
  );
}

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_USER_PIN || "";
}

function signature(payload) {
  return crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createSessionToken(username) {
  if (!sessionSecret()) throw new Error("ADMIN_SESSION_SECRET is not configured");
  const payload = Buffer.from(JSON.stringify({ username, expiresAt: Date.now() + SESSION_MS })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

function verifySessionToken(token) {
  if (!token || !sessionSecret()) return null;
  const [payload, providedSignature, extra] = String(token).split(".");
  if (!payload || !providedSignature || extra || !safeEqual(signature(payload), providedSignature)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.username || !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function cookieOptions(maxAgeSeconds = Math.floor(SESSION_MS / 1000)) {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    process.env.NODE_ENV === "production" ? "Secure" : "",
    `Max-Age=${maxAgeSeconds}`
  ].filter(Boolean);
}

function setSessionCookie(res, username) {
  const options = cookieOptions();
  options[0] += createSessionToken(username);
  res.setHeader("Set-Cookie", options.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", cookieOptions(0).join("; "));
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const session = verifySessionToken(cookies[COOKIE_NAME]);
  return session?.username === process.env.ADMIN_USERNAME ? session : null;
}

function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: "Authentication required" });
  req.admin = session;
  next();
}

module.exports = {
  createSessionToken,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  getSession,
  requireAdmin
};
