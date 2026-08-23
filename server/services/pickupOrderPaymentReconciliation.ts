import type Stripe from "stripe";
import {
  isPickupOrderFullyRefunded,
  pickupOrderCustomerRecoveryAmountCents,
  pickupOrderDisputeRecoveryAmountCents,
  pickupOrderSucceededRefundAmountCents,
} from "@shared/pickupOrderFinancialTruth";

const configuredPickupPaymentWindowMinutes = Number(
  process.env.PICKUP_ORDER_PAYMENT_WINDOW_MINUTES || 15,
);

export const PICKUP_ORDER_CONTRACT_VERSION = "2026-08-23-v1";

export const PICKUP_ORDER_PAYMENT_WINDOW_MS =
  (Number.isFinite(configuredPickupPaymentWindowMinutes)
    ? Math.min(30, Math.max(5, configuredPickupPaymentWindowMinutes))
    : 15) *
  60 *
  1000;

const configuredPickupSettlementGraceMinutes = Number(
  process.env.PICKUP_ORDER_SETTLEMENT_GRACE_MINUTES || 15,
);
export const PICKUP_ORDER_SETTLEMENT_GRACE_MS =
  (Number.isFinite(configuredPickupSettlementGraceMinutes)
    ? Math.min(60, Math.max(5, configuredPickupSettlementGraceMinutes))
    : 15) *
  60 *
  1000;

export const PICKUP_ORDER_PAYMENT_EXPIRED_REASON =
  "Payment was not completed before the checkout window expired";

export const PICKUP_ORDER_PAYMENT_EVENT_OUTSIDE_WINDOW_REASON =
  "Stripe could not verify that payment completed within the checkout window";

export const PICKUP_ORDER_SETTLEMENT_GRACE_EXPIRED_REASON =
  "Payment confirmation could not be settled before the checkout deadline";

export const PICKUP_ORDER_ACKNOWLEDGEMENT_EXPIRED_REASON =
  "The business did not start preparation within its verified response window";

export function isPickupOrderPaymentExpired(
  createdAt: unknown,
  now = new Date(),
  windowMs = PICKUP_ORDER_PAYMENT_WINDOW_MS,
): boolean {
  const createdAtMs = new Date(String(createdAt || "")).getTime();
  const nowMs = now.getTime();
  return Boolean(
    Number.isFinite(createdAtMs) &&
    Number.isFinite(nowMs) &&
    nowMs - createdAtMs > windowMs,
  );
}

export function isPickupPaymentSuccessEventWithinWindow(input: {
  orderCreatedAt: unknown;
  eventCreatedSeconds: unknown;
  now?: Date;
  windowMs?: number;
}): boolean {
  const orderCreatedAtMs = new Date(
    String(input.orderCreatedAt || ""),
  ).getTime();
  const eventCreatedSeconds = Number(input.eventCreatedSeconds);
  const eventCreatedAtMs = eventCreatedSeconds * 1000;
  const nowMs = (input.now || new Date()).getTime();
  const windowMs = input.windowMs ?? PICKUP_ORDER_PAYMENT_WINDOW_MS;
  const clockSkewMs = 2 * 60 * 1000;
  return Boolean(
    Number.isFinite(orderCreatedAtMs) &&
    Number.isFinite(eventCreatedSeconds) &&
    Number.isSafeInteger(eventCreatedSeconds) &&
    eventCreatedSeconds > 0 &&
    Number.isFinite(nowMs) &&
    eventCreatedAtMs >= orderCreatedAtMs - clockSkewMs &&
    eventCreatedAtMs <= nowMs + clockSkewMs &&
    eventCreatedAtMs - orderCreatedAtMs <= windowMs,
  );
}

export function isPickupPaymentSettlementWithinGrace(input: {
  orderCreatedAt: unknown;
  now?: Date;
  paymentWindowMs?: number;
  settlementGraceMs?: number;
}): boolean {
  const orderCreatedAtMs = new Date(
    String(input.orderCreatedAt || ""),
  ).getTime();
  const nowMs = (input.now || new Date()).getTime();
  const paymentWindowMs =
    input.paymentWindowMs ?? PICKUP_ORDER_PAYMENT_WINDOW_MS;
  const settlementGraceMs =
    input.settlementGraceMs ?? PICKUP_ORDER_SETTLEMENT_GRACE_MS;
  const ageMs = nowMs - orderCreatedAtMs;
  return Boolean(
    Number.isFinite(orderCreatedAtMs) &&
    Number.isFinite(nowMs) &&
    Number.isFinite(paymentWindowMs) &&
    paymentWindowMs >= 0 &&
    Number.isFinite(settlementGraceMs) &&
    settlementGraceMs >= 0 &&
    ageMs >= -2 * 60 * 1000 &&
    ageMs <= paymentWindowMs + settlementGraceMs,
  );
}

