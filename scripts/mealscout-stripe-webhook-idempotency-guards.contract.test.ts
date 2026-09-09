import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Static regression guard over server/routes/stripeWebhookRoutes.ts.
//
// Full runtime proof of DB-level idempotency (processing the same Stripe
// event twice has no double effect) requires a running server wired to an
// approved, isolated test database plus test-mode Stripe keys -- neither is
// available by default, and MEALSCOUT_PAYMENT_WEBHOOK_SAFETY_MAP.md (C9-F5)
// already flags that stateful payment smokes stay behind explicit fixture/env
// approval. scripts/mealscout-stripe-webhook-stateful-replay.integration.test.ts
// is the synthetic disposable-branch proof when that approval exists.
//
// Until then, this test locks in the specific idempotency/duplicate-
// protection code shapes already present in the webhook handler, so a
// future refactor cannot silently drop one of these guards without a test
// failure calling it out by name. This is a code-shape check, not a live
// database assertion.

const source = readFileSync("server/routes/stripeWebhookRoutes.ts", "utf8");
const pickupOrderSource = readFileSync(
  "server/routes/pickupOrderRoutes.ts",
  "utf8",
);
const hostEarningsSource = readFileSync(
  "server/hostEarningsService.ts",
  "utf8",
);
const parkingPassServiceSource = readFileSync(
  "server/services/parkingPassBookingService.ts",
  "utf8",
);

function requireIncludes(snippet: string, label = snippet) {
  assert.ok(source.includes(snippet), `Missing idempotency guard: ${label}`);
}

function requireCountAtLeast(snippet: string, expected: number, label = snippet) {
  const actual = source.split(snippet).length - 1;
  assert.ok(
    actual >= expected,
    `Missing idempotency guard: ${label} (expected at least ${expected}, found ${actual})`,
  );
}

// Supplier order payment success: only marks paid if not already paid, and
// ignores events for a PaymentIntent id that doesn't match what's stored on
// the order (prevents a stale/duplicate intent from overwriting a newer one).
requireIncludes(
  '// Idempotent: only mark paid if not already.',
  "supplier order payment_intent.succeeded idempotency comment",
);
requireIncludes(
  'if (storedIntentId && storedIntentId !== paymentIntent.id) {',
  "supplier order payment_intent.succeeded stored-intent mismatch guard",
);
requireIncludes(
  'if (String((order as any).paymentStatus || "") !== "paid") {',
  "supplier order payment_intent.succeeded paid-status guard",
);

// Supplier order payment failure: same stored-intent mismatch guard so a
// failure event for an old/replaced intent can't unpay a newer paid order,
// and an out-of-order failure cannot regress a payment already marked paid.
requireIncludes(
  'if (storedIntentId && storedIntentId !== failedIntent.id) {',
  "supplier order payment_intent.payment_failed stored-intent mismatch guard",
);
requireCountAtLeast(
  'if (String((order as any).paymentStatus || "") !== "paid") {',
  2,
  "supplier order payment_intent.payment_failed paid-status guard",
);
requireIncludes(
  'inArray(eventBookings.status, ["pending"])',
  "failed booking update is restricted to pending rows",
);

// Every new paid event/Parking Pass webhook first enters the canonical
// purchase aggregate. Historical rows without that binding are quarantined;
// they never recreate the old local confirmation/earnings mutation.
requireIncludes(
  "await confirmParkingPassPurchaseFromIntent(paymentIntent, stripe)",
  "canonical Parking Pass confirmation adapter",
);
requireIncludes(
  "if (parkingPassPurchase.handled) break;",
  "canonical Parking Pass confirmation owns bound intents",
);
requireIncludes(
  "expectedIntentId && expectedIntentId !== paymentIntent.id",
  "legacy single-event stored-intent mismatch guard",
);
requireIncludes(
  'stripePaymentStatus: "reconciliation_required"',
  "legacy paid booking is quarantined",
);
requireIncludes(
  'settlementState: "action_required"',
  "legacy paid booking requires reconciliation",
);
assert.ok(
  !source.includes("recordHostBookingEarnings"),
  "Destination-charge Parking Pass webhooks must not enter the legacy earnings ledger",
);
assert.ok(
  hostEarningsSource.includes(".onConflictDoNothing();"),
  "Host earnings inserts must use target-free conflict handling so PostgreSQL can apply migration 074's partial unique index",
);
assert.ok(
  !hostEarningsSource.includes(
    "target: [hostEarningsLedger.bookingId, hostEarningsLedger.entryType]",
  ),
  "Host earnings inserts must not name a conflict target that cannot infer migration 074's partial unique index",
);

