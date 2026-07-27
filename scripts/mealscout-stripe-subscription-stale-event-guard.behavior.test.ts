import assert from "node:assert/strict";
import { shouldRevokeUserSubscriptionEntitlements } from "../server/utils/stripeSubscriptionEntitlements";

const cases = [
  {
    name: "matching current subscription revokes user-level entitlements",
    currentSubscriptionId: "sub_A",
    eventSubscriptionId: "sub_A",
    expected: true,
  },
  {
    name: "cleared lookup key permits retry-safe revocation",
    currentSubscriptionId: null,
    eventSubscriptionId: "sub_A",
    expected: true,
  },
  {
    name: "stale cancellation cannot revoke replacement subscription",
    currentSubscriptionId: "sub_B",
    eventSubscriptionId: "sub_A",
    expected: false,
  },
  {
    name: "missing event subscription fails closed",
    currentSubscriptionId: "sub_B",
    eventSubscriptionId: "",
    expected: false,
  },
] as const;

for (const testCase of cases) {
  assert.equal(
    shouldRevokeUserSubscriptionEntitlements({
      currentSubscriptionId: testCase.currentSubscriptionId,
      eventSubscriptionId: testCase.eventSubscriptionId,
    }),
    testCase.expected,
    testCase.name,
  );
}

console.log(
  `mealscout-stripe-subscription-stale-event-guard: PASS (${cases.length}/${cases.length})`,
);
