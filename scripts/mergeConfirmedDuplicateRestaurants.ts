import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { restaurants, truckClaimRequests } from "../shared/schema";

/**
 * One-time cleanup: delete two confirmed-empty duplicate restaurant rows,
 * per direction from the 2026-07-14 conversation record (same lineage as
 * 596706fa / scripts/backfillEarlyAccountTrials.ts).
 *
 * Both target rows were verified empty across menus, deals, favorites,
 * follows, recommendations, subscriptions, food truck sessions/locations,
 * business staff memberships, booked events, and verification requests
 * before this script was written - nothing is lost by deleting them.
 *
 * - CREATIVBOWLS duplicate (c07e668e...), owned by the same owner as the
 *   real verified CREATIVBOWLS row (75dd470e...), which already carries the
 *   lifetime-free subscription grant from the 596706fa cleanup.
 * - "3-D EATS" duplicate (271878aa...), owned by the same owner as the real
 *   verified "3D Eats & Tea" row (95c4e656...), which has the actual
 *   menu/deals/session content.
 *
 * Also included (second batch, 2026-07-14): four more empty duplicate rows
 * under an account the admin onboarded and manages directly via super
 * admin - not a separate, unconfirmed owner. Deleting the listing noise
 * only; this does not touch or merge the underlying user account.
 *
 * Usage:
 *   npx tsx scripts/mergeConfirmedDuplicateRestaurants.ts --dry-run
 *   npx tsx scripts/mergeConfirmedDuplicateRestaurants.ts --apply
 */

const TARGETS = [
  {
    label: "CREATIVBOWLS duplicate",
    deleteId: "c07e668e-63a9-4c1f-8a10-95bd15978df3",
    keepId: "75dd470e-2692-4579-bde0-a64dcc3f6fcb",
  },
  {
    label: "3-D EATS duplicate (real business is 3D Eats & Tea)",
    deleteId: "271878aa-082c-4990-a0ae-4da1d665ca0a",
    keepId: "95c4e656-f3cc-46ab-ae18-53f549cecfd1",
  },
  // Second batch (2026-07-14): four more empty duplicate rows under an
  // account the admin onboarded and manages directly via super admin, with
  // no truck_claim_requests. Deleting the listing noise only - this does
  // not touch or merge the underlying user account.
  {
    label: "3-D EATS duplicate #2 (owner account confirmed same real business)",
    deleteId: "7ff7ba14-8e0a-48cf-b20a-e663e8d9d9e1",
    keepId: "95c4e656-f3cc-46ab-ae18-53f549cecfd1",
  },
  {
    label: "3-D EATS duplicate #3 (owner account confirmed same real business)",
    deleteId: "4c39db22-6c2f-4312-820f-45ad79aa9998",
    keepId: "95c4e656-f3cc-46ab-ae18-53f549cecfd1",
  },
  {
    label: "3-D EATS duplicate #4, currently active (owner account confirmed same real business)",
    deleteId: "53de3f22-ebb6-4726-81c3-b2eba7c4ebc8",
    keepId: "95c4e656-f3cc-46ab-ae18-53f549cecfd1",
  },
  {
    label: "CREATIVBOWLS duplicate #2 (owner account confirmed same real business)",
    deleteId: "16f4f038-6e85-4448-a03d-0669cc6e2876",
    keepId: "75dd470e-2692-4579-bde0-a64dcc3f6fcb",
  },
];

const parseArgs = () => {
  const args = new Set(process.argv.slice(2));
  return { apply: args.has("--apply"), dryRun: !args.has("--apply") };
};

async function main() {
  const { apply, dryRun } = parseArgs();
  console.log(
    `[merge-duplicate-restaurants] Starting (${dryRun ? "DRY RUN - no writes" : "APPLY"})...`,
  );

  const backupRows: unknown[] = [];
  for (const target of TARGETS) {
    const [row] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, target.deleteId));
    if (!row) {
      console.log(
        `[merge-duplicate-restaurants] ${target.label}: row ${target.deleteId} not found (already removed?). Skipping.`,
      );
      continue;
    }
    const claimRequestRows = await db
      .select()
      .from(truckClaimRequests)
      .where(eq(truckClaimRequests.restaurantId, target.deleteId));
    backupRows.push({ target: target.label, row, claimRequestRows });
    console.log(
      `[merge-duplicate-restaurants] ${dryRun ? "[DRY RUN] Would delete" : "Deleting"} ${target.label}: ${target.deleteId} (keeping ${target.keepId}), plus ${claimRequestRows.length} truck_claim_requests row(s).`,
    );
  }

  mkdirSync("backups", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `backups/merge-duplicate-restaurants-${stamp}.json`;
  writeFileSync(backupPath, JSON.stringify(backupRows, null, 2), "utf8");
  console.log(`[merge-duplicate-restaurants] Backup written: ${backupPath}`);

  if (!apply) {
    console.log(
      "\n[merge-duplicate-restaurants] DRY-RUN: no rows deleted. Review the backup, then re-run with --apply.",
    );
    return;
  }

  await db.transaction(async (tx: any) => {
    for (const target of TARGETS) {
      await tx
        .delete(truckClaimRequests)
        .where(eq(truckClaimRequests.restaurantId, target.deleteId));
      await tx.delete(restaurants).where(eq(restaurants.id, target.deleteId));
      console.log(
        `[merge-duplicate-restaurants] Deleted ${target.label} and its claim request(s).`,
      );
    }
  });
  console.log("\n[merge-duplicate-restaurants] Done.");
}

main()
  .catch((err) => {
    console.error("[merge-duplicate-restaurants] Fatal error:", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
