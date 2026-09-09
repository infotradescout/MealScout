import assert from "node:assert/strict";

import {
  resolveDisputeConvergence,
  validateRefundWebhookIdentity,
  type RefundWebhookIdentity,
} from "../server/services/parkingPassFinancialPolicy";

type PurchaseState = "pending" | "confirmed" | "payment_failed";

const convergePaymentIntentEvent = (
  state: PurchaseState,
  event: "succeeded" | "attempt_failed" | "cancelled",
): PurchaseState => {
  if (state === "confirmed") return state;
  if (event === "succeeded") return "confirmed";
  if (event === "cancelled") return "payment_failed";
  return state;
};

let purchaseState: PurchaseState = "pending";
let confirmationTransitions = 0;
for (const event of [
  "succeeded",
  "succeeded",
  "attempt_failed",
  "succeeded",
] as const) {
  const next = convergePaymentIntentEvent(purchaseState, event);
  if (purchaseState !== "confirmed" && next === "confirmed") {
    confirmationTransitions += 1;
  }
  purchaseState = next;
}
assert.equal(purchaseState, "confirmed");
assert.equal(confirmationTransitions, 1);

const refundIdentity: RefundWebhookIdentity = {
  operationId: "cancel-1",
  providerOperationId: "provider-operation-1",
  providerStepId: "provider-step-1",
  purchaseId: "purchase-1",
  requestDigest: "request-digest-1",
  allocationDigest: "allocation-digest-1",
  sortedLineDigest: "sorted-line-digest-1",
  policyTrigger: "host_future_cancellation",
  paymentIntentId: "pi_1",
  chargeId: "ch_1",
  currency: "usd",
  amountCents: 2925,
  refundId: "re_1",
};
const processedRefundIds = new Set<string>();
for (const actual of [
  { ...refundIdentity },
  { ...refundIdentity },
  { ...refundIdentity, amountCents: refundIdentity.amountCents - 1 },
]) {
  const validation = validateRefundWebhookIdentity(refundIdentity, actual);
  if (!validation.valid) continue;
  processedRefundIds.add(String(actual.refundId));
}
assert.equal(processedRefundIds.size, 1);

const open = resolveDisputeConvergence({
  providerStatus: "needs_response",
  chargedAmountCents: 2925,
  refundedAmountCents: 0,
});
const updated = resolveDisputeConvergence({
  providerStatus: "under_review",
  chargedAmountCents: 2925,
  refundedAmountCents: 0,
});
const won = resolveDisputeConvergence({
  providerStatus: "won",
  chargedAmountCents: 2925,
  refundedAmountCents: 0,
});
const wonReplay = resolveDisputeConvergence({
  providerStatus: "won",
  chargedAmountCents: 2925,
  refundedAmountCents: 0,
});
const lost = resolveDisputeConvergence({
  providerStatus: "lost",
  chargedAmountCents: 2925,
  refundedAmountCents: 0,
});
assert.equal(open.disputeState, "open");
assert.equal(updated.disputeState, "open");
assert.deepEqual(wonReplay, won);
assert.equal(won.purchaseStatus, "confirmed");
assert.equal(lost.purchaseStatus, "confirmed");
assert.equal(lost.settlementStatus, "disputed");

const wonAfterCredit = resolveDisputeConvergence({
  providerStatus: "won",
  chargedAmountCents: 2925,
  refundedAmountCents: 0,
  lineStates: [
    {
      status: "cancelled",
      cancellationCreditIssuedCents: 1000,
      cancellationPolicy: "truck_voluntary_pre_start",
    },
  ],
});
assert.equal(wonAfterCredit.purchaseStatus, "cancelled");
assert.equal(wonAfterCredit.settlementStatus, "transferred_to_connect");

const mixedWon = resolveDisputeConvergence({
  providerStatus: "won",
  chargedAmountCents: 2925,
  refundedAmountCents: 1500,
  lineStates: [
    { status: "refunded", cashRefundedCents: 1500 },
    {
      status: "cancelled",
      cancellationCreditIssuedCents: 425,
      cancellationPolicy: "truck_voluntary_pre_start",
    },
  ],
});
assert.equal(mixedWon.purchaseStatus, "partially_refunded");
assert.equal(mixedWon.settlementStatus, "partially_reversed");
assert.deepEqual(
  resolveDisputeConvergence({
    providerStatus: "won",
    chargedAmountCents: 2925,
    refundedAmountCents: 1500,
    lineStates: [
      { status: "refunded", cashRefundedCents: 1500 },
      {
        status: "cancelled",
        cancellationCreditIssuedCents: 425,
        cancellationPolicy: "truck_voluntary_pre_start",
      },
    ],
  }),
  mixedWon,
);

console.log("parking-pass-webhook-replay: PASS");
