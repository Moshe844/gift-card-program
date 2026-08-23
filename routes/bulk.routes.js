const express = require("express");
const multer = require("multer");
const db = require("../db");
const store = require("../giftStore");
const operations = require("../services/giftOperations.service");
const directIssue = require("../services/directIssue.service");
const { INVALID_GIFT_CARD_CODES } = require("../services/cardknox.service");
const { requireAdmin } = require("../services/adminAuth.service");
const { parseCsvBuffer, csvEscape } = require("../utils/csv");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }
});

router.use(requireAdmin);

function field(row, names) {
  for (const name of names) {
    if (row[name] !== undefined) return String(row[name]).trim();
  }
  return "";
}

function cardFields(row) {
  return {
    phone: store.normalize(field(row, ["phone", "Phone", "PHONE"])),
    cardNum: store.normalizeCardNum(field(row, ["cardnum", "cardNum", "CardNum", "CARDNUM"]))
  };
}

function mask(cardNum) {
  return cardNum ? `************${cardNum.slice(-4)}` : "";
}

router.post("/import-gifts", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No CSV file uploaded" });
    const rows = await parseCsvBuffer(req.file.buffer);
    const results = [];

    for (const row of rows) {
      const { phone, cardNum } = cardFields(row);
      const amount = Number(field(row, ["amount", "Amount", "AMOUNT"]));
      let status = "INSERTED";
      let error = null;

      if (phone.length !== 10) {
        status = "SKIPPED";
        error = "INVALID_PHONE";
      } else if (!store.isValidCardNum(cardNum)) {
        status = "SKIPPED";
        error = "INVALID_CARD_NUMBER";
      } else if (!Number.isFinite(amount) || amount <= 0) {
        status = "SKIPPED";
        error = "INVALID_AMOUNT";
      } else {
        try {
          await operations.validateCardNumber(cardNum);
          const gift = await store.insertGift({ phone, cardNum, amount });
          if (!gift) {
            status = "SKIPPED";
            error = "CARD_ALREADY_EXISTS";
          } else {
            const prepared = await operations.prepareForIvrById(gift.id);
            if (prepared.status === "READY_FOR_IVR") {
              status = "READY_FOR_IVR";
            } else {
              status = "FAILED";
              error = prepared.error || "CARD_PREPARATION_FAILED";
            }
          }
        } catch (insertError) {
          const knownInvalid = INVALID_GIFT_CARD_CODES.has(insertError.code);
          status = knownInvalid ? "SKIPPED" : "FAILED";
          error = knownInvalid
            ? "CARDKNOX_INVALID_GIFT_CARD"
            : `CARDKNOX_VALIDATION_OR_IMPORT_FAILED: ${insertError.message}`;
        }
      }

      results.push({ phone, cardNum: mask(cardNum), amount, status, error });
    }

    return res.json({
      total: results.length,
      inserted: results.filter(row => row.status === "READY_FOR_IVR").length,
      skipped: results.filter(row => row.status === "SKIPPED").length,
      failed: results.filter(row => row.status === "FAILED").length,
      results
    });
  } catch (error) {
    console.error("Import failed:", error.message);
    return res.status(500).json({ error: "Import failed" });
  }
});

