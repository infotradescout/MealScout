import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEPLOY_MIGRATION_FLOOR,
  DEPLOY_MIGRATION_LOCK_TIMEOUT_MS,
  assertTransactionCompatibleMigration,
  discoverDeployMigrations,
  planDeployMigrations,
  resolveMigrationDatabaseUrl,
} from "./runDeployMigrations";

const migrations = discoverDeployMigrations();
assert.ok(migrations.length >= 4, "release migration set must include 119-122");
assert.equal(migrations[0]?.number, DEPLOY_MIGRATION_FLOOR);
assert.deepEqual(
  migrations.slice(0, 4).map((migration) => migration.number),
  [119, 120, 121, 122],
);
assert.equal(
  planDeployMigrations(migrations, []).length,
  migrations.length,
  "an empty ledger must apply every release migration",
);

const applied = migrations.map((migration) => ({
  filename: migration.filename,
  migrationNumber: migration.number,
  sha256: migration.sha256,
}));
assert.deepEqual(
  planDeployMigrations(migrations, applied),
  [],
  "an intact ledger must make repeated deploys a no-op",
);
assert.throws(
  () =>
    planDeployMigrations(migrations, [
      { ...applied[0]!, sha256: "changed-after-apply" },
    ]),
  /changed after execution/,
  "editing an applied migration must fail closed",
);
assert.throws(
  () =>
    planDeployMigrations(migrations.slice(1), [applied[0]!]),
  /file is missing/,
  "deleting applied migration history must fail closed",
);
assert.ok(
  DEPLOY_MIGRATION_LOCK_TIMEOUT_MS > 0,
  "migration lock wait must be bounded",
);
assert.doesNotThrow(() =>
  assertTransactionCompatibleMigration(migrations[0]!, "select 1"),
);
assert.throws(
  () =>
    assertTransactionCompatibleMigration(
      migrations[0]!,
      "create index concurrently idx_example on example(id)",
    ),
  /dedicated non-transactional deploy path/,
  "concurrent indexes must retain their semantics outside the transactional path",
);
assert.throws(
  () =>
    assertTransactionCompatibleMigration(
      migrations[0]!,
      "create unique index concurrently uq_example on example(id)",
    ),
  /dedicated non-transactional deploy path/,
  "unique concurrent indexes must also retain their non-transactional semantics",
);
assert.equal(
  new URL(
    resolveMigrationDatabaseUrl({
      DATABASE_URL:
        "postgresql://user:password@ep-example-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require",
    }),
  ).hostname,
  "ep-example.us-east-2.aws.neon.tech",
  "the migration runner must bypass Neon's transaction pooler",
);
assert.equal(
  new URL(
    resolveMigrationDatabaseUrl({
      DATABASE_URL:
        "postgresql://user:password@ep-pooled-pooler.us-east-2.aws.neon.tech/neondb",
      MIGRATION_DATABASE_URL:
        "postgresql://user:password@ep-direct.us-east-2.aws.neon.tech/neondb",
    }),
  ).hostname,
  "ep-direct.us-east-2.aws.neon.tech",
  "an explicit direct migration URL must take precedence",
);
assert.throws(
  () =>
    resolveMigrationDatabaseUrl({
      MIGRATION_DATABASE_URL:
        "postgresql://user:password@pgbouncer-pooler.example.com/app",
    }),
  /direct Postgres connection/,
);

const runnerSource = readFileSync("scripts/runDeployMigrations.ts", "utf8");
assert.match(
  runnerSource,
  /const client = await pool\.connect\(\)/,
  "the advisory lock must remain pinned to one database session",
);
assert.doesNotMatch(
  runnerSource,
  /import\("\.\.\/server\/db\.js"\)/,
  "the deploy runner must not reuse the app's pooled database client",
);
assert.match(
  runnerSource,
  /pg_advisory_lock/,
  "concurrent migration runs must serialize behind a bounded blocking lock",
);
assert.doesNotMatch(runnerSource, /pg_try_advisory_lock/);
assert.match(
  runnerSource,
  /client\.query\("begin"\)[\s\S]*insert into mealscout_release_migrations[\s\S]*client\.query\("commit"\)/,
  "migration SQL and its ledger record must commit atomically",
);

const renderConfig = readFileSync("render.yaml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
assert.match(
  renderConfig,
  /preDeployCommand:\s*npm run migrate:deploy/,
  "Render must run pending migrations before switching traffic",
);
assert.equal(
  packageJson.scripts["migrate:deploy"],
  "tsx scripts/runDeployMigrations.ts",
);

console.log("mealscout-render-migration-gate.contract: PASS");
