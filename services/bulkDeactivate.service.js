const {
  deactivateCard,
  redeemGiftBalance,
  getGiftBalance
} = require("./cardknox.service");

const store = require("../giftStore");

async function deactivateOneCard(phoneRaw, cardNumRaw) {
  const phone = store.normalize(phoneRaw);
  const cardNum = String(cardNumRaw || "").trim();

  if (!phone || phone.length !== 10) {
    return { phone: phoneRaw, cardNum, status: "FAILED", error: "INVALID_PHONE" };
  }
  if (!cardNum) {
    return { phone, cardNum, status: "FAILED", error: "MISSING_CARDNUM" };
  }

  let redeemedAmount = 0;

  try {
    // optional but recommended: ensure the DB row exists
    const gift = await store.findByPhone(phone);
    if (!gift) {
      return { phone, cardNum, status: "FAILED", error: "NOT_FOUND_IN_DB" };
    }

    // balance
    const bal = await getGiftBalance(cardNum);
    const remaining = Math.max(0, Number(bal.xRemainingBalance || 0));

    // redeem remainder
    if (remaining > 0) {
      const amt = Math.floor(remaining * 100) / 100; // safe 2-dec trunc
      await redeemGiftBalance(cardNum, amt);
      redeemedAmount = amt;
    }

    // deactivate
    await deactivateCard(cardNum);

    // DB update (verify it updates)
    const updated = await store.deactivate(phone);
    if (updated === 0) {
      return { phone, cardNum, status: "FAILED", error: "DB_UPDATE_0_ROWS" };
    }

    return { phone, cardNum, status: "DEACTIVATED", redeemedAmount };
  } catch (err) {
    return { phone, cardNum, status: "FAILED", error: err.message };
  }
}

async function bulkDeactivate(cards) {
  const results = [];
  for (const c of cards) {
    results.push(await deactivateOneCard(c.phone, c.cardNum));
  }
  return results;
}

module.exports = { bulkDeactivate };