const DEFAULT_ENDPOINT = "https://x1.cardknox.com/gatewayjson";

class GatewayError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
  }
}

function toAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new TypeError("Amount must be a positive number");
  }
  return (Math.round((amount + Number.EPSILON) * 100) / 100).toFixed(2);
}

function createCardknoxService({
  fetchImpl = global.fetch,
  apiKey = process.env.CARDKNOX_KEY,
  endpoint = process.env.CARDKNOX_URL || DEFAULT_ENDPOINT,
  timeoutMs = Number(process.env.CARDKNOX_TIMEOUT_MS || 15000)
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");

  async function request(command, fields = {}) {
    if (!apiKey) throw new GatewayError("Cardknox is not configured");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          xCommand: command,
          xVersion: "5.0.0",
          xSoftwareName: "SolaIVRGift",
          xSoftwareVersion: "2.0.0",
          xKey: apiKey,
          ...fields
        })
      });

      if (!response.ok) throw new GatewayError(`Cardknox HTTP ${response.status}`);

      const raw = await response.text();
      try {
        return JSON.parse(raw);
      } catch {
        throw new GatewayError("Cardknox returned an invalid response");
      }
    } catch (error) {
      if (error.name === "AbortError") throw new GatewayError("Cardknox request timed out");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function approved(result, fallback) {
    if (result?.xResult !== "A") {
      throw new GatewayError(result?.xError || fallback, result?.xErrorCode || null);
    }
    return result;
  }

  async function activateCard(cardNum) {
    const result = await request("gift:activate", { xCardNum: cardNum });
    const alreadyActive = result?.xErrorCode === "01675" || /already active/i.test(result?.xError || "");
    if (result?.xResult !== "A" && !alreadyActive) approved(result, "Activation failed");
    return { alreadyActive, reference: result?.xRefNum || null };
  }

  async function issueFunds(cardNum, amount) {
    const result = approved(
      await request("gift:issue", { xCardNum: cardNum, xAmount: toAmount(amount) }),
      "Funding failed"
    );
    const live = await getGiftBalance(cardNum);
    return { ok: true, balance: live.balance, reference: result?.xRefNum || null };
  }

  async function getGiftBalance(cardNum) {
    const result = approved(
      await request("gift:balance", { xCardNum: cardNum }),
      "Balance lookup failed"
    );
    const balance = Number(result.xRemainingBalance);
    if (!Number.isFinite(balance) || balance < 0) {
      throw new GatewayError("Cardknox returned an invalid balance");
    }
    return { balance, reference: result?.xRefNum || null };
  }

  async function deactivateCard(cardNum) {
    const result = await request("gift:deactivate", { xCardNum: cardNum });
    const alreadyInactive = /already inactive|inactive/i.test(result?.xError || "");
    if (result?.xResult !== "A" && !alreadyInactive) approved(result, "Deactivation failed");
    return { alreadyInactive, reference: result?.xRefNum || null };
  }

  async function redeemGiftBalance(cardNum, amount) {
    const result = approved(
      await request("gift:redeem", { xCardNum: cardNum, xAmount: toAmount(amount) }),
      "Redeem failed"
    );
    return { reference: result?.xRefNum || null };
  }

  return { activateCard, issueFunds, getGiftBalance, deactivateCard, redeemGiftBalance };
}

module.exports = {
  GatewayError,
  createCardknoxService,
  ...createCardknoxService()
};
