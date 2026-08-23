import assert from "node:assert/strict";

import { pickupOrderFinancialLockKey } from "../server/utils/pickupOrderFinancialLock";
import { shouldAttemptPickupWebhookPayoutTransfer } from "../server/utils/pickupWebhookPayout";

type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "cancellation_pending"
  | "cancelled";
type PayoutStatus =
  | "pending"
  | "transferred"
  | "reversal_pending"
  | "reversed";

type FinancialModel = {
  id: string;
  status: OrderStatus;
  payoutStatus: PayoutStatus;
  paymentSucceeded: boolean;
  transferGroupId: string;
  transferCents: number;
  reversedCents: number;
  refunds: number;
};

class AdvisoryLockModel {
  private tails = new Map<string, Promise<void>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(key) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => current);
    this.tails.set(key, tail);
    await prior;
    try {
      return await work();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

function controlledHold() {
  let announceEntered!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    announceEntered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entered,
    release,
    onLocked: async () => {
      announceEntered();
      await held;
    },
  };
}

function freshModel(status: OrderStatus = "pending"): FinancialModel {
  return {
    id: "order-race-fixture",
    status,
    payoutStatus: "pending",
    paymentSucceeded: true,
    transferGroupId: "group-race-fixture",
    transferCents: 0,
    reversedCents: 0,
    refunds: 0,
  };
}

async function runPaymentSucceededWebhook(
  model: FinancialModel,
  locks: AdvisoryLockModel,
  onLocked?: () => Promise<void>,
) {
  return locks.run(pickupOrderFinancialLockKey(model.id), async () => {
    await onLocked?.();
    const shouldTransfer = shouldAttemptPickupWebhookPayoutTransfer({
      statusBeforeWebhook: model.status,
      paymentSucceeded: model.paymentSucceeded,
      stripeTransferGroupId: model.transferGroupId,
      payoutStatus: model.payoutStatus,
    });
    if (shouldTransfer) {
      model.transferCents = 1_000;
      model.payoutStatus = "transferred";
    }
    if (model.status === "pending" && model.payoutStatus === "transferred") {
      model.status = "confirmed";
    }
  });
}

async function runPaymentFailedWebhook(
  model: FinancialModel,
  locks: AdvisoryLockModel,
) {
  return locks.run(pickupOrderFinancialLockKey(model.id), async () => {
    // A failed confirmation attempt is nonterminal. The same PaymentIntent can
    // later succeed, while bounded expiry owns eventual cancellation.
    return model.status;
  });
}

async function requestCancellation(
  model: FinancialModel,
  locks: AdvisoryLockModel,
  expectedStatus: OrderStatus,
  onLocked?: () => Promise<void>,
) {
  return locks.run(pickupOrderFinancialLockKey(model.id), async () => {
    await onLocked?.();
    if (model.status === "cancelled") return "cancelled" as const;
    if (model.status === "cancellation_pending") return "requested" as const;
    if (model.status !== expectedStatus) return "conflict" as const;
    // Durable phase-1 commit: the webhook observes this before any refund or
    // transfer reversal happens.
    model.status = "cancellation_pending";
    model.payoutStatus = "reversal_pending";
    return "requested" as const;
  });
}

async function finalizeCancellation(
  model: FinancialModel,
  locks: AdvisoryLockModel,
  options: { failAfterStripe?: boolean } = {},
) {
  return locks.run(pickupOrderFinancialLockKey(model.id), async () => {
    if (model.status === "cancelled") return "cancelled" as const;
    if (model.status !== "cancellation_pending") return "conflict" as const;

    // Stripe idempotency means retries converge on these same ledger effects.
    model.reversedCents = model.transferCents;
    model.refunds = 1;
    if (options.failAfterStripe) return "failed_after_stripe" as const;

    model.status = "cancelled";
    model.payoutStatus = "reversed";
    return "cancelled" as const;
  });
}

async function runOwnerCancellation(
  model: FinancialModel,
  locks: AdvisoryLockModel,
  expectedStatus: OrderStatus,
  options: {
    onRequestLocked?: () => Promise<void>;
    failAfterStripe?: boolean;
  } = {},
) {
  const request = await requestCancellation(
    model,
    locks,
    expectedStatus,
    options.onRequestLocked,
  );
  if (request === "conflict") return request;
  return finalizeCancellation(model, locks, {
    failAfterStripe: options.failAfterStripe,
  });
}

async function runOwnerPreparation(
  model: FinancialModel,
  locks: AdvisoryLockModel,
  expectedStatus: OrderStatus,
  onLocked?: () => Promise<void>,
) {
  return locks.run(pickupOrderFinancialLockKey(model.id), async () => {
    await onLocked?.();
    if (model.status !== expectedStatus) return "conflict" as const;
    if (model.payoutStatus !== "transferred") return "blocked" as const;
    model.status = "preparing";
    return "preparing" as const;
  });
}

