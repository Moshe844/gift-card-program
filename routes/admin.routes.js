const express = require("express");
const store = require("../giftStore");
const { BASE_URL } = require("../config");

const {
  deactivateCard,
  redeemGiftBalance,
  getGiftBalance
} = require("../services/cardknox.service");

const router = express.Router();

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
router.post("/login", (req, res) => {
  try {
    console.log("🔐 /admin/login called");
    console.log("Login attempt for user:", req.body?.username);

    const { username, pin } = req.body;

    if (!username || !pin) {
      return res.status(400).json({
        success: false,
        error: "Missing credentials"
      });
    }

    if (
      username === process.env.ADMIN_USERNAME &&
      pin === process.env.ADMIN_USER_PIN
    ) {
      return res.json({ success: true });
    }

    return res.status(401).json({
      success: false,
      error: "Invalid credentials"
    });
  } catch (err) {
    console.error("🔥 /admin/login error:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
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

module.exports = router;
