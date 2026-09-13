import { db as applicationDb } from "./db";
import {
  users,
  restaurants,
  restaurantUserRecommendations,
  recommendationFlags,
  profileContentFlags,
  moderationCases,
  moderationResolutions,
  moderationAppeals,
} from "@shared/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export interface ModerationService {
  // Flag creation
  flagRecommendation(
    recommendationId: string,
    flaggedByUserId: string,
    reason: string,
    description?: string,
    evidenceUrls?: string[],
  ): Promise<{ flagId: string; caseId: string }>;

  flagProfileContent(
    restaurantId: string,
    flaggedByUserId: string,
    contentType: string,
    reason: string,
    description?: string,
    evidenceUrls?: string[],
  ): Promise<{ flagId: string; caseId: string }>;

  // Moderation queue
  getModerationQueue(
    status?: string,
    priority?: string,
    search?: string,
  ): Promise<ModeratingCaseWithFlag[]>;

  assignCase(caseId: string, moderatorId: string): Promise<void>;

  // Resolution
  resolveCase(
    caseId: string,
    moderatorId: string,
    outcome: "valid" | "invalid" | "partial",
    reasonCode: string,
    moderatorNotes?: string,
    actionTaken?: string,
  ): Promise<void>;

  // Appeals
  appealDecision(
    resolutionId: string,
    appealedByUserId: string,
    appealReason: string,
  ): Promise<string>; // Returns appeal ID

  // Reporter reputation
  getReporterReputation(userId: string): Promise<{
    score: number;
    flaggedCount: number;
    upheldCount: number;
    falseFlagCount: number;
  }>;

  // Case details
  getCaseDetails(
    caseId: string,
  ): Promise<ModeratingCaseWithFlag | null>;

  // User's flags
  getUserFlags(
    userId: string,
  ): Promise<UserFlagWithCaseStatus[]>;
}

export interface ModeratingCaseWithFlag {
  case: {
    id: string;
    caseType: string;
    status: string;
    priority: string;
    reporterId: string;
    restaurantId: string | null;
    recommendationId: string | null;
    assignedModeratorId: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  flag: {
    id: string;
    reason: string;
    description: string | null;
    evidenceUrls: string[];
    flaggedAt: Date;
  };
  resolution?: {
    outcome: string;
    reasonCode: string;
    moderatorNotes: string | null;
    actionTaken: string | null;
  };
  reporter: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    reporterReputation: number;
  };
}

export interface UserFlagWithCaseStatus {
  flag: {
    id: string;
    reason: string;
    createdAt: Date;
  };
  case: {
    id: string;
    status: string;
    updatedAt: Date;
  };
  resolution?: {
    outcome: string;
  };
}

