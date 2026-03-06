const express = require("express");
const store = require("../giftStore");
const { BASE_URL } = require("../config");
const{sendAdminLockoutEmail} = require("../utils/mailer");
const redis = require("../services/redisClient");
const {
  activateCard,
  issueFunds,
  deactivateCard,
  redeemGiftBalance,
  getGiftBalance
} = require("../services/cardknox.service");

const router = express.Router();



const LOCK_THRESHOLD = 3;
const LOCK_TIME = 1000 * 60 * 60 * 24; // 24 hours (or infinite)

/**
 * ADMIN LOOKUP
 * GET /admin/gift-by-phone
 */
router.get("/gift-by-phone", async (req, res) => {
  const phone = store.normalize(req.query.phone || "");
  if (!phone) {
    return res.status(400).json({ error: "Phone number required" });
  }

  const gifts = await store.findAllByPhone(phone);
  console.log("Gift data:", gifts);

  if (!gifts || gifts.length === 0) {
    return res.status(404).json({
      found: false,
      message: "No gift card found for this phone number."
    });
  }

  const cards = gifts.map(gift => {
    const card = gift.cardnum || "";
    const maskedCard =
      card.length >= 8
        ? card.slice(0, 4) + "********" + card.slice(-4)
        : "********";

    return {
      id: gift.id,
      phone: gift.phone,
      maskedCard,
      amount: gift.amount,
      balance: gift.balance,
      status: gift.status,
      fundingStatus: gift.funding_status || "UNKNOWN",
      activatedAt: gift.activated_at
    };
  });

  res.json({
    found: true,
    phone,
    cards
  });
});

/**
 * ADMIN LOGIN
 * POST /admin/login
 */
router.post("/login", async (req, res) => {
  try {
    const { username, pin } = req.body;

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
      req.socket.remoteAddress;

    if (!username || !pin) {
      return res.status(400).json({
        success: false,
        error: "Missing credentials"
      });
    }

    const failKey = `fail:${ip}`;
    const lockKey = `lock:${ip}`;

    // 🔒 Check lock
    const isLocked = await redis.get(lockKey);
    if (isLocked) {
      return res.status(403).json({
        success: false,
        error: "This device has been locked due to too many failed attempts."
      });
    }

    // ✅ Correct credentials
    if (
      username === process.env.ADMIN_USERNAME &&
      pin === process.env.ADMIN_USER_PIN
    ) {
      await redis.del(failKey);
      return res.json({ success: true });
    }

    // ❌ Increment failed attempts
    const attempts = await redis.incr(failKey);

    // Set 15-minute window for attempts
    if (attempts === 1) {
      await redis.expire(failKey, 900);
    }

    console.log(`Failed login from ${ip}. Attempt ${attempts}`);

    if (attempts >= LOCK_THRESHOLD) {
      await redis.set(lockKey, "1");

      console.log("🚨 ADMIN LOCKOUT:", {
        ip,
        time: new Date().toISOString()
      });

      sendAdminLockoutEmail({ ip, username })
        .catch(err => console.error("Email failed:", err));

      return res.status(403).json({
        success: false,
        error: "Too many failed attempts. This device is now locked. Please reach out to admin to unlock."
      });
    }

    return res.status(401).json({
      success: false,
      error: "Invalid credentials"
    });

  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ success: false });
  }
});



router.post("/unlock-ip", async (req, res) => {
  const { masterKey, targetIp } = req.body;

  if (masterKey !== process.env.MASTER_UNLOCK_KEY) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (!targetIp) {
    return res.status(400).json({
      success: false,
      error: "targetIp is required"
    });
  }

  const lockKey = `lock:${targetIp}`;
  const failKey = `fail:${targetIp}`;

  const exists = await redis.get(lockKey);

  if (!exists) {
    return res.status(404).json({
      success: false,
      error: "Device not locked"
    });
  }

  await redis.del(lockKey);
  await redis.del(failKey);

  return res.json({
    success: true,
    message: `${targetIp} has been unlocked successfully`
  });
});






