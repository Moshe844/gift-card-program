const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const file = path.join(__dirname, "..", "migrations", "001_card_identity_integrity.sql");
  await db.query(fs.readFileSync(file, "utf8"));
  console.log("Card identity integrity migration completed.");
}

if (require.main === module) {
  runMigration()
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}

module.exports = { runMigration };
