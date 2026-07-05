/**
 * backfillEarlyAccountTrials.ts
 *
 * One-time cleanup for a specific set of ~91 business accounts that signed
 * up at various points early in development. Most of that set turned out
 * to be seed/test/smoke-test fixtures (excluded here, handled separately)
 * - this script only touches the real businesses identified in that audit:
 *
 * 1. Deletes one confirmed duplicate: an old "CreativBowls" restaurant row
 *    owned by the generic system-import@mealscout.us placeholder account,
 *    superseded by a real owner's "CREATIVBOWLS" signup. Verified this
 *    duplicate has zero menus/items/deals/favorites/follows/recommendations
 *    before deleting - nothing is lost.
 * 2. Grants permanent lifetime-free premium access (no monthly subscription
 *    fee - they still owe any other fees, e.g. the per-order platform fee)
 *    to CreativBowls and Sweet Love, matching the exact row already in
 *    place for 3D Eats & Tea ("Partner lifetime access").
 *
 * NOT done here (per direction): the 30-day trial doesn't start for anyone
 * until a future common launch date, applied uniformly to every account
 * then - not backdated to each account's original signup date.
 *
 * Deliberately NOT touched (see conversation record for why):
 * - Orphaned rows whose owner user is already deleted/anonymized.
 * - System-import-placeholder-owned rows with no identified real-owner
 *   duplicate.
 * - ranking_score - confirmed 0/null across ALL active restaurants
 *   app-wide, not specific to this set.
 * - Profile fields (logo/cover/website/description) - needs owner input.
 *
 * Usage:
 *   npx tsx scripts/backfillEarlyAccountTrials.ts --dry-run
 *   npx tsx scripts/backfillEarlyAccountTrials.ts
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { restaurants, restaurantSubscriptions } from "../shared/schema";

const DUPLICATE_RESTAURANT_ID_TO_DELETE = "9c9c809e-f14f-42e2-9837-f430668f2f1d"; // CreativBowls, May 5, system-import owner - superseded by CREATIVBOWLS (real owner)

// Matches the existing 3D Eats & Tea row exactly (tier/status/feature flags),
// just a different restaurant_id and reason wording per account.
const LIFETIME_FREE_GRANTS: { name: string; restaurantId: string }[] = [
  { name: "CREATIVBOWLS", restaurantId: "75dd470e-2692-4579-bde0-a64dcc3f6fcb" },
  { name: "Sweet Love", restaurantId: "f3b76054-f355-43b0-a2d3-901277748557" },
];

const parseArgs = () => {
  const args = new Set(process.argv.slice(2));
  return { dryRun: args.has("--dry-run") || args.has("-n") };
};

async function run() {
  const { dryRun } = parseArgs();
  console.log(`[backfill-early-accounts] Starting (${dryRun ? "DRY RUN - no writes" : "APPLY"})...`);

  console.log(
    `[backfill-early-accounts] ${dryRun ? "[DRY RUN] Would delete" : "Deleting"} duplicate restaurant ${DUPLICATE_RESTAURANT_ID_TO_DELETE} (CreativBowls, system-import placeholder).`,
  );
  if (!dryRun) {
    await db.delete(restaurants).where(eq(restaurants.id, DUPLICATE_RESTAURANT_ID_TO_DELETE));
  }

  const now = new Date();
  for (const { name, restaurantId } of LIFETIME_FREE_GRANTS) {
    console.log(
      `[backfill-early-accounts] ${dryRun ? "[DRY RUN] Would insert" : "Inserting"} lifetime-free subscription row for ${name} (${restaurantId}).`,
    );
    if (!dryRun) {
      await db.insert(restaurantSubscriptions).values({
        restaurantId,
        tier: "premium",
        status: "active",
        priceCents: 0,
        billingInterval: "monthly",
        isLifetimeFree: true,
        lifetimeReason: "Partner lifetime access",
        lifetimeGrantedAt: now,
        canPostVideos: true,
        canPostDeals: true,
        canUseFeaturedSlots: true,
        maxFeaturedSlots: 3,
        hasAnalytics: true,
        hasDealScheduling: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  console.log(`[backfill-early-accounts] Done. dry_run=${dryRun}`);
}

run().catch((err) => {
  console.error("[backfill-early-accounts] Fatal error:", err);
  process.exit(1);
});
