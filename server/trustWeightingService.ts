import { db } from "./db";
import {
  users,
  restaurantUserRecommendations,
  recommendationFlags,
  moderationCases,
  moderationResolutions,
} from "@shared/schema";
import { eq, and, sum, count, lt } from "drizzle-orm";

/**
 * Trust scoring integration for recommendations and awards
 * Incorporates moderation outcomes into ranking and Golden Fork eligibility
 */

export interface UserTrustProfile {
  userId: string;
  baseReputation: number; // influenceScore
  reporterReputation: number; // moderation reputation
  flagsAgainst: number; // recommendations flagged
  flagsUpheld: number; // how many were confirmed as policy violations
  trustAdjustmentPercent: number; // -50% to +20% modifier
  isEligibleForGoldenFork: boolean;
  eligibilityReason?: string;
}

export async function calculateUserTrustProfile(
  userId: string,
): Promise<UserTrustProfile> {
  // Get user's base stats
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .then((res) => res[0]);

  if (!user) throw new Error("User not found");

  // Count recommendations they made that were flagged
  const flaggedStats = await db
    .select({
      total: count(),
      upheld: count(),
    })
    .from(recommendationFlags)
    .leftJoin(
      moderationCases,
      eq(recommendationFlags.caseId, moderationCases.id),
    )
    .leftJoin(
      moderationResolutions,
      eq(moderationCases.id, moderationResolutions.caseId),
    )
    // Find flags on this user's recommendations
    // This would require fetching the user's recommendations first
    .then((res) => res[0]);

  // Get their recommendations count
  const recommendationsCount = await db
    .select({ count: count() })
    .from(restaurantUserRecommendations)
    .where(eq(restaurantUserRecommendations.userId, userId))
    .then((res) => res[0]?.count || 0);

  // Calculate trust adjustment based on:
  // 1. Reporter reputation (higher is better)
  // 2. False flags against their recommendations
  // 3. Upheld flags against their recommendations

  const reporterReputation = user.reporterReputationScore || 100;
  const falseFlagCount = user.falseFlagCount || 0;
  const flagsAgainstCount = user.flaggedCount || 0;

  // Trust adjustment formula:
  // Start at 0%
  // +20% for excellent reputation (>90)
  // -5% per upheld false flag (brigading)
  // -30% if multiple false flags (brigading pattern)
  // +5% recovery for each resolved valid report they filed

  let trustAdjustmentPercent = 0;

  if (reporterReputation > 90) {
    trustAdjustmentPercent += 20;
  } else if (reporterReputation > 70) {
    trustAdjustmentPercent += 10;
  } else if (reporterReputation < 40) {
    trustAdjustmentPercent -= 20;
  }

  if (falseFlagCount > 3) {
    trustAdjustmentPercent -= 30; // Pattern of harassment
  } else if (falseFlagCount > 0) {
    trustAdjustmentPercent -= 5 * falseFlagCount;
  }

  // Golden Fork eligibility check
  let isEligibleForGoldenFork = true;
  let eligibilityReason = "Meets all criteria";

  // Original criteria
  if ((user.reviewCount || 0) < 10) {
    isEligibleForGoldenFork = false;
    eligibilityReason = "Fewer than 10 reviews";
  } else if ((user.recommendationCount || 0) < 5) {
    isEligibleForGoldenFork = false;
    eligibilityReason = "Fewer than 5 recommendations";
  } else if ((user.influenceScore || 0) < 100) {
    isEligibleForGoldenFork = false;
    eligibilityReason = "Influence score below 100";
  }

  // Trust-based disqualification
  if (isEligibleForGoldenFork && reporterReputation < 50) {
    isEligibleForGoldenFork = false;
    eligibilityReason = "Reporter reputation below minimum threshold";
  }

  if (isEligibleForGoldenFork && falseFlagCount > 2) {
    isEligibleForGoldenFork = false;
    eligibilityReason = "Multiple false reports indicate lack of credibility";
  }

  // Cap adjustment to reasonable bounds
  trustAdjustmentPercent = Math.max(-50, Math.min(20, trustAdjustmentPercent));

  return {
    userId,
    baseReputation: user.influenceScore || 0,
    reporterReputation,
    flagsAgainst: flagsAgainstCount,
    flagsUpheld: user.upheldAgainstCount || 0,
    trustAdjustmentPercent,
    isEligibleForGoldenFork,
    eligibilityReason,
  };
}

