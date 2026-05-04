import fs from "fs";
import path from "path";
import { sql } from "drizzle-orm";

import { db } from "../db";

const MENU_MIGRATIONS = [
  "089_online_menus_and_ordering.sql",
  "097_add_menu_import_url.sql",
] as const;
const STARTER_MENU_BACKFILL = "098_backfill_starter_menus.sql";
const STARTER_MENU_CLEANUP = "099_cleanup_system_backfilled_menus.sql";

function splitSqlStatements(sqlText: string): string[] {
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
        const open = sqlText.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
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
      if (trimmed) statements.push(trimmed);
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function isMenuSchemaReady() {
  const result = await db.execute(sql`
    select
      to_regclass('public.menus')::text as menus_table,
      to_regclass('public.menu_categories')::text as menu_categories_table,
      to_regclass('public.menu_items')::text as menu_items_table,
      to_regclass('public.menu_item_variants')::text as menu_item_variants_table,
      to_regclass('public.menu_item_modifiers')::text as menu_item_modifiers_table,
      to_regclass('public.menu_import_logs')::text as menu_import_logs_table,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'menus'
          and column_name = 'import_url'
      ) as menus_import_url_column
  `);
  const row = result.rows?.[0] as Record<string, unknown> | undefined;
  return Boolean(
    row?.menus_table &&
      row?.menu_categories_table &&
      row?.menu_items_table &&
      row?.menu_item_variants_table &&
      row?.menu_item_modifiers_table &&
      row?.menu_import_logs_table &&
      row?.menus_import_url_column,
  );
}

async function runMigrationFile(fileName: string) {
  const migrationPath = path.join(process.cwd(), "migrations", fileName);
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Menu migration file missing: ${migrationPath}`);
  }

  const statements = splitSqlStatements(fs.readFileSync(migrationPath, "utf8"));
  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}

async function applyCompatibilityRepairs() {
  const repairs = [
    `ALTER TABLE IF EXISTS menus ADD COLUMN IF NOT EXISTS import_url varchar`,
    `ALTER TABLE IF EXISTS menus ADD COLUMN IF NOT EXISTS accepts_cash boolean NOT NULL DEFAULT false`,
    `ALTER TABLE IF EXISTS menus ADD COLUMN IF NOT EXISTS hide_platform_fee boolean NOT NULL DEFAULT false`,
    `ALTER TABLE IF EXISTS menu_items ADD COLUMN IF NOT EXISTS image_url varchar`,
    `ALTER TABLE IF EXISTS menu_items ADD COLUMN IF NOT EXISTS allergens jsonb NOT NULL DEFAULT '[]'::jsonb`,
    `ALTER TABLE IF EXISTS menu_items ADD COLUMN IF NOT EXISTS dietary_tags jsonb NOT NULL DEFAULT '[]'::jsonb`,
    `CREATE INDEX IF NOT EXISTS idx_menus_restaurant ON menus(restaurant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_menu_items_menu ON menu_items(menu_id)`,
    `CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant ON menu_items(restaurant_id)`,
  ];

  for (const repair of repairs) {
    await db.execute(sql.raw(repair));
  }
}

export async function ensureMenuSchema() {
  if (!db) return;

  if (await isMenuSchemaReady()) {
    await runMigrationFile(STARTER_MENU_BACKFILL);
    await runMigrationFile(STARTER_MENU_CLEANUP);
    console.log("[menu-schema] ready");
    return;
  }

  console.warn("[menu-schema] missing or incomplete; applying menu migrations");
  for (const migration of MENU_MIGRATIONS) {
    await runMigrationFile(migration);
  }
  await applyCompatibilityRepairs();
  await runMigrationFile(STARTER_MENU_BACKFILL);
  await runMigrationFile(STARTER_MENU_CLEANUP);

  if (!(await isMenuSchemaReady())) {
    throw new Error("Menu schema migration completed but readiness check still failed");
  }

  console.log("[menu-schema] migrations applied successfully");
}
