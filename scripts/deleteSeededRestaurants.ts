import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { sql, eq, and } from "drizzle-orm";
import { db } from "../server/db";
import { users, restaurants } from "../shared/schema";

/**
 * Delete "seeded" restaurant rows created by batch admin upload
 * (scripts/mealscout-bulk-truck-ingest.ts), identified by ownership of the
 * import system user (system-import@mealscout.us, override via IMPORT_SYSTEM_EMAIL).
 *
 * SAFETY:
 * - Default target EXCLUDES active rows (active seeded rows are real, in-progress
 *   businesses e.g. claimed profiles with menus). Use --include-active to override
 *   (NOT recommended).
 * - Default mode is DRY-RUN: no deletes. It writes a JSON backup of the target set
 *   to ./backups/ so the exact rows can be reviewed / restored.
 * - --apply performs the delete inside a transaction, AFTER writing the backup.
 * - Verified precondition (2026-07-06): the inactive seeded set has 0 rows in any
 *   blocking-FK table (deals/reviews/favorites/orders/subscriptions/claims/etc.),
 *   so deletes will not be blocked; CASCADE FKs clean up the ~3 menus.
 *
 * Examples:
 *   node --import tsx scripts/deleteSeededRestaurants.ts                 # dry-run + backup
 *   node --import tsx scripts/deleteSeededRestaurants.ts --apply         # delete inactive seeded
 */

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const includeActive = args.includes("--include-active");

  const importEmail =
    (process.env.IMPORT_SYSTEM_EMAIL || "system-import@mealscout.us").toLowerCase();
  const [importUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, importEmail))
    .limit(1);
  if (!importUser) {
    console.error(`Import system user (${importEmail}) not found. Aborting.`);
    process.exit(1);
  }

  const whereClause = includeActive
    ? eq(restaurants.ownerId, importUser.id)
    : and(eq(restaurants.ownerId, importUser.id), eq(restaurants.isActive, false));

  const target = await db.select().from(restaurants).where(whereClause);

  console.log(`Mode: ${apply ? "APPLY (will DELETE)" : "DRY-RUN (no deletes)"}`);
  console.log(`Import system user: ${importEmail} (${importUser.id})`);
  console.log(`Target rows: ${target.length} (${includeActive ? "including active" : "inactive only; active preserved"})`);

  if (target.length === 0) {
    console.log("Nothing to do.");
    process.exit(0);
  }

  // Always write a backup of the exact target set (reversibility).
  mkdirSync("backups", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `backups/seeded-restaurants-${stamp}.json`;
  writeFileSync(backupPath, JSON.stringify(target, null, 2), "utf8");
  console.log(`Backup written: ${backupPath}`);

  if (!apply) {
    console.log("\nDRY-RUN: no rows deleted. Review the backup, then re-run with --apply.");
    process.exit(0);
  }

  const ids = target.map((r) => r.id);
  let deleted = 0;
  await db.transaction(async (tx: any) => {
    // Delete in chunks to keep statements bounded. CASCADE FKs handle child rows;
    // blocking-FK tables were verified empty for this set.
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      const res: any = await tx.execute(
        sql`DELETE FROM restaurants WHERE id = ANY(${chunk})`,
      );
      deleted += Number(res.rowCount ?? chunk.length);
    }
  });

  console.log(`\nDeleted ${deleted} seeded restaurant row(s). Backup at ${backupPath}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Seeded restaurant delete failed:", e);
  process.exit(1);
});
