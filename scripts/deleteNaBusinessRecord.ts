import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { restaurants, menus } from "@shared/schema";

/**
 * One-time cleanup: delete the restaurant row literally named "N/A"
 * (e48278f1-afe5-49be-b763-c76c2fe3d55e), surfaced by the 2026-07-14
 * real-account completeness report as 0/5 complete with a placeholder
 * name and cuisine type of "N/A".
 *
 * Verified empty before this script was written: no deals, favorites,
 * follows, recommendations, subscriptions, food truck sessions/locations,
 * business staff memberships/invites, event bookings, verification
 * requests, truck claim requests, reviews, manual schedules, parking
 * reports, or credit redemptions. Its one menu has zero menu items. The
 * owner (Shannon Potter) has no other restaurant row and never logged in.
 *
 * Usage:
 *   npx tsx scripts/deleteNaBusinessRecord.ts --dry-run
 *   npx tsx scripts/deleteNaBusinessRecord.ts --apply
 */

const RESTAURANT_ID = "e48278f1-afe5-49be-b763-c76c2fe3d55e";

const parseArgs = () => {
  const args = new Set(process.argv.slice(2));
  return { apply: args.has("--apply"), dryRun: !args.has("--apply") };
};

async function main() {
  const { apply, dryRun } = parseArgs();
  console.log(
    `[delete-na-business-record] Starting (${dryRun ? "DRY RUN - no writes" : "APPLY"})...`,
  );

  const [restaurantRow] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, RESTAURANT_ID));
  if (!restaurantRow) {
    console.log(
      `[delete-na-business-record] Row ${RESTAURANT_ID} not found (already removed?). Nothing to do.`,
    );
    return;
  }

  const menuRows = await db
    .select()
    .from(menus)
    .where(eq(menus.restaurantId, RESTAURANT_ID));

  mkdirSync("backups", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `backups/delete-na-business-record-${stamp}.json`;
  writeFileSync(
    backupPath,
    JSON.stringify({ restaurant: restaurantRow, menus: menuRows }, null, 2),
    "utf8",
  );
  console.log(`[delete-na-business-record] Backup written: ${backupPath}`);
  console.log(
    `[delete-na-business-record] ${dryRun ? "[DRY RUN] Would delete" : "Deleting"} restaurant ${RESTAURANT_ID} ("${restaurantRow.name}") and ${menuRows.length} menu row(s).`,
  );

  if (!apply) {
    console.log(
      "\n[delete-na-business-record] DRY-RUN: no rows deleted. Review the backup, then re-run with --apply.",
    );
    return;
  }

  await db.transaction(async (tx: any) => {
    await tx.delete(menus).where(eq(menus.restaurantId, RESTAURANT_ID));
    await tx.delete(restaurants).where(eq(restaurants.id, RESTAURANT_ID));
  });
  console.log("\n[delete-na-business-record] Done.");
}

main()
  .catch((err) => {
    console.error("[delete-na-business-record] Fatal error:", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
