const store = require("../giftStore");
const operations = require("./giftOperations.service");

function issueError(code, message, httpStatus, giftId = null) {
  const error = new Error(message);
  error.code = code;
  error.httpStatus = httpStatus;
  error.giftId = giftId;
  return error;
}

function createDirectIssueService({ giftStore = store, giftOperations = operations } = {}) {
  async function issue(cardNumRaw, amountRaw) {
    const cardNum = giftStore.normalizeCardNum(cardNumRaw);
    const amount = Number(amountRaw);

    if (!giftStore.isValidCardNum(cardNum)) {
      throw issueError("INVALID_CARD_NUMBER", "Card number must contain 12 to 19 digits", 400);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw issueError("INVALID_AMOUNT", "Amount must be greater than zero", 400);
    }

    let gift = await giftStore.findByCardNum(cardNum);
    let created = false;

    if (!gift) {
      gift = await giftStore.insertGift({ phone: null, cardNum, amount });
      created = Boolean(gift);
      // A concurrent request may have inserted the exact card first. Reload it
      // and apply the same ownership/amount checks instead of issuing twice.
      if (!gift) gift = await giftStore.findByCardNum(cardNum);
    }

    if (!gift) {
      throw issueError("CARD_INSERT_FAILED", "The card could not be saved", 409);
    }
    if (gift.phone) {
      throw issueError(
        "PHONE_CARD_CONFLICT",
        "That card already belongs to a phone-based gift. Use the phone lookup instead.",
        409,
        gift.id
      );
    }
    if (Number(gift.amount) !== amount) {
      throw issueError(
        "AMOUNT_CONFLICT",
        `That phone-less card already exists with a $${Number(gift.amount).toFixed(2)} issue amount.`,
        409,
        gift.id
      );
    }

    const currentStatus = String(gift.status || "").toUpperCase();
    if (currentStatus === "DEACTIVATED") {
      throw issueError(
        "PREVIOUSLY_DEACTIVATED",
        "That card was previously deactivated. It cannot be reissued from this workflow.",
        409,
        gift.id
      );
    }

    if (["IMPORTING", "IMPORT_FAILED"].includes(currentStatus)) {
      const preparation = await giftOperations.prepareForIvrById(gift.id);
      const safelyAdvancedByAnotherRequest =
        preparation.status === "PREPARATION_SKIPPED" &&
        ["PENDING", "ACTIVE"].includes(preparation.currentStatus);
      if (preparation.status !== "READY_FOR_IVR" && !safelyAdvancedByAnotherRequest) {
        throw issueError(
          "PREPARATION_FAILED",
          "The card was saved but could not be safely cleared and prepared. Retry the same card and amount.",
          502,
          gift.id
        );
      }
    }

    const issuance = await giftOperations.activateAndFundById(gift.id);
    if (issuance.status === "ACTIVATED_NOT_FUNDED") {
      throw issueError(
        "FUNDING_NOT_CONFIRMED",
        "The card was activated, but Cardknox did not confirm the funds. Retry the same card and amount; duplicate funding is prevented.",
        502,
        gift.id
      );
    }

    return { giftId: gift.id, cardNum, amount, created, issuance };
  }

  return { issue };
}

module.exports = {
  createDirectIssueService,
  ...createDirectIssueService()
};
