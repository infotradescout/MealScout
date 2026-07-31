/**
 * Canonical MealScout profile product law.
 *
 * Every business profile includes the complete profile toolset under a free
 * trial that does not expire, require a card, convert to a paid plan, or create
 * a monthly bill. Transaction, order, delivery, and booking charges are
 * separate and must never be inferred from this profile-access policy.
 */
export const PROFILE_ACCESS_POLICY = {
  status: "active",
  label: "Free trial",
  expires: false,
  cardRequired: false,
  convertsToPaid: false,
  monthlySubscriptionEnabled: false,
} as const;

// Kept as a compatibility export while older route names are removed.
export const UNIVERSAL_PROFILE_FREE_TRIAL_ACTIVE = true;

export function isStaffOrAdminUserType(
  userType?: string | null,
): boolean {
  return ["staff", "admin", "duper_admin", "super_admin"].includes(
    String(userType || ""),
  );
}