export function isStripePaymentIntentCancelable(status: unknown): boolean {
  return [
    "requires_payment_method",
    "requires_capture",
    "requires_confirmation",
    "requires_action",
    "processing",
  ].includes(String(status || ""));
}

export function isPickupPaymentIntentAmountBound(
  paymentIntent: {
    status?: unknown;
    currency?: unknown;
    amount?: unknown;
    amount_received?: unknown;
  },
  expectedTotalCents: unknown,
): boolean {
  const expected = Number(expectedTotalCents);
  const amount = Number(paymentIntent.amount);
  const amountReceived = Number(paymentIntent.amount_received);
  return Boolean(
    paymentIntent.status === "succeeded" &&
    String(paymentIntent.currency || "")
      .trim()
      .toLowerCase() === "usd" &&
    Number.isSafeInteger(expected) &&
    expected >= 0 &&
    Number.isSafeInteger(amount) &&
    Number.isSafeInteger(amountReceived) &&
    amount === expected &&
    amountReceived === expected,
  );
}

export function isPickupPaymentIntentCheckoutBound(
  paymentIntent: {
    currency?: unknown;
    amount?: unknown;
    metadata?: Record<string, unknown> | null;
  },
  order: {
    id?: unknown;
    restaurantId?: unknown;
    totalCents?: unknown;
  },
): boolean {
  const expected = Number(order.totalCents);
  const amount = Number(paymentIntent.amount);
  const metadata = paymentIntent.metadata || {};
  return Boolean(
    String(order.id || "").trim() &&
    String(metadata.pickupOrderId || "").trim() ===
      String(order.id || "").trim() &&
    String(metadata.restaurantId || "").trim() ===
      String(order.restaurantId || "").trim() &&
    String(paymentIntent.currency || "")
      .trim()
      .toLowerCase() === "usd" &&
    Number.isSafeInteger(expected) &&
    expected >= 0 &&
    Number.isSafeInteger(amount) &&
    amount === expected,
  );
}

export function isLegacyPickupPaymentIntentCheckoutBound(
  paymentIntent: {
    currency?: unknown;
    amount?: unknown;
    metadata?: Record<string, unknown> | null;
  },
  order: {
    id?: unknown;
    restaurantId?: unknown;
    totalCents?: unknown;
  },
): boolean {
  const expected = Number(order.totalCents);
  const amount = Number(paymentIntent.amount);
  const metadata = paymentIntent.metadata || {};
  const metadataOrderId = String(
    metadata.pickupOrderId || metadata.orderId || "",
  ).trim();
  return Boolean(
    String(order.id || "").trim() &&
    metadataOrderId === String(order.id || "").trim() &&
    String(metadata.restaurantId || "").trim() ===
      String(order.restaurantId || "").trim() &&
    String(paymentIntent.currency || "")
      .trim()
      .toLowerCase() === "usd" &&
    Number.isSafeInteger(expected) &&
    expected >= 0 &&
    Number.isSafeInteger(amount) &&
    amount === expected,
  );
}

export function isPickupPaymentIntentSettlementBound(
  paymentIntent: {
    currency?: unknown;
    amount?: unknown;
    metadata?: Record<string, unknown> | null;
  },
  order: {
    id?: unknown;
    restaurantId?: unknown;
    totalCents?: unknown;
    merchantOwnerIdSnapshot?: unknown;
    stripeConnectAccountIdSnapshot?: unknown;
  },
): boolean {
  const metadata = paymentIntent.metadata || {};
  const ownerId = String(order.merchantOwnerIdSnapshot || "").trim();
  const connectAccountId = String(
    order.stripeConnectAccountIdSnapshot || "",
  ).trim();
  return Boolean(
    ownerId &&
    connectAccountId &&
    isPickupPaymentIntentCheckoutBound(paymentIntent, order) &&
    String(metadata.merchantOwnerId || "").trim() === ownerId &&
    String(metadata.stripeConnectAccountId || "").trim() === connectAccountId,
  );
}

export function isPickupPaymentIntentOrderIdentityBound(
  paymentIntent: {
    currency?: unknown;
    amount?: unknown;
    metadata?: Record<string, unknown> | null;
  },
  order: {
    id?: unknown;
    restaurantId?: unknown;
    totalCents?: unknown;
    orderingContractVersion?: unknown;
    merchantOwnerIdSnapshot?: unknown;
    stripeConnectAccountIdSnapshot?: unknown;
  },
): boolean {
  const contractVersion = String(order.orderingContractVersion || "").trim();
  if (contractVersion === PICKUP_ORDER_CONTRACT_VERSION) {
    return isPickupPaymentIntentSettlementBound(paymentIntent, order);
  }
  if (!contractVersion) {
    return isLegacyPickupPaymentIntentCheckoutBound(paymentIntent, order);
  }
  return false;
}

