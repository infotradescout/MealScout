import "dotenv/config";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

import { splitSqlStatements } from "./sqlMigrationStatements";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEPLOY_MIGRATION_FLOOR = 119;
export const DEPLOY_MIGRATION_LOCK_KEY = 2026081101;
export const DEPLOY_MIGRATION_LOCK_TIMEOUT_MS = 120_000;

neonConfig.webSocketConstructor = ws;

export type DeployMigration = {
  filename: string;
  number: number;
  path: string;
  sha256: string;
  compatibleSha256s: readonly string[];
};

export type AppliedDeployMigration = {
  filename: string;
  migrationNumber: number;
  sha256: string;
};

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

export function normalizeMigrationSqlForFingerprint(sqlText: string): string {
  return sqlText.replace(/\r\n?/g, "\n");
}

export function migrationFingerprints(sqlText: string): {
  canonical: string;
  compatible: readonly string[];
} {
  const canonicalSql = normalizeMigrationSqlForFingerprint(sqlText);
  const canonical = sha256(canonicalSql);
  const legacyCrLf = sha256(canonicalSql.replace(/\n/g, "\r\n"));
  return {
    canonical,
    compatible: [...new Set([canonical, legacyCrLf])],
  };
}

export function discoverDeployMigrations(
  migrationsDirectory = path.resolve(__dirname, "../migrations"),
  floor = DEPLOY_MIGRATION_FLOOR,
): DeployMigration[] {
  return fs
    .readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => {
      const match = entry.name.match(/^(\d+)/);
      if (!match) return null;
      const number = Number(match[1]);
      if (number < floor) return null;
      const migrationPath = path.join(migrationsDirectory, entry.name);
      const fingerprints = migrationFingerprints(
        fs.readFileSync(migrationPath, "utf8"),
      );
      return {
        filename: entry.name,
        number,
        path: migrationPath,
        sha256: fingerprints.canonical,
        compatibleSha256s: fingerprints.compatible,
      };
    })
    .filter((entry): entry is DeployMigration => entry !== null)
    .sort((left, right) =>
      left.number === right.number
        ? left.filename.localeCompare(right.filename)
        : left.number - right.number,
    );
}

export function planDeployMigrations(
  available: DeployMigration[],
  applied: AppliedDeployMigration[],
): DeployMigration[] {
  const availableByFilename = new Map(
    available.map((migration) => [migration.filename, migration]),
  );
  const appliedByFilename = new Map(
    applied.map((migration) => [migration.filename, migration]),
  );

  for (const record of applied) {
    const migration = availableByFilename.get(record.filename);
    if (!migration) {
      throw new Error(
        `Applied migration file is missing: ${record.filename}. Restore immutable migration history.`,
      );
    }
    if (
      migration.number !== record.migrationNumber ||
      !migration.compatibleSha256s.includes(record.sha256)
    ) {
      throw new Error(
        `Applied migration changed after execution: ${record.filename}`,
      );
    }
  }

  return available.filter(
    (migration) => !appliedByFilename.has(migration.filename),
  );
}

export function assertTransactionCompatibleMigration(
  migration: DeployMigration,
  sqlText: string,
): void {
  if (
    /\b(?:create\s+(?:unique\s+)?index|drop\s+index)\s+concurrently\b/i.test(
      sqlText,
    )
  ) {
    throw new Error(
      `${migration.filename} requires a dedicated non-transactional deploy path; ` +
        "do not weaken CREATE/DROP INDEX CONCURRENTLY to make this gate pass",
    );
  }
}

export function resolveMigrationDatabaseUrl(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const raw =
    environment.MIGRATION_DATABASE_URL || environment.DATABASE_URL || "";
  if (!raw) {
    throw new Error(
      "MIGRATION_DATABASE_URL or DATABASE_URL is required for deploy migrations",
    );
  }

  const parsed = new URL(raw);
  if (!environment.MIGRATION_DATABASE_URL && /\.neon\.tech$/i.test(parsed.hostname)) {
    parsed.hostname = parsed.hostname.replace(/-pooler(?=\.)/i, "");
  }
  if (/-pooler(?=\.)/i.test(parsed.hostname)) {
    throw new Error(
      "Deploy migrations require a direct Postgres connection, not a transaction-pooled endpoint",
    );
  }
  return parsed.toString();
}

export async function runDeployMigrations(): Promise<void> {
  const pool = new Pool({
    connectionString: resolveMigrationDatabaseUrl(),
    max: 1,
  });

  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query(
      "select set_config('statement_timeout', $1, false)",
      [`${DEPLOY_MIGRATION_LOCK_TIMEOUT_MS}ms`],
    );
    await client.query("select pg_advisory_lock($1)", [
      DEPLOY_MIGRATION_LOCK_KEY,
    ]);
    lockAcquired = true;
    await client.query("select set_config('statement_timeout', '0', false)");

    await client.query(`
      create table if not exists mealscout_release_migrations (
        filename text primary key,
        migration_number integer not null,
        sha256 text not null,
        execution_ms integer not null,
        applied_at timestamptz not null default now()
      )
    `);

    const appliedResult = await client.query(
      `
      select
        filename,
        migration_number as "migrationNumber",
        sha256
      from mealscout_release_migrations
      where migration_number >= $1
      order by migration_number, filename
    `,
      [DEPLOY_MIGRATION_FLOOR],
    );
    const available = discoverDeployMigrations();
    const pending = planDeployMigrations(
      available,
      appliedResult.rows as AppliedDeployMigration[],
    );

    for (const migration of pending) {
      const migrationSql = fs.readFileSync(migration.path, "utf8");
      assertTransactionCompatibleMigration(migration, migrationSql);
      const statements = splitSqlStatements(migrationSql);
      const startedAt = Date.now();
      console.log(`Applying deploy migration ${migration.filename}`);
      await client.query("begin");
      try {
        for (const statement of statements) {
          await client.query(statement);
        }
        await client.query(
          `insert into mealscout_release_migrations
            (filename, migration_number, sha256, execution_ms)
           values ($1, $2, $3, $4)`,
          [
            migration.filename,
            migration.number,
            migration.sha256,
            Date.now() - startedAt,
          ],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      }
    }

    console.log(
      `Deploy migration PASS (${pending.length} applied, ${available.length - pending.length} already recorded)`,
    );
  } finally {
    if (lockAcquired) {
      await client
        .query("select pg_advisory_unlock($1)", [DEPLOY_MIGRATION_LOCK_KEY])
        .catch((error: unknown) => {
          console.error("Failed to release deploy migration lock:", error);
        });
    }
    client.release();
    await pool.end().catch(() => undefined);
  }
}

if (path.resolve(process.argv[1] || "") === __filename) {
  runDeployMigrations().catch((error) => {
    console.error("Deploy migration failed:", error);
    process.exit(1);
  });
}
