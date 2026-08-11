import "dotenv/config";
import { db } from "../server/db.js";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { splitSqlStatements } from "./sqlMigrationStatements";

export { splitSqlStatements } from "./sqlMigrationStatements";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrationFile(
  fileArg: string,
  options: { quiet?: boolean } = {},
) {
  const migrationPath = path.isAbsolute(fileArg)
    ? fileArg
    : path.join(__dirname, "../migrations", fileArg);
  const log = options.quiet ? () => undefined : console.log;
  log(`Running migration: ${migrationPath}\n`);

  const migrationSQL = fs.readFileSync(migrationPath, "utf-8");
  const statements = splitSqlStatements(migrationSQL);
  log(`Found ${statements.length} SQL statements to execute\n`);

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i];
    const preview = statement.substring(0, 100).replace(/\s+/g, " ");

    try {
      log(`[${i + 1}/${statements.length}] Executing: ${preview}...`);
      await db.execute(sql.raw(statement));
      log("Success\n");
    } catch (error: any) {
      if (error?.code === "42701" || error?.message?.includes("already exists")) {
        log("Skipped (already exists)\n");
        continue;
      }
      throw error;
    }
  }

  log("Migration completed successfully!\n");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === __filename) {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error("Usage: tsx scripts/runSqlMigration.ts <migration-file.sql>");
    process.exit(1);
  }

  runMigrationFile(fileArg).catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
}
