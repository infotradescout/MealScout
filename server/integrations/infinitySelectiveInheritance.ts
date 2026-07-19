export type InfinityInheritanceSourceKind =
  | "owner_verified"
  | "product_record"
  | "screen_pass"
  | "public_credential"
  | "public_catalog"
  | "public_reputation"
  | "public_website";

type FieldRule = {
  field: string;
  action: "inherit" | "exclude";
  allowedSourceKinds: InfinityInheritanceSourceKind[];
  minimumConfidence: number;
  requireVerifiedEvidence: boolean;
  sourcePriority: InfinityInheritanceSourceKind[];
};

const inherit = (
  field: string,
  minimumConfidence: number,
  sourcePriority: InfinityInheritanceSourceKind[],
): FieldRule => ({
  field,
  action: "inherit",
  allowedSourceKinds: sourcePriority,
  minimumConfidence,
  requireVerifiedEvidence: true,
  sourcePriority,
});

const exclude = (field: string): FieldRule => ({
  field,
  action: "exclude",
  allowedSourceKinds: [],
  minimumConfidence: 1,
  requireVerifiedEvidence: true,
  sourcePriority: [],
});

export function mealScoutSelectiveInheritancePolicy(tenantId: string) {
  return {
    id: "mealscout-public-profile-selective-inheritance",
    tenantId,
    objectType: "food_business_profile",
    version: "1",
    status: "active" as const,
    defaultAction: "exclude" as const,
    fields: [
      inherit("businessName", 0.95, [
        "owner_verified",
        "product_record",
        "public_website",
      ]),
      inherit("description", 0.9, [
        "owner_verified",
        "product_record",
        "public_website",
      ]),
      inherit("logo", 0.9, [
        "owner_verified",
        "screen_pass",
        "product_record",
        "public_website",
      ]),
      inherit("coverImage", 0.9, [
        "owner_verified",
        "screen_pass",
        "product_record",
        "public_website",
      ]),
      inherit("cuisine", 0.9, [
        "owner_verified",
        "product_record",
        "public_catalog",
        "public_website",
      ]),
      inherit("menu", 0.95, [
        "owner_verified",
        "product_record",
        "public_catalog",
        "screen_pass",
      ]),
      inherit("schedule", 0.98, [
        "owner_verified",
        "product_record",
        "screen_pass",
      ]),
      inherit("location", 0.98, [
        "owner_verified",
        "product_record",
        "public_credential",
      ]),
      inherit("gallery", 0.9, [
        "owner_verified",
        "screen_pass",
        "product_record",
        "public_website",
      ]),
      inherit("socialLinks", 0.95, [
        "owner_verified",
        "product_record",
        "public_website",
      ]),
      exclude("liveAvailability"),
      exclude("ordering"),
      exclude("payment"),
      exclude("commission"),
      exclude("ownerIdentity"),
      exclude("staffAccess"),
      exclude("claimStatus"),
    ],
  };
}

export type MealScoutInheritanceCandidate = {
  field: string;
  value: unknown;
  sourceKind: InfinityInheritanceSourceKind;
  sourceReference: string;
  evidenceDigest: string;
  observedAt: string;
  confidence: number;
  verified: boolean;
  screenPass?: {
    publicId: string;
    authoritative: boolean;
    changed: boolean | null;
  };
};

export type MealScoutInheritanceOverride = {
  field: string;
  value: unknown;
  reason: string;
  evidenceDigest: string;
  actorReference: string;
  authorizedAt: string;
};
