const db = require("../db");

async function count(sql) {
  const { rows } = await db.query(sql);
  return Number(rows[0].count);
}

async function main() {
  const report = {
    totalCards: await count("SELECT COUNT(*) FROM gifts"),
    phonesWithMultipleCards: await count("SELECT COUNT(*) FROM (SELECT phone FROM gifts GROUP BY phone HAVING COUNT(*) > 1) x"),
    duplicatedCardNumbers: await count("SELECT COUNT(*) FROM (SELECT cardnum FROM gifts GROUP BY cardnum HAVING COUNT(*) > 1) x"),
    invalidPhones: await count("SELECT COUNT(*) FROM gifts WHERE phone IS NULL OR phone !~ '^\\d{10}$'"),
    invalidCardNumbers: await count("SELECT COUNT(*) FROM gifts WHERE cardnum IS NULL OR cardnum !~ '^\\d{12,19}$'"),
    invalidAmounts: await count("SELECT COUNT(*) FROM gifts WHERE amount IS NULL OR amount <= 0"),
    negativeBalances: await count("SELECT COUNT(*) FROM gifts WHERE balance < 0")
  };

  console.log(JSON.stringify(report, null, 2));
  if (report.duplicatedCardNumbers || report.invalidCardNumbers) process.exitCode = 2;
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());
