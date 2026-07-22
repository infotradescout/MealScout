export type BusinessPermissionSet = {
  manageDeals: boolean;
  manageParkingPass: boolean;
  viewAnalytics: boolean;
  manageProfile: boolean;
};

export type BusinessAccessContext = {
  hasAnyAccess: boolean;
  permissions: BusinessPermissionSet;
  restaurants?: Array<{
    id: string;
    isOwner?: boolean;
    permissions: BusinessPermissionSet;
  }>;
};

const NO_BUSINESS_PERMISSIONS: BusinessPermissionSet = {
  manageDeals: false,
  manageParkingPass: false,
  viewAnalytics: false,
  manageProfile: false,
};

export function getScopedBusinessPermissions(
  context: BusinessAccessContext | null | undefined,
  restaurantId: string | null | undefined,
): BusinessPermissionSet {
  const safeId = String(restaurantId || "").trim();
  if (!safeId) return NO_BUSINESS_PERMISSIONS;
  const scoped = context?.restaurants?.find(
    (restaurant) => String(restaurant.id) === safeId,
  );
  return scoped?.permissions || NO_BUSINESS_PERMISSIONS;
}
