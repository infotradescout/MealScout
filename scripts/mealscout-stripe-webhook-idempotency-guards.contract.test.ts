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
const hostEarningsSource = readFileSync(
  "server/hostEarningsService.ts",
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

// Single-event booking payment: explicit idempotent skip when already
// confirmed, plus a PaymentIntent match check and replay reconciliation for
// the host earnings ledger.
requireIncludes(
  '// Idempotent',
  "single-event booking idempotency comment",
);
requireIncludes(
  "bookingIntentId !== paymentIntent.id",
  "single-event booking stored-intent mismatch guard",
);
requireIncludes(
  'if (booking.status === "confirmed") {',
  "single-event booking already-confirmed skip",
);
requireIncludes(
  "recordHostBookingEarnings",
  "single-event booking replay host-earnings reconciliation",
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

// Parking Pass booking payment: an `alreadyProcessed` check keyed on
// confirmed status or credited cancellation, followed by idempotent
// reconciliation before the replay is acknowledged.
requireIncludes(
  'const alreadyProcessed = intentRows.some(',
  "parking pass alreadyProcessed guard",
);
requireIncludes(
  "if (alreadyProcessed) {",
  "parking pass alreadyProcessed early exit",
);

// Concurrent-delivery protection: Stripe's documented at-least-once
// delivery (including near-simultaneous retries) means two deliveries of
// the same event can race inside the same process. The credit-issuance
// path takes a Postgres advisory lock keyed on the PaymentIntent id and
// re-checks terminal state inside the lock before issuing credit again.
requireIncludes(
  "pg_advisory_xact_lock(hashtext(${`payment_intent_credit:",
  "credit-issuance advisory lock keyed on PaymentIntent id",
);
requireIncludes(
  "eq(creditLedger.sourceId, paymentIntent.id)",
  "credit issuance reuses the PaymentIntent as its idempotency reference",
);
requireIncludes(
  "Skipping duplicate credit issuance for PaymentIntent",
  "credit-issuance duplicate-skip log",
);
requireIncludes(
  "await reconcileHostEarnings(intentRows);",
  "replayed parking pass reconciles host earnings before acknowledgment",
);
requireIncludes(
  "await reconcileCommittedCreditDebit();",
  "replayed parking pass reconciles the committed credit debit",
);

// Spot assignment: also advisory-locked per event id, and booking row
// upserts use onConflictDoNothing so a race can't create two confirmed rows
// for the same event/truck pair.
requireIncludes(
  "pg_advisory_xact_lock(hashtext(${`parking_pass_spot:",
  "spot-assignment advisory lock keyed on event id",
);
requireIncludes(".onConflictDoNothing()", "booking upsert onConflictDoNothing");

// Pickup-order payouts can be retried after the order transition committed,
// but only while the order is confirmed (or was atomically changed from
// pending to confirmed by this delivery). Stripe receives a stable
// idempotency key, preventing a second transfer if the first transfer
// succeeded but the local payout-status write failed.
requireIncludes(
  'eq(pickupOrders.status, "pending")',
  "pickup transition is restricted to a still-pending row",
);
requireIncludes(
  "shouldAttemptPickupWebhookPayoutTransfer({",
  "pickup payout state eligibility guard",
);
requireIncludes(
  "transitionedToConfirmed: Boolean(updated)",
  "pickup payout requires proof of the pending-to-confirmed transition",
);
requireIncludes(
  "idempotencyKey: `pickup-order:${order.id}:transfer`",
  "pickup transfer Stripe idempotency key",
);

// Primary mutation failures must escape their local diagnostic catches and
// reach the route-level 500 response instead of falling through to a 200.
[
  "throw pickupError;",
  "throw supplierError;",
  "throw bookingError;",
].forEach((snippet) =>
  requireIncludes(snippet, `primary processing failure propagation: ${snippet}`),
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
