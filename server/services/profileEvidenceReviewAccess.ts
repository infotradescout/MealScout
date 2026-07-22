export type ProfileEvidenceMembershipEvidence = {
  restaurantId?: unknown;
  userId?: unknown;
  status?: unknown;
  permissions?: unknown;
} | null;

const isStaffOrAdmin = (userType?: string | null) =>
  userType === "staff" ||
  userType === "admin" ||
  userType === "duper_admin" ||
  userType === "super_admin";

/**
 * Exact resource authorization for owner evidence review. Account-wide business
 * roles never grant access to a different selected restaurant.
 */
export function hasProfileEvidenceReviewAccess(input: {
  userId: unknown;
  userType?: string | null;
  restaurantId: unknown;
  ownerId?: unknown;
  membership?: ProfileEvidenceMembershipEvidence;
}): boolean {
  if (isStaffOrAdmin(input.userType)) return true;
  const userId = String(input.userId || "").trim();
  const restaurantId = String(input.restaurantId || "").trim();
  if (!userId || !restaurantId) return false;
  if (String(input.ownerId || "").trim() === userId) return true;

  const membership = input.membership;
  const permissions =
    membership?.permissions && typeof membership.permissions === "object"
      ? (membership.permissions as Record<string, unknown>)
      : {};
  return Boolean(
    membership &&
      String(membership.userId || "").trim() === userId &&
      String(membership.restaurantId || "").trim() === restaurantId &&
      String(membership.status || "").trim() === "active" &&
      permissions.manageProfile === true,
  );
}