router.post("/bulk-direct-issue", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No CSV file uploaded" });
    const rows = await parseCsvBuffer(req.file.buffer);
    const results = [];

    for (const row of rows) {
      const cardNum = store.normalizeCardNum(field(row, ["cardnum", "cardNum", "CardNum", "CARDNUM"]));
      const amount = Number(field(row, ["amount", "Amount", "AMOUNT"]));

      try {
        const result = await directIssue.issue(cardNum, amount);
        const status = result.issuance.status === "ALREADY_ACTIVE" ? "ALREADY_ISSUED" : "ISSUED";
        results.push({
          cardNum: mask(cardNum),
          amount,
          status,
          balance: result.issuance.balance,
          error: null
        });
      } catch (error) {
        const skipped = ["INVALID_CARD_NUMBER", "INVALID_AMOUNT", "CARDKNOX_VALIDATION_FAILED", "PHONE_CARD_CONFLICT", "AMOUNT_CONFLICT", "PREVIOUSLY_DEACTIVATED"].includes(error.code) && error.httpStatus !== 502;
        results.push({
          cardNum: mask(cardNum),
          amount: Number.isFinite(amount) ? amount : "",
          status: skipped ? "SKIPPED" : "FAILED",
          balance: "",
          error: error.message
        });
      }
    }

    const resultsCsv = [
      ["cardNum", "amount", "status", "balance", "error"],
      ...results.map(row => [row.cardNum, row.amount, row.status, row.balance, row.error])
    ].map(values => values.map(csvEscape).join(",")).join("\n");

    return res.json({
      total: results.length,
      issued: results.filter(row => row.status === "ISSUED").length,
      alreadyIssued: results.filter(row => row.status === "ALREADY_ISSUED").length,
      skipped: results.filter(row => row.status === "SKIPPED").length,
      failed: results.filter(row => row.status === "FAILED").length,
      results,
      resultsCsv
    });
  } catch (error) {
    console.error("Bulk direct issue failed:", error.message);
    return res.status(500).json({ error: "Bulk direct issue failed" });
  }
});

async function resolveExactGift(row) {
  const { phone, cardNum } = cardFields(row);
  if (phone.length !== 10 || !store.isValidCardNum(cardNum)) {
    return { phone, cardNum, error: "INVALID_PHONE_OR_CARD" };
  }
  const gift = await store.findByPhoneAndCard(phone, cardNum);
  if (!gift) return { phone, cardNum, error: "EXACT_CARD_NOT_FOUND" };
  return { phone, cardNum, gift };
}

async function runBulk(req, res, action) {
  try {
    if (!req.file) return res.status(400).json({ error: "No CSV file uploaded" });
    const rows = await parseCsvBuffer(req.file.buffer);
    const results = [];

    for (const row of rows) {
      const resolved = await resolveExactGift(row);
      if (resolved.error) {
        results.push({
          phone: resolved.phone,
          cardNum: mask(resolved.cardNum),
          status: "SKIPPED",
          error: resolved.error
        });
        continue;
      }

      try {
        const result = action === "activate"
          ? await operations.activateAndFundById(resolved.gift.id)
          : await operations.deactivateById(resolved.gift.id);
        results.push({
          phone: resolved.phone,
          cardNum: mask(resolved.cardNum),
          ...result
        });
      } catch (error) {
        results.push({
          phone: resolved.phone,
          cardNum: mask(resolved.cardNum),
          status: "FAILED",
          error: error.message
        });
      }
    }

    const output = [
      ["phone", "cardNum", "status", "balance", "redeemedAmount", "error"],
      ...results.map(row => [row.phone, row.cardNum, row.status, row.balance, row.redeemedAmount, row.error])
    ].map(values => values.map(csvEscape).join(",")).join("\n");

    const completed = results.filter(row => !["FAILED", "SKIPPED", "ERROR"].includes(row.status)).length;
    return res.json({
      total: results.length,
      completed,
      activated: action === "activate" ? completed : 0,
      deactivated: action === "deactivate" ? completed : 0,
      skipped: results.filter(row => row.status === "SKIPPED").length,
      failed: results.filter(row => ["FAILED", "ERROR"].includes(row.status)).length,
      results,
      resultsCsv: output
    });
  } catch (error) {
    console.error(`Bulk ${action} failed:`, error.message);
    return res.status(500).json({ error: `Bulk ${action} failed` });
  }
}

router.post("/bulk-deactivate", upload.single("file"), (req, res) => runBulk(req, res, "deactivate"));

router.get("/export-gifts.csv", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, phone, cardnum, amount, balance, status, funding_status, activated_at, funded_at
       FROM gifts ORDER BY id ASC`
    );
    const headers = ["id", "phone", "cardnum", "amount", "balance", "status", "funding_status", "activated_at", "funded_at"];
    const lines = [headers.join(",")];
    for (const row of rows) {
      const safe = { ...row, cardnum: mask(String(row.cardnum || "")) };
      lines.push(headers.map(header => csvEscape(safe[header])).join(","));
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="gifts-export-masked.csv"');
    return res.send(lines.join("\n"));
  } catch (error) {
    console.error("Export failed:", error.message);
    return res.status(500).json({ error: "Export failed" });
  }
});

module.exports = router;
