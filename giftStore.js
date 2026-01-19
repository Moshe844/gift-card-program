const db = require("./db");

function normalize(phone) {
  let digits = String(phone).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits;
}

async function findByPhone(phone) {
  const { rows } = await db.query(
    "SELECT * FROM gifts WHERE phone = $1",
    [normalize(phone)]
  );
  return rows[0] || null;
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
        balance=$2,
        funded_at=NOW()
    WHERE phone=$1
    `,
    [normalize(phone), balance]
  );
}

module.exports = {
  normalize,
  findByPhone,
  activateByPhone,
  updateBalanceByPhone,
  markFunded
};
