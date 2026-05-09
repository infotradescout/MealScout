export const ROOT_ADMIN_ROLE = "super_admin" as const;
export const DUPER_ADMIN_ROLE = "duper_admin" as const;

export const VALID_USER_TYPES = [
  "customer",
  "restaurant_owner",
  "food_truck",
  "supplier",
  "host",
  "event_coordinator",
  "staff",
  "admin",
  DUPER_ADMIN_ROLE,
  ROOT_ADMIN_ROLE,
] as const;

export type UserType = (typeof VALID_USER_TYPES)[number];

export function getUserType(value: unknown): string {
  return String(value || "").trim();
}

export function isRootAdminUserType(userType: unknown): boolean {
  return getUserType(userType) === ROOT_ADMIN_ROLE;
}

export function isDuperAdminUserType(userType: unknown): boolean {
  return getUserType(userType) === DUPER_ADMIN_ROLE;
}

export function isAdminUserType(userType: unknown): boolean {
  const role = getUserType(userType);
  return (
    role === "admin" || role === DUPER_ADMIN_ROLE || role === ROOT_ADMIN_ROLE
  );
}

export function isInternalTeamUserType(userType: unknown): boolean {
  return getUserType(userType) === "staff" || isAdminUserType(userType);
}

export function canAssignUserType(
  actorUserType: unknown,
  targetUserType: unknown,
): boolean {
  const actor = getUserType(actorUserType);
  const target = getUserType(targetUserType);

  if (!VALID_USER_TYPES.includes(target as UserType)) return false;
  if (target === ROOT_ADMIN_ROLE) return actor === ROOT_ADMIN_ROLE;
  if (target === DUPER_ADMIN_ROLE)
    return actor === ROOT_ADMIN_ROLE || actor === DUPER_ADMIN_ROLE;
  if (target === "admin" || target === "staff") return isAdminUserType(actor);
  return isInternalTeamUserType(actor);
}

export function getRoleAssignmentDeniedMessage(
  targetUserType: unknown,
): string {
  const target = getUserType(targetUserType);
  if (target === ROOT_ADMIN_ROLE) {
    return "Only super admins can assign super admin accounts";
  }
  if (target === DUPER_ADMIN_ROLE) {
    return "Only Duperrr admins or super admins can assign Duperrr admin accounts";
  }
  if (target === "admin" || target === "staff") {
    return "Only admins can assign internal team roles";
  }
  return "You do not have permission to assign this user type";
}

export function shouldAssignAffiliateTagForUserType(
  userType?: string | null,
): boolean {
  const role = getUserType(userType);
  return (
    role !== "admin" && role !== DUPER_ADMIN_ROLE && role !== ROOT_ADMIN_ROLE
  );
}
