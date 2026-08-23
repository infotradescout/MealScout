import assert from "node:assert/strict";
import type Stripe from "stripe";

import { retrieveAuthoritativePickupOrderDispute } from "../server/services/pickupOrderDisputeTruth";

function dispute(status: Stripe.Dispute.Status) {
  return {
    id: "dp_ordering_truth",
    object: "dispute",
    amount: 10_000,
    currency: "usd",
    payment_intent: "pi_ordering_truth",
    status,
  } as Stripe.Dispute;
}

let currentDispute = dispute("won");
const stripe = {
  disputes: {
    retrieve: async (id: string) => {
      assert.equal(id, currentDispute.id);
      return currentDispute;
    },
  },
} as unknown as Stripe;

const staleActiveAfterWon = await retrieveAuthoritativePickupOrderDispute({
  stripe,
  webhookDispute: dispute("needs_response"),
});
assert.equal(
  staleActiveAfterWon.status,
  "won",
  "A delayed active event must reconcile Stripe's current won state",
);

currentDispute = dispute("lost");
const staleWonAfterLost = await retrieveAuthoritativePickupOrderDispute({
  stripe,
  webhookDispute: dispute("won"),
});
assert.equal(
  staleWonAfterLost.status,
  "lost",
  "A delayed won event must reconcile Stripe's current lost state",
);

await assert.rejects(
  retrieveAuthoritativePickupOrderDispute({
    stripe,
    webhookDispute: {
      ...dispute("lost"),
      amount: 9_999,
    },
  }),
  /changed immutable payment identity/,
  "A webhook whose financial identity disagrees with Stripe must fail closed",
);

console.log("MealScout authoritative pickup dispute behavior: PASS");
