const db = require("./db");

async function logEvent({
  phone,
  cardNum,
  eventType,
  status,
  message,
  metadata = {}
}) {
  const last4 = cardNum ? cardNum.slice(-4) : null;

  await db.query(
    `
    INSERT INTO gift_activity
      (phone, card_last4, event_type, status, message, metadata)
    VALUES
      ($1, $2, $3, $4, $5, $6)
    `,
    [
      phone,
      last4,
      eventType,
      status,
      message,
      metadata
    ]
  );
}

module.exports = { logEvent };
