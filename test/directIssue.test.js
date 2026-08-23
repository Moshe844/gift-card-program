const test = require("node:test");
const assert = require("node:assert/strict");
const { createDirectIssueService } = require("../services/directIssue.service");

function harness(existingGift = null) {
  let gift = existingGift ? { ...existingGift } : null;
  const calls = [];
  const giftStore = {
    normalizeCardNum: value => String(value || "").trim(),
    isValidCardNum: value => /^\d{12,19}$/.test(value),
    async findByCardNum() { return gift; },
    async insertGift({ phone, cardNum, amount }) {
      calls.push({ type: "insert", phone, cardNum, amount });
      gift = { id: 11, phone, cardnum: cardNum, amount, status: "IMPORTING" };
      return gift;
    }
  };
  const giftOperations = {
    async prepareForIvrById(id) {
      calls.push({ type: "prepare", id });
      gift.status = "PENDING";
      return { status: "READY_FOR_IVR" };
    },
    async activateAndFundById(id) {
      calls.push({ type: "issue", id });
      return { status: "ACTIVATED_AND_FUNDED", last4: gift.cardnum.slice(-4), balance: Number(gift.amount) };
    }
  };
  return { service: createDirectIssueService({ giftStore, giftOperations }), calls };
}

test("bulk-capable direct issue stores no phone and prepares before funding", async () => {
  const h = harness();
  const result = await h.service.issue("1111111111111111", 80);

  assert.equal(result.created, true);
  assert.deepEqual(h.calls.map(call => call.type), ["insert", "prepare", "issue"]);
  assert.equal(h.calls[0].phone, null);
});

test("direct issue rejects a card owned by a phone workflow", async () => {
  const h = harness({ id: 12, phone: "5550107000", cardnum: "2222222222222222", amount: 40, status: "PENDING" });

  await assert.rejects(
    () => h.service.issue("2222222222222222", 40),
    error => error.code === "PHONE_CARD_CONFLICT" && error.httpStatus === 409
  );
  assert.equal(h.calls.length, 0);
});

test("direct issue retries only the same amount for an existing phone-less card", async () => {
  const h = harness({ id: 13, phone: null, cardnum: "3333333333333333", amount: 25, status: "ACTIVE" });

  await assert.rejects(
    () => h.service.issue("3333333333333333", 30),
    error => error.code === "AMOUNT_CONFLICT"
  );
  assert.equal(h.calls.length, 0);
});
