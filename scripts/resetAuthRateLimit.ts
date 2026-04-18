import "dotenv/config";
import { pool } from "../server/db";

async function main() {
  if (!pool) {
    throw new Error("Database pool is not initialized");
  }

  const result = await pool.query(
    "delete from rate_limit_counters where scope in ('auth:moderate','auth:strict')",
  );
  console.log(`deleted ${result.rowCount ?? 0} auth rate-limit rows`);

  await pool.end();
}

main().catch((error) => {
  console.error("Failed to reset auth rate-limit rows:", error);
  process.exit(1);
});