export async function getRecommendationVisibilityScore(
  recommendationId: string,
): Promise<{
  isHidden: boolean;
  visibilityPercent: number;
  reason: string;
}> {
  // Check if this recommendation has been flagged
  const flags = await db
    .select()
    .from(recommendationFlags)
    .where(eq(recommendationFlags.recommendationId, recommendationId));

  const unresolved = flags.filter((f) => !f.caseId);

  // If flagged and unresolved, hide it
  if (unresolved.length > 0) {
    return {
      isHidden: true,
      visibilityPercent: 0,
      reason: "Pending moderation review",
    };
  }

  // Check moderation outcomes
  const cases = await db
    .select()
    .from(moderationCases)
    .where(eq(moderationCases.recommendationId, recommendationId));

  const resolutions = await Promise.all(
    cases.map((c) =>
      db
        .select()
        .from(moderationResolutions)
        .where(eq(moderationResolutions.caseId, c.id))
        .then((res) => res[0]),
    ),
  );

  const upheldCount = resolutions.filter((r) => r?.outcome === "valid").length;
  const dismissedCount = resolutions.filter(
    (r) => r?.outcome === "invalid",
  ).length;

  if (upheldCount > 0) {
    return {
      isHidden: true,
      visibilityPercent: 0,
      reason: "Violates community guidelines",
    };
  }

  if (dismissedCount >= 2) {
    // Multiple false flags - reduce visibility slightly due to controversy
    return {
      isHidden: false,
      visibilityPercent: 70,
      reason: "Multiple disputed flags reduce visibility",
    };
  }

  if (dismissedCount === 1) {
    // Single false flag - minor visibility reduction
    return {
      isHidden: false,
      visibilityPercent: 85,
      reason: "One disputed flag slightly reduces visibility",
    };
  }

  return {
    isHidden: false,
    visibilityPercent: 100,
    reason: "No moderation issues",
  };
}

export async function getExplainabilityText(
  userId: string,
  context: "ranking" | "award" | "visibility",
): Promise<string> {
  const profile = await calculateUserTrustProfile(userId);

  if (context === "ranking") {
    if (profile.trustAdjustmentPercent > 10) {
      return `Ranked higher due to strong community trust score (${profile.reporterReputation}/100)`;
    } else if (profile.trustAdjustmentPercent < -10) {
      return `Ranked lower due to community trust concerns (${profile.reporterReputation}/100)`;
    } else {
      return `Ranked based on community feedback and trust score`;
    }
  }

  if (context === "award") {
    if (!profile.isEligibleForGoldenFork) {
      return `Not eligible for Community Gold Fork: ${profile.eligibilityReason}`;
    } else if (profile.trustAdjustmentPercent > 15) {
      return `Community Gold Fork eligible - Strong community trust verified`;
    } else {
      return `Community Gold Fork eligible - Community trust verified`;
    }
  }

  if (context === "visibility") {
    const vis = await getRecommendationVisibilityScore(userId);
    if (vis.isHidden) {
      return `Hidden from feed: ${vis.reason}`;
    } else if (vis.visibilityPercent < 100) {
      return `Visibility reduced: ${vis.reason}`;
    }
  }

  return "Based on community feedback";
}

/**
 * When moderation case is resolved, update both user's reputation
 * and recalculate their trust profile for ranking adjustments
 */
export async function onModerationResolved(
  userId: string,
  caseId: string,
  outcome: "valid" | "invalid" | "partial",
) {
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .then((res) => res[0]);

  if (!user) return;

  let reputationDelta = 0;
  let flagCountUpdate = 0;
  let upheldCountUpdate = 0;

  if (outcome === "valid") {
    reputationDelta = 5;
    upheldCountUpdate = 1;
  } else if (outcome === "invalid") {
    reputationDelta = -10;
    flagCountUpdate = 1;
  } else {
    reputationDelta = 2;
  }

  // Update user with new stats
  await db
    .update(users)
    .set({
      reporterReputationScore: Math.max(
        10,
        (user.reporterReputationScore || 100) + reputationDelta,
      ),
      falseFlag Count:
        outcome === "invalid"
          ? (user.falseFlagCount || 0) + 1
          : user.falseFlagCount,
      upheldAgainstCount:
        outcome === "valid"
        outcome === "invalid"
          ? (user.falseFlagCount || 0) + 1
          : user.falseFlagCount,
          ? (user.upheldAgainstCount || 0) + 1
          : user.upheldAgainstCount,
    })
    .where(eq(users.id, userId));
}
