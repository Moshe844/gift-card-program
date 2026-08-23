const store = require("../giftStore");
const operations = require("./giftOperations.service");

async function deactivateOneCard(phoneRaw, cardNumRaw) {
  const phone = store.normalize(phoneRaw);
  const cardNum = store.normalizeCardNum(cardNumRaw);

  if (phone.length !== 10 || !store.isValidCardNum(cardNum)) {
    return { phone, last4: cardNum.slice(-4), status: "FAILED", error: "INVALID_PHONE_OR_CARD" };
  }

  const gift = await store.findByPhoneAndCard(phone, cardNum);
  if (!gift) {
    return { phone, last4: cardNum.slice(-4), status: "FAILED", error: "EXACT_CARD_NOT_FOUND" };
  }

  try {
    return { phone, ...(await operations.deactivateById(gift.id)) };
  } catch (error) {
    return { phone, last4: cardNum.slice(-4), status: "FAILED", error: error.message };
  }
}

async function bulkDeactivate(cards) {
  const results = [];
  for (const card of cards) results.push(await deactivateOneCard(card.phone, card.cardNum));
  return results;
}

module.exports = { deactivateOneCard, bulkDeactivate };
