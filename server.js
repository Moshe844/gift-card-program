const express = require("express");
const store = require("./giftStore");
const {logEvent} = require("./activityLogger");
const path = require("path");
require("dotenv").config();

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
})
// app.use((req, res, next) => {
//   if (req.path.endsWith(".mp3")) {
//     res.setHeader("Content-Type", "audio/mpeg");
//   }
//   next();
// });

const MAX_PHONE_RETRIES = 3;
const MAX_SECURITY_RETRIES = 2;

// top of server.js
const ivrRetries = new Map();

function getRetry(callSid, type) {
  const key = `${callSid}:${type}`;
  return ivrRetries.get(key) || 0;
}

function incrementRetry(callSid, type) {
  const key = `${callSid}:${type}`;
  const count = getRetry(callSid, type) + 1;
  ivrRetries.set(key, count);
  return count;
}

function clearRetries(callSid) {
  for (const key of ivrRetries.keys()) {
    if (key.startsWith(callSid)) ivrRetries.delete(key);
  }
}



function twimlEscape(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function splitAmount(amount) {
  const [dollars, cents] = Number(amount)
    .toFixed(2)
    .split(".");
  return { dollars, cents };
}

function speakAmount(amount) {
  const { dollars, cents } = splitAmount(amount);

  // Convert number strings to integers
  const dollarNum = parseInt(dollars, 10);
  const centNum = parseInt(cents, 10);

  const spokenDollars = numberToWords(dollarNum);

  if (centNum === 0) {
    return `${spokenDollars} dollars`;
  }

  const spokenCents = numberToWords(centNum);
  return `${spokenDollars} dollars and ${spokenCents} cents`;
}

// Helper: convert numbers 0–999 to words
function numberToWords(num) {
  const ones = ["zero","one","two","three","four","five","six","seven","eight","nine"];
  const teens = ["ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
  const tens = ["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];

  if (num < 10) return ones[num];
  if (num >= 10 && num < 20) return teens[num-10];
  if (num < 100) {
    const t = Math.floor(num/10);
    const o = num % 10;
    return o === 0 ? tens[t] : `${tens[t]} ${ones[o]}`;
  }
  if (num < 1000) {
    const h = Math.floor(num/100);
    const remainder = num % 100;
    return remainder === 0 ? `${ones[h]} hundred` : `${ones[h]} hundred ${numberToWords(remainder)}`;
  }
  return num.toString(); // fallback for 1000+
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

  const fundingStatus = gift.funding_status || "UNKNOWN";

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
    fundingStatus,
    activatedAt: gift.activated_at
  });
});

app.post("/admin/unmask-card", async (req, res) => {
  const { pin, phone } = req.body;

  if (pin !== process.env.ADMIN_PIN) {
    return res.status(403).json({ error: "Invalid PIN" });
  }

  const normalizedPhone = store.normalize(phone || "");
  const gift = await store.findByPhone(normalizedPhone);

  if (!gift || !gift.cardnum) {
    return res.status(404).json({ error: "Gift card not found" });
  }

  res.json({ fullCard: gift.cardnum });
});

const BASE_URL = "https://gift-card-program.onrender.com";
const BASE_URL_LOCAL = "http://localhost:3000";
/**
 * IVR ENTRY
 */
app.all("/ivr", (req, res) => {
  res.type("text/xml");
  res.send(`
    <Response>
      <Gather
        input="dtmf"
        numDigits="10"
        timeout="3"
        finishOnKey="#"
        action="/ivr-verify"
        method="POST"
      >
      <Say voice="Polly.Matthew">Thanks for calling the Yad V'Ezer gift card activation line.</Say>
        <Say voice="Polly.Matthew">
          Welcome. Please enter your phone number including area code.
        </Say>
      </Gather>

      <Redirect>/ivr</Redirect>
    </Response>
  `);
});



// app.all("/ivr-language", (req, res) => {
//   res.type("text/xml");

//   const digits = req.body.Digits;

//   if (digits === "1") {
//     return res.send(`
//       <Response>
//         <Redirect>/ivr-en</Redirect>
//       </Response>
//     `);
//   }

//   return res.send(`
//     <Response>
//       <Redirect>/ivr-yi</Redirect>
//     </Response>
//   `);
// });


// app.all("/ivr-yi", (req, res) => {
//   res.type("text/xml");

//   const attempt = parseInt(req.query.attempt || "1", 10);

//   // Max attempts reached → disconnect
//   if (attempt > 2) {
//     return res.send(`
//       <Response>
//         <Say voice="Polly.Joey">We did not receive any input. Goodbye.</Say>
//         <Hangup/>
//       </Response>
//     `);
//   }

