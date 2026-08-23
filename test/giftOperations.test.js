const test = require("node:test");
const assert = require("node:assert/strict");
const { createGiftOperations } = require("../services/giftOperations.service");

function harness(rows, balances = {}) {
  const gifts = new Map(rows.map(row => [row.id, { ...row }]));
  const writes = [];
  const gatewayCalls = [];

  const txStore = {
    async findByIdForUpdate(id) { return gifts.get(id) || null; },
    async updateBalanceByIdAndCard(id, cardNum, balance) {
      assert.equal(gifts.get(id).cardnum, cardNum);
      writes.push({ type: "balance", id, cardNum, balance });
      gifts.get(id).balance = balance;
      return gifts.get(id);
    },
    async activateByIdAndCard(id, cardNum) {
      assert.equal(gifts.get(id).cardnum, cardNum);
      writes.push({ type: "activate", id, cardNum });
      gifts.get(id).status = "ACTIVE";
      return gifts.get(id);
    },
    async markFundedByIdAndCard(id, cardNum, balance) {
      assert.equal(gifts.get(id).cardnum, cardNum);
      writes.push({ type: "funded", id, cardNum, balance });
      Object.assign(gifts.get(id), { status: "ACTIVE", funding_status: "FUNDED", balance });
      return gifts.get(id);
    },
    async markActivatedNotFundedByIdAndCard(id, cardNum) {
      assert.equal(gifts.get(id).cardnum, cardNum);
      writes.push({ type: "not-funded", id, cardNum });
      return gifts.get(id);
    },
    async deactivateByIdAndCard(id, cardNum) {
      assert.equal(gifts.get(id).cardnum, cardNum);
      writes.push({ type: "deactivate", id, cardNum });
      Object.assign(gifts.get(id), { status: "DEACTIVATED", balance: 0 });
      return gifts.get(id);
    }
  };

  const giftStore = {
    normalize: value => String(value).replace(/\D/g, ""),
    normalizeCardNum: value => String(value || "").trim(),
    isValidCardNum: value => /^\d{12,19}$/.test(value),
    createStore: () => txStore,
    findAllByPhone: async phone => [...gifts.values()].filter(row => row.phone === phone)
  };

  const cardGateway = {
    async activateCard(cardNum) { gatewayCalls.push({ type: "activate", cardNum }); },
    async getGiftBalance(cardNum) {
      gatewayCalls.push({ type: "balance", cardNum });
      return { balance: balances[cardNum] || 0 };
    },
    async issueFunds(cardNum, amount) {
      gatewayCalls.push({ type: "issue", cardNum, amount });
      return { balance: amount };
    },
    async redeemGiftBalance(cardNum, amount) { gatewayCalls.push({ type: "redeem", cardNum, amount }); },
    async deactivateCard(cardNum) { gatewayCalls.push({ type: "deactivate", cardNum }); }
  };

  const database = { withTransaction: work => work({ query() {} }) };
  return {
    operations: createGiftOperations({ database, giftStore, cardGateway }),
    gifts,
    writes,
    gatewayCalls
  };
}

test("multi-card activation keeps gateway and database writes on each exact card", async () => {
  const cardA = "1111111111111111";
  const cardB = "2222222222222222";
  const h = harness([
    { id: 1, phone: "5550101000", cardnum: cardA, amount: 25, status: "PENDING", funding_status: "NOT_FUNDED" },
    { id: 2, phone: "5550101000", cardnum: cardB, amount: 50, status: "ACTIVE", funding_status: "FUNDED" }
  ], { [cardB]: 17.25 });

  const result = await h.operations.activateAndFundByPhone("5550101000");

  assert.equal(result.cards.length, 2);
  assert.deepEqual(h.gatewayCalls.filter(call => call.type === "issue"), [
    { type: "issue", cardNum: cardA, amount: 25 }
  ]);
  assert.ok(h.writes.every(write => h.gifts.get(write.id).cardnum === write.cardNum));
  assert.equal(h.gifts.get(1).balance, 25);
  assert.equal(h.gifts.get(2).balance, 17.25);
});

test("retry reconciles a live funded balance instead of issuing funds again", async () => {
  const card = "3333333333333333";
  const h = harness([
    { id: 3, phone: "5550102000", cardnum: card, amount: 100, status: "ACTIVE", funding_status: "NOT_FUNDED" }
  ], { [card]: 82.5 });

  const result = await h.operations.activateAndFundById(3);

  assert.equal(result.status, "RECONCILED_ALREADY_FUNDED");
  assert.equal(h.gatewayCalls.some(call => call.type === "issue"), false);
  assert.equal(h.gifts.get(3).balance, 82.5);
});

test("deactivating one card never changes a sibling card with the same phone", async () => {
  const cardA = "4444444444444444";
  const cardB = "5555555555555555";
  const h = harness([
    { id: 4, phone: "5550103000", cardnum: cardA, amount: 20, balance: 10, status: "ACTIVE", funding_status: "FUNDED" },
    { id: 5, phone: "5550103000", cardnum: cardB, amount: 30, balance: 30, status: "ACTIVE", funding_status: "FUNDED" }
  ], { [cardA]: 10, [cardB]: 30 });

  await h.operations.deactivateById(4);

  assert.equal(h.gifts.get(4).status, "DEACTIVATED");
  assert.equal(h.gifts.get(5).status, "ACTIVE");
  assert.equal(h.gifts.get(5).balance, 30);
  assert.deepEqual(h.writes.filter(write => write.type === "deactivate").map(write => write.id), [4]);
});
