import { Express, Request, Response } from "express";
import { z } from "zod";
import { isAuthenticated } from "./unifiedAuth";
import { createModerationService } from "./moderationService";
import { db } from "./db";
import { recommendationFlags } from "@shared/schema";
import { and, desc } from "drizzle-orm";
import { profileContentFlags, moderationCases, moderationResolutions } from "@shared/schema";
import { eq } from "drizzle-orm";

const flagRecommendationSchema = z.object({
  recommendationId: z.string().min(1),
  reason: z.enum([
    "spam",
    "inappropriate",
    "misleading",
    "fake",
    "off_topic",
    "abuse",
  ]),
  description: z.string().optional(),
  evidenceUrls: z.array(z.string().url()).optional(),
});

const flagProfileContentSchema = z.object({
  restaurantId: z.string().min(1),
  contentType: z.enum([
    "profile_description",
    "hours",
    "location",
    "contact",
    "images",
    "other",
  ]),
  reason: z.enum([
    "false_info",
    "inappropriate",
    "misleading",
    "policy_violation",
    "spam",
    "abuse",
  ]),
  description: z.string().optional(),
  evidenceUrls: z.array(z.string().url()).optional(),
});

const resolveCaseSchema = z.object({
  outcome: z.enum(["valid", "invalid", "partial"]),
  reasonCode: z.enum([
    "genuine_violation",
    "reporter_error",
    "context_missing",
    "borderline",
    "insufficient_evidence",
  ]),
  moderatorNotes: z.string().optional(),
  actionTaken: z.string().optional(),
});

const appealDecisionSchema = z.object({
  appealReason: z.string().min(10),
});

