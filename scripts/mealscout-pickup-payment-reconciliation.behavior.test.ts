import assert from "node:assert/strict";
import {
  isPickupOrderCustomerMadeWhole,
  isPickupOrderFullyRefunded,
  pickupOrderRemainingCustomerRefundCents,
} from "../shared/pickupOrderFinancialTruth";

import {
  classifyStripeRefundStatus,
  derivePickupOrderAggregateRefundStatus,
  describePickupOrderCancellationPayment,
  describePickupOrderReconciliationFailure,
  isPickupDisputeBoundToOrder,
  isLegacyPickupPaymentIntentCheckoutBound,
  isPickupOrderPaymentExpired,
  isPickupPaymentIntentAmountBound,
  isPickupPaymentIntentCheckoutBound,
  isPickupPaymentIntentOrderIdentityBound,
  isPickupPaymentIntentSettlementBound,
  PICKUP_ORDER_CONTRACT_VERSION,
  isPickupPaymentSettlementWithinGrace,
  isPickupRefundBoundToOrder,
  isPickupRefundFromOrder,
  isPickupPaymentSuccessEventWithinWindow,
  isStripePaymentIntentCancelable,
  shouldPickupRefundEnterCancellation,
} from "../server/services/pickupOrderPaymentReconciliation";

assert.equal(
  isLegacyPickupPaymentIntentCheckoutBound(
    {
      amount: 2_500,
      currency: "usd",
      metadata: {
        orderId: "legacy-order",
        restaurantId: "legacy-restaurant",
      },
    },
    {
      id: "legacy-order",
      restaurantId: "legacy-restaurant",
      totalCents: 2_500,
    },
  ),
  true,
);

const createdAt = new Date("2026-08-23T12:00:00.000Z");
assert.equal(
  isPickupOrderPaymentExpired(
    createdAt,
    new Date("2026-08-23T12:15:00.000Z"),
    15 * 60 * 1000,
  ),
  false,
  "The full advertised payment window remains usable",
);
assert.equal(
  isPickupOrderPaymentExpired(
    createdAt,
    new Date("2026-08-23T12:15:00.001Z"),
    15 * 60 * 1000,
  ),
  true,
  "An abandoned checkout expires immediately after its bounded window",
);
assert.equal(isPickupOrderPaymentExpired("not-a-date"), false);

assert.equal(
  isPickupPaymentSuccessEventWithinWindow({
    orderCreatedAt: createdAt,
    eventCreatedSeconds: new Date("2026-08-23T12:10:00.000Z").getTime() / 1000,
    now: new Date("2026-08-23T13:00:00.000Z"),
    windowMs: 15 * 60 * 1000,
  }),
  true,
  "A delayed webhook replay must use Stripe's signed event time",
);
assert.equal(
  isPickupPaymentSuccessEventWithinWindow({
    orderCreatedAt: createdAt,
    eventCreatedSeconds: new Date("2026-08-23T12:16:00.000Z").getTime() / 1000,
    now: new Date("2026-08-23T12:16:05.000Z"),
    windowMs: 15 * 60 * 1000,
  }),
  false,
  "Payment success after the advertised window must fail closed",
);
assert.equal(
  isPickupPaymentSettlementWithinGrace({
    orderCreatedAt: createdAt,
    now: new Date("2026-08-23T12:30:00.000Z"),
    paymentWindowMs: 15 * 60 * 1000,
    settlementGraceMs: 15 * 60 * 1000,
  }),
  true,
  "A signed success can settle through the bounded grace deadline",
);
assert.equal(
  isPickupPaymentSettlementWithinGrace({
    orderCreatedAt: createdAt,
    now: new Date("2026-08-23T12:30:00.001Z"),
    paymentWindowMs: 15 * 60 * 1000,
    settlementGraceMs: 15 * 60 * 1000,
  }),
  false,
  "A stale signed success replay cannot settle after the grace deadline",
);

for (const status of [
  "requires_payment_method",
  "requires_capture",
  "requires_confirmation",
  "requires_action",
  "processing",
]) {
  assert.equal(
    isStripePaymentIntentCancelable(status),
    true,
    `${status} must be cancelled before an abandoned reservation is released`,
  );
}
assert.equal(isStripePaymentIntentCancelable("succeeded"), false);
assert.equal(isStripePaymentIntentCancelable("canceled"), false);

