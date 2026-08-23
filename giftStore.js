const db = require("./db");

function normalize(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}

function normalizeCardNum(cardNum) {
  return String(cardNum || "").trim();
}

function isValidCardNum(cardNum) {
  return /^\d{12,19}$/.test(normalizeCardNum(cardNum));
}

function assertExactlyOne(rowCount, operation, id, cardNum) {
  if (rowCount !== 1) {
    throw new Error(
      `${operation} mismatch: id=${id}, card ending ${normalizeCardNum(cardNum).slice(-4)}`
    );
  }
}

function createStore(queryable = db) {
  const query = (text, params) => queryable.query(text, params);

  async function findAllByPhone(phone) {
    const { rows } = await query(
      "SELECT * FROM gifts WHERE phone = $1 ORDER BY id ASC",
      [normalize(phone)]
    );
    return rows;
  }

  async function findById(id) {
    const { rows } = await query("SELECT * FROM gifts WHERE id = $1", [id]);
    return rows[0] || null;
  }

  async function findByCardNum(cardNum) {
    const { rows } = await query(
      "SELECT * FROM gifts WHERE cardnum = $1",
      [normalizeCardNum(cardNum)]
    );
    return rows[0] || null;
  }

  async function findByIdForUpdate(id) {
    const { rows } = await query(
      "SELECT * FROM gifts WHERE id = $1 FOR UPDATE",
      [id]
    );
    return rows[0] || null;
  }

  async function findByIdAndCard(id, cardNum) {
    const { rows } = await query(
      "SELECT * FROM gifts WHERE id = $1 AND cardnum = $2",
      [id, normalizeCardNum(cardNum)]
    );
    return rows[0] || null;
  }

  async function findByPhoneAndCard(phone, cardNum) {
    const { rows } = await query(
      "SELECT * FROM gifts WHERE phone = $1 AND cardnum = $2",
      [normalize(phone), normalizeCardNum(cardNum)]
    );
    return rows[0] || null;
  }

  async function insertGift({ phone, cardNum, amount }) {
    const { rows, rowCount } = await query(
      `
      INSERT INTO gifts
        (phone, cardnum, amount, status, funded, funding_status, funding_error, balance)
      VALUES
        ($1, $2, $3, 'IMPORTING', false, 'NOT_FUNDED', NULL, 0)
      ON CONFLICT (cardnum) DO NOTHING
      RETURNING *
      `,
      [normalize(phone) || null, normalizeCardNum(cardNum), amount]
    );
    return rowCount === 1 ? rows[0] : null;
  }

  async function activateByIdAndCard(id, cardNum) {
    const { rows, rowCount } = await query(
      `
      UPDATE gifts
      SET status = 'ACTIVE', activated_at = COALESCE(activated_at, NOW())
      WHERE id = $1 AND cardnum = $2
      RETURNING *
      `,
      [id, normalizeCardNum(cardNum)]
    );
    assertExactlyOne(rowCount, "Activate", id, cardNum);
    return rows[0];
  }

  async function updateBalanceByIdAndCard(id, cardNum, balance) {
    const { rows, rowCount } = await query(
      `
      UPDATE gifts SET balance = $3
      WHERE id = $1 AND cardnum = $2
      RETURNING *
      `,
      [id, normalizeCardNum(cardNum), balance]
    );
    assertExactlyOne(rowCount, "Balance update", id, cardNum);
    return rows[0];
  }

  async function markFundedByIdAndCard(id, cardNum, balance) {
    const { rows, rowCount } = await query(
      `
      UPDATE gifts
      SET funded = true,
          status = 'ACTIVE',
          funding_status = 'FUNDED',
          funding_error = NULL,
          balance = $3,
          funded_at = COALESCE(funded_at, NOW())
      WHERE id = $1 AND cardnum = $2
      RETURNING *
      `,
      [id, normalizeCardNum(cardNum), balance]
    );
    assertExactlyOne(rowCount, "Funded update", id, cardNum);
    return rows[0];
  }

  async function markActivatedNotFundedByIdAndCard(id, cardNum, errorMessage) {
    const { rows, rowCount } = await query(
      `
      UPDATE gifts
      SET status = 'ACTIVE',
          funded = false,
          funding_status = 'NOT_FUNDED',
          funding_error = $3
      WHERE id = $1 AND cardnum = $2
      RETURNING *
      `,
      [id, normalizeCardNum(cardNum), String(errorMessage || "Funding failed").slice(0, 500)]
    );
    assertExactlyOne(rowCount, "Not-funded update", id, cardNum);
    return rows[0];
  }

  async function deactivateByIdAndCard(id, cardNum) {
    const { rows, rowCount } = await query(
      `
      UPDATE gifts
      SET status = 'DEACTIVATED',
          funded = false,
          funding_status = 'NOT_FUNDED',
          funding_error = NULL,
          balance = 0,
          activated_at = NULL,
          funded_at = NULL
      WHERE id = $1 AND cardnum = $2
      RETURNING *
      `,
      [id, normalizeCardNum(cardNum)]
    );
    assertExactlyOne(rowCount, "Deactivate", id, cardNum);
    return rows[0];
  }

  async function markReadyForIvrByIdAndCard(id, cardNum) {
    const { rows, rowCount } = await query(
      `
      UPDATE gifts
      SET status = 'PENDING',
          funded = false,
          funding_status = 'NOT_FUNDED',
          funding_error = NULL,
          balance = 0,
          activated_at = NULL,
          funded_at = NULL
      WHERE id = $1 AND cardnum = $2
      RETURNING *
      `,
      [id, normalizeCardNum(cardNum)]
    );
    assertExactlyOne(rowCount, "Prepare for IVR", id, cardNum);
    return rows[0];
  }

  async function markImportFailedByIdAndCard(id, cardNum, errorMessage) {
    const { rows, rowCount } = await query(
      `
      UPDATE gifts
      SET status = 'IMPORT_FAILED',
          funded = false,
          funding_status = 'NOT_FUNDED',
          funding_error = $3,
          balance = 0
      WHERE id = $1 AND cardnum = $2
      RETURNING *
      `,
      [id, normalizeCardNum(cardNum), String(errorMessage || "Card preparation failed").slice(0, 500)]
    );
    assertExactlyOne(rowCount, "Import failure", id, cardNum);
    return rows[0];
  }

  return {
    findAllByPhone,
    findById,
    findByCardNum,
    findByIdForUpdate,
    findByIdAndCard,
    findByPhoneAndCard,
    insertGift,
    activateByIdAndCard,
    updateBalanceByIdAndCard,
    markFundedByIdAndCard,
    markActivatedNotFundedByIdAndCard,
    deactivateByIdAndCard,
    markReadyForIvrByIdAndCard,
    markImportFailedByIdAndCard
  };
}

module.exports = {
  normalize,
  normalizeCardNum,
  isValidCardNum,
  createStore,
  ...createStore()
};
