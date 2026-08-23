const crypto = require("crypto");
const express = require("express");
const db = require("../db");
const store = require("../giftStore");
const operations = require("../services/giftOperations.service");
const redis = require("../services/redisClient");
const { sendAdminLockoutEmail } = require("../utils/mailer");
const {
  setSessionCookie,
  clearSessionCookie,
  getSession,
  requireAdmin
} = require("../services/adminAuth.service");

const router = express.Router();
const LOCK_THRESHOLD = 3;

function safeEqual(value, expected) {
  if (!expected) return false;
  const left = Buffer.from(String(value || ""));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requestIp(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function maskedCard(cardNum) {
  const card = String(cardNum || "");
  return card.length >= 8 ? `${card.slice(0, 4)}********${card.slice(-4)}` : "********";
}

function presentGift(gift) {
  return {
    id: gift.id,
    phone: gift.phone,
    maskedCard: maskedCard(gift.cardnum),
    amount: Number(gift.amount),
    balance: Number(gift.balance || 0),
    status: gift.status,
    fundingStatus: gift.funding_status || "UNKNOWN",
    fundingError: gift.funding_error || null,
    activatedAt: gift.activated_at,
    fundedAt: gift.funded_at
  };
}

router.post("/login", async (req, res) => {
  try {
    const { username, pin } = req.body;
    const ip = requestIp(req);
    if (!username || !pin) return res.status(400).json({ success: false, error: "Missing credentials" });

    const failKey = `fail:${ip}`;
    const lockKey = `lock:${ip}`;
    if (await redis.get(lockKey)) {
      return res.status(403).json({ success: false, error: "This device is locked due to failed attempts." });
    }

    if (safeEqual(username, process.env.ADMIN_USERNAME) && safeEqual(pin, process.env.ADMIN_USER_PIN)) {
      await redis.del(failKey);
      setSessionCookie(res, username);
      return res.json({ success: true });
    }

    const attempts = await redis.incr(failKey);
    if (attempts === 1) await redis.expire(failKey, 900);

    if (attempts >= LOCK_THRESHOLD) {
      await redis.set(lockKey, "1");
      sendAdminLockoutEmail({ ip, username }).catch(error => console.error("Lockout email failed:", error.message));
      return res.status(403).json({
        success: false,
        error: "Too many failed attempts. This device is locked until an administrator unlocks it."
      });
    }

    return res.status(401).json({ success: false, error: "Invalid credentials" });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({ success: false, error: "Login is temporarily unavailable" });
  }
});

router.post("/unlock-ip", async (req, res) => {
  const { masterKey, targetIp } = req.body;
  if (!safeEqual(masterKey, process.env.MASTER_UNLOCK_KEY)) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  if (!targetIp) return res.status(400).json({ error: "targetIp is required" });

  await redis.del(`lock:${targetIp}`, `fail:${targetIp}`);
  return res.json({ success: true, message: `${targetIp} has been unlocked.` });
});

router.get("/session", (req, res) => {
  const session = getSession(req);
  return session ? res.json({ authenticated: true, username: session.username }) : res.status(401).json({ authenticated: false });
});

router.post("/logout", (req, res) => {
  clearSessionCookie(res);
  return res.json({ success: true });
});

router.use(requireAdmin);

router.get("/gift-by-phone", async (req, res) => {
  try {
    const phone = store.normalize(req.query.phone || "");
    if (phone.length !== 10) return res.status(400).json({ found: false, message: "Enter a valid 10-digit phone number." });

    let gifts = await store.findAllByPhone(phone);
    if (gifts.length === 0) return res.status(404).json({ found: false, message: "No gift cards found for this phone number." });

    for (const gift of gifts) {
      if (String(gift.status).toUpperCase() === "ACTIVE" && String(gift.funding_status).toUpperCase() === "FUNDED") {
        try {
          await operations.refreshBalanceById(gift.id);
        } catch (error) {
          console.error(`Balance refresh failed for gift ${gift.id}:`, error.message);
        }
      }
    }

    gifts = await store.findAllByPhone(phone);
    return res.json({ found: true, phone, cards: gifts.map(presentGift) });
  } catch (error) {
    console.error("Gift lookup failed:", error.message);
    return res.status(500).json({ found: false, message: "Gift lookup failed" });
  }
});

router.post("/gifts", async (req, res) => {
  try {
    const phone = store.normalize(req.body.phone);
    const cardNum = store.normalizeCardNum(req.body.cardNum);
    const amount = Number(req.body.amount);
    if (phone.length !== 10) return res.status(400).json({ error: "Phone must contain 10 digits" });
    if (!store.isValidCardNum(cardNum)) return res.status(400).json({ error: "Card number must contain 12 to 19 digits" });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Amount must be greater than zero" });

    const gift = await store.insertGift({ phone, cardNum, amount });
    if (!gift) return res.status(409).json({ error: "That card number already exists" });
    return res.status(201).json({ gift: presentGift(gift) });
  } catch (error) {
    console.error("Create gift failed:", error.message);
    return res.status(500).json({ error: "Unable to add gift card" });
  }
});

router.post("/activate-by-phone", async (req, res) => {
  const result = await operations.activateAndFundByPhone(req.body.phone);
  const statusCode = result.status === "BAD_PHONE" ? 400 : result.status === "NOT_FOUND" ? 404 : 200;
  return res.status(statusCode).json(result);
});

router.post("/cards/:id/refresh", async (req, res) => {
  try {
    return res.json(await operations.refreshBalanceById(req.params.id));
  } catch (error) {
    return res.status(error.code === "NOT_FOUND" ? 404 : 500).json({ error: error.message });
  }
});

router.post("/toggle-gift", async (req, res) => {
  try {
    const { id, action } = req.body;
    if (!Number(id) || !["activate", "deactivate"].includes(action)) {
      return res.status(400).json({ status: "BAD_REQUEST", message: "A valid id and action are required" });
    }

    const result = action === "activate"
      ? await operations.activateAndFundById(id)
      : await operations.deactivateById(id);

    const message = action === "activate"
      ? `Card ending ${result.last4} was processed successfully.`
      : result.redeemedAmount > 0
        ? `Card ending ${result.last4} was deactivated after redeeming $${result.redeemedAmount.toFixed(2)}.`
        : `Card ending ${result.last4} was deactivated.`;

    return res.json({ ...result, message });
  } catch (error) {
    console.error("Gift action failed:", error.message);
    return res.status(error.code === "NOT_FOUND" ? 404 : 500).json({ status: "ERROR", message: error.message });
  }
});

router.post("/unmask-card", async (req, res) => {
  if (!safeEqual(req.body.pin, process.env.ADMIN_PIN)) return res.status(403).json({ error: "Invalid PIN" });
  const gift = await store.findById(Number(req.body.id));
  if (!gift?.cardnum) return res.status(404).json({ error: "Gift card not found" });
  return res.json({ fullCard: gift.cardnum });
});

router.get("/activity", async (req, res) => {
  const phone = store.normalize(req.query.phone || "");
  if (phone.length !== 10) return res.status(400).json({ error: "A valid phone number is required" });
  const { rows } = await db.query(
    `SELECT id, card_last4, event_type, status, message, metadata, created_at
     FROM gift_activity WHERE phone = $1 ORDER BY created_at DESC LIMIT 100`,
    [phone]
  );
  return res.json({ activity: rows });
});

module.exports = router;