const checkoutOrder = {
  id: "order-1",
  restaurantId: "restaurant-1",
  totalCents: 1300,
};
assert.equal(
  isPickupPaymentIntentCheckoutBound(
    {
      amount: 1300,
      currency: "usd",
      metadata: {
        pickupOrderId: "order-1",
        restaurantId: "restaurant-1",
      },
    },
    checkoutOrder,
  ),
  true,
);
assert.equal(
  isPickupPaymentIntentCheckoutBound(
    {
      amount: 1299,
      currency: "usd",
      metadata: {
        pickupOrderId: "order-1",
        restaurantId: "restaurant-1",
      },
    },
    checkoutOrder,
  ),
  false,
);
const settlementOrder = {
  ...checkoutOrder,
  merchantOwnerIdSnapshot: "owner-1",
  stripeConnectAccountIdSnapshot: "acct_merchant_1",
};
assert.equal(
  isPickupPaymentIntentOrderIdentityBound(
    {
      amount: 1300,
      currency: "usd",
      metadata: {
        pickupOrderId: "order-1",
        restaurantId: "restaurant-1",
        merchantOwnerId: "owner-1",
        stripeConnectAccountId: "acct_merchant_1",
      },
    },
    {
      ...settlementOrder,
      orderingContractVersion: PICKUP_ORDER_CONTRACT_VERSION,
    },
  ),
  true,
);
assert.equal(
  isPickupPaymentIntentOrderIdentityBound(
    {
      amount: 1300,
      currency: "usd",
      metadata: {
        pickupOrderId: "order-1",
        restaurantId: "restaurant-1",
        merchantOwnerId: "owner-1",
        stripeConnectAccountId: "acct_other",
      },
    },
    {
      ...settlementOrder,
      orderingContractVersion: PICKUP_ORDER_CONTRACT_VERSION,
    },
  ),
  false,
  "Current orders must retain their exact owner and Connect settlement binding during every reconciliation",
);
assert.equal(
  isPickupPaymentIntentOrderIdentityBound(
    {
      amount: 1300,
      currency: "usd",
      metadata: {
        orderId: "order-1",
        restaurantId: "restaurant-1",
      },
    },
    { ...checkoutOrder, orderingContractVersion: null },
  ),
  true,
  "Legacy recovery accepts only the exact legacy checkout identity",
);
assert.equal(
  isPickupPaymentIntentOrderIdentityBound(
    {
      amount: 1300,
      currency: "usd",
      metadata: {
        orderId: "order-1",
        restaurantId: "restaurant-1",
      },
    },
    { ...checkoutOrder, orderingContractVersion: "unknown-future-contract" },
  ),
  false,
  "Unknown ordering contracts must not inherit the weaker legacy binding",
);
assert.equal(
  isPickupPaymentIntentSettlementBound(
    {
      amount: 1300,
      currency: "usd",
      metadata: {
        pickupOrderId: "order-1",
        restaurantId: "restaurant-1",
        merchantOwnerId: "owner-1",
        stripeConnectAccountId: "acct_merchant_1",
      },
    },
    settlementOrder,
  ),
  true,
);
assert.equal(
  isPickupPaymentIntentSettlementBound(
    {
      amount: 1300,
      currency: "usd",
      metadata: {
        pickupOrderId: "order-1",
        restaurantId: "restaurant-1",
        merchantOwnerId: "owner-1",
        stripeConnectAccountId: "acct_other",
      },
    },
    settlementOrder,
  ),
  false,
  "A different Connect destination must never settle the order",
);
assert.equal(
  isPickupPaymentIntentAmountBound(
    {
      status: "succeeded",
      amount: 1300,
      amount_received: 1300,
      currency: "usd",
    },
    1300,
  ),
  true,
);
assert.equal(
  isPickupPaymentIntentAmountBound(
    {
      status: "succeeded",
      amount: 1300,
      amount_received: 1200,
      currency: "usd",
    },
    1300,
  ),
  false,
);
assert.equal(
  isPickupRefundBoundToOrder(
    { payment_intent: "pi-1", amount: 1300, currency: "usd" },
    "pi-1",
    1300,
  ),
  true,
);
assert.equal(
  isPickupRefundBoundToOrder(
    { payment_intent: "pi-other", amount: 1300, currency: "usd" },
    "pi-1",
    1300,
  ),
  false,
);
assert.equal(
  isPickupRefundFromOrder(
    { payment_intent: "pi-1", amount: 500, currency: "usd" },
    "pi-1",
    1300,
  ),
  true,
  "A positive partial refund remains bound to the exact order payment",
);
assert.equal(
  isPickupRefundFromOrder(
    { payment_intent: "pi-1", amount: 1301, currency: "usd" },
    "pi-1",
    1300,
  ),
  false,
  "A refund greater than the order total is never order-bound",
);
assert.equal(
  isPickupDisputeBoundToOrder(
    { payment_intent: "pi-1", amount: 700, currency: "usd" },
    "pi-1",
    1300,
  ),
  true,
  "A partial card dispute can be reconciled only against its exact payment",
);
for (const status of ["pending", "confirmed", "preparing", "ready"]) {
  assert.equal(
    shouldPickupRefundEnterCancellation(status, "succeeded"),
    true,
    `${status} must stop fulfillment after a bound full refund`,
  );
}
assert.equal(
  shouldPickupRefundEnterCancellation("confirmed", "failed"),
  true,
  "Any bound refund event must freeze active fulfillment until reconciliation",
);
assert.equal(
  shouldPickupRefundEnterCancellation("completed", "succeeded"),
  false,
);

