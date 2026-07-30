export type PreOrderPaymentIntentDisposition =
  | "create_order"
  | "cancelled"
  | "resume_payment"
  | "payment_submitted"
  | "unsafe_state";

export function classifyPreOrderPaymentIntentStatus(
  status: unknown,
): PreOrderPaymentIntentDisposition {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  if (normalized === "requires_payment_method") {
    return "create_order";
  }
  if (normalized === "canceled") {
    return "cancelled";
  }
  if (normalized === "requires_action") {
    return "resume_payment";
  }
  if (["processing", "requires_capture", "succeeded"].includes(normalized)) {
    return "payment_submitted";
  }
  return "unsafe_state";
}

export function paymentIntentMatchesPickupOrder(
  intent: {
    amount?: unknown;
    currency?: unknown;
    transfer_group?: unknown;
    metadata?: Record<string, unknown> | null;
  },
  expected: {
    orderId: string;
    restaurantId: string;
    totalCents: number;
    transferGroup: string;
  },
) {
  const metadata = intent.metadata || {};
  return (
    String(metadata.pickupOrderId || "") === expected.orderId &&
    String(metadata.orderId || "") === expected.orderId &&
    String(metadata.restaurantId || "") === expected.restaurantId &&
    Number(intent.amount) === expected.totalCents &&
    String(intent.currency || "").toLowerCase() === "usd" &&
    String(intent.transfer_group || "") === expected.transferGroup
  );
}
