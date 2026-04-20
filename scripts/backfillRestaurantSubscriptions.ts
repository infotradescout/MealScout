/**
 * backfillRestaurantSubscriptions.ts
 *
 * One-time backfill: for every restaurant whose owner has a non-null
 * stripeSubscriptionId on their user record, upsert a row in the
 * restaurant_subscriptions table so the assertHasOrderingSubscription
 * access gate works correctly.
 *
 * This is needed because existing manually-added hosts/trucks had their
 * subscriptions provisioned directly on the users table, bypassing the
 * invoice.payment_succeeded webhook that normally writes this row.
 *
 * Usage:
 *   # Dry run (no writes):
 *   npm run backfill:restaurant-subscriptions -- --dry-run
 *
 *   # Apply:
 *   npm run backfill:restaurant-subscriptions
 */

import "dotenv/config";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../server/db";
import { restaurants, restaurantSubscriptions, users } from "../shared/schema";

const parseArgs = () => {
  const args = new Set(process.argv.slice(2));
  return {
    dryRun: args.has("--dry-run") || args.has("-n"),
  };
};

async function run() {
  const { dryRun } = parseArgs();
  console.log(
    `[backfill:restaurant-subscriptions] Starting (${dryRun ? "DRY RUN — no writes" : "APPLY"})...`,
  );

  // 1. Find all users with an active stripeSubscriptionId
  const subscribedUsers = await db
    .select({
      id: users.id,
      email: users.email,
      stripeSubscriptionId: users.stripeSubscriptionId,
      stripeCustomerId: users.stripeCustomerId,
    })
    .from(users)
    .where(isNotNull(users.stripeSubscriptionId));

  console.log(
    `[backfill:restaurant-subscriptions] Found ${subscribedUsers.length} user(s) with a stripeSubscriptionId.`,
  );

  if (subscribedUsers.length === 0) {
    console.log("[backfill:restaurant-subscriptions] Nothing to backfill. Done.");
    return;
  }

  const userIds = subscribedUsers.map((u) => u.id);

  // 2. Find all restaurants owned by those users
  const ownedRestaurants = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      userId: restaurants.userId,
    })
    .from(restaurants)
    .where(inArray(restaurants.userId, userIds));

  console.log(
    `[backfill:restaurant-subscriptions] Found ${ownedRestaurants.length} restaurant(s) owned by subscribed users.`,
  );

  if (ownedRestaurants.length === 0) {
    console.log("[backfill:restaurant-subscriptions] No restaurants found. Done.");
    return;
  }

  // 3. Check which restaurants already have an active subscription row
  const restaurantIds = ownedRestaurants.map((r) => r.id);
  const existingRows = await db
    .select({ restaurantId: restaurantSubscriptions.restaurantId })
    .from(restaurantSubscriptions)
    .where(
      and(
        inArray(restaurantSubscriptions.restaurantId, restaurantIds),
        eq(restaurantSubscriptions.status, "active"),
      ),
    );

  const alreadyCovered = new Set(existingRows.map((r) => r.restaurantId));

  const toBackfill = ownedRestaurants.filter((r) => !alreadyCovered.has(r.id));

  console.log(
    `[backfill:restaurant-subscriptions] ${alreadyCovered.size} already covered, ${toBackfill.length} need backfill.`,
  );

  if (toBackfill.length === 0) {
    console.log("[backfill:restaurant-subscriptions] All restaurants already have active subscription rows. Done.");
    return;
  }

  // 4. Build a lookup map: userId → user record
  const userMap = new Map(subscribedUsers.map((u) => [u.id, u]));

  let inserted = 0;
  let skipped = 0;
  const now = new Date();

  for (const restaurant of toBackfill) {
    const owner = userMap.get(restaurant.userId ?? "");
    if (!owner) {
      console.warn(
        `[backfill:restaurant-subscriptions] SKIP ${restaurant.id} (${restaurant.name}) — owner not found`,
      );
      skipped += 1;
      continue;
    }

    console.log(
      `[backfill:restaurant-subscriptions] ${dryRun ? "[DRY RUN] Would insert" : "Inserting"} row for restaurant ${restaurant.id} (${restaurant.name}) owner=${owner.email}`,
    );

    if (!dryRun) {
      await db.insert(restaurantSubscriptions).values({
        restaurantId: restaurant.id,
        tier: "monthly",
        status: "active",
        priceCents: 2500,
        billingInterval: "monthly",
        canPostVideos: true,
        canPostDeals: true,
        canUseFeaturedSlots: true,
        maxFeaturedSlots: 3,
        hasAnalytics: true,
        hasDealScheduling: true,
        stripeCustomerId: owner.stripeCustomerId ?? null,
        stripeSubscriptionId: owner.stripeSubscriptionId ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }

    inserted += 1;
  }

  console.log(
    `[backfill:restaurant-subscriptions] Done. inserted=${inserted} skipped=${skipped} dry_run=${dryRun}`,
  );
}

run().catch((err) => {
  console.error("[backfill:restaurant-subscriptions] Fatal error:", err);
  process.exit(1);
});
