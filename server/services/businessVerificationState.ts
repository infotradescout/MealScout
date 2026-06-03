type VerificationStateInput = {
  isActive?: boolean | null;
  isVerified?: boolean | null;
  emailVerified?: boolean | null;
  insuranceVerified?: boolean | null;
  insuranceExpiresAt?: Date | string | null;
  businessInsuranceSubmitted?: boolean | null;
  claimedFromImportId?: string | null;
  isSuspended?: boolean | null;
  isBanned?: boolean | null;
};

export type BusinessVerificationState = {
  isVerifiedForSetup: boolean;
  isVerifiedForDiscovery: boolean;
  verificationLabel:
    | "verified"
    | "verification_pending"
    | "inactive"
    | "review_required";
  blockingReasons: string[];
  setupWarnings: string[];
  isAdminUploadDraft: boolean;
  isImportDraft: boolean;
};

const hasText = (value: unknown) => String(value || "").trim().length > 0;

const isFutureDate = (value: unknown) => {
  if (!value) return false;
  const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(time) && time > Date.now();
};

export function getBusinessVerificationState(
  input: VerificationStateInput,
): BusinessVerificationState {
  const active = input.isActive !== false;
  const suspended = input.isSuspended === true || input.isBanned === true;
  const insuranceNotExpired =
    !input.insuranceExpiresAt || isFutureDate(input.insuranceExpiresAt);
  const hasInsurance = input.insuranceVerified === true && insuranceNotExpired;
  const hasEmailOrAdminVerification =
    input.emailVerified === true || input.isVerified === true;

  const isImportDraft = hasText(input.claimedFromImportId) && input.isVerified !== true;
  const isAdminUploadDraft = isImportDraft;

  const isVerifiedForSetup =
    active &&
    !suspended &&
    !isAdminUploadDraft &&
    hasEmailOrAdminVerification &&
    hasInsurance;
  const isVerifiedForDiscovery = isVerifiedForSetup;

  const blockingReasons: string[] = [];
  if (!active) blockingReasons.push("business_inactive");
  if (suspended) blockingReasons.push("business_suspended");
  if (isAdminUploadDraft) blockingReasons.push("review_required");

  const setupWarnings: string[] = [];
  if (!hasInsurance) setupWarnings.push("insurance_pending");
  if (!hasEmailOrAdminVerification) setupWarnings.push("email_or_admin_verification_pending");

  let verificationLabel: BusinessVerificationState["verificationLabel"] = "verification_pending";
  if (!active || suspended) verificationLabel = "inactive";
  else if (isAdminUploadDraft) verificationLabel = "review_required";
  else if (isVerifiedForSetup) verificationLabel = "verified";

  return {
    isVerifiedForSetup,
    isVerifiedForDiscovery,
    verificationLabel,
    blockingReasons,
    setupWarnings,
    isAdminUploadDraft,
    isImportDraft,
  };
}
