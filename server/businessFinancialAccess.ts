import { isInternalTeamUserType } from "./roleAccess";
import { storage } from "./storage";

type BusinessFinancialAccessInput = {
  restaurantId: string;
  userId: string;
  userType: unknown;
};

/**
 * Account, plan, and payment tools are intentionally owner-only. Business
 * collaborators do not inherit financial access from profile, deals, parking,
 * or analytics permissions. Internal staff and administrators retain their
 * existing support access.
 */
export async function canManageBusinessFinancials({
  restaurantId,
  userId,
  userType,
}: BusinessFinancialAccessInput): Promise<boolean> {
  if (!restaurantId || !userId) return false;
  if (isInternalTeamUserType(userType)) return true;
  return storage.verifyRestaurantOwnership(restaurantId, userId);
}
