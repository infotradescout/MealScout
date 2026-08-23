export type PickupWebhookPayoutEligibilityInput = {
  statusBeforeWebhook: string | null | undefined;
  paymentSucceeded: boolean;
  stripeTransferGroupId: string | null | undefined;
  payoutStatus: string | null | undefined;
};

export type PickupPayoutLatestCharge =
  | string
  | { id?: string | null }
  | null
  | undefined;

export function resolvePickupPayoutSourceTransaction(
  latestCharge: PickupPayoutLatestCharge,
): string | null {
  const chargeId =
    typeof latestCharge === "string" ? latestCharge : latestCharge?.id;
  const normalized = String(chargeId || "").trim();
  return normalized || null;
}

export function shouldAttemptPickupWebhookPayoutTransfer(
  input: PickupWebhookPayoutEligibilityInput,
): boolean {
  if (!input.paymentSucceeded) return false;
  if (!String(input.stripeTransferGroupId || "").trim()) return false;
  if (input.payoutStatus === "transferred") return false;

  const status = String(input.statusBeforeWebhook || "")
    .trim()
    .toLowerCase();
  return status === "pending" || status === "confirmed";
}
