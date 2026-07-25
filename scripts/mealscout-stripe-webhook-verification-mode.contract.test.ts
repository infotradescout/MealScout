import assert from "node:assert/strict";
import { decideStripeWebhookVerificationMode } from "../server/utils/stripeWebhookVerification";

// Exhaustive truth table for the Stripe webhook signature-verification
// policy. This is the exact decision that gates whether an inbound POST to
// /api/stripe/webhook is trusted without a valid Stripe signature. Getting
// this wrong in either direction is a real-money bug:
//   - too permissive -> forged webhook events can mutate bookings/orders/
//     subscriptions without ever touching Stripe.
//   - too strict -> legitimate production webhooks get rejected and
//     payments never reconcile.
//
// chore/payment-safety-week1 flipped the development default from
// "accept unsigned unless FORCE_VERIFY=true" to "verify unless the operator
// explicitly opts in with STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED=true". This test
// locks in that hardened default and every override combination so it
// cannot silently regress.

type Case = {
  name: string;
  env: Parameters<typeof decideStripeWebhookVerificationMode>[0];
  expected: "accept_unsigned_dev" | "verify_signature";
};

const cases: Case[] = [
  {
    name: "production-shaped NODE_ENV always verifies, even with both opt-outs set",
    env: { nodeEnv: "production", forceVerify: false, allowUnsignedDev: true },
    expected: "verify_signature",
  },
  {
    name: "undefined NODE_ENV (misconfigured deploy) always verifies",
    env: { nodeEnv: undefined, forceVerify: false, allowUnsignedDev: true },
    expected: "verify_signature",
  },
  {
    name: "empty-string NODE_ENV always verifies",
    env: { nodeEnv: "", forceVerify: false, allowUnsignedDev: true },
    expected: "verify_signature",
  },
  {
    name: "test-shaped NODE_ENV always verifies",
    env: { nodeEnv: "test", forceVerify: false, allowUnsignedDev: true },
    expected: "verify_signature",
  },
  {
    name: "HARDENED DEFAULT: development with no explicit opt-in verifies signatures",
    env: { nodeEnv: "development", forceVerify: false, allowUnsignedDev: false },
    expected: "verify_signature",
  },
  {
    name: "development + explicit dev opt-in accepts unsigned payloads",
    env: { nodeEnv: "development", forceVerify: false, allowUnsignedDev: true },
    expected: "accept_unsigned_dev",
  },
  {
    name: "development + dev opt-in but FORCE_VERIFY=true still verifies (force wins)",
    env: { nodeEnv: "development", forceVerify: true, allowUnsignedDev: true },
    expected: "verify_signature",
  },
  {
    name: "development + FORCE_VERIFY=true with no dev opt-in verifies",
    env: { nodeEnv: "development", forceVerify: true, allowUnsignedDev: false },
    expected: "verify_signature",
  },
];

let passed = 0;
for (const t of cases) {
  const actual = decideStripeWebhookVerificationMode(t.env);
  assert.equal(actual, t.expected, `${t.name}: expected ${t.expected}, got ${actual}`);
  passed += 1;
}

console.log(
  `mealscout-stripe-webhook-verification-mode: PASS (${passed}/${cases.length})`,
);
