export function buildRestaurantOrderingAuthorityRevocation() {
  return {
    orderingApprovedAt: null,
    orderingApprovedByUserId: null,
    orderingApprovalEvidenceUrl: null,
    orderingApprovalReviewNote: null,
    pickupAcknowledgementMinutes: null,
  } as const;
}

export function buildRestaurantOwnerTransferReset() {
  return {
    ...buildRestaurantOrderingAuthorityRevocation(),
    stripeConnectAccountId: null,
    stripeConnectStatus: "pending",
    stripeOnboardingCompleted: false,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
  } as const;
}

export const RESTAURANT_OWNER_TRANSFER_TERMINAL_ORDER_STATUSES = [
  "completed",
  "cancelled",
] as const;

export function isPickupOrderBlockingRestaurantOwnerTransfer(
  status: unknown,
): boolean {
  return !RESTAURANT_OWNER_TRANSFER_TERMINAL_ORDER_STATUSES.includes(
    String(
      status || "",
    ) as (typeof RESTAURANT_OWNER_TRANSFER_TERMINAL_ORDER_STATUSES)[number],
  );
}