assert.ok(
  parkingPassServiceSource.includes(".for(\"update\")") &&
    parkingPassServiceSource.includes(
      "purchase.stripePaymentIntentId !== intent.id",
    ) &&
    parkingPassServiceSource.includes(
      "providerOperation.providerPaymentIntentId !== intent.id",
    ),
  "Canonical confirmation must lock and bind the purchase, provider operation, and PaymentIntent",
);
assert.ok(
  parkingPassServiceSource.includes("purchase.paidAt &&") &&
    parkingPassServiceSource.includes("return { status: purchase.status, replay: true }"),
  "Canonical confirmation must converge terminal webhook replay",
);
assert.ok(
  parkingPassServiceSource.includes(
    "pg_advisory_xact_lock(hashtext(${`parking_pass_spot:",
  ),
  "Canonical confirmation must serialize spot assignment per event",
);
requireIncludes(
  "await recordParkingPassPaymentFailureFromIntent(cancelledIntent",
  "canonical final PaymentIntent cancellation adapter",
);

// Pickup-order payouts settle before a pending order is confirmed. Stripe
// receives a stable idempotency key, preventing a second transfer if the first
// transfer succeeded but a later local write failed.
requireIncludes(
  'eq(pickupOrders.status, "pending")',
  "pickup transition is restricted to a still-pending row",
);
requireIncludes(
  "shouldAttemptPickupWebhookPayoutTransfer({",
  "pickup payout state eligibility guard",
);
requireIncludes(
  'paymentSucceeded: paymentIntent.status === "succeeded"',
  "pickup payout requires a succeeded payment",
);
requireIncludes(
  "idempotencyKey: `pickup-order:${order.id}:transfer`",
  "pickup transfer Stripe idempotency key",
);
requireIncludes(
  'String(event.account || "").trim()',
  "deauthorized Connect account is read from the Stripe event envelope",
);
requireIncludes(
  "pickupOrderFinancialLockKey(candidate.id)",
  "pickup payout and confirmation use the shared per-order financial lock",
);
assert.ok(
  pickupOrderSource.includes("pickupOrderFinancialLockKey(orderId)"),
  "Missing idempotency guard: owner cancellation uses the same per-order financial lock",
);
requireIncludes(
  "const pickupOrderId = String(",
  "pickup order payment failure uses pickupOrderId/orderId metadata",
);
requireIncludes(
  'metadata.pickupOrderId || metadata.orderId || ""',
  "pickup payment_failed branch reads fallback metadata",
);
requireIncludes(
  "if (storedIntentId && storedIntentId !== failedIntent.id)",
  "pickup payment_failed stored-intent mismatch guard",
);
requireIncludes(
  'eq(pickupOrders.status, "pending")',
  "pickup payment_failed only attaches identity to a still-pending order",
);
assert.match(
  source,
  /A PaymentIntent can fail one confirmation attempt and later[\s\S]*Keep the order and its[\s\S]*reservation pending/,
  "pickup payment_failed must remain retryable until bounded expiry",
);
assert.ok(
  pickupOrderSource.includes("cleanupPendingPickupOrderAfterPaymentSetupFailure"),
  "Missing idempotency guard: pickup payment setup failures use atomic inventory cleanup",
);
assert.equal(
  (pickupOrderSource.match(/cleanupPendingPickupOrderAfterPaymentSetupFailure/g) || [])
    .length,
  5,
  "Missing Stripe, Stripe creation failure, invalid setup, and a safely cancelled attachment failure must share the cleanup path.",
);
assert.ok(
  pickupOrderSource.includes("eq(pickupOrders.status, lockedOrder.status)"),
  "Missing idempotency guard: owner cancellation re-reads and compare-and-swaps locked status",
);

// Primary mutation failures must escape their local diagnostic catches and
// reach the route-level 500 response instead of falling through to a 200.
[
  "throw pickupError;",
  "throw supplierError;",
].forEach((snippet) =>
  requireIncludes(snippet, `primary processing failure propagation: ${snippet}`),
);
requireCountAtLeast(
  "throw error;",
  2,
  "canonical booking success/failure processing errors propagate",
);
requireIncludes(
  "await db.transaction(async (tx: any)",
  "legacy billing retirement transaction failures propagate",
);
requireIncludes(
  "await retireLegacyProfileSubscription(",
  "legacy recurring events are retired instead of activated",
);
requireIncludes(
  'res.status(500).json({ error: "Webhook processing failed" })',
  "route-level retryable processing failure response",
);

console.log("mealscout-stripe-webhook-idempotency-guards: PASS");
