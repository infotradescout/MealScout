export function doesPickupDisputeRequireMerchantRecovery(status: unknown) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  return Boolean(
    normalized && !["won", "prevented", "warning_closed"].includes(normalized),
  );
}

export function pickupOrderCustomerFinancialLossCents(input: {
  totalCents: unknown;
  succeededRefundAmountCents?: unknown;
  stripeDisputeStatus?: unknown;
  stripeDisputeAmountCents?: unknown;
}) {
  const totalCents = Number(input.totalCents);
  const refundCents = Number(input.succeededRefundAmountCents || 0);
  const disputeCents = doesPickupDisputeRequireMerchantRecovery(
    input.stripeDisputeStatus,
  )
    ? Number(input.stripeDisputeAmountCents || 0)
    : 0;
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new Error("Pickup order total is invalid for net settlement.");
  }
  if (
    !Number.isSafeInteger(refundCents) ||
    refundCents < 0 ||
    !Number.isSafeInteger(disputeCents) ||
    disputeCents < 0
  ) {
    throw new Error(
      "Pickup order customer loss is invalid for net settlement.",
    );
  }
  return Math.min(totalCents, refundCents + disputeCents);
}

export function pickupOrderReconciledPayoutStatus(input: {
  totalCents: unknown;
  succeededRefundAmountCents?: unknown;
  stripeDisputeStatus?: unknown;
}) {
  const totalCents = Number(input.totalCents);
  const refundCents = Number(input.succeededRefundAmountCents || 0);
  if (doesPickupDisputeRequireMerchantRecovery(input.stripeDisputeStatus)) {
    return "disputed";
  }
  if (refundCents >= totalCents && totalCents > 0) return "reversed";
  if (refundCents > 0) return "partially_reversed";
  return "transferred";
}
