import type { User } from "@shared/schema";
import { UNIVERSAL_PROFILE_FREE_TRIAL_ACTIVE } from "@shared/profileAccessPolicy";
import { storage } from "../storage";

export function isPremiumTrialActive(user: User | null): boolean {
  if (user && UNIVERSAL_PROFILE_FREE_TRIAL_ACTIVE) return true;
  if (!user?.trialEndsAt) return false;
  return user.trialEndsAt.getTime() > Date.now();
}

export async function ensurePremiumTrialForUser(user: User): Promise<User> {
  if (UNIVERSAL_PROFILE_FREE_TRIAL_ACTIVE) {
    return user;
  }

  if (user.stripeSubscriptionId) {
    return user;
  }

  // Never grant trials to staff/admin accounts.
  const ineligibleTypes = new Set([
    "staff",
    "admin",
    "duper_admin",
    "super_admin",
  ]);
  if (ineligibleTypes.has(String(user.userType || ""))) {
    return user;
  }

  const restaurantsForUser = await storage.getRestaurantsByOwner(user.id);
  const eligibleUserTypes = new Set(["restaurant_owner", "food_truck"]);
  if (!eligibleUserTypes.has(String(user.userType || ""))) {
    return user;
  }

  if (restaurantsForUser.length === 0) {
    return user;
  }

  // Trial is anchored to account creation date, not verification date.
  const createdAt = user.createdAt ? new Date(user.createdAt) : new Date();
  if (!Number.isFinite(createdAt.getTime())) {
    return user;
  }

  const startedAt = createdAt;
  const endsAt = new Date(startedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

  const hasSameWindow =
    user.trialStartedAt &&
    user.trialEndsAt &&
    Math.abs(new Date(user.trialStartedAt).getTime() - startedAt.getTime()) <
      1_000 &&
    Math.abs(new Date(user.trialEndsAt).getTime() - endsAt.getTime()) < 1_000;

  if (hasSameWindow) {
    return user;
  }
  const trialStillActive = endsAt.getTime() > Date.now();
  const nextInterval = trialStillActive
    ? "trial"
    : user.subscriptionBillingInterval === "trial"
      ? null
      : user.subscriptionBillingInterval;

  const updated = await storage.updateUser(user.id, {
    trialStartedAt: startedAt,
    trialEndsAt: endsAt,
    trialUsed: true,
    subscriptionBillingInterval: nextInterval,
  });

  return updated || user;
}

export async function ensurePremiumTrialForUserId(
  userId: string,
): Promise<User | null> {
  const user = await storage.getUser(userId);
  if (!user) return null;
  return await ensurePremiumTrialForUser(user);
}