export function registerModerationRoutes(app: Express) {
  const moderationService = createModerationService(db);

  // ============================================================================
  // USER ENDPOINTS
  // ============================================================================

  // File a recommendation flag
  app.post(
    "/api/recommendations/:recommendationId/flag",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { recommendationId } = req.params;
        const payload = flagRecommendationSchema.parse(req.body);
        const userId = (req as any).userId;
  const userId = (req as any).user.id;
  const userId = (req as any).user.id;

        // Check for duplicate recent flags from same user
        const recentFlag = await db.query
          .recommendationFlags()
          .where((t, { eq, and }) =>
            and(
              eq(t.recommendationId, recommendationId),
              eq(t.flaggedByUserId, userId),
            ),
          )
          .orderBy((t) => t.flaggedAt)
          .limit(1)
          .execute();
          // Check for duplicate recent flags from same user
          const recentFlags = await db
            .select()
            .from(recommendationFlags)
            .where(
              and(
                eq(recommendationFlags.recommendationId, recommendationId),
                eq(recommendationFlags.flaggedByUserId, userId),
              ),
            )
            .orderBy(desc(recommendationFlags.flaggedAt))
            .limit(1);

          const recentFlag = recentFlags[0];

        if (
          recentFlag &&
          new Date().getTime() - recentFlag[0]?.flaggedAt?.getTime() <
            24 * 60 * 60 * 1000
        ) {
          return res
            .status(429)
            .json({
              error: "You already flagged this recommendation in the last 24 hours",
            });
        }

        const result = await moderationService.flagRecommendation(
          recommendationId,
          userId,
          payload.reason,
          payload.description,
          payload.evidenceUrls,
        );

        res.status(201).json({
          flagId: result.flagId,
          caseId: result.caseId,
          message: "Recommendation flagged for review",
        });
      } catch (error: any) {
        res
          .status(error.status || 400)
          .json({
            error: error.message,
          });
      }
    },
  );

  // Flag profile content
  app.post(
    "/api/restaurants/:restaurantId/flag-content",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { restaurantId } = req.params;
        const payload = flagProfileContentSchema.parse(req.body);
        const userId = (req as any).userId;

        const result = await moderationService.flagProfileContent(
          restaurantId,
          userId,
          payload.contentType,
          payload.reason,
          payload.description,
          payload.evidenceUrls,
        );

        res.status(201).json({
          flagId: result.flagId,
          caseId: result.caseId,
          message: "Profile content flagged for review",
        });
      } catch (error: any) {
        res
          .status(error.status || 400)
          .json({
            error: error.message,
          });
      }
    },
  );

  // Get user's flags and their status
  app.get(
    "/api/user/flags",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const flags = await moderationService.getUserFlags(userId);
        res.json(flags);
      } catch (error: any) {
        res
          .status(500)
          .json({
            error: error.message,
          });
      }
    },
  );

  // Get reporter reputation
  app.get(
    "/api/user/reporter-reputation",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = (req as any).userId;
        const reputation = await moderationService.getReporterReputation(
          userId,
        );
        res.json(reputation);
      } catch (error: any) {
        res
          .status(500)
          .json({
            error: error.message,
          });
      }
    },
  );

  // Appeal a resolution
  app.post(
    "/api/moderation/:resolutionId/appeal",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { resolutionId } = req.params;
        const payload = appealDecisionSchema.parse(req.body);
        const userId = (req as any).userId;

        const appealId = await moderationService.appealDecision(
          resolutionId,
          userId,
          payload.appealReason,
        );

        res.status(201).json({
          appealId,
          message: "Appeal submitted for review",
        });
      } catch (error: any) {
        res
          .status(error.status || 400)
          .json({
            error: error.message,
          });
      }
    },
  );

  // ============================================================================
  // ADMIN ENDPOINTS
  // ============================================================================

  // Get moderation queue
  app.get(
    "/api/admin/moderation/queue",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        // Check admin/moderator permissions
        const user = (req as any).user;
        if (
          user?.userType !== "admin" &&
          user?.userType !== "super_admin" &&
          user?.userType !== "moderator"
        ) {
          return res.status(403).json({ error: "Unauthorized" });
        }

        const { status, priority } = req.query;
        const queue = await moderationService.getModerationQueue(
          status as string,
          priority as string,
        );
        res.json(queue);
      } catch (error: any) {
        res
          .status(500)
          .json({
            error: error.message,
          });
      }
    },
  );

  // Get case details
  app.get(
    "/api/admin/moderation/:caseId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        // Check admin/moderator permissions
        const user = (req as any).user;
        if (
          user?.userType !== "admin" &&
          user?.userType !== "super_admin" &&
          user?.userType !== "moderator"
        ) {
          return res.status(403).json({ error: "Unauthorized" });
        }

        const { caseId } = req.params;
        const caseDetails = await moderationService.getCaseDetails(caseId);

        if (!caseDetails) {
          return res.status(404).json({ error: "Case not found" });
        }

        res.json(caseDetails);
      } catch (error: any) {
        res
          .status(500)
          .json({
            error: error.message,
          });
      }
    },
  );

  // Assign case to moderator
  app.post(
    "/api/admin/moderation/:caseId/assign",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        // Check admin/super_admin permissions only
        const user = (req as any).user;
        if (user?.userType !== "admin" && user?.userType !== "super_admin") {
          return res.status(403).json({ error: "Unauthorized" });
        }

        const { caseId } = req.params;
        const { moderatorId } = req.body;

        if (!moderatorId) {
          return res.status(400).json({ error: "Moderator ID required" });
        }

        await moderationService.assignCase(caseId, moderatorId);
        res.json({ message: "Case assigned to moderator" });
      } catch (error: any) {
        res
          .status(500)
          .json({
            error: error.message,
          });
      }
    },
  );

  // Resolve case
  app.post(
    "/api/admin/moderation/:caseId/resolve",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        // Check admin/moderator permissions
        const user = (req as any).user;
        if (
          user?.userType !== "admin" &&
          user?.userType !== "super_admin" &&
          user?.userType !== "moderator"
        ) {
          return res.status(403).json({ error: "Unauthorized" });
        }

        const { caseId } = req.params;
        const payload = resolveCaseSchema.parse(req.body);
        const moderatorId = (req as any).userId || (req as any).user?.id;
  const moderatorId = (req as any).user.id;

        await moderationService.resolveCase(
          caseId,
          moderatorId,
          payload.outcome,
          payload.reasonCode,
          payload.moderatorNotes,
          payload.actionTaken,
        );

        res.json({ message: "Case resolved" });
      } catch (error: any) {
        res
          .status(error.status || 400)
          .json({
            error: error.message,
          });
      }
    },
  );
}
