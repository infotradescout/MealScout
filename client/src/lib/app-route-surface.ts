type RouteSurfaceContext = {
  userType?: string | null;
  hasBusinessAccess?: boolean;
};
const normalizePathname = (value: string) => {
  const pathname = String(value || "/").split("?")[0] || "/";
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
};

const FOOD_BUSINESS_USER_TYPES = new Set([
  "restaurant_owner",
  "food_truck",
]);

export const isScoutRoutePath = (value: string) => {
  const pathname = normalizePathname(value);
  return (
    pathname === "/scout" ||
    pathname.startsWith("/scout/") ||
    pathname === "/scout-v2" ||
    pathname === "/directory" ||
    pathname.startsWith("/directory/")
  );
};

export const isParkingPassRoutePath = (value: string) =>
  normalizePathname(value) === "/parking-pass";

export const isBusinessWorkspaceRoutePath = (
  value: string,
  context: RouteSurfaceContext = {},
) => {
  const pathname = normalizePathname(value);
  const userType = String(context.userType || "").trim().toLowerCase();
  const hasFoodBusinessAuthority =
    FOOD_BUSINESS_USER_TYPES.has(userType) || context.hasBusinessAccess === true;

  if (
    pathname === "/restaurant-owner-dashboard" ||
    pathname === "/restaurant/dashboard" ||
    pathname === "/menu-builder" ||
    pathname === "/deal-creation" ||
    pathname.startsWith("/deal-edit/") ||
    pathname === "/business-team" ||
    pathname === "/kitchen"
  ) {
    return true;
  }

  if (pathname === "/orders") return hasFoodBusinessAuthority;

  if (
    pathname === "/subscribe" ||
    pathname === "/profile/settings" ||
    pathname === "/settings"
  ) {
    return hasFoodBusinessAuthority;
  }

  return false;
};
