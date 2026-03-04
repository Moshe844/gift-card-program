const db = require("./db");

function normalize(phone) {
  let digits = String(phone).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits;
}

// async function findByPhone(phone) {
//   const { rows } = await db.query(
//     "SELECT * FROM gifts WHERE phone = $1 ORDER BY id ASC",
//     [normalize(phone)]
//   );
//   return rows[0] || null;
// }
async function findAllByPhone(phone) {
  const { rows } = await db.query(
    "SELECT * FROM gifts WHERE phone = $1 ORDER BY id ASC",
    [normalize(phone)]
  );
  return rows; // return ALL rows
}

async function activateByPhone(phone) {
  const { rows } = await db.query(
    `
    UPDATE gifts
    SET status='ACTIVE', activated_at=NOW()
    WHERE phone=$1
    RETURNING *
    `,
    [normalize(phone)]
  );
  return rows[0] || null;
}

async function updateBalanceByPhone(phone, balance) {
  await db.query(
    "UPDATE gifts SET balance=$2 WHERE phone=$1",
    [normalize(phone), balance]
  );
}

async function markFunded(phone, balance) {
  await db.query(
    `
    UPDATE gifts
    SET funded=true,
        status = 'ACTIVE',
        funding_status = 'FUNDED',
        funding_error = NULL,
        balance=$2,
        funded_at=NOW()
    WHERE phone=$1
    `,
    [normalize(phone), balance]
  );
}
async function markActivatedNotFunded(phone, errorMessage) {
  await db.query(
    `
    UPDATE gifts
    SET status='ACTIVE',
        funded=false,
        funding_status='NOT_FUNDED',
        funding_error=$2
    WHERE phone=$1
    `,
    [normalize(phone), errorMessage]
  );
}

async function deactivate(phone) {
  const result = await db.query(
    `
    UPDATE gifts
    SET status='PENDING',
        funded=false,
        funding_status='NOT_FUNDED',
        funding_error=NULL,
        balance=0,
        activated_at=NULL,
        funded_at=NULL
    WHERE phone=$1
    `,
    [normalize(phone)]
  );

  return result.rowCount; // ✅ tells you if a row was updated
}
async function remove(phone, cardNum) {
  const r = await db.query(
    `DELETE FROM gifts WHERE phone=$1 AND cardnum=$2 RETURNING id`,
    [normalize(phone), String(cardNum).trim()]
  );
  return r.rowCount;
}

module.exports = {
  normalize,
  // findByPhone,
  findAllByPhone,
  activateByPhone,
  updateBalanceByPhone,
  markFunded,
  markActivatedNotFunded,
  deactivate,
  remove
};