export function isPickupRefundBoundToOrder(
  refund: {
    payment_intent?: unknown;
    currency?: unknown;
    amount?: unknown;
  },
  expectedPaymentIntentId: unknown,
  expectedTotalCents: unknown,
): boolean {
  const paymentIntent = refund.payment_intent;
  const paymentIntentId =
    typeof paymentIntent === "string"
      ? paymentIntent
      : String((paymentIntent as { id?: unknown } | null)?.id || "");
  const expectedIntentId = String(expectedPaymentIntentId || "").trim();
  const expected = Number(expectedTotalCents);
  const amount = Number(refund.amount);
  return Boolean(
    expectedIntentId &&
    paymentIntentId === expectedIntentId &&
    String(refund.currency || "")
      .trim()
      .toLowerCase() === "usd" &&
    Number.isSafeInteger(expected) &&
    expected >= 0 &&
    Number.isSafeInteger(amount) &&
    amount === expected,
  );
}

export function isPickupRefundFromOrder(
  refund: {
    payment_intent?: unknown;
    currency?: unknown;
    amount?: unknown;
  },
  expectedPaymentIntentId: unknown,
  expectedTotalCents: unknown,
): boolean {
  const paymentIntent = refund.payment_intent;
  const paymentIntentId =
    typeof paymentIntent === "string"
      ? paymentIntent
      : String((paymentIntent as { id?: unknown } | null)?.id || "");
  const expectedIntentId = String(expectedPaymentIntentId || "").trim();
  const expected = Number(expectedTotalCents);
  const amount = Number(refund.amount);
  return Boolean(
    expectedIntentId &&
    paymentIntentId === expectedIntentId &&
    String(refund.currency || "")
      .trim()
      .toLowerCase() === "usd" &&
    Number.isSafeInteger(expected) &&
    expected > 0 &&
    Number.isSafeInteger(amount) &&
    amount > 0 &&
    amount <= expected,
  );
}

