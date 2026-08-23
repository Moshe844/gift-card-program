const test = require("node:test");
const assert = require("node:assert/strict");
const storeModule = require("../giftStore");

test("all mutations include both row id and card number", async () => {
  const statements = [];
  const store = storeModule.createStore({
    async query(text, params) {
      statements.push({ text: text.replace(/\s+/g, " ").trim(), params });
      return { rowCount: 1, rows: [{ id: params[0], cardnum: params[1], balance: params[2] }] };
    }
  });

  await store.activateByIdAndCard(7, "7777777777777777");
  await store.updateBalanceByIdAndCard(7, "7777777777777777", 12);
  await store.markFundedByIdAndCard(7, "7777777777777777", 12);
  await store.markActivatedNotFundedByIdAndCard(7, "7777777777777777", "failed");
  await store.deactivateByIdAndCard(7, "7777777777777777");
  await store.markReadyForIvrByIdAndCard(7, "7777777777777777");
  await store.markImportFailedByIdAndCard(7, "7777777777777777", "failed");

  for (const statement of statements) {
    assert.match(statement.text, /WHERE id = \$1 AND cardnum = \$2/);
    assert.doesNotMatch(statement.text, /WHERE phone/);
  }
  assert.equal("deactivateAllByPhone" in storeModule, false);
});

test("imports conflict on card number, not phone", async () => {
  let sql;
  const store = storeModule.createStore({
    async query(text) {
      sql = text.replace(/\s+/g, " ");
      return { rowCount: 1, rows: [{ id: 1 }] };
    }
  });
  await store.insertGift({ phone: "5550101000", cardNum: "1111111111111111", amount: 25 });
  assert.match(sql, /ON CONFLICT \(cardnum\)/);
  assert.doesNotMatch(sql, /ON CONFLICT \(phone\)/);
});

test("a phone-less direct gift is stored as NULL, never as an empty phone", async () => {
  let params;
  const store = storeModule.createStore({
    async query(_text, values) {
      params = values;
      return { rowCount: 1, rows: [{ id: 2 }] };
    }
  });

  await store.insertGift({ phone: null, cardNum: "2222222222222222", amount: 50 });

  assert.equal(params[0], null);
});

test("phone and card normalization accept common spreadsheet formatting", () => {
  assert.equal(storeModule.normalize("3476756700'"), "3476756700");
  assert.equal(storeModule.normalize("+1 (347) 675-6700"), "3476756700");
  assert.equal(storeModule.normalizeCardNum("'1234 5678-9012 3456'"), "1234567890123456");
});
