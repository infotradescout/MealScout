import "dotenv/config";
import { db } from "../server/db.js";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function splitSqlStatements(sqlText: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag: string | null = null;

  while (i < sqlText.length) {
    const ch = sqlText[i];
    const next = i + 1 < sqlText.length ? sqlText[i + 1] : "";

    if (!inSingle && !inDouble && !inBlockComment && !dollarTag) {
      if (!inLineComment && ch === "-" && next === "-") {
        inLineComment = true;
        current += ch + next;
        i += 2;
        continue;
      }
      if (inLineComment) {
        current += ch;
        i += 1;
        if (ch === "\n") inLineComment = false;
        continue;
      }
    }

    if (!inSingle && !inDouble && !inLineComment && !dollarTag) {
      if (!inBlockComment && ch === "/" && next === "*") {
        inBlockComment = true;
        current += ch + next;
        i += 2;
        continue;
      }
      if (inBlockComment) {
        current += ch;
        i += 1;
        if (ch === "*" && next === "/") {
          current += next;
          i += 1;
          inBlockComment = false;
        }
        continue;
      }
    }

    if (!inSingle && !inDouble && !inLineComment && !inBlockComment) {
      if (!dollarTag && ch === "$") {
        const rest = sqlText.slice(i);
        const open = rest.match(/^\$[A-Za-z0-9_]*\$/);
        if (open) {
          dollarTag = open[0];
          current += dollarTag;
          i += dollarTag.length;
          continue;
        }
      } else if (dollarTag && sqlText.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
    }

    if (!inDouble && !inLineComment && !inBlockComment && !dollarTag && ch === "'") {
      inSingle = !inSingle;
      current += ch;
      i += 1;
      continue;
    }
    if (!inSingle && !inLineComment && !inBlockComment && !dollarTag && ch === '"') {
      inDouble = !inDouble;
      current += ch;
      i += 1;
      continue;
    }

    if (!inSingle && !inDouble && !inLineComment && !inBlockComment && !dollarTag && ch === ";") {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  const tail = current.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

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
