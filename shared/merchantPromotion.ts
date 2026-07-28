export type MerchantPromotionMode = "automatic" | "approved_only";
export type MerchantPromotionPartnerStatus = "approved" | "excluded";

export const PROMOTION_ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function promotionCandidateAllowed(input: {
  enabled: boolean;
  approvalMode: MerchantPromotionMode;
  partnerStatus?: MerchantPromotionPartnerStatus | null;
}) {
  if (!input.enabled || input.partnerStatus === "excluded") return false;
  return input.approvalMode === "automatic" || input.partnerStatus === "approved";
}

export function calculatePromotedOrderCommissionCents(
  eligibleOrderCents: number,
  commissionBps: number,
) {
  const cents = Math.max(0, Math.round(eligibleOrderCents));
  const bps = Math.max(0, Math.min(10_000, Math.round(commissionBps)));
  return Math.floor((cents * bps) / 10_000);
}

export function isAttributionUsable(input: {
  sourceRestaurantId: string;
  targetRestaurantId: string;
  expectedTargetRestaurantId: string;
  clickedAt: Date;
  expiresAt: Date;
  convertedAt?: Date | null;
  now?: Date;
}) {
  const now = input.now || new Date();
  return (
    input.sourceRestaurantId !== input.targetRestaurantId &&
    input.targetRestaurantId === input.expectedTargetRestaurantId &&
    !input.convertedAt &&
    input.clickedAt <= now &&
    input.expiresAt > now
  );
}
