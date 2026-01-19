const express = require("express");
const store = require("./giftStore");
const path = require("path");
require("dotenv").config();

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function twimlEscape(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function getGiftBalance(cardNum) {
  const res = await fetch("https://x1.cardknox.com/gatewayjson", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      xCommand: "gift:balance",
      xVersion: "5.0.0",
      xSoftwareName: "SolaIVRGift",
      xSoftwareVersion: "1.0.0",
      xKey: process.env.CARDKNOX_KEY,
      xCardNum: cardNum
    
    })
  });

  const raw = await res.text();
  return JSON.parse(raw);
}

/**
 * ADMIN LOOKUP
 */
app.get("/admin/gift-by-phone", async (req, res) => {
  const phone = store.normalize(req.query.phone || "");
  if (!phone) return res.status(400).json({ error: "Phone number required" });

  const gift = await store.findByPhone(phone);

  if (!gift) {
    return res.status(404).json({
      found: false,
      message: "No gift card found for this phone number."
    });
  }

  const card = gift.cardnum;
  const maskedCard =
    card.length >= 8
      ? card.slice(0, 4) + "********" + card.slice(-4)
      : "********";

  res.json({
    found: true,
    phone: gift.phone,
    maskedCard,
    amount: gift.amount,
    balance: gift.balance,
    status: gift.status,
    activatedAt: gift.activated_at
  });
});

/**
 * IVR ENTRY
 */
app.post("/ivr", (req, res) => {
  res.type("text/xml");


  res.send(`
    <Response>
      <Gather numDigits="10" timeout="7" action="/ivr-verify" method="POST">
        <Say voice="Polly.Joey">Please enter your phone number including area code.</Say>
      </Gather>
    </Response>
  `);
});

/**
 * IVR VERIFY
 */
app.post("/ivr-verify", async (req, res) => {
  res.type("text/xml");

  try {
    const enteredPhone = store.normalize(req.body.Digits || "");
    const callerPhone = store.normalize(req.body.From || "");

    if (enteredPhone.length !== 10) {
      return res.send(`
        <Response>
          <Say voice="Polly.Joey">Please enter a valid ten digit phone number.</Say>
          <Redirect>/ivr</Redirect>
        </Response>
      `);
    }

    if (enteredPhone !== callerPhone) {
      return res.send(`
        <Response>
          <Say voice="Polly.Joey">Please call from the phone number associated with the gift card.</Say>
        </Response>
      `);
    }

    const BASE_URL = process.env.BASE_URL;;
    const apiRes = await fetch(`${BASE_URL}/activate-by-phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: enteredPhone })
    });

    const result = await apiRes.json();

    return res.send(`
      <Response>
        <Say voice="Polly.Joey">${twimlEscape(result.message)}</Say>
      </Response>
    `);

  } catch (err) {
    return res.send(`
      <Response>
        <Say voice="Polly.Joey">We are unable to complete your request.</Say>
      </Response>
    `);
  }
});

/**
 * ACTIVATE + FUND
 */
app.post("/activate-by-phone", async (req, res) => {
  const phone = store.normalize(req.body.phone || "");
  const gift = await store.findByPhone(phone);

  if (!gift) {
    return res.json({ message: "No gift card found for this phone number." });
  }

  const cardNum = gift.cardnum;

  if (!cardNum) {
    return res.json({ message: "Gift card record is missing card number." });
  }

  if (gift.status === "ACTIVE") {
    const bal = await getGiftBalance(cardNum);
    const balance = parseFloat(bal.xRemainingBalance || "0");
    await store.updateBalanceByPhone(phone, balance);

    const last4 = cardNum && cardNum.length >= 4
    ? cardNum.slice(-4)
    : "****";
    return res.json({
      message: `Your gift card ending in ${last4} is already active. Balance is $${balance.toFixed(2)}`
    });
  }

  const activate = await fetch("https://x1.cardknox.com/gatewayjson", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      xCommand: "gift:activate",
      xVersion: "5.0.0",
      xSoftwareName: "SolaIVRGift",
      xSoftwareVersion: "1.0.0",
      xKey: process.env.CARDKNOX_KEY,
      xCardNum: cardNum
    })
  }).then(r => r.json());

  if (activate.xResult !== "A") {
    // 👇 ADD THIS CASE
    if (activate.xErrorCode === "01675" || 
        activate.xError?.includes("already active")) {
  
      // Sync DB to reality
      await store.activateByPhone(phone);
  
      const bal = await getGiftBalance(cardNum);
      const balance = Number(bal.xRemainingBalance || 0);
      await store.updateBalanceByPhone(phone, balance);
      
      const last4 = cardNum && cardNum.length >= 4
        ? cardNum.slice(-4)
        : "****";
      return res.json({
        message: `Your gift card ending in ${last4} is already active. Your current balance is $${balance.toFixed(2)}`
      });
    }
  
    // Real failure
    return res.json({
      message: `Gift activation failed: ${activate.xError || "Unknown error"}`
    });
  }
  
  const amount = Number(gift.amount);

  if (Number.isNaN(amount)) {
    console.error("Invalid amount in DB:", gift.amount);
    return res.json({
      message: "Gift card amount is invalid. Please contact support."
    });
  }

  const issue = await fetch("https://x1.cardknox.com/gatewayjson", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      xCommand: "gift:issue",
      xVersion: "5.0.0",
      xSoftwareName: "SolaIVRGift",
      xSoftwareVersion: "1.0.0",
      xKey: process.env.CARDKNOX_KEY,
      xCardNum: cardNum,
      xAmount: amount.toFixed(2)

    })
  }).then(r => r.json());

  if (issue.xResult !== "A") {
    return res.json({ message: "Funding failed." });
  }

  const bal = await getGiftBalance(cardNum);
  const balance = parseFloat(bal.xRemainingBalance || gift.amount);

  await store.activateByPhone(phone);
  await store.markFunded(phone, balance);

  const last4 = cardNum && cardNum.length >= 4
    ? cardNum.slice(-4)
    : "****";
  res.json({
    message: `Your gift card ending in ${last4} has been activated and loaded with $${gift.amount}`
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

