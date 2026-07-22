import type { ProfileEvidenceReviewField } from "@shared/profileEvidenceReview";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export type ProfileEvidenceQuarantineVisibility = {
  isQuarantined: boolean;
  hidePublicTrustFields: boolean;
  hideMedia: boolean;
  decisionStatus: (evidenceId: string) => string;
  isAccepted: (evidenceId: string) => boolean;
  isRejected: (evidenceId: string) => boolean;
  isAcceptedWithLegacyFallback: (
    evidenceId: string,
    legacyEvidenceId: string,
  ) => boolean;
  isRejectedWithLegacyFallback: (
    evidenceId: string,
    legacyEvidenceId: string,
  ) => boolean;
};

const normalizeLoose = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (value: unknown) =>
  normalizeLoose(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

const overlapRatio = (left: unknown, right: unknown) => {
  const leftTokens = new Set(tokens(left));
  const rightTokens = new Set(tokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  return shared / Math.max(leftTokens.size, rightTokens.size);
};

const normalizePhone = (value: unknown) =>
  String(value || "").replace(/[^\d]/g, "");

const normalizeDomain = (value: unknown) => {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  return raw
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim();
};

const joinedAddressLabel = (restaurant: Record<string, unknown>) =>
  [restaurant.address, restaurant.city, restaurant.state]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");

/**
 * Canonical visibility policy for evidence-quarantined public profile fields.
 * Public projection and profile-completion truth must consume the same verdict
 * so a hidden asset can never satisfy a public-readiness requirement.
 */
export function deriveProfileEvidenceQuarantineVisibility(
  restaurantValue: unknown,
): ProfileEvidenceQuarantineVisibility {
  const restaurant = asRecord(restaurantValue);
  const rawData = asRecord(restaurant.rawData);
  const evidenceIngest = asRecord(rawData.evidenceIngest);
  const directQuarantine = asRecord(rawData.evidenceQuarantine);
  const hasDirectQuarantine = Boolean(
    rawData.evidenceQuarantine &&
      typeof rawData.evidenceQuarantine === "object" &&
      !Array.isArray(rawData.evidenceQuarantine),
  );
  const quarantineConfig =
    hasDirectQuarantine
      ? directQuarantine
      : asRecord(evidenceIngest.quarantine);
  const extractedEvidence = asRecord(evidenceIngest.extracted);
  const evidenceExternalBusinessName =
    String(
      extractedEvidence.business_name ||
        extractedEvidence.name ||
        evidenceIngest.businessName ||
        evidenceIngest.sourceBusinessName ||
        evidenceIngest.googleBusinessName ||
        "",
    ).trim() || null;
  const normalizedRestaurantPhone = normalizePhone(restaurant.phone);
  const normalizedEvidencePhone = normalizePhone(extractedEvidence.phone);
  const hardIdentityPhoneMatch = Boolean(
    normalizedRestaurantPhone &&
      normalizedEvidencePhone &&
      normalizedRestaurantPhone === normalizedEvidencePhone,
  );
  const restaurantEmail = String(restaurant.email || "")
    .trim()
    .toLowerCase();
  const evidenceEmail = String(extractedEvidence.email || "")
    .trim()
    .toLowerCase();
  const hardIdentityEmailMatch = Boolean(
    restaurantEmail && evidenceEmail && restaurantEmail === evidenceEmail,
  );
  const restaurantWebsite = normalizeDomain(restaurant.websiteUrl);
  const evidenceWebsite = normalizeDomain(
    extractedEvidence.website || extractedEvidence.websiteUrl,
  );
  const hardIdentityWebsiteMatch = Boolean(
    restaurantWebsite &&
      evidenceWebsite &&
      restaurantWebsite === evidenceWebsite,
  );
  const restaurantAddress = normalizeLoose(joinedAddressLabel(restaurant));
  const evidenceAddress = normalizeLoose(
    extractedEvidence.address || extractedEvidence.location_text,
  );
  const hardIdentityAddressMatch = Boolean(
    restaurantAddress &&
      evidenceAddress &&
      restaurantAddress === evidenceAddress,
  );
  const hasHardIdentityAnchor = Boolean(
    hardIdentityPhoneMatch ||
      hardIdentityEmailMatch ||
      hardIdentityWebsiteMatch ||
      hardIdentityAddressMatch,
  );
  const externalNameMismatch =
    Boolean(evidenceExternalBusinessName) &&
    Boolean(String(restaurant.name || "").trim()) &&
    overlapRatio(restaurant.name, evidenceExternalBusinessName) < 0.6;
  const quarantineByRule = externalNameMismatch && !hasHardIdentityAnchor;
  const isQuarantined = Boolean(
    quarantineConfig.active === true ||
      String(quarantineConfig.status || "")
        .trim()
        .toLowerCase() === "quarantined" ||
      quarantineByRule,
  );
  const quarantineDecisions = asRecord(quarantineConfig.decisions);
  const decisionStatus = (evidenceId: string) =>
    String(
      asRecord(quarantineDecisions[evidenceId]).status ||
        asRecord(quarantineDecisions[evidenceId.replace(/-/g, "_")]).status ||
        "",
    )
      .trim()
      .toLowerCase();
  const isAccepted = (evidenceId: string) =>
    decisionStatus(evidenceId) === "accepted";
  const isRejected = (evidenceId: string) =>
    decisionStatus(evidenceId) === "rejected";
  const isAcceptedWithLegacyFallback = (
    evidenceId: string,
    legacyEvidenceId: string,
  ) => {
    const status = decisionStatus(evidenceId);
    return status ? status === "accepted" : isAccepted(legacyEvidenceId);
  };
  const isRejectedWithLegacyFallback = (
    evidenceId: string,
    legacyEvidenceId: string,
  ) => {
    const status = decisionStatus(evidenceId);
    return status ? status === "rejected" : isRejected(legacyEvidenceId);
  };
  const hidePublicTrustFields =
    isQuarantined && quarantineConfig.allowPublicTrustFields !== true;
  const hideMedia =
    hidePublicTrustFields && quarantineConfig.hideMedia !== false;

  return {
    isQuarantined,
    hidePublicTrustFields,
    hideMedia,
    decisionStatus,
    isAccepted,
    isRejected,
    isAcceptedWithLegacyFallback,
    isRejectedWithLegacyFallback,
  };
}

const quarantineDecisionKeyByField: Partial<
  Record<ProfileEvidenceReviewField, string>
> = {
  phone: "contact_phone",
  websiteUrl: "website_link",
  facebookPageUrl: "social_facebook",
  instagramUrl: "social_instagram",
  xUrl: "social_x",
};

/**
 * Records only the trust-field decision the owner actually made. It never
 * disables profile-level quarantine or blesses sibling social/contact fields.
 */
export function reconcileOwnerConfirmedEvidenceQuarantine(input: {
  rawData: unknown;
  field: ProfileEvidenceReviewField;
  proposalId: string;
  actorUserId: string;
  decidedAt: string;
}): Record<string, unknown> | null {
  const decisionKey = quarantineDecisionKeyByField[input.field];
  if (!decisionKey) return null;

  const rawData = asRecord(input.rawData);
  const evidenceQuarantine = asRecord(rawData.evidenceQuarantine);
  const decisions = asRecord(evidenceQuarantine.decisions);
  const previousDecision = asRecord(decisions[decisionKey]);

  return {
    ...rawData,
    evidenceQuarantine: {
      ...evidenceQuarantine,
      decisions: {
        ...decisions,
        [decisionKey]: {
          ...previousDecision,
          status: "accepted",
          source: "owner_profile_evidence_review",
          proposalId: input.proposalId,
          reviewedByUserId: input.actorUserId,
          reviewedAt: input.decidedAt,
        },
      },
    },
  };
}
