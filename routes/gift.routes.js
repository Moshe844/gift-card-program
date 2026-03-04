const express = require("express");
const store = require("../giftStore");
const {
  activateCard,
  issueFunds,
  getGiftBalance
} = require("../services/cardknox.service");

const router = express.Router();

function pickGiftForActivation(gifts) {
  // Prefer a card that is not active yet
  let g = gifts.find(x => (x.status || "").toUpperCase() !== "ACTIVE");
  if (g) return g;

  // Or active but not funded
  g = gifts.find(x => (x.funding_status || "").toUpperCase() !== "FUNDED");
  if (g) return g;

  // Else just take the newest
  return gifts[0];
}

router.post("/activate-by-phone", async (req, res) => {
  try {
    const phone = store.normalize(req.body.phone || "");
    if (!phone || phone.length !== 10) {
      return res.json({ status: "BAD_PHONE" });
    }

    // IMPORTANT: this returns an ARRAY
    const gifts = await store.findAllByPhone(phone);

    if (!gifts || gifts.length === 0) {
      return res.json({ status: "NOT_FOUND" });
    }

    const gift = pickGiftForActivation(gifts);

    const cardNum = String(gift.cardnum || "").trim();
    if (!cardNum) {
      console.error("Gift row missing cardnum:", gift);
      return res.json({ status: "ERROR", message: "MISSING_CARDNUM" });
    }

    const last4 = cardNum.slice(-4);
    const amount = Number(gift.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      console.error("Gift row bad amount:", gift);
      return res.json({ status: "ERROR", message: "BAD_AMOUNT" });
    }

    // -----------------------------
    // Already active & funded
    // -----------------------------
    if ((gift.status || "").toUpperCase() === "ACTIVE" &&
        (gift.funding_status || "").toUpperCase() === "FUNDED") {

      const bal = await getGiftBalance(cardNum);
      const remaining = Number(bal?.xRemainingBalance || 0);

      // NOTE: you may want to update balance by cardnum instead of phone
      await store.updateBalanceByPhone(phone, remaining);

      return res.json({
        status: "ALREADY_ACTIVE",
        fundingStatus: "FUNDED",
        last4,
        balance: remaining
      });
    }

    // -----------------------------
    // Already active, not funded (retry funding)
    // -----------------------------
    if ((gift.status || "").toUpperCase() === "ACTIVE" &&
        (gift.funding_status || "").toUpperCase() !== "FUNDED") {

      const issue = await issueFunds(cardNum, amount);

      if (!issue.ok) {
        // FIX: issue.error -> issue.fundingError
        await store.markActivatedNotFunded(phone, issue.fundingError);

        return res.json({
          status: "ACTIVATED_NOT_FUNDED",
          last4,
          fundingStatus: "NOT_FUNDED",
          fundingError: issue.fundingError,
          fundingErrorCode: issue.fundingErrorCode
        });
      }

      await store.markFunded(phone, issue.balance);

      return res.json({
        status: "FUNDED_SUCCESSFULLY",
        fundingStatus: "FUNDED",
        last4,
        amount: amount.toFixed(2)
      });
    }

    // -----------------------------
    // Inactive or new card: activate first
    // -----------------------------
    await activateCard(cardNum);

    // If you want activation per-row, you should ideally update by cardnum.
    // Keeping your current function for now:
    await store.activateByPhone(phone);

    const issue = await issueFunds(cardNum, amount);

    if (!issue.ok) {
      await store.markActivatedNotFunded(phone, issue.fundingError);

      return res.json({
        status: "ACTIVATED_NOT_FUNDED",
        last4,
        fundingError: issue.fundingError,
        fundingErrorCode: issue.fundingErrorCode
      });
    }

    await store.markFunded(phone, issue.balance);

    return res.json({
      status: "ACTIVATED_AND_FUNDED",
      last4,
      amount: amount.toFixed(2)
    });

  } catch (err) {
    console.error("Unexpected error in activate-by-phone:", err);
    return res.json({ status: "ERROR", message: err.message });
  }
});

module.exports = router;