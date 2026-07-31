import Stripe from "stripe";
import { eq, isNotNull } from "drizzle-orm";

import { db } from "../server/db";
import { restaurantSubscriptions, users } from "../shared/schema";

const apply = process.argv.includes("--apply");
const secret = String(process.env.STRIPE_SECRET_KEY || "").trim();

if (apply && !secret) {
  throw new Error("STRIPE_SECRET_KEY is required with --apply");
}

const stripe = secret ? new Stripe(secret) : null;

const legacyUsers = await db
  .select({
    id: users.id,
    stripeSubscriptionId: users.stripeSubscriptionId,
  })
  .from(users)
  .where(isNotNull(users.stripeSubscriptionId));

const legacyRestaurantRows = await db
  .select({
    restaurantId: restaurantSubscriptions.restaurantId,
    stripeSubscriptionId: restaurantSubscriptions.stripeSubscriptionId,
  })
  .from(restaurantSubscriptions)
  .where(isNotNull(restaurantSubscriptions.stripeSubscriptionId));

const legacySubscriptionIds = Array.from(
  new Set(
    [...legacyUsers, ...legacyRestaurantRows]
      .map((row) => String(row.stripeSubscriptionId || "").trim())
      .filter(Boolean),
  ),
);

console.log(
  `[profile-access] ${apply ? "applying" : "dry run"}: ${legacySubscriptionIds.length} unique legacy subscription(s) across ${legacyUsers.length} user record(s) and ${legacyRestaurantRows.length} business audit row(s)`,
);

let retired = 0;
let failed = 0;

for (const subscriptionId of legacySubscriptionIds) {
  if (!apply) {
    console.log(`[profile-access] would retire ${subscriptionId}`);
    continue;
  }

  try {
    try {
      await stripe!.subscriptions.cancel(subscriptionId);
    } catch (error: any) {
      if (String(error?.code || "") !== "resource_missing") throw error;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(restaurantSubscriptions)
        .set({
          status: "canceled",
          canceledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(restaurantSubscriptions.stripeSubscriptionId, subscriptionId));

      await tx
        .update(users)
        .set({
          stripeSubscriptionId: null,
          subscriptionBillingInterval: null,
          updatedAt: new Date(),
        })
        .where(eq(users.stripeSubscriptionId, subscriptionId));
    });

    retired += 1;
    console.log(`[profile-access] retired ${subscriptionId}`);
  } catch (error: any) {
    failed += 1;
    console.error(`[profile-access] failed ${subscriptionId}`, {
      message: error?.message || error,
    });
  }
}

console.log(
  `[profile-access] complete: retired=${retired} failed=${failed} dryRun=${!apply}`,
);

if (failed > 0) process.exitCode = 1;
