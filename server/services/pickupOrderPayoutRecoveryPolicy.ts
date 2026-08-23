import { isPickupOrderCustomerMadeWhole } from "@shared/pickupOrderFinancialTruth";

type RefundedCancelledPickupOrder = {
  status: string;
  paymentMethod: string;
  totalCents: number;
  stripeRefundStatus?: string | null;
  stripeRefundAmountCents?: number | null;
  stripeDisputeStatus?: string | null;
  stripeDisputeAmountCents?: number | null;
};

export function needsCancelledPickupOrderPayoutRecovery(
  order: RefundedCancelledPickupOrder,
) {
  return (
    order.status === "cancelled" &&
    order.paymentMethod === "card" &&
    isPickupOrderCustomerMadeWhole(order)
  );
}

/**
 * Merchant payout recovery is deliberately downstream from durable customer
 * refund truth. A recovery failure may change only merchant-facing payout
 * state; it must never turn a cancelled, fully refunded order back into an
 * unpaid-refund state.
 */
export async function recoverPayoutWithoutDowngradingCustomerRefund<
  T extends RefundedCancelledPickupOrder,
>(
  order: T,
  recover: () => Promise<T | null>,
  onRecoveryError?: (error: unknown) => void,
): Promise<T> {
  if (!needsCancelledPickupOrderPayoutRecovery(order)) return order;
  try {
    return (await recover()) || order;
  } catch (error) {
    onRecoveryError?.(error);
    return order;
  }
}