export function createModerationService(db = applicationDb): ModerationService {
  return {
    async flagRecommendation(
      recommendationId: string,
      flaggedByUserId: string,
      reason: string,
      description?: string,
      evidenceUrls?: string[],
    ) {
      // Create flag
      const [flag] = await db
        .insert(recommendationFlags)
        .values({
          recommendationId,
          flaggedByUserId,
          reason,
          description,
          evidenceUrls: evidenceUrls || [],
        })
        .returning();

      // Create moderation case
      const [caseRecord] = await db
        .insert(moderationCases)
        .values({
          caseType: "recommendation_flag",
          flagId: flag.id,
          reporterId: flaggedByUserId,
          recommendationId,
          status: "pending",
        })
        .returning();

      // Update flag with case reference
      await db
        .update(recommendationFlags)
        .set({ caseId: caseRecord.id })
        .where(eq(recommendationFlags.id, flag.id));

      return {
        flagId: flag.id,
        caseId: caseRecord.id,
      };
    },

    async flagProfileContent(
      restaurantId: string,
      flaggedByUserId: string,
      contentType: string,
      reason: string,
      description?: string,
      evidenceUrls?: string[],
    ) {
      // Create flag
      const [flag] = await db
        .insert(profileContentFlags)
        .values({
          restaurantId,
          flaggedByUserId,
          contentType,
          reason,
          description,
          evidenceUrls: evidenceUrls || [],
        })
        .returning();

      // Create moderation case
      const [caseRecord] = await db
        .insert(moderationCases)
        .values({
          caseType: "profile_content_flag",
          flagId: flag.id,
          reporterId: flaggedByUserId,
          restaurantId,
          status: "pending",
        })
        .returning();

      // Update flag with case reference
      await db
        .update(profileContentFlags)
        .set({ caseId: caseRecord.id })
        .where(eq(profileContentFlags.id, flag.id));

      return {
        flagId: flag.id,
        caseId: caseRecord.id,
      };
    },

    async getModerationQueue(status?: string, priority?: string, search?: string) {
      let query = db.select().from(moderationCases);

      if (status) {
        query = query.where(eq(moderationCases.status, status));
      }
      if (priority) {
        query = query.where(eq(moderationCases.priority, priority));
      }

      const cases = await query.orderBy(
        desc(moderationCases.priority),
        desc(moderationCases.createdAt),
      );

      const enriched = await Promise.all(
        cases.map(async (caseRecord: any) => {
          const flag =
            caseRecord.caseType === "recommendation_flag"
              ? await db
                  .select()
                  .from(recommendationFlags)
                  .where(eq(recommendationFlags.id, caseRecord.flagId))
                  .then((res: any[]) => res[0])
              : await db
                  .select()
                  .from(profileContentFlags)
                  .where(eq(profileContentFlags.id, caseRecord.flagId))
                  .then((res: any[]) => res[0]);

          const resolution = await db
            .select()
            .from(moderationResolutions)
            .where(eq(moderationResolutions.caseId, caseRecord.id))
            .then((res: any[]) => res[0]);

          const reporter = await db
            .select()
            .from(users)
            .where(eq(users.id, caseRecord.reporterId))
            .then((res: any[]) => res[0]);

          return {
            case: caseRecord,
            flag,
            resolution,
            reporter: {
              id: reporter.id,
              firstName: reporter.firstName,
              lastName: reporter.lastName,
              reporterReputation: reporter.reporterReputationScore,
            },
          };
        }),
      );

      return enriched;
    },

    async assignCase(caseId: string, moderatorId: string) {
      await db
        .update(moderationCases)
        .set({
          assignedModeratorId: moderatorId,
          assignedAt: new Date(),
          status: "under_review",
        })
        .where(eq(moderationCases.id, caseId));
    },

    async resolveCase(
      caseId: string,
      moderatorId: string,
      outcome: "valid" | "invalid" | "partial",
      reasonCode: string,
      moderatorNotes?: string,
      actionTaken?: string,
    ) {
      // Get case details
      const caseRecord = await db
        .select()
        .from(moderationCases)
        .where(eq(moderationCases.id, caseId))
        .then((res: any[]) => res[0]);

      if (!caseRecord) throw new Error("Case not found");

      // Create resolution
      const [resolution] = await db
        .insert(moderationResolutions)
        .values({
          caseId,
          outcome,
          reasonCode,
          moderatorNotes,
          actionTaken,
        })
        .returning();

      // Update case status
      await db
        .update(moderationCases)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(moderationCases.id, caseId));

      // Update reporter reputation
      const reporter = await db
        .select()
        .from(users)
        .where(eq(users.id, caseRecord.reporterId))
        .then((res: any[]) => res[0]);

      let reputationDelta = 0;
      if (outcome === "valid") {
        reputationDelta = 5; // Boost for accurate reports
      } else if (outcome === "invalid") {
        reputationDelta = -10; // Penalize false reports
      } else {
        reputationDelta = 2; // Slight boost for partially valid
      }

      await db
        .update(users)
        .set({
          reporterReputationScore: Math.max(
            10,
            reporter.reporterReputationScore + reputationDelta,
          ),
          flaggedCount:
            outcome === "valid"
              ? reporter.flaggedCount + 1
              : reporter.flaggedCount,
          falseFlagCount:
            outcome === "invalid"
              ? reporter.falseFlagCount + 1
              : reporter.falseFlagCount,
          upheldAgainstCount:
            outcome === "valid" ? reporter.upheldAgainstCount + 1 : reporter.upheldAgainstCount,
        })
        .where(eq(users.id, caseRecord.reporterId));
    },

    async appealDecision(
      resolutionId: string,
      appealedByUserId: string,
      appealReason: string,
    ) {
      return db.transaction(async (tx: any) => {
        const [resolution] = await tx.select().from(moderationResolutions)
          .where(eq(moderationResolutions.id, resolutionId)).for("update");
        const fail = (message: string, status: number): never => {
          throw Object.assign(new Error(message), { status });
        };
        if (!resolution) fail("Resolution not found", 404);
        if (resolution.appealEligible === false) fail("This resolution is not eligible for appeal", 409);
        const [caseRecord] = await tx.select().from(moderationCases)
          .where(eq(moderationCases.id, resolution.caseId)).for("update");
        if (!caseRecord) fail("Resolution not found", 404);
        let authorized = caseRecord.reporterId === appealedByUserId;
        if (!authorized && caseRecord.restaurantId) {
          const [business] = await tx.select({ ownerId: restaurants.ownerId }).from(restaurants)
            .where(eq(restaurants.id, caseRecord.restaurantId));
          authorized = business?.ownerId === appealedByUserId;
        }
        if (!authorized && caseRecord.recommendationId) {
          const [recommendation] = await tx.select({ userId: restaurantUserRecommendations.userId })
            .from(restaurantUserRecommendations)
            .where(eq(restaurantUserRecommendations.id, caseRecord.recommendationId));
          authorized = recommendation?.userId === appealedByUserId;
        }
        if (!authorized) fail("You cannot appeal this resolution", 403);
        if (!["resolved", "appealed"].includes(caseRecord.status)) {
          fail("This case is not open for an appeal", 409);
        }
        const [existing] = await tx.select({ id: moderationAppeals.id, appealedByUserId: moderationAppeals.appealedByUserId })
          .from(moderationAppeals).where(eq(moderationAppeals.resolutionId, resolutionId));
        if (existing?.appealedByUserId === appealedByUserId) return existing.id;
        if (existing) fail("An appeal has already been submitted for this resolution", 409);
        const [appeal] = await tx.insert(moderationAppeals).values({
          resolutionId, appealedByUserId, appealReason,
        }).returning();
        await tx.update(moderationCases).set({ status: "appealed", updatedAt: new Date() })
          .where(eq(moderationCases.id, caseRecord.id));
        return appeal.id;
      });
    },

    async getReporterReputation(userId: string) {
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .then((res: any[]) => res[0]);

      return {
        score: user.reporterReputationScore || 100,
        flaggedCount: user.flaggedCount || 0,
        upheldCount: user.upheldAgainstCount || 0,
        falseFlagCount: user.falseFlagCount || 0,
      };
    },

    async getCaseDetails(caseId: string) {
      const caseRecord = await db
        .select()
        .from(moderationCases)
        .where(eq(moderationCases.id, caseId))
        .then((res: any[]) => res[0]);

      if (!caseRecord) return null;

      const flag =
        caseRecord.caseType === "recommendation_flag"
          ? await db
              .select()
              .from(recommendationFlags)
              .where(eq(recommendationFlags.id, caseRecord.flagId))
              .then((res: any[]) => res[0])
          : await db
              .select()
              .from(profileContentFlags)
              .where(eq(profileContentFlags.id, caseRecord.flagId))
              .then((res: any[]) => res[0]);

      const resolution = await db
        .select()
        .from(moderationResolutions)
        .where(eq(moderationResolutions.caseId, caseId))
        .then((res: any[]) => res[0]);

      const reporter = await db
        .select()
        .from(users)
        .where(eq(users.id, caseRecord.reporterId))
        .then((res: any[]) => res[0]);

      return {
        case: caseRecord,
        flag,
        resolution,
        reporter: {
          id: reporter.id,
          firstName: reporter.firstName,
          lastName: reporter.lastName,
          reporterReputation: reporter.reporterReputationScore,
        },
      };
    },

    async getUserFlags(userId: string) {
      const userFlags = await db
        .select()
        .from(recommendationFlags)
        .where(eq(recommendationFlags.flaggedByUserId, userId));

      const result = await Promise.all(
        userFlags.map(async (flag: any) => {
          const caseRecord = await db
            .select()
            .from(moderationCases)
            .where(eq(moderationCases.id, flag.caseId!))
            .then((res: any[]) => res[0]);

          const resolution = await db
            .select()
            .from(moderationResolutions)
            .where(eq(moderationResolutions.caseId, caseRecord.id))
            .then((res: any[]) => res[0]);

          return {
            flag: {
              id: flag.id,
              reason: flag.reason,
              createdAt: flag.createdAt!,
            },
            case: {
              id: caseRecord.id,
              status: caseRecord.status,
              updatedAt: caseRecord.updatedAt!,
            },
            resolution: resolution && {
              outcome: resolution.outcome,
            },
          };
        }),
      );

      return result;
    },
  };
}
