const db = require("../db");
const store = require("../giftStore");
const gateway = require("./cardknox.service");

function statusOf(value) {
  return String(value || "").trim().toUpperCase();
}

function last4(cardNum) {
  return String(cardNum || "").slice(-4);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function createGiftOperations({ database = db, giftStore = store, cardGateway = gateway } = {}) {
  async function withLockedGift(id, work) {
    const giftId = Number(id);
    if (!Number.isSafeInteger(giftId) || giftId <= 0) {
      throw new TypeError("A valid gift id is required");
    }

    return database.withTransaction(async client => {
      const txStore = giftStore.createStore(client);
      const gift = await txStore.findByIdForUpdate(giftId);
      if (!gift) {
        const error = new Error("Gift card not found");
        error.code = "NOT_FOUND";
        throw error;
      }

      const cardNum = giftStore.normalizeCardNum(gift.cardnum);
      if (!giftStore.isValidCardNum(cardNum)) {
        throw new Error("Gift record has an invalid card number");
      }

      return work({ gift, cardNum, txStore });
    });
  }

  async function activateAndFundById(id) {
    return withLockedGift(id, async ({ gift, cardNum, txStore }) => {
      const amount = roundMoney(gift.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Gift record has an invalid funding amount");
      }

      const originalStatus = statusOf(gift.status);
      const fundingStatus = statusOf(gift.funding_status);

      if (originalStatus === "ACTIVE" && fundingStatus === "FUNDED") {
        const live = await cardGateway.getGiftBalance(cardNum);
        await txStore.updateBalanceByIdAndCard(gift.id, cardNum, live.balance);
        return { id: gift.id, last4: last4(cardNum), status: "ALREADY_ACTIVE", balance: live.balance };
      }

      if (originalStatus !== "ACTIVE") {
        await cardGateway.activateCard(cardNum);
        await txStore.activateByIdAndCard(gift.id, cardNum);
      }

      // A gateway success can outlive a process/DB failure. Checking the live
      // balance before issuing prevents that retry from loading funds twice.
      const liveBeforeIssue = await cardGateway.getGiftBalance(cardNum);
      if (liveBeforeIssue.balance > 0) {
        await txStore.markFundedByIdAndCard(gift.id, cardNum, liveBeforeIssue.balance);
        return {
          id: gift.id,
          last4: last4(cardNum),
          status: "RECONCILED_ALREADY_FUNDED",
          balance: liveBeforeIssue.balance
        };
      }

      try {
        const issued = await cardGateway.issueFunds(cardNum, amount);
        await txStore.markFundedByIdAndCard(gift.id, cardNum, issued.balance);
        return {
          id: gift.id,
          last4: last4(cardNum),
          status: originalStatus === "ACTIVE" ? "FUNDED_SUCCESSFULLY" : "ACTIVATED_AND_FUNDED",
          balance: issued.balance
        };
      } catch (error) {
        await txStore.markActivatedNotFundedByIdAndCard(gift.id, cardNum, error.message);
        return {
          id: gift.id,
          last4: last4(cardNum),
          status: "ACTIVATED_NOT_FUNDED",
          fundingError: error.message,
          fundingErrorCode: error.code || null
        };
      }
    });
  }

  async function activateAndFundByPhone(phoneRaw) {
    const phone = giftStore.normalize(phoneRaw);
    if (phone.length !== 10) return { status: "BAD_PHONE", cards: [] };

    const gifts = await giftStore.findAllByPhone(phone);
    if (gifts.length === 0) return { status: "NOT_FOUND", cards: [] };

    const cards = [];
    for (const gift of gifts) {
      if (!["PENDING", "ACTIVE"].includes(statusOf(gift.status))) {
        cards.push({
          id: gift.id,
          last4: last4(gift.cardnum),
          status: "UNAVAILABLE",
          message: `This card is not available for phone activation (${statusOf(gift.status) || "UNKNOWN"})`
        });
        continue;
      }
      try {
        cards.push(await activateAndFundById(gift.id));
      } catch (error) {
        cards.push({
          id: gift.id,
          last4: last4(gift.cardnum),
          status: "ERROR",
          message: error.message
        });
      }
    }

    return { status: "MULTI_CARD_RESULT", cards };
  }

  async function refreshBalanceById(id) {
    return withLockedGift(id, async ({ gift, cardNum, txStore }) => {
      const live = await cardGateway.getGiftBalance(cardNum);
      await txStore.updateBalanceByIdAndCard(gift.id, cardNum, live.balance);
      return { id: gift.id, last4: last4(cardNum), balance: live.balance };
    });
  }

  async function deactivateById(id) {
    return withLockedGift(id, async ({ gift, cardNum, txStore }) => {
      const live = await cardGateway.getGiftBalance(cardNum);
      const remaining = roundMoney(live.balance);

      if (remaining > 0) await cardGateway.redeemGiftBalance(cardNum, remaining);
      await cardGateway.deactivateCard(cardNum);
      await txStore.deactivateByIdAndCard(gift.id, cardNum);

      return {
        id: gift.id,
        last4: last4(cardNum),
        status: "DEACTIVATED",
        redeemedAmount: remaining
      };
    });
  }

  async function prepareForIvrById(id) {
    return withLockedGift(id, async ({ gift, cardNum, txStore }) => {
      const currentStatus = statusOf(gift.status);
      if (!["IMPORTING", "IMPORT_FAILED"].includes(currentStatus)) {
        return {
          id: gift.id,
          last4: last4(cardNum),
          status: "PREPARATION_SKIPPED",
          currentStatus
        };
      }

      try {
        let remaining = 0;
        try {
          const live = await cardGateway.getGiftBalance(cardNum);
          remaining = roundMoney(live.balance);
        } catch (error) {
          // Some gateways reject balance inquiries for an already-inactive card.
          // That state is already safe for preparation, so continue with zero.
          if (!/inactive|not active/i.test(error.message || "")) throw error;
        }

        if (remaining > 0) await cardGateway.redeemGiftBalance(cardNum, remaining);
        await cardGateway.deactivateCard(cardNum);
        await txStore.markReadyForIvrByIdAndCard(gift.id, cardNum);

        return {
          id: gift.id,
          last4: last4(cardNum),
          status: "READY_FOR_IVR",
          clearedAmount: remaining
        };
      } catch (error) {
        await txStore.markImportFailedByIdAndCard(gift.id, cardNum, error.message);
        return {
          id: gift.id,
          last4: last4(cardNum),
          status: "PREPARATION_FAILED",
          error: error.message
        };
      }
    });
  }

  return {
    activateAndFundById,
    activateAndFundByPhone,
    refreshBalanceById,
    deactivateById,
    prepareForIvrById
  };
}

module.exports = {
  createGiftOperations,
  ...createGiftOperations()
};
