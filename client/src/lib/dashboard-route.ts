type DashboardRouteUser = {
  userType?: string | null;
  roles?: Array<string | null> | null;
  continuationPath?: string | null;
};

const isSafeAppPath = (value: unknown): value is string => {
  const path = String(value || "").trim();
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("://")
  );
};

export const getRoleDashboardPath = (user?: DashboardRouteUser | null) => {
  const roles = new Set<string>();
  const primaryType = String(user?.userType || "").trim().toLowerCase();
  if (primaryType) roles.add(primaryType);
  if (Array.isArray(user?.roles)) {
    user.roles.forEach((role) => {
      const normalized = String(role || "").trim().toLowerCase();
      if (normalized) roles.add(normalized);
    });
  }

  if (roles.has("admin") || roles.has("duper_admin") || roles.has("super_admin")) {
    return "/admin/dashboard";
  }
  if (roles.has("staff")) return "/staff";
  if (roles.has("event_coordinator")) return "/event-coordinator/dashboard";
  if (roles.has("host")) return "/host/dashboard";
  if (roles.has("supplier")) return "/supplier/dashboard";
  if (roles.has("restaurant_owner") || roles.has("food_truck")) {
    return "/restaurant-owner-dashboard";
  }
  return "/scout";
};

export const getAccountContinuationPath = (user?: DashboardRouteUser | null) => {
  const continuationPath = String(user?.continuationPath || "").trim();
  if (
    isSafeAppPath(continuationPath) &&
    !continuationPath.startsWith("/account-setup")
  ) {
    return continuationPath;
  }

  return getRoleDashboardPath(user);
};

export const CANONICAL_DASHBOARD_ENTRY_PATH = "/dashboard";
