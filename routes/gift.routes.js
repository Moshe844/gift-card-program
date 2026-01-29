const express = require("express");
const store = require("../giftStore");
const {
  activateCard,
  issueFunds,
  getGiftBalance
} = require("../services/cardknox.service");

const router = express.Router();

router.post("/activate-by-phone", async (req, res) => {
    try {
        const phone = store.normalize(req.body.phone || "");
        const gift = await store.findByPhone(phone);
    
        if (!gift) return res.json({ status: "NOT_FOUND" });
    
        const cardNum = gift.cardnum;
        const last4 = cardNum.slice(-4);
        const amount = Number(gift.amount);
    
        // -----------------------------
        // Already active & funded
        // -----------------------------
        if (gift.status === "ACTIVE" && gift.funding_status === "FUNDED") {
          const bal = await getGiftBalance(cardNum);
          await store.updateBalanceByPhone(phone, bal.xRemainingBalance);
    
          return res.json({
            status: "ALREADY_ACTIVE",
            fundingStatus: "FUNDED",
            last4,
            balance: bal.xRemainingBalance
          });
        }
    
        // -----------------------------
        // Already active, not funded (retry funding)
        // -----------------------------
        if (gift.status === "ACTIVE" && gift.funding_status !== "FUNDED") {
    
          // if(!gift.activated_at) {
          //   await store.activateByPhone(phone);
          // }
          const issue = await issueFunds(cardNum, amount);
    
          if (!issue.ok) {
            await store.markActivatedNotFunded(phone, issue.error);
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
        return res.json({ status: "ERROR" });
      }
    });
    
  

module.exports = router;
