import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Legacy recurring events may synchronize terminal billing records and lookup
// keys, but they must never cancel Stripe records automatically or change
// complete-profile tools and public content.
const source = readFileSync("server/routes/stripeWebhookRoutes.ts", "utf8");

function sliceBetween(start: string, end: string, label: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Missing ${label} start`);
  assert.ok(endIndex > startIndex, `Missing ${label} end`);
  return source.slice(startIndex, endIndex);
}

const retirementHelper = sliceBetween(
  "async function deactivateSubscriptionEntitlements",
  "async function retireLegacyProfileSubscription",
  "legacy billing retirement helper",
);

assert.ok(
  retirementHelper.includes(".update(restaurantSubscriptions)") &&
    retirementHelper.includes('status: "canceled"') &&
    retirementHelper.includes("stripeSubscriptionId: null"),
  "Legacy billing retirement must cancel its audit row and clear the lookup key.",
);
assert.ok(
  retirementHelper.includes('.for("update")') &&
    retirementHelper.includes("shouldRevokeUserSubscriptionEntitlements({"),
  "Stale legacy events must retain the replacement-subscription race guard.",
);
assert.ok(
  !retirementHelper.includes(".update(deals)") &&
    !retirementHelper.includes("canPostVideos") &&
    !retirementHelper.includes("canPostDeals") &&
    !retirementHelper.includes("hasAnalytics"),
  "Legacy billing events must not revoke profile features or public content.",
);

for (const eventType of [
  'case "customer.subscription.updated"',
  'case "customer.subscription.deleted"',
]) {
  const eventIndex = source.indexOf(eventType);
  assert.ok(eventIndex >= 0, `Missing legacy event handler: ${eventType}`);
  const eventSlice = source.slice(eventIndex, eventIndex + 1800);
  assert.ok(
    eventSlice.includes("retireLegacyProfileSubscription("),
    `${eventType} must retire, not activate, recurring profile billing.`,
  );
}

for (const eventType of [
  'case "invoice.payment_succeeded"',
  'case "invoice.payment_failed"',
]) {
  const eventIndex = source.indexOf(eventType);
  assert.ok(eventIndex >= 0, `Missing legacy event handler: ${eventType}`);
  const eventSlice = source.slice(eventIndex, eventIndex + 900);
  assert.ok(
    !eventSlice.includes("retireLegacyProfileSubscription("),
    `${eventType} must not cancel or retire a live legacy subscription automatically.`,
  );
  assert.ok(
    eventSlice.includes("no automatic cancellation or access change was made"),
    `${eventType} must explicitly preserve live billing state for separate cleanup.`,
  );
}

assert.ok(
  !source.includes("stripe.subscriptions.cancel("),
  "Webhook delivery must never cancel a live Stripe subscription.",
);
assert.ok(
  /const terminalLegacyStatus = \[[\s\S]*?"canceled",[\s\S]*?"incomplete_expired",?[\s\S]*?\]\.includes\(/.test(
    source,
  ),
  "Subscription updates may retire local legacy state only after Stripe reports a terminal status.",
);
assert.ok(
  source.includes("stripeEventCreatedAt.getTime() >=") &&
    source.includes("params.eventCreatedAt.getTime()"),
  "Older and duplicate subscription events must not overwrite newer local state.",
);
assert.ok(
  source.includes("recordLegacyProfileSubscriptionEvent({") &&
    source.includes("eventId: event.id") &&
    source.includes("eventCreatedAt"),
  "Nonterminal subscription events must advance the ordering watermark without granting access.",
);

const paymentFailureSlice = sliceBetween(
  'case "payment_intent.payment_failed"',
  'case "customer.subscription.updated"',
  "food-order payment event routing",
);
assert.ok(
  !paymentFailureSlice.includes("retireLegacyProfileSubscription(") &&
    !paymentFailureSlice.includes("deactivateSubscriptionEntitlements("),
  "Food-order payment events must not mutate subscription entitlements.",
);

const subscriptionSlice = sliceBetween(
  'case "customer.subscription.updated"',
  'case "account.updated"',
  "subscription event routing",
);
assert.ok(
  !subscriptionSlice.includes("pickupOrders") &&
    !subscriptionSlice.includes("restoreTrackedInventoryForPickupOrderByOrderId"),
  "Subscription events must not mutate food orders or inventory.",
);

for (const forbiddenActivation of [
  "stripe.subscriptions.retrieve",
  "createAffiliateCommissionsForSubscription",
  "Subscription payment confirmed",
  "insert(lisaClaims)",
]) {
  assert.ok(
    !source.includes(forbiddenActivation),
    `Legacy subscription activation remains: ${forbiddenActivation}`,
  );
}

console.log("mealscout-stripe-webhook-legacy-billing-retirement: PASS");
