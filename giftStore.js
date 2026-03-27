const db = require("./db");

function normalize(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits;
}

function normalizeCardNum(cardNum) {
  return String(cardNum || "").trim();
}

async function findAllByPhone(phone) {
  const { rows } = await db.query(
    `
    SELECT *
    FROM gifts
    WHERE phone = $1
    ORDER BY id ASC
    `,
    [normalize(phone)]
  );

  return rows;
}

async function findById(id) {
  const { rows } = await db.query(
    `
    SELECT *
    FROM gifts
    WHERE id = $1
    `,
    [id]
  );

  return rows[0] || null;
}

async function findByIdAndCard(id, cardNum) {
  const { rows } = await db.query(
    `
    SELECT *
    FROM gifts
    WHERE id = $1
      AND cardnum = $2
    `,
    [id, normalizeCardNum(cardNum)]
  );

  return rows[0] || null;
}

async function activateByIdAndCard(id, cardNum) {
  const { rows, rowCount } = await db.query(
    `
    UPDATE gifts
    SET status = 'ACTIVE',
        activated_at = NOW()
    WHERE id = $1
      AND cardnum = $2
    RETURNING *
    `,
    [id, normalizeCardNum(cardNum)]
  );

  if (rowCount !== 1) {
    throw new Error(
      `Activate mismatch: id=${id}, card ending ${normalizeCardNum(cardNum).slice(-4)}`
    );
  }

  return rows[0];
}

async function updateBalanceByIdAndCard(id, cardNum, balance) {
  const { rows, rowCount } = await db.query(
    `
    UPDATE gifts
    SET balance = $3
    WHERE id = $1
      AND cardnum = $2
    RETURNING *
    `,
    [id, normalizeCardNum(cardNum), balance]
  );

  if (rowCount !== 1) {
    throw new Error(
      `Balance update mismatch: id=${id}, card ending ${normalizeCardNum(cardNum).slice(-4)}`
    );
  }

  return rows[0];
}

async function markFundedByIdAndCard(id, cardNum, balance) {
  const { rows, rowCount } = await db.query(
    `
    UPDATE gifts
    SET funded = true,
        status = 'ACTIVE',
        funding_status = 'FUNDED',
        funding_error = NULL,
        balance = $3,
        funded_at = NOW()
    WHERE id = $1
      AND cardnum = $2
    RETURNING *
    `,
    [id, normalizeCardNum(cardNum), balance]
  );

  if (rowCount !== 1) {
    throw new Error(
      `Funded update mismatch: id=${id}, card ending ${normalizeCardNum(cardNum).slice(-4)}`
    );
  }

  return rows[0];
}

async function markActivatedNotFundedByIdAndCard(id, cardNum, errorMessage) {
  const { rows, rowCount } = await db.query(
    `
    UPDATE gifts
    SET status = 'ACTIVE',
        funded = false,
        funding_status = 'NOT_FUNDED',
        funding_error = $3
    WHERE id = $1
      AND cardnum = $2
    RETURNING *
    `,
    [id, normalizeCardNum(cardNum), errorMessage]
  );

  if (rowCount !== 1) {
    throw new Error(
      `Not-funded update mismatch: id=${id}, card ending ${normalizeCardNum(cardNum).slice(-4)}`
    );
  }

  return rows[0];
}

async function deactivateByIdAndCard(id, cardNum) {
  const { rows, rowCount } = await db.query(
    `
    UPDATE gifts
    SET status = 'PENDING',
        funded = false,
        funding_status = 'NOT_FUNDED',
        funding_error = NULL,
        balance = 0,
        activated_at = NULL,
        funded_at = NULL
    WHERE id = $1
      AND cardnum = $2
    RETURNING *
    `,
    [id, normalizeCardNum(cardNum)]
  );

  if (rowCount !== 1) {
    throw new Error(
      `Deactivate mismatch: id=${id}, card ending ${normalizeCardNum(cardNum).slice(-4)}`
    );
  }

  return rows[0];
}

/**
 * Keep this ONLY if you intentionally want to reset ALL cards for a phone.
 * This is dangerous for normal business logic.
 */
async function deactivateAllByPhone(phone) {
  const result = await db.query(
    `
    UPDATE gifts
    SET status = 'PENDING',
        funded = false,
        funding_status = 'NOT_FUNDED',
        funding_error = NULL,
        balance = 0,
        activated_at = NULL,
        funded_at = NULL
    WHERE phone = $1
    `,
    [normalize(phone)]
  );

  return result.rowCount;
}

async function remove(phone, cardNum) {
  const r = await db.query(
    `
    DELETE FROM gifts
    WHERE phone = $1
      AND cardnum = $2
    RETURNING id
    `,
    [normalize(phone), normalizeCardNum(cardNum)]
  );

  return r.rowCount;
}

module.exports = {
  normalize,
  normalizeCardNum,
  findAllByPhone,
  findById,
  findByIdAndCard,
  activateByIdAndCard,
  updateBalanceByIdAndCard,
  markFundedByIdAndCard,
  markActivatedNotFundedByIdAndCard,
  deactivateByIdAndCard,
  deactivateAllByPhone,
  remove
};