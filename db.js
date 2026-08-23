require("dotenv").config();
const { Pool } = require("pg");

const poolConfig = {
  connectionString: process.env.DATABASE_URL
};

if (process.env.NODE_ENV === "production" && process.env.PGSSLMODE !== "disable") {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

async function withTransaction(work) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  withTransaction,
  close: () => pool.end()
};
