const fs = require("fs");
const path = require("path");
const db = require("./db");
const store = require("./giftStore");
const { parseCsvBuffer } = require("./utils/csv");

async function main() {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, "gifts.csv");
  const rows = await parseCsvBuffer(fs.readFileSync(file));
  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const phone = store.normalize(row.phone);
    const cardNum = store.normalizeCardNum(row.cardNum || row.cardnum);
    const amount = Number(row.amount);

    if (phone.length !== 10 || !store.isValidCardNum(cardNum) || !Number.isFinite(amount) || amount <= 0) {
      skipped += 1;
      continue;
    }

    if (await store.insertGift({ phone, cardNum, amount })) inserted += 1;
    else skipped += 1;
  }

  console.log(JSON.stringify({ total: rows.length, inserted, skipped }));
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
