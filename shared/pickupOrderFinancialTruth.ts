export type PickupOrderRefundTruth = {
  totalCents?: unknown;
  stripeRefundStatus?: unknown;
  stripeRefundAmountCents?: unknown;
};

export type PickupOrderCustomerRecoveryTruth = PickupOrderRefundTruth & {
  stripeDisputeStatus?: unknown;
  stripeDisputeAmountCents?: unknown;
};

export function pickupOrderSucceededRefundAmountCents(
  order: PickupOrderRefundTruth,
) {
  const totalCents = Number(order.totalCents);
  const refundedCents = Number(order.stripeRefundAmountCents);
  if (
    !Number.isSafeInteger(totalCents) ||
    totalCents <= 0 ||
    !Number.isSafeInteger(refundedCents) ||
    refundedCents <= 0
  ) {
    return 0;
  }
  return Math.min(totalCents, refundedCents);
}

export function isPickupOrderFullyRefunded(order: PickupOrderRefundTruth) {
  const totalCents = Number(order.totalCents);
  return (
    String(order.stripeRefundStatus || "")
      .trim()
      .toLowerCase() === "succeeded" &&
    Number.isSafeInteger(totalCents) &&
    totalCents > 0 &&
    pickupOrderSucceededRefundAmountCents(order) === totalCents
  );
}

export function pickupOrderDisputeRecoveryAmountCents(
  order: PickupOrderCustomerRecoveryTruth,
) {
  const totalCents = Number(order.totalCents);
  const disputeAmountCents = Number(order.stripeDisputeAmountCents);
  if (
    String(order.stripeDisputeStatus || "")
      .trim()
      .toLowerCase() !== "lost" ||
    !Number.isSafeInteger(totalCents) ||
    totalCents <= 0 ||
    !Number.isSafeInteger(disputeAmountCents) ||
    disputeAmountCents <= 0
  ) {
    return 0;
  }
  return Math.min(totalCents, disputeAmountCents);
}

export function pickupOrderCustomerRecoveryAmountCents(
  order: PickupOrderCustomerRecoveryTruth,
) {
  const totalCents = Number(order.totalCents);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return 0;
  return Math.min(
    totalCents,
    pickupOrderSucceededRefundAmountCents(order) +
      pickupOrderDisputeRecoveryAmountCents(order),
  );
}

export function pickupOrderRemainingCustomerRefundCents(
  order: PickupOrderCustomerRecoveryTruth,
) {
  const totalCents = Number(order.totalCents);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new Error("Pickup order total is invalid for customer recovery.");
  }
  return Math.max(
    0,
    totalCents - pickupOrderCustomerRecoveryAmountCents(order),
  );
}

export function isPickupOrderCustomerMadeWhole(
  order: PickupOrderCustomerRecoveryTruth,
) {
  const totalCents = Number(order.totalCents);
  const disputeRecoveryCents = pickupOrderDisputeRecoveryAmountCents(order);
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return false;
  if (disputeRecoveryCents === 0) return isPickupOrderFullyRefunded(order);
  return pickupOrderCustomerRecoveryAmountCents(order) === totalCents;
}
