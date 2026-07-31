import type { User } from "@shared/schema";
import { PROFILE_ACCESS_POLICY } from "@shared/profileAccessPolicy";
import { storage } from "../storage";

export function isPremiumTrialActive(user: User | null): boolean {
  return Boolean(user && PROFILE_ACCESS_POLICY.status === "active");
}

export async function ensurePremiumTrialForUser(user: User): Promise<User> {
  return user;
}

export async function ensurePremiumTrialForUserId(
  userId: string,
): Promise<User | null> {
  const user = await storage.getUser(userId);
  if (!user) return null;
  return await ensurePremiumTrialForUser(user);
}
