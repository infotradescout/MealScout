import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { startNativePostgres16 } from "./nativePostgres16Fixture.ts";

assert.equal(process.env.MEALSCOUT_ISOLATED_RECOVERY_PROOF, "1");
assert.equal(process.env.DATABASE_URL, undefined, "Never reuse an ambient database");
assert.notEqual(process.getuid?.(), 0, "Native PostgreSQL requires a non-root runner");
const bin = process.argv[2];
assert.ok(bin, "Pass the pinned native PostgreSQL 16 binary directory");
const fixture = await startNativePostgres16(bin, "imv1-disposable-stateful-only");
const env = {
  ...process.env,
  NODE_ENV: "test",
  TZ: "UTC",
  DATABASE_URL: `postgresql://postgres:imv1-disposable-stateful-only@127.0.0.1:${fixture.port}/postgres`,
  MEALSCOUT_DISPOSABLE_POSTGRES: "1",
  STRIPE_SECRET_KEY: "",
};
async function node(args) {
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: "inherit", timeout: 900_000 });
    child.once("error", reject);
    child.once("close", code => code === 0 ? done() : reject(new Error(`Native fixture command failed (${code})`)));
  });
}
try {
  // Mirror the canonical Docker orchestrator; only the owned PostgreSQL transport differs.
  await node([resolve("node_modules/drizzle-kit/bin.cjs"), "push", "--force"]);
  for (const file of ["090_recommendation_interactions_and_uniques.sql", "142_integrated_marketplace_purchase_review_arrival.sql"]) {
    const applied = fixture.run("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], readFileSync(resolve("migrations", file), "utf8"));
    assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  }
  await node(["--import", "tsx", "scripts/integratedMarketplaceProviderStateful.test.ts", "--fixture"]);
  console.log("RECOVERY_NATIVE_STATEFUL_PASS: canonical provider fixture on disposable PostgreSQL 16");
} finally {
  fixture.stop();
}
