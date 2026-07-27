import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Static regression proof for subscription event ordering. Live mutation
// replay still requires the isolated database and Stripe fixtures documented
// in MEALSCOUT_PAYMENT_WEBHOOK_SAFETY_MAP.md.
const source = readFileSync("server/routes/stripeWebhookRoutes.ts", "utf8");

function sliceBetween(start: string, end: string, label: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `Missing ${label} start`);
  assert.ok(endIndex > startIndex, `Missing ${label} end`);
  return source.slice(startIndex, endIndex);
}

const revocationHelper = sliceBetween(
  "async function deactivateSubscriptionEntitlements",
  "export function registerStripeWebhookRoutes",
  "subscription entitlement revocation helper",
);
const subscriptionRowsIndex = revocationHelper.indexOf(
  ".update(restaurantSubscriptions)",
);
const userLockIndex = revocationHelper.indexOf('.for("update")');
const currentSubscriptionGuardIndex = revocationHelper.indexOf(
  "shouldRevokeUserSubscriptionEntitlements({",
);
const dealsIndex = revocationHelper.indexOf(".update(deals)");
const lookupClearIndex = revocationHelper.indexOf(".update(users)");
assert.ok(
  userLockIndex >= 0 &&
    subscriptionRowsIndex > userLockIndex &&
    currentSubscriptionGuardIndex > subscriptionRowsIndex &&
    dealsIndex > currentSubscriptionGuardIndex &&
    lookupClearIndex > dealsIndex,
  "revocation must lock current subscription state, retire the event row, then change deals and the lookup key in order",
);
assert.ok(
  revocationHelper.includes("stripeSubscriptionId: null"),
  "revocation helper must clear the user subscription lookup key last",
);
assert.ok(
  revocationHelper.includes("await db.transaction(async (tx: any)") &&
    revocationHelper.includes("isNull(users.stripeSubscriptionId)") &&
    revocationHelper.includes(
      "eq(users.stripeSubscriptionId, params.subscriptionId)",
    ),
  "stale replacement-subscription events must be serialized and conditionally blocked inside one transaction",
);

const updatedCase = sliceBetween(
  'case "customer.subscription.updated":',
  'case "customer.subscription.deleted":',
  "subscription.updated case",
);
const canceledUpdateBranch = updatedCase.slice(
  updatedCase.indexOf('subscriptionUpdated.status === "canceled"'),
  updatedCase.indexOf(
    '} else if (subscriptionUpdated.status === "active")',
  ),
);
assert.ok(
  canceledUpdateBranch.includes(
    "await deactivateSubscriptionEntitlements({",
  ),
  "canceled and incomplete-expired updates must revoke entitlements before acknowledgment",
);
assert.ok(
  updatedCase.includes("getSubscriptionCustomerId(") &&
    updatedCase.includes("storage.getUserByStripeCustomerId(customerId)"),
  "subscription.updated must retain customer-id fallback lookup",
);

const deletedCase = sliceBetween(
  'case "customer.subscription.deleted":',
  'case "account.updated":',
  "subscription.deleted case",
);
const subscriptionLookupIndex = deletedCase.indexOf(
  "storage.getUserByStripeSubscriptionId(",
);
const customerFallbackIndex = deletedCase.indexOf(
  "storage.getUserByStripeCustomerId(customerId)",
);
const revocationCallIndex = deletedCase.indexOf(
  "await deactivateSubscriptionEntitlements({",
);
assert.ok(
  subscriptionLookupIndex >= 0 &&
    customerFallbackIndex > subscriptionLookupIndex &&
    revocationCallIndex > customerFallbackIndex,
  "subscription.deleted must fall back to customer lookup before running the shared revocation",
);

console.log(
  "mealscout-stripe-webhook-subscription-entitlement-guards: PASS",
);