function assertFinancialInvariant(model: FinancialModel) {
  const merchantNet = model.transferCents - model.reversedCents;
  assert.ok(merchantNet >= 0, "a reversal cannot exceed its transfer");
  if (model.status === "cancelled") {
    assert.equal(model.refunds, 1, "a paid cancellation must refund once");
    assert.equal(merchantNet, 0, "a refunded cancellation cannot leave merchant funds");
  } else if (model.status === "cancellation_pending") {
    assert.equal(
      merchantNet,
      0,
      "cancellation_pending cannot expose merchant funds after refund work",
    );
  } else {
    assert.equal(model.refunds, 0, "a fulfillable order cannot have a refund");
  }
}

// Cancellation commits its blocking state first. A queued webhook sees it,
// skips transfer, and cancellation then finalizes the refund.
{
  const model = freshModel();
  const locks = new AdvisoryLockModel();
  const hold = controlledHold();
  const cancellation = runOwnerCancellation(model, locks, "pending", {
    onRequestLocked: hold.onLocked,
  });
  await hold.entered;
  const webhook = runPaymentSucceededWebhook(model, locks);
  hold.release();
  await webhook;
  assert.equal(await cancellation, "cancelled");
  assert.equal(model.status, "cancelled");
  assert.equal(model.transferCents, 0);
  assertFinancialInvariant(model);
}

// If the webhook commits first, a stale pending cancellation conflicts instead
// of refunding a now-confirmed order underneath the merchant transfer.
{
  const model = freshModel();
  const locks = new AdvisoryLockModel();
  const hold = controlledHold();
  const webhook = runPaymentSucceededWebhook(model, locks, hold.onLocked);
  await hold.entered;
  const cancellation = runOwnerCancellation(model, locks, "pending");
  hold.release();
  await webhook;
  assert.equal(await cancellation, "conflict");
  assert.equal(model.status, "confirmed");
  assert.equal(model.transferCents, 1_000);
  assertFinancialInvariant(model);
}

// A fresh cancellation after confirmation reverses settlement and refunds.
{
  const model = freshModel();
  const locks = new AdvisoryLockModel();
  await runPaymentSucceededWebhook(model, locks);
  assert.equal(
    await runOwnerCancellation(model, locks, "confirmed"),
    "cancelled",
  );
  assert.equal(model.reversedCents, 1_000);
  assertFinancialInvariant(model);
}

// A failed card attempt does not release the order or inventory underneath a
// later successful retry on the same PaymentIntent.
{
  const model = freshModel();
  const locks = new AdvisoryLockModel();
  assert.equal(await runPaymentFailedWebhook(model, locks), "pending");
  assert.equal(model.status, "pending");
  await runPaymentSucceededWebhook(model, locks);
  assert.equal(model.status, "confirmed");
  assert.equal(model.transferCents, 1_000);
  assertFinancialInvariant(model);
}

// Failure injection: Stripe succeeds but the final DB commit fails. Durable
// cancellation_pending blocks a webhook transfer; retry resumes idempotently.
{
  const model = freshModel();
  const locks = new AdvisoryLockModel();
  assert.equal(
    await runOwnerCancellation(model, locks, "pending", {
      failAfterStripe: true,
    }),
    "failed_after_stripe",
  );
  assert.equal(model.status, "cancellation_pending");
  await runPaymentSucceededWebhook(model, locks);
  assert.equal(model.transferCents, 0);
  assert.equal(await finalizeCancellation(model, locks), "cancelled");
  assertFinancialInvariant(model);
}

// Preparation and cancellation start from the same confirmed snapshot. One
// coherent winner remains and the stale operation conflicts.
for (const first of ["cancel", "prepare"] as const) {
  const model = freshModel("confirmed");
  model.payoutStatus = "transferred";
  model.transferCents = 1_000;
  const locks = new AdvisoryLockModel();
  const hold = controlledHold();
  const firstResult =
    first === "cancel"
      ? runOwnerCancellation(model, locks, "confirmed", {
          onRequestLocked: hold.onLocked,
        })
      : runOwnerPreparation(model, locks, "confirmed", hold.onLocked);
  await hold.entered;
  const secondResult =
    first === "cancel"
      ? runOwnerPreparation(model, locks, "confirmed")
      : runOwnerCancellation(model, locks, "confirmed");
  hold.release();
  await firstResult;
  assert.equal(await secondResult, "conflict");
  assertFinancialInvariant(model);
}

console.log("MealScout pickup financial race model: PASS (7/7)");
