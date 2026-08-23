const test = require("node:test");
const assert = require("node:assert/strict");
const { createCardknoxService, GatewayError } = require("../services/cardknox.service");

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

test("funding does not opt into duplicate transactions", async () => {
  const bodies = [];
  const replies = [
    { xResult: "A", xRefNum: "fund-1" },
    { xResult: "A", xRemainingBalance: "25.00" }
  ];
  const service = createCardknoxService({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return response(replies.shift());
    }
  });

  const result = await service.issueFunds("1111111111111111", 25);

  assert.equal(result.balance, 25);
  assert.equal(bodies[0].xCommand, "gift:issue");
  assert.equal(Object.hasOwn(bodies[0], "xAllowDuplicate"), false);
});

test("a rejected balance response is never converted to zero", async () => {
  const service = createCardknoxService({
    apiKey: "test-key",
    fetchImpl: async () => response({ xResult: "E", xError: "Lookup failed" })
  });
  await assert.rejects(() => service.getGiftBalance("1111111111111111"), GatewayError);
});

test("already-active activation response is safely reconciled", async () => {
  const service = createCardknoxService({
    apiKey: "test-key",
    fetchImpl: async () => response({ xResult: "E", xErrorCode: "01674", xError: "Card Already Active" })
  });
  assert.deepEqual(await service.activateCard("1111111111111111"), { alreadyActive: true, reference: null });
});

test("a valid inactive gift card is accepted only by its explicit Cardknox code", async () => {
  const service = createCardknoxService({
    apiKey: "test-key",
    fetchImpl: async () => response({ xResult: "E", xErrorCode: "01673", xError: "Inactive Gift Card" })
  });

  assert.deepEqual(await service.validateGiftCard("1111111111111111"), {
    valid: true,
    active: false,
    balance: 0,
    reference: null
  });
});

test("an invalid card is rejected even if its message contains the word inactive", async () => {
  const service = createCardknoxService({
    apiKey: "test-key",
    fetchImpl: async () => response({ xResult: "E", xErrorCode: "01112", xError: "Invalid inactive gift card" })
  });

  await assert.rejects(
    () => service.validateGiftCard("1111111111111111"),
    error => error instanceof GatewayError && error.code === "01112"
  );
});

test("deactivation accepts only Cardknox's already-inactive code", async () => {
  const validInactive = createCardknoxService({
    apiKey: "test-key",
    fetchImpl: async () => response({ xResult: "E", xErrorCode: "01675", xError: "Card already inactive" })
  });
  assert.equal((await validInactive.deactivateCard("1111111111111111")).alreadyInactive, true);

  const invalid = createCardknoxService({
    apiKey: "test-key",
    fetchImpl: async () => response({ xResult: "E", xErrorCode: "01112", xError: "Invalid inactive gift card" })
  });
  await assert.rejects(() => invalid.deactivateCard("1111111111111111"), GatewayError);
});
