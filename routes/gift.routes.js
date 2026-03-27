const express = require("express");
const store = require("../giftStore");
const {
  activateCard,
  issueFunds,
  getGiftBalance
} = require("../services/cardknox.service");

const router = express.Router();

function normalizeStatus(value) {
  return String(value || "").toUpperCase().trim();
}

router.post("/activate-by-phone", async (req, res) => {
  try {
    const phone = store.normalize(req.body.phone || "");
    console.log("📞 [ACTIVATE] Incoming phone:", req.body.phone, "→ normalized:", phone);

    if (!phone || phone.length !== 10) {
      console.log("❌ BAD_PHONE");
      return res.json({ status: "BAD_PHONE" });
    }

    const gifts = await store.findAllByPhone(phone);
    console.log("📦 Found gifts:", gifts.length);

    if (!gifts || gifts.length === 0) {
      console.log("❌ NOT_FOUND");
      return res.json({ status: "NOT_FOUND" });
    }

    const results = [];

    for (const gift of gifts) {
      const id = gift.id;
      const cardNum = String(gift.cardnum || "").trim();
      const last4 = cardNum.slice(-4);
      const amount = Number(gift.amount);
      const status = normalizeStatus(gift.status);
      const fundingStatus = normalizeStatus(gift.funding_status);

      console.log("➡️ Processing card:", {
        id,
        last4,
        status,
        fundingStatus,
        amount
      });

      try {
        if (!cardNum) {
          console.log("❌ Missing cardnum for id:", id);
          results.push({ id, last4: "????", status: "ERROR", message: "MISSING_CARDNUM" });
          continue;
        }

        if (!Number.isFinite(amount) || amount <= 0) {
          console.log("❌ Bad amount for id:", id);
          results.push({ id, last4, status: "ERROR", message: "BAD_AMOUNT" });
          continue;
        }

        if (status === "ACTIVE" && fundingStatus === "FUNDED") {
          console.log("🔍 Fetching balance for:", last4);

          const bal = await getGiftBalance(cardNum);
          const remaining = Number(bal?.xRemainingBalance || 0);

          console.log("💰 Balance fetched:", remaining);

           const fresh = await store.findByIdAndCard(id, cardNum);
          if (!fresh) {
            throw new Error(
              `Row/card mismatch before funded write: id=${id}, card ending ${last4}`
            );
          }

          await store.updateBalanceByIdAndCard(id, cardNum, remaining);

          results.push({ id, last4, status: "ALREADY_ACTIVE", balance: remaining });
          continue;
        }

        if (status === "ACTIVE" && fundingStatus !== "FUNDED") {
          console.log("💳 Funding existing active card:", last4);

          const issue = await issueFunds(cardNum, amount);

          if (!issue.ok) {
            console.log("❌ Funding failed:", issue);

            const fresh = await store.findByIdAndCard(id, cardNum);
            if (!fresh) {
              throw new Error(
                `Row/card mismatch before not-funded write: id=${id}, card ending ${last4}`
              );
            }
            await store.markActivatedNotFundedByIdAndCard(id, cardNum, issue.fundingError);

            results.push({
              id,
              last4,
              status: "ACTIVATED_NOT_FUNDED",
              fundingError: issue.fundingError
            });
            continue;
          }

          console.log("✅ Funded:", issue.balance);
          await store.markFundedByIdAndCard(id, cardNum, issue.balance);

          results.push({
            id,
            last4,
            status: "FUNDED_SUCCESSFULLY",
            balance: issue.balance
          });
          continue;
        }

        console.log("🆕 Activating new card:", last4);

        await activateCard(cardNum);
          let fresh = await store.findByIdAndCard(id, cardNum);
        if (!fresh) {
          throw new Error(
            `Row/card mismatch before activate write: id=${id}, card ending ${last4}`
          );
        }

        await store.activateByIdAndCard(id, cardNum);

        const issue = await issueFunds(cardNum, amount);

        if (!issue.ok) {
          console.log("❌ Activation funding failed:", issue);
           fresh = await store.findByIdAndCard(id, cardNum);
          if (!fresh) {
            throw new Error(
              `Row/card mismatch before activation-not-funded write: id=${id}, card ending ${last4}`
            );
          }
          await store.markActivatedNotFundedByIdAndCard(id, cardNum, issue.fundingError);

          results.push({
            id,
            last4,
            status: "ACTIVATED_NOT_FUNDED"
          });
          continue;
        }

        console.log("✅ Activated + funded:", issue.balance);

         fresh = await store.findByIdAndCard(id, cardNum);
        if (!fresh) {
          throw new Error(
            `Row/card mismatch before activated-funded write: id=${id}, card ending ${last4}`
          );
        }
        await store.markFundedByIdAndCard(id, cardNum, issue.balance);

        results.push({
          id,
          last4,
          status: "ACTIVATED_AND_FUNDED",
          balance: issue.balance
        });

      } catch (cardErr) {
        console.log("🔥 Card error:", cardErr);
        results.push({
          id,
          last4,
          status: "ERROR",
          message: cardErr.message
        });
      }
    }

    console.log("📤 FINAL RESULT:", JSON.stringify(results, null, 2));

    return res.json({
      status: "MULTI_CARD_RESULT",
      cards: results
    });

  } catch (err) {
    console.error("🔥 FATAL ERROR:", err);
    return res.json({ status: "ERROR", message: err.message });
  }
});

module.exports = router;