import assert from "node:assert/strict";

import {
  needsCancelledPickupOrderPayoutRecovery,
  recoverPayoutWithoutDowngradingCustomerRefund,
} from "../server/services/pickupOrderPayoutRecoveryPolicy";

const refundedOrder = {
  id: "order-refunded",
  status: "cancelled",
  paymentMethod: "card",
  totalCents: 4_200,
  stripeRefundStatus: "succeeded",
  stripeRefundAmountCents: 4_200,
  payoutStatus: "reversal_pending",
  refundFailureReason: null,
  payoutReversalFailureReason: null as string | null,
};

assert.equal(needsCancelledPickupOrderPayoutRecovery(refundedOrder), true);
assert.equal(
  needsCancelledPickupOrderPayoutRecovery({
    ...refundedOrder,
    payoutStatus: "reversed",
  }),
  true,
  "Legacy local reversed state must not suppress an authoritative transfer audit",
);
assert.equal(
  needsCancelledPickupOrderPayoutRecovery({
    ...refundedOrder,
    totalCents: 10_000,
    stripeRefundStatus: "partially_refunded",
    stripeRefundAmountCents: 8_000,
    stripeDisputeStatus: "lost",
    stripeDisputeAmountCents: 2_000,
  }),
  true,
  "Issuer recovery plus a remainder refund can make a cancelled customer whole",
);

let observedError: unknown;
const preserved = await recoverPayoutWithoutDowngradingCustomerRefund(
  refundedOrder,
  async () => {
    throw new Error("connected account is temporarily unavailable");
  },
  (error) => {
    observedError = error;
  },
);
assert.equal(preserved.status, "cancelled");
assert.equal(preserved.stripeRefundStatus, "succeeded");
assert.equal(preserved.stripeRefundAmountCents, preserved.totalCents);
assert.equal(preserved.refundFailureReason, null);
assert.match(String(observedError), /temporarily unavailable/);

const recoveryPending = await recoverPayoutWithoutDowngradingCustomerRefund(
  refundedOrder,
  async () => ({
    ...refundedOrder,
    payoutReversalFailureReason: "Merchant transfer reversal will retry.",
  }),
);
assert.equal(recoveryPending.stripeRefundStatus, "succeeded");
assert.equal(
  recoveryPending.payoutReversalFailureReason,
  "Merchant transfer reversal will retry.",
);

let attemptedUnrefundedRecovery = false;
const unrefundedOrder = {
  ...refundedOrder,
  status: "cancellation_pending",
  stripeRefundStatus: "pending",
  stripeRefundAmountCents: 0,
};
await recoverPayoutWithoutDowngradingCustomerRefund(
  unrefundedOrder,
  async () => {
    attemptedUnrefundedRecovery = true;
    return unrefundedOrder;
  },
);
assert.equal(attemptedUnrefundedRecovery, false);

console.log("MealScout pickup payout-recovery isolation behavior: PASS");
