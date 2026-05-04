export const DEFAULT_AFFILIATE_PERCENT = 20;
export const STAFF_AFFILIATE_PERCENT = 25;
export const ADMIN_AFFILIATE_PERCENT = 0;

export function getDefaultAffiliatePercent(userType?: string | null): number {
  if (userType === "staff") return STAFF_AFFILIATE_PERCENT;
  if (userType === "admin" || userType === "super_admin") {
    return ADMIN_AFFILIATE_PERCENT;
  }
  return DEFAULT_AFFILIATE_PERCENT;
}
