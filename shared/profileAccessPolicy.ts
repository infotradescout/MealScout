/**
 * Temporary product-wide access policy.
 *
 * MealScout profiles receive full operating-tool access while this switch is
 * active. Keep the legacy subscription state and billing paths intact so paid
 * plans can be re-enabled deliberately without changing transaction payments.
 */
export const UNIVERSAL_PROFILE_FREE_TRIAL_ACTIVE = true;

export function isStaffOrAdminUserType(
  userType?: string | null,
): boolean {
  return ["staff", "admin", "duper_admin", "super_admin"].includes(
    String(userType || ""),
  );
}
