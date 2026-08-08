import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrationFile } from "./runSqlMigration";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDirectory = path.resolve(__dirname, "../migrations");

function numericOption(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number(raw.slice(prefix.length));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${prefix}<nonnegative integer> is required`);
  }
  return value;
}

async function run() {
  const from = numericOption("from", 0);
  const through = numericOption("through", Number.MAX_SAFE_INTEGER);
  if (from > through) throw new Error("--from cannot exceed --through");

  const migrations = fs
    .readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => {
      const match = entry.name.match(/^(\d+)/);
      return match
        ? { name: entry.name, number: Number(match[1]) }
        : null;
    })
    .filter(
      (entry): entry is { name: string; number: number } =>
        entry !== null && entry.number >= from && entry.number <= through,
    )
    .sort((left, right) =>
      left.number === right.number
        ? left.name.localeCompare(right.name)
        : left.number - right.number,
    );

  for (const migration of migrations) {
    try {
      await runMigrationFile(
        path.join(migrationsDirectory, migration.name),
        { quiet: true },
      );
    } catch (error) {
      console.error(`Migration chain failed at ${migration.name}`);
      throw error;
    }
  }

  console.log(
    `Migration chain PASS (${migrations.length} files, ${migrations[0]?.name || "none"} through ${migrations.at(-1)?.name || "none"})`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
