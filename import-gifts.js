const fs = require("fs");
const path = require("path");
const db = require("./db");
require("dotenv").config();
const CSV_FILE = path.join(__dirname, "gifts.csv");
console.log("DB URL exists:", !!process.env.DATABASE_URL);

function normalize(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }
  return digits;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines.shift().split(",");

  return lines.map(line => {
    const values = line.split(",");
    const row = {};
    headers.forEach((h, i) => row[h.trim()] = values[i]?.trim());
    return row;
  });
}

async function run() {
  const csv = fs.readFileSync(CSV_FILE, "utf8");
  const rows = parseCsv(csv);

  let added = 0;

  for (const row of rows) {
    const phone = normalize(row.phone);
    const cardnum = row.cardNum;
    const amount = parseFloat(row.amount);

    if (!phone || phone.length !== 10 || !cardnum || !amount) continue;

    try {
      await db.query(
        `
        INSERT INTO gifts (phone, cardnum, amount)
        VALUES ($1, $2, $3)
        ON CONFLICT (phone) DO NOTHING
        `,
        [phone, cardnum, amount]
      );
      added++;
    } catch (e) {
      console.error("Insert failed:", phone, e.message);
    }
  }

  console.log(`✅ Imported ${added} gifts`);
  process.exit(0);
}

run();
