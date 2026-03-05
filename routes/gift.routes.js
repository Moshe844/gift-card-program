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
    if (!phone || phone.length !== 10) return res.json({ status: "BAD_PHONE" });

    const gifts = await store.findAllByPhone(phone);
    if (!gifts || gifts.length === 0) return res.json({ status: "NOT_FOUND" });

    // Process each gift row separately (IMPORTANT: by ID, not by phone)
    const results = [];

    for (const gift of gifts) {
      const id = gift.id;
      const cardNum = String(gift.cardnum || "").trim();
      const last4 = cardNum.slice(-4);
      const amount = Number(gift.amount);

      if (!cardNum) {
        results.push({ status: "ERROR", last4: "????", message: "MISSING_CARDNUM" });
        continue;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        results.push({ status: "ERROR", last4, message: "BAD_AMOUNT" });
        continue;
      }

      const status = (gift.status || "").toUpperCase();
      const fundingStatus = (gift.funding_status || "").toUpperCase();

      // 1) Already active & funded -> just read balance and update THIS ROW ONLY
      if (status === "ACTIVE" && fundingStatus === "FUNDED") {
        const bal = await getGiftBalance(cardNum);
        const remaining = Number(bal?.xRemainingBalance || 0);

        await store.updateBalanceById(id, remaining);

        results.push({
          status: "ALREADY_ACTIVE",
          last4,
          balance: remaining
        });
        continue;
      }

      // 2) Active but not funded -> retry funding for THIS ROW ONLY
      if (status === "ACTIVE" && fundingStatus !== "FUNDED") {
        const issue = await issueFunds(cardNum, amount);

        if (!issue.ok) {
          await store.markActivatedNotFundedById(id, issue.fundingError);

          results.push({
            status: "ACTIVATED_NOT_FUNDED",
            last4,
            fundingError: issue.fundingError,
            fundingErrorCode: issue.fundingErrorCode
          });
          continue;
        }

        await store.markFundedById(id, issue.balance);

        results.push({
          status: "FUNDED_SUCCESSFULLY",
          last4,
          amount: amount.toFixed(2)
        });
        continue;
      }

      // 3) Inactive/new -> activate in Cardknox, then mark ACTIVE for THIS ROW ONLY, then fund
      await activateCard(cardNum);
      await store.activateById(id);

      const issue = await issueFunds(cardNum, amount);

      if (!issue.ok) {
        await store.markActivatedNotFundedById(id, issue.fundingError);

        results.push({
          status: "ACTIVATED_NOT_FUNDED",
          last4,
          fundingError: issue.fundingError,
          fundingErrorCode: issue.fundingErrorCode
        });
        continue;
      }

      await store.markFundedById(id, issue.balance);

      results.push({
        status: "ACTIVATED_AND_FUNDED",
        last4,
        amount: amount.toFixed(2)
      });
    }

    // If multiple cards, return multi result so IVR reads both
    if (results.length > 1) {
      return res.json({ status: "MULTI_CARD_RESULT", cards: results });
    }

    // Single-card behavior stays exactly the same as before
    return res.json(results[0]);

  } catch (err) {
    console.error("Unexpected error in activate-by-phone:", err);
    return res.json({ status: "ERROR", message: err.message });
  }
});

module.exports = router;