export async function summarizePickupOrderRefunds(input: {
  stripe: Stripe;
  paymentIntentId: string;
  totalCents: number;
}) {
  const refunds: Stripe.Refund[] = [];
  let startingAfter: string | undefined;
  do {
    const page = await input.stripe.refunds.list({
      payment_intent: input.paymentIntentId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    refunds.push(...page.data);
    const lastRefund = page.data.at(-1);
    startingAfter = page.has_more ? lastRefund?.id : undefined;
    if (page.has_more && !startingAfter) {
      throw new Error(
        `Stripe refunds for PaymentIntent ${input.paymentIntentId} could not be fully paginated.`,
      );
    }
  } while (startingAfter);

  for (const refund of refunds) {
    if (
      !isPickupRefundFromOrder(refund, input.paymentIntentId, input.totalCents)
    ) {
      throw new Error(
        `Stripe refund ${refund.id} is not bound to PaymentIntent ${input.paymentIntentId}.`,
      );
    }
  }
  const succeededAmountCents = refunds
    .filter((refund) => refund.status === "succeeded")
    .reduce((total, refund) => total + Number(refund.amount), 0);
  const pendingAmountCents = refunds
    .filter((refund) =>
      ["pending", "requires_action"].includes(String(refund.status)),
    )
    .reduce((total, refund) => total + Number(refund.amount), 0);
  if (succeededAmountCents > input.totalCents) {
    throw new Error(
      `Stripe refunds exceed pickup order total for PaymentIntent ${input.paymentIntentId}.`,
    );
  }
  return {
    refunds,
    succeededAmountCents,
    pendingAmountCents,
    latestRefund:
      [...refunds].sort((left, right) => right.created - left.created)[0] ||
      null,
  };
}

export function isPickupDisputeBoundToOrder(
  dispute: {
    payment_intent?: unknown;
    currency?: unknown;
    amount?: unknown;
  },
  expectedPaymentIntentId: unknown,
  expectedTotalCents: unknown,
): boolean {
  const paymentIntent = dispute.payment_intent;
  const paymentIntentId =
    typeof paymentIntent === "string"
      ? paymentIntent
      : String((paymentIntent as { id?: unknown } | null)?.id || "");
  const expectedIntentId = String(expectedPaymentIntentId || "").trim();
  const total = Number(expectedTotalCents);
  const amount = Number(dispute.amount);
  return Boolean(
    expectedIntentId &&
    paymentIntentId === expectedIntentId &&
    String(dispute.currency || "")
      .trim()
      .toLowerCase() === "usd" &&
    Number.isSafeInteger(total) &&
    total > 0 &&
    Number.isSafeInteger(amount) &&
    amount > 0 &&
    amount <= total,
  );
}

export function shouldPickupRefundEnterCancellation(
  orderStatus: unknown,
  _refundStatus: unknown,
): boolean {
  const activeOrderStatuses = ["pending", "confirmed", "preparing", "ready"];
  return activeOrderStatuses.includes(String(orderStatus || ""));
}

export type StripeRefundReconciliationState =
  "succeeded" | "waiting" | "failed" | "unknown";

export function classifyStripeRefundStatus(
  status: unknown,
): StripeRefundReconciliationState {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  if (normalized === "succeeded") return "succeeded";
  if (["pending", "requires_action"].includes(normalized)) return "waiting";
  if (["failed", "canceled"].includes(normalized)) return "failed";
  return "unknown";
}

export function derivePickupOrderAggregateRefundStatus(input: {
  totalCents: unknown;
  succeededAmountCents: unknown;
  pendingAmountCents: unknown;
  latestRefundStatus: unknown;
}) {
  const totalCents = Number(input.totalCents);
  const succeededAmountCents = Number(input.succeededAmountCents);
  const pendingAmountCents = Number(input.pendingAmountCents);
  if (
    !Number.isSafeInteger(totalCents) ||
    totalCents <= 0 ||
    !Number.isSafeInteger(succeededAmountCents) ||
    succeededAmountCents < 0 ||
    succeededAmountCents > totalCents ||
    !Number.isSafeInteger(pendingAmountCents) ||
    pendingAmountCents < 0
  ) {
    throw new Error("Pickup refund aggregate contains invalid amounts.");
  }
  const latestRefundStatus = String(input.latestRefundStatus || "unknown");
  if (succeededAmountCents === totalCents) return "succeeded";
  if (pendingAmountCents > 0) return "pending";
  if (succeededAmountCents > 0) {
    return ["failed", "canceled"].includes(latestRefundStatus)
      ? "reconciliation_required"
      : "partially_refunded";
  }
  return latestRefundStatus;
}

export function describePickupOrderReconciliationFailure(
  error: unknown,
): string {
  const candidate = error as {
    name?: unknown;
    type?: unknown;
    message?: unknown;
  };
  const kind = String(candidate?.type || candidate?.name || "Stripe error")
    .replace(/\s+/g, " ")
    .trim();
  const message = String(
    candidate?.message || "Stripe payment reconciliation did not finish.",
  )
    .replace(/\s+/g, " ")
    .trim();
  return `${kind}: ${message}`.slice(0, 500);
}

export function describePickupOrderCancellationPayment(input: {
  paymentMethod?: unknown;
  totalCents?: unknown;
  stripeRefundStatus?: unknown;
  stripeRefundAmountCents?: unknown;
  stripeDisputeStatus?: unknown;
  stripeDisputeAmountCents?: unknown;
}): string {
  if (input.paymentMethod !== "card") return "No card payment was collected.";
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const disputeRecoveryCents = pickupOrderDisputeRecoveryAmountCents(input);
  const refundedCents = pickupOrderSucceededRefundAmountCents(input);
  const totalCents = Number(input.totalCents);
  if (disputeRecoveryCents > 0) {
    if (
      Number.isSafeInteger(totalCents) &&
      pickupOrderCustomerRecoveryAmountCents(input) === totalCents
    ) {
      return refundedCents > 0
        ? `Your card issuer returned ${money(disputeRecoveryCents)} through the dispute, and MealScout refunded the remaining ${money(refundedCents)}.`
        : `Your card issuer returned ${money(disputeRecoveryCents)} through the dispute; no separate MealScout refund was needed.`;
    }
    return `Your card issuer returned ${money(disputeRecoveryCents)} through the dispute. Reconciliation of the remaining card amount is still in progress.`;
  }
  if (isPickupOrderFullyRefunded(input)) {
    return "Your card payment was refunded.";
  }
  if (refundedCents > 0) {
    return "A partial card refund was recorded; final reconciliation is still in progress.";
  }
  const refundStatus = String(input.stripeRefundStatus || "")
    .trim()
    .toLowerCase();
  if (refundStatus === "not_required_payment_not_captured") {
    return "The card payment was not captured, so no refund was required.";
  }
  return "A final card payment or refund outcome is not yet recorded; keep the order status page for updates.";
}
