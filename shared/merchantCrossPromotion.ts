export type MerchantCrossPromotionPolicy = {
  enabled: boolean;
  approvalMode: "automatic" | "approved_only";
  approvedBusinessIds: string[];
  excludedBusinessIds: string[];
};

export const DEFAULT_MERCHANT_CROSS_PROMOTION_POLICY: MerchantCrossPromotionPolicy = {
  enabled: true,
  approvalMode: "automatic",
  approvedBusinessIds: [],
  excludedBusinessIds: [],
};

const stringIds = (value: unknown) =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((item) => String(item || "").trim())
            .filter(Boolean),
        ),
      ).slice(0, 250)
    : [];

export function readMerchantCrossPromotionPolicy(
  settingsValue: unknown,
): MerchantCrossPromotionPolicy {
  const settings =
    settingsValue && typeof settingsValue === "object"
      ? (settingsValue as Record<string, unknown>)
      : {};
  const raw =
    settings.crossPromotion && typeof settings.crossPromotion === "object"
      ? (settings.crossPromotion as Record<string, unknown>)
      : {};
  return {
    enabled: raw.enabled !== false,
    approvalMode:
      raw.approvalMode === "approved_only" ? "approved_only" : "automatic",
    approvedBusinessIds: stringIds(raw.approvedBusinessIds),
    excludedBusinessIds: stringIds(raw.excludedBusinessIds),
  };
}

export function crossPromotionCandidateAllowed(
  policy: MerchantCrossPromotionPolicy,
  candidateId: string,
) {
  if (!policy.enabled || policy.excludedBusinessIds.includes(candidateId)) {
    return false;
  }
  return (
    policy.approvalMode !== "approved_only" ||
    policy.approvedBusinessIds.includes(candidateId)
  );
}
