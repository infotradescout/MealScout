import "dotenv/config";
import { pool } from "../server/db";

const CONFIRM_TOKEN = "RESET_AUTH_LIMITERS";

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function assertAllowedEnvironment(): void {
  const nodeEnv = String(process.env.NODE_ENV || "development").trim();
  const allowProd = isTruthy(process.env.ADMIN_SMOKE_PREP_ALLOW_PROD);
  if (nodeEnv === "production" && !allowProd) {
    throw new Error(
      "Refusing to reset auth rate-limit counters in production. Set ADMIN_SMOKE_PREP_ALLOW_PROD=true to override.",
    );
  }
}

function assertConfirmed(): void {
  const confirm = String(process.env.ADMIN_SMOKE_PREP_CONFIRM || "").trim();
  if (confirm !== CONFIRM_TOKEN) {
    throw new Error(
      `Missing confirmation token. Set ADMIN_SMOKE_PREP_CONFIRM=${CONFIRM_TOKEN} to proceed.`,
    );
  }
}

async function main() {
  assertAllowedEnvironment();
  assertConfirmed();

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
  console.error("Failed to prepare admin manual provisioning smoke run:", error);
  process.exit(1);
});
