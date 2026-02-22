const express = require("express");
const multer = require("multer");
const db = require("../db");

const {
  deactivateCard,
  redeemGiftBalance,
  getGiftBalance
} = require("../services/cardknox.service"); // <-- adjust if needed

const store = require("../giftStore"); // <-- adjust if needed

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function normalize(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}

// Basic CSV parser: works for simple CSVs without quoted commas.
// Also strips UTF-8 BOM if present (common from Excel).
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines.shift().replace(/^\uFEFF/, "").split(",").map(h => h.trim());

  return lines.map(line => {
    const values = line.split(",");
    const row = {};
    headers.forEach((h, i) => (row[h] = (values[i] ?? "").trim()));
    return row;
  });
}

/* ---------------------------------------------------------
   IMPORT GIFTS
   POST /admin/import-gifts
   CSV headers: phone,cardNum,amount
--------------------------------------------------------- */
router.post("/import-gifts", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const csvText = req.file.buffer.toString("utf8");
    const rows = parseCsv(csvText);

    let inserted = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      const phone = normalize(row.phone || row.Phone || row.PHONE);
      const cardnum =
        (row.cardNum || row.cardnum || row.CardNum || row.CARDNUM || "").trim();
      const amount = parseFloat(row.amount ?? row.Amount ?? row.AMOUNT);

      if (!phone || phone.length !== 10 || !cardnum || !Number.isFinite(amount) || amount <= 0) {
        skipped++;
        continue;
      }

      try {
        const result = await db.query(
          `
          INSERT INTO gifts (phone, cardnum, amount)
          VALUES ($1, $2, $3)
          ON CONFLICT (phone) DO NOTHING
          `,
          [phone, cardnum, amount]
        );

        if (result.rowCount === 1) inserted++;
        else skipped++; // conflict (phone already existed)
      } catch (e) {
        failed++;
        console.error("Import insert failed:", phone, e.message);
      }
    }

    return res.json({ total: rows.length, inserted, skipped, failed });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Import failed" });
  }
});

/* ---------------------------------------------------------
   BULK DEACTIVATE
   POST /admin/bulk-deactivate
   CSV headers: phone,cardnum   (cardnum can also be cardNum)
--------------------------------------------------------- */
async function deactivateOneCard(phone, cardNum) {
  let redeemedAmount = 0;

  try {
    // 1) Get balance
    const bal = await getGiftBalance(cardNum);
    const remaining = Number(bal?.xRemainingBalance || 0);

    // 2) Redeem any remaining balance
    if (remaining > 0) {
      await redeemGiftBalance(cardNum, remaining);
      redeemedAmount = remaining;
    }

    // 3) Deactivate
    await deactivateCard(cardNum);

    // 4) Update DB
    await store.deactivate(phone, {
      redeemedAmount,
      finalBalance: 0
    });

    return { phone, cardNum, status: "DEACTIVATED", redeemedAmount };
  } catch (err) {
    return { phone, cardNum, status: "FAILED", redeemedAmount, error: err.message };
  }
}

router.post("/bulk-deactivate", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const csvText = req.file.buffer.toString("utf8");
    const rows = parseCsv(csvText);

    const cards = rows.map(r => ({
      phone: normalize(r.phone || r.Phone || r.PHONE),
      cardNum: (r.cardnum || r.cardNum || r.CardNum || r.CARDNUM || "").trim()
    }));

    const results = [];
    let skipped = 0;

    for (const c of cards) {
      if (!c.phone || c.phone.length !== 10 || !c.cardNum) {
        skipped++;
        results.push({
          phone: c.phone || "",
          cardNum: c.cardNum || "",
          status: "SKIPPED",
          redeemedAmount: 0,
          error: "Missing/invalid phone or cardNum"
        });
        continue;
      }

      const r = await deactivateOneCard(c.phone, c.cardNum);
      results.push(r);
    }

    // Build results CSV so the UI can download it
    const outLines = [
      ["phone", "cardNum", "status", "redeemedAmount", "error"].join(","),
      ...results.map(r => {
        const safeError = (r.error || "").replace(/"/g, '""');
        return [
          r.phone || "",
          r.cardNum || "",
          r.status || "",
          String(r.redeemedAmount || 0),
          safeError
        ].join(",");
      })
    ];

    const deactivated = results.filter(r => r.status === "DEACTIVATED").length;
    const failed = results.filter(r => r.status === "FAILED").length;

    return res.json({
      total: cards.length,
      skipped,
      deactivated,
      failed,
      results,
      resultsCsv: outLines.join("\n")
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Bulk deactivate failed" });
  }
});

// GET /admin/export-gifts.csv
router.get("/export-gifts.csv", async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, phone, cardnum, amount, balance, status
      FROM gifts
      ORDER BY id ASC
    `);

    // Build CSV
    const headers = ["id", "phone", "cardnum", "amount", "balance", "status"];
    const lines = [headers.join(",")];

    for (const row of result.rows) {
      const values = headers.map((h) => {
        const v = row[h];

        // Basic CSV escaping (handles commas/quotes/newlines)
        const s = v === null || v === undefined ? "" : String(v);
        const escaped = /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        return escaped;
      });

      lines.push(values.join(","));
    }

    const csv = lines.join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="gifts-export.csv"`);
    return res.send(csv);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Export failed" });
  }
});

module.exports = router;