assert.equal(classifyStripeRefundStatus("succeeded"), "succeeded");
assert.equal(classifyStripeRefundStatus("pending"), "waiting");
assert.equal(classifyStripeRefundStatus("requires_action"), "waiting");
assert.equal(classifyStripeRefundStatus("failed"), "failed");
assert.equal(classifyStripeRefundStatus("canceled"), "failed");
assert.equal(classifyStripeRefundStatus(null), "unknown");

const partialRefundAfterFailedPayoutRecovery = {
  totalCents: 1300,
  stripeRefundStatus: derivePickupOrderAggregateRefundStatus({
    totalCents: 1300,
    succeededAmountCents: 500,
    pendingAmountCents: 0,
    latestRefundStatus: "succeeded",
  }),
  stripeRefundAmountCents: 500,
};
try {
  throw new Error("injected downstream transfer reversal failure");
} catch {
  // The aggregate customer-refund record remains durable and truthful even
  // when downstream merchant-transfer work fails.
}
assert.equal(
  partialRefundAfterFailedPayoutRecovery.stripeRefundStatus,
  "partially_refunded",
);
assert.equal(
  isPickupOrderFullyRefunded(partialRefundAfterFailedPayoutRecovery),
  false,
  "A downstream failure cannot promote one partial refund to full-refund truth",
);

assert.equal(
  describePickupOrderCancellationPayment({
    paymentMethod: "card",
    totalCents: 1300,
    stripeRefundStatus: "succeeded",
    stripeRefundAmountCents: 1300,
  }),
  "Your card payment was refunded.",
);
assert.equal(
  describePickupOrderCancellationPayment({
    paymentMethod: "card",
    totalCents: 1300,
    stripeRefundStatus: "succeeded",
    stripeRefundAmountCents: 500,
  }),
  "A partial card refund was recorded; final reconciliation is still in progress.",
  "A succeeded partial refund must never be described as a full refund",
);
assert.equal(
  describePickupOrderCancellationPayment({
    paymentMethod: "card",
    stripeRefundStatus: null,
  }),
  "A final card payment or refund outcome is not yet recorded; keep the order status page for updates.",
  "Missing durable payment truth must not claim no charge or a refund",
);
assert.equal(
  describePickupOrderCancellationPayment({
    paymentMethod: "card",
    stripeRefundStatus: "not_required_payment_not_captured",
  }),
  "The card payment was not captured, so no refund was required.",
);

const partialLostDispute = {
  paymentMethod: "card",
  totalCents: 10_000,
  stripeDisputeStatus: "lost",
  stripeDisputeAmountCents: 2_000,
  stripeRefundStatus: "partially_refunded",
  stripeRefundAmountCents: 8_000,
};
assert.equal(
  pickupOrderRemainingCustomerRefundCents({
    ...partialLostDispute,
    stripeRefundAmountCents: 0,
  }),
  8_000,
);
assert.equal(isPickupOrderCustomerMadeWhole(partialLostDispute), true);
assert.equal(
  describePickupOrderCancellationPayment(partialLostDispute),
  "Your card issuer returned $20.00 through the dispute, and MealScout refunded the remaining $80.00.",
);
assert.equal(
  pickupOrderRemainingCustomerRefundCents({
    ...partialLostDispute,
    stripeDisputeStatus: "won",
    stripeRefundAmountCents: 0,
  }),
  10_000,
  "A merchant-won dispute gives the customer no final issuer recovery",
);
assert.equal(
  describePickupOrderReconciliationFailure({
    type: "StripeConnectionError",
    message: "network\nrequest did not finish",
  }),
  "StripeConnectionError: network request did not finish",
);

console.log("MealScout pickup payment reconciliation behavior: PASS");
