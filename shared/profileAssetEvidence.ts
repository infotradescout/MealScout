export const PROFILE_ASSET_TYPES = [
  "logo",
  "profile_media",
  "cover",
  "menu",
  "hours",
  "contact",
  "profile_details",
] as const;

export type ProfileAssetType = (typeof PROFILE_ASSET_TYPES)[number];

export type ProfileAssetEvidenceSource =
  | "manual_codex_intake"
  | "admin_user_upload";

export type ProfileAssetEvidence = {
  source: ProfileAssetEvidenceSource;
  originalFilename: string;
  normalizedFilename: string;
  normalizedPath: string;
  sha256: string;
  assetType: ProfileAssetType;
  profileSlug: string | null;
  profileId: string;
  ownerUserId: string | null;
  intakeAt: string;
  applyMode: "append_only_enrichment";
  mimeType: string;
  sizeBytes: number;
  reviewStatus: "pending_review" | "approved";
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const requiredText = (value: unknown, label: string) => {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
};

export function buildProfileAssetEvidence(
  input: ProfileAssetEvidence,
): ProfileAssetEvidence {
  const source = requiredText(input.source, "source") as ProfileAssetEvidenceSource;
  if (!["manual_codex_intake", "admin_user_upload"].includes(source)) {
    throw new Error(`Unsupported evidence source: ${source}`);
  }

  const assetType = requiredText(input.assetType, "assetType") as ProfileAssetType;
  if (!(PROFILE_ASSET_TYPES as readonly string[]).includes(assetType)) {
    throw new Error(`Unsupported asset type: ${assetType}`);
  }

  const sha256 = requiredText(input.sha256, "sha256").toLowerCase();
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error("sha256 must be a 64-character lowercase hex digest");
  }

  const intakeAt = requiredText(input.intakeAt, "intakeAt");
  if (Number.isNaN(Date.parse(intakeAt))) {
    throw new Error("intakeAt must be an ISO-8601 timestamp");
  }

  const sizeBytes = Number(input.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error("sizeBytes must be a positive integer");
  }

  if (input.applyMode !== "append_only_enrichment") {
    throw new Error("applyMode must be append_only_enrichment");
  }

  if (!["pending_review", "approved"].includes(input.reviewStatus)) {
    throw new Error("reviewStatus must be pending_review or approved");
  }

  return {
    source,
    originalFilename: requiredText(input.originalFilename, "originalFilename"),
    normalizedFilename: requiredText(
      input.normalizedFilename,
      "normalizedFilename",
    ),
    normalizedPath: requiredText(input.normalizedPath, "normalizedPath"),
    sha256,
    assetType,
    profileSlug: input.profileSlug
      ? requiredText(input.profileSlug, "profileSlug")
      : null,
    profileId: requiredText(input.profileId, "profileId"),
    ownerUserId: input.ownerUserId
      ? requiredText(input.ownerUserId, "ownerUserId")
      : null,
    intakeAt: new Date(intakeAt).toISOString(),
    applyMode: "append_only_enrichment",
    mimeType: requiredText(input.mimeType, "mimeType"),
    sizeBytes,
    reviewStatus: input.reviewStatus,
  };
}

export function profileEvidenceUploadField(
  assetType: ProfileAssetType,
  options: { approveLogo?: boolean } = {},
) {
  if (assetType === "logo") {
    return options.approveLogo ? "logoImage" : "profileImages";
  }
  if (assetType === "menu") return "menuImages";
  if (assetType === "hours") return "hoursImages";
  if (assetType === "contact" || assetType === "profile_details") {
    return "contactImages";
  }
  return "profileImages";
}
