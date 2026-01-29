const express = require("express");
const store = require("../giftStore");
const { logEvent } = require("../activityLogger");
const { BASE_URL } = require("../config");
const {isRateLimited} = require("../services/ivrRateLimit.service");

const {
  getRetry,
  incrementRetry,
  clearRetries,
  MAX_PHONE_RETRIES,
  MAX_SECURITY_RETRIES
} = require("../services/ivrRetry.service");
const { speakAmount, twimlEscape } = require("../services/speech.service");

const router = express.Router();

router.all("/ivr", async (req, res) => {
  const callerPhone = store.normalize(req.body.From || "");
  res.type("text/xml");

  if (callerPhone && isRateLimited(callerPhone)) {
    await logEvent({
      eventType: "IVR_RATE_LIMIT",
      phone: callerPhone,
      status: "BLOCKED",
      message: "Exceeded 5 calls in 30 minutes"
    });

    return res.send(`
      <Response>
        <Say voice="Polly.Joey">
          You have made too many calls in a short period of time.
          Please try again later.
        </Say>
        <Hangup/>
      </Response>
    `);
  }

  // normal IVR flow
  await logEvent({
    eventType: "IVR_ENTRY",
    phone: callerPhone,
    status: "SUCCESS",
    message: "Caller entered IVR"
  });

  res.send(`
    <Response>
      <Gather input="dtmf" numDigits="10" timeout="3" finishOnKey="#"
        action="/ivr-verify" method="POST">
        <Say voice="Polly.Joey">
          Welcome to the Yad V'Eizer gift card activation line.
        </Say>
        <Pause length="1"/>
        <Say voice="Polly.Joey">
          Please enter your phone number including the area code.
        </Say>
      </Gather>
      <Redirect>/ivr</Redirect>
    </Response>
  `);
});


router.all("/ivr-enter-phone", (req, res) => {
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
        <Say voice="Polly.Joey">
          Please enter your phone number including the area code.
        </Say>
      </Gather>

      <Redirect>/ivr-enter-phone</Redirect>
    </Response>
  `);
});


router.post("/ivr-verify", async (req, res) => {
    
        await logEvent({
          eventType: "IVR_VERIFY_ATTEMPT",
          phone: store.normalize(req.body.From || ""),
          status: "ATTEMPT",
          message: "User entered phone number"
        });
        
        const callSid = req.body.CallSid;
        res.type("text/xml");
      
        try {
          const enteredPhone = store.normalize(req.body.Digits || "");
          const callerPhone  = store.normalize(req.body.From || "");
         
      
          // -----------------------------
          // INVALID PHONE
          // -----------------------------
          if (enteredPhone.length !== 10) {
            await logEvent({
              eventType: "IVR_VERIFY_FAILED",
              phone: enteredPhone,
              status: "FAILED",
              message: "Invalid phone length"
            });
            
            const retries = incrementRetry(callSid, "PHONE");
            if (retries >= MAX_PHONE_RETRIES) {
              await logEvent({
                eventType: "IVR_VERIFY_LOCKOUT",
                phone: enteredPhone,
                status: "LOCKED_OUT",
                message: "Max phone retries exceeded"
              })
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
                <Redirect>/ivr-enter-phone</Redirect>
              </Response>
            `);
          }
      
          // -----------------------------
          // SECURITY CHECK
          // -----------------------------
          if (enteredPhone !== callerPhone) {
            await logEvent({
              eventType: "IVR_VERIFY_FAILED",
              phone: enteredPhone,
              status: "FAILED",
              message: "Caller phone does not match entered phone"
            })
            const retries = incrementRetry(callSid, "SECURITY");
      
            if (retries >= MAX_SECURITY_RETRIES) {
              await logEvent({
                eventType: "IVR_VERIFY_LOCKOUT",
                phone: enteredPhone,
                status: "LOCKED_OUT",
                message: "Max security retries exceeded"
              })
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
                <Redirect>/ivr-enter-phone</Redirect>
              </Response>
            `);
          }
      
          // -----------------------------
          // ACTIVATE / FUND
          // -----------------------------
          const apiRes = await fetch(`${BASE_URL}/activate-by-phone`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone: enteredPhone })
          });
      
          await logEvent({
            eventType: "ACTIVATE_ATTEMPT",
            phone: enteredPhone,
            status: "ATTEMPT",
            message: "Activation requested"
          });
          
          const result = await apiRes.json();
          clearRetries(callSid);
      
          // -----------------------------
          // ACTIVATED + FUNDED (FIRST CALL)
          // -----------------------------
          if (result.status === "ACTIVATED_AND_FUNDED") {
            await logEvent({
              eventType: "ACTIVATE_SUCCESS",
              phone: enteredPhone,
              status: "SUCCESS",
              message: "Gift card activated and funded successfully"
            })
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
            await logEvent({
              eventType: "FUNDING_SUCCESS",
              phone: enteredPhone,
              status: "SUCCESS",
              message: "Gift card funded successfully on retry"
            })
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
            await logEvent({
              eventType: "FUNDING_FAILED",
              phone: enteredPhone,
              status: "FAILED",
              message: "Gift card activated but funding failed",
              metadata: {
                fundingError: result.fundingError,
                fundingErrorCode: result.fundingErrorCode
              }
            })
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
            await logEvent({
              eventType: "ACTIVATE_ALREADY_ACTIVE",
              phone: enteredPhone,
              status: "SUCCESS",
              message: `Gift card is already active with the balance of ${result.balance}.`
            })
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
    


module.exports = router;