//   res.send(`
//     <Response>
//       <Gather 
//         input="dtmf"
//         bargeIn="false"
//         numDigits="10"
//         timeout="3"
//         finishOnKey="#"
//         action="/ivr-verify?lang=yi"
//         method="POST"
//       >
//         <Play>${BASE_URL}/audio/yi/entered_phone.mp3</Play>
//       </Gather>

//       <!-- No input → retry with incremented attempt -->
//       <Redirect>/ivr-yi?attempt=${attempt + 1}</Redirect>
//     </Response>
//   `);
// });



// app.all("/ivr-en", (req, res) => {
//   res.type("text/xml");

//   const attempt = parseInt(req.query.attempt || "1", 10);

//   if (attempt > 2) {
//     return res.send(`
//       <Response>
//         <Say voice="Polly.Joey">
//           We did not receive any input. Goodbye.
//         </Say>
//         <Hangup/>
//       </Response>
//     `);
//   }

//   res.send(`
//     <Response>
//       <Gather
//         input="dtmf"
//         numDigits="10"
//         timeout="3"
//         finishOnKey="#"
//         action="/ivr-verify?lang=en"
//         method="POST"
//       >
//         <Say voice="Polly.Joey">
//           Please enter your phone number including area code.
//         </Say>
//       </Gather>

//       <Redirect>/ivr-en?attempt=${attempt + 1}</Redirect>
//     </Response>
//   `);
// });



/**
 * IVR VERIFY
 */

/**
 * ===============================
 * IVR VERIFY (WITH YIDDISH + ENGLISH)
 * ===============================
 */
