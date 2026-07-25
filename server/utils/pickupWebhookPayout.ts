export type PickupWebhookPayoutEligibilityInput = {
  statusBeforeWebhook: string | null | undefined;
  transitionedToConfirmed: boolean;
  stripeTransferGroupId: string | null | undefined;
  payoutStatus: string | null | undefined;
};

export function shouldAttemptPickupWebhookPayoutTransfer(
  input: PickupWebhookPayoutEligibilityInput,
): boolean {
  if (!String(input.stripeTransferGroupId || "").trim()) return false;
  if (input.payoutStatus === "transferred") return false;

  const status = String(input.statusBeforeWebhook || "")
    .trim()
    .toLowerCase();
  return (
    status === "confirmed" ||
    (status === "pending" && input.transitionedToConfirmed)
  );
}
