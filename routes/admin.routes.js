const express = require("express");
const store = require("../giftStore");
const { BASE_URL } = require("../config");
const{sendAdminLockoutEmail} = require("../utils/mailer");
const redis = require("../services/redisClient");
const {
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

  const gift = await store.findByPhone(phone);

  if (!gift) {
    return res.status(404).json({
      found: false,
      message: "No gift card found for this phone number."
    });
  }

  const fundingStatus = gift.funding_status || "UNKNOWN";

  const card = gift.cardnum || "";
  const maskedCard =
    card.length >= 8
      ? card.slice(0, 4) + "********" + card.slice(-4)
      : "********";

  res.json({
    found: true,
    phone: gift.phone,
    maskedCard,
    amount: gift.amount,
    balance: gift.balance,
    status: gift.status,
    fundingStatus,
    activatedAt: gift.activated_at
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
  const { pin, phone } = req.body;

  if (pin !== process.env.ADMIN_PIN) {
    return res.status(403).json({ error: "Invalid PIN" });
  }

  const normalizedPhone = store.normalize(phone || "");
  const gift = await store.findByPhone(normalizedPhone);

  if (!gift || !gift.cardnum) {
    return res.status(404).json({ error: "Gift card not found" });
  }

  res.json({ fullCard: gift.cardnum });
});

/**
 * TOGGLE GIFT (already exists)
 * POST /admin/toggle-gift
 */
router.post("/toggle-gift", async (req, res) => {
    try {
        const { phone, action } = req.body;
        const gift = await store.findByPhone(phone);
    
        if (!gift) {
          return res.json({ status: "NOT_FOUND" });
        }
    
        const cardNum = gift.cardnum;
    
        // ------------------------
        // DEACTIVATE
        // ------------------------
        if (action === "deactivate") {
          let redeemedAmount = 0;
        
          // 1. Get current balance
          const bal = await getGiftBalance(cardNum);
          const remaining = Number(bal.xRemainingBalance || 0);
        
          // 2. Redeem remaining balance if any
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
        
          // 3. Deactivate card
          try {
            await deactivateCard(cardNum);
          } catch (err) {
            if (err.message !== "Card Already Inactive") {
              throw err;
            }
          }
        
          // 4. Update DB
          await store.deactivate(phone, {
            redeemedAmount,
            finalBalance: 0
          });
        
          return res.json({
            status: "DEACTIVATED",
            message:
              redeemedAmount > 0
                ? `Gift card deactivated and ${redeemedAmount.toFixed(
                    2
                  )} balance was redeemed.`
                : "Gift card deactivated successfully."
          });
        }
        
        
        // ------------------------
        // ACTIVATE
        // ------------------------
    // ACTIVATE
    // ------------------------
    else if (action === "activate") {
      const apiRes = await fetch(`${BASE_URL}/activate-by-phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone })
      });
    
      const result = await apiRes.json();
    
      let message = "Gift card activation completed.";
    
      if (result.status === "ACTIVATED_AND_FUNDED") {
        message = "Gift card was activated and funded successfully.";
      } else if (result.status === "ACTIVATED_NOT_FUNDED") {
        message =
          "Gift card was activated, but funding could not be completed. You may retry funding later.";
      } else if (result.status === "ALREADY_ACTIVE") {
        message = "Gift card is already active.";
      }
    
      return res.json({
        status: result.status,
        message,
        details: result
      });
    }
    
        
    
        // fallback if action is something else
        return res.json({ message: "No action taken" });
    
      } catch (err) {
        console.error("Error in /admin/toggle-gift:", err);
        return res.status(500).json({ error: "Internal server error" });
      }
    });

    router.get("/debug/locked-ips", async (req, res) => {
      try {
        const keys = await redisClient.keys("lock:*");
    
        const ips = keys.map(k => k.replace("lock:", ""));
    
        res.json({
          count: ips.length,
          lockedIps: ips
        });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch locked IPs" });
      }
    });
    

module.exports = router;