/**
 * UNMASK CARD (HIGHLY SENSITIVE)
 * POST /admin/unmask-card
 */
router.post("/unmask-card", async (req, res) => {
  const { pin, id } = req.body;

  if (pin !== process.env.ADMIN_PIN) {
    return res.status(403).json({ error: "Invalid PIN" });
  }

  const giftId = Number(id);
  if (!giftId) {
    return res.status(400).json({ error: "Missing id" });
  }

  // You need a store function to lookup by id
  const gift = await store.findById(giftId);

  if (!gift || !gift.cardnum) {
    return res.status(404).json({ error: "Gift card not found" });
  }

  return res.json({ fullCard: gift.cardnum });
});

/**
 * TOGGLE GIFT (already exists)
 * POST /admin/toggle-gift
 */
router.post("/toggle-gift", async (req, res) => {
  try {
    const { id, action } = req.body;

    const giftId = Number(id);
    if (!giftId) {
      return res.status(400).json({ status: "BAD_REQUEST", message: "Missing id" });
    }

    if (action !== "activate" && action !== "deactivate") {
      return res.status(400).json({ status: "BAD_REQUEST", message: "Invalid action" });
    }

    const gift = await store.findById(giftId);
    if (!gift) {
      return res.json({ status: "NOT_FOUND", message: "Gift card not found" });
    }

    const cardNum = String(gift.cardnum || "").trim();
    if (!cardNum) {
      return res.status(500).json({ status: "ERROR", message: "Gift row missing card number" });
    }

    const amount = Number(gift.amount || 0);

    // ------------------------
    // DEACTIVATE
    // ------------------------
    if (action === "deactivate") {
      let redeemedAmount = 0;

      // 1) get current balance
      const bal = await getGiftBalance(cardNum);
      const remaining = Number(bal?.xRemainingBalance || 0);

      // 2) redeem remaining balance if any
      if (remaining > 0) {
        try {
          await redeemGiftBalance(cardNum, remaining);
          redeemedAmount = remaining;
        } catch (err) {
          console.error("Redeem failed:", err);
          return res.status(500).json({
            status: "REDEEM_FAILED",
            message: "Unable to redeem remaining balance. Card was not deactivated."
          });
        }
      }

      // 3) deactivate card in Cardknox
      try {
        await deactivateCard(cardNum);
      } catch (err) {
        // if your cardknox.service throws "Card Already Inactive" allow it
        if (err.message !== "Card Already Inactive") throw err;
      }

      // 4) update DB for THIS ROW ONLY
      await store.deactivateById(giftId, {
        redeemedAmount,
        finalBalance: 0
      });

      return res.json({
        status: "DEACTIVATED",
        message:
          redeemedAmount > 0
            ? `Gift card deactivated and ${redeemedAmount.toFixed(2)} balance was redeemed.`
            : "Gift card deactivated successfully."
      });
    }

    // ------------------------
    // ACTIVATE (this card only)
    // ------------------------
    // Activate in Cardknox
    await activateCard(cardNum);

    // Mark row active in DB
    await store.activateById(giftId);

    // Optionally fund (if amount is valid)
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.json({
        status: "ACTIVATED",
        message: "Gift card activated. No funding amount available for this row."
      });
    }

    const issue = await issueFunds(cardNum, amount);

    if (!issue.ok) {
      await store.markActivatedNotFundedById(giftId, issue.fundingError);

      return res.json({
        status: "ACTIVATED_NOT_FUNDED",
        message: "Gift card activated, but funding could not be completed.",
        fundingError: issue.fundingError,
        fundingErrorCode: issue.fundingErrorCode
      });
    }

    await store.markFundedById(giftId, issue.balance);

    return res.json({
      status: "ACTIVATED_AND_FUNDED",
      message: "Gift card was activated and funded successfully."
    });

  } catch (err) {
    console.error("Error in /admin/toggle-gift:", err);
    return res.status(500).json({ status: "ERROR", message: "Internal server error" });
  }
});    

module.exports = router;