app.post("/ivr-verify", async (req, res) => {

  const callSid = req.body.CallSid;
  res.type("text/xml");

  try {
    const enteredPhone = store.normalize(req.body.Digits || "");
    const callerPhone  = store.normalize(req.body.From || "");
   

    // -----------------------------
    // INVALID PHONE
    // -----------------------------
    if (enteredPhone.length !== 10) {
      const retries = incrementRetry(callSid, "PHONE");
      if (retries >= MAX_PHONE_RETRIES) {
        clearRetries(callSid);
        return res.send(`
          <Response>
            <Say voice="Polly.Joey">
              You have exceeded the maximum number of attempts. Goodbye.
            </Say>
            <Hangup/>
          </Response>
        `);
      }

      return res.send(`
        <Response>
          <Say voice="Polly.Joey">
            Please enter a valid ten digit phone number.
          </Say>
          <Redirect>/ivr</Redirect>
        </Response>
      `);
    }

    // -----------------------------
    // SECURITY CHECK
    // -----------------------------
    if (enteredPhone !== callerPhone) {
      const retries = incrementRetry(callSid, "SECURITY");

      if (retries >= MAX_SECURITY_RETRIES) {
        clearRetries(callSid);
        return res.send(`
          <Response>
            <Say voice="Polly.Joey">
              This call cannot be completed from this phone number. Goodbye.
            </Say>
            <Hangup/>
          </Response>
        `);
      }

      return res.send(`
        <Response>
          <Say voice="Polly.Joey">
            Please call from the phone number associated with the gift card.
          </Say>
          <Redirect>/ivr</Redirect>
        </Response>
      `);
    }

    // -----------------------------
    // ACTIVATE / FUND
    // -----------------------------
    const apiRes = await fetch(`${BASE_URL_LOCAL}/activate-by-phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: enteredPhone })
    });

    const result = await apiRes.json();
    clearRetries(callSid);

    // -----------------------------
    // ACTIVATED + FUNDED (FIRST CALL)
    // -----------------------------
    if (result.status === "ACTIVATED_AND_FUNDED") {
      clearRetries(callSid);
     return res.send(`
        <Response>
          <Say voice="Polly.Joey">
            Your gift card ending in ${result.last4}
            has been activated successfully and loaded with
            ${speakAmount(result.amount)}.
          </Say>
        </Response>
      `);
    }

    // -----------------------------
    // FUNDED ON RETRY
    // -----------------------------
    if (result.status === "FUNDED_SUCCESSFULLY") {
      return res.send(`
        <Response>
          <Say voice="Polly.Joey">
            ${speakAmount(result.amount)} has been funded successfully.
          </Say>
        </Response>
      `);
    }

    // -----------------------------
    // ACTIVATED BUT NOT FUNDED
    // -----------------------------
    if (result.status === "ACTIVATED_NOT_FUNDED") {
      let errorText = "";
      if (result.fundingError) {
        errorText = ` Reason: ${twimlEscape(result.fundingError)}.`;
      }

      return res.send(`
        <Response>
          <Say voice="Polly.Joey">
            Your gift card was activated successfully.
            However, funding could not be completed.${errorText}
            Please call back shortly. Goodbye.
          </Say>
          <Hangup/>
        </Response>
      `);
    }
    
    // -----------------------------
    // ALREADY ACTIVE
    // -----------------------------
    if (result.status === "ALREADY_ACTIVE") {
      return res.send(`
        <Response>
          <Say voice="Polly.Joey">
            Your gift card ending in${result.last4.split("").join(" ")} is already active.
            Your current balance is ${speakAmount(result.balance)}.
          </Say>
        </Response>
      `);
    }

    console.error("Unhandled gift card status:", result);

    const status = result?.status || "UNKNOWN";

    return res.send(`
      <Response>
        <Say voice="Polly.Joey">
          We could not process your request due to an unexpected system response.
          Error code ${status.replace(/_/g, " ")}.
        </Say>
        <Hangup/>
      </Response>
    `);



  } catch (err) {
    return res.send(`
      <Response>
        <Say>
          We are unable to complete your request.
        </Say>
        <Hangup/>
      </Response>
    `);
  }
});

/**
 * ACTIVATE + FUND
 */
app.post("/activate-by-phone", async (req, res) => {
 
  try {
    const phone = store.normalize(req.body.phone || "");
    const gift = await store.findByPhone(phone);
    
    if (!gift) return res.json({ status: "NOT_FOUND" });

    const cardNum = gift.cardnum;
    const last4 = cardNum.slice(-4);
    const amount = Number(gift.amount);

    // Retry funding
    if (gift.status === "ACTIVE" && gift.funding_status !== "FUNDED") {
      
      const issue = await fetch("https://x1.cardknox.com/gatewayjson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          xCommand: "gift:issue",
          xKey: process.env.CARDKNOX_KEY,
          xCardNum: cardNum,
          xVersion: "5.0.0",
          xSoftwareName: "SolaIVRGift",
        
          xSoftwareVersion: "1.0.0",
          xAmount: amount.toFixed(2)
        })
      }).then(r => r.json());

      if (issue.xResult !== "A") {
        await store.markActivatedNotFunded(phone);
        return res.json({ 
          status: "ACTIVATED_NOT_FUNDED",
          fundingStatus: "NOT_FUNDED",
          last4,
          fundingError: issue.xError || "Funding failed",
          fundingErrorCode: issue.xErrorCode || ""
         });
      }

      const bal = await getGiftBalance(cardNum);
      const balance = Number(bal.xRemainingBalance || gift.balance);
      await store.markFunded(phone, balance);

      return res.json({
        status: "FUNDED_SUCCESSFULLY",
        fundingStatus: "FUNDED",
        last4,
        amount: amount.toFixed(2)
      });
    }

    // Already active & funded
    if (gift.status === "ACTIVE" && gift.funding_status === "FUNDED") {
      const bal = await getGiftBalance(cardNum);

      await store.updateBalanceByPhone(phone, bal.xRemainingBalance);
      return res.json({
        status: "ALREADY_ACTIVE",
        fundingStatus: "FUNDED",
        last4,
        balance: bal.xRemainingBalance
      });
    }

    // Activate
    const activate = await fetch("https://x1.cardknox.com/gatewayjson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        xCommand: "gift:activate",
        xKey: process.env.CARDKNOX_KEY,
        xVersion: "5.0.0",
        xSoftwareName: "SolaIVRGift",
        xSoftwareVersion: "1.0.0",
        xCardNum: cardNum
      })
    }).then(r => r.json());

    if (activate.xResult !== "A") {
      return res.json({ status: "ACTIVATION_FAILED" });
    }

    await store.activateByPhone(phone);

    // Fund after activation
    const issue = await fetch("https://x1.cardknox.com/gatewayjson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        xCommand: "gift:issue",
        xKey: process.env.CARDKNOX_KEY,
        xCardNum: cardNum,
        xVersion: "5.0.0",
        xSoftwareName: "SolaIVRGift",
        xSoftwareVersion: "1.0.0",
        xAmount: amount.toFixed(2)
      })
    }).then(r => r.json());

    if (issue.xResult !== "A") {
      await store.markActivatedNotFunded(phone);
      return res.json({
         status: "ACTIVATED_NOT_FUNDED",
          last4,
          fundingError: issue.xError || "Funding failed",
          fundingErrorCode: issue.xErrorCode || ""
        });
    }

    const bal = await getGiftBalance(cardNum);
    await store.markFunded(phone, bal.xRemainingBalance || amount);

    return res.json({
      status: "ACTIVATED_AND_FUNDED",
      fundingStatus: "FUNDED",
      last4,
      amount: amount.toFixed(2)
    });

  } catch (err) {
    return res.json({ status: "ERROR" });
  }
});


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

