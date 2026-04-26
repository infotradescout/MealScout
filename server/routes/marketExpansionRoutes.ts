import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import {
  autoPopulateDirectoryForActiveCities,
  createInitialOnboardingBatch,
  listMarketDirectory,
  listMarketExpansionLifecycle,
  listMarketExpansionQueue,
  listMarketExpansionUsage,
  runMarketExpansionScoreRecompute,
  runMarketExpansionStateTransition,
  summarizeFastFoodChainPresence,
  upsertMarketDirectoryEntry,
} from "../services/marketExpansionAutomation";

const upsertDirectorySchema = z.object({
  id: z.string().optional(),
  entityType: z.string().min(2),
  businessName: z.string().min(2),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  contactEmail: z.string().optional().nullable(),
  websiteUrl: z.string().url().optional().nullable(),
  serviceRadiusMiles: z.number().int().min(0).max(500).optional().nullable(),
  servesFoodTrucks: z.boolean().optional(),
  verificationStatus: z.string().optional().nullable(),
  qualityScore: z.number().int().min(0).max(100).optional().nullable(),
  source: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().max(5000).optional().nullable(),
});

const recomputeSchema = z.object({
  limitCities: z.number().int().min(1).max(1000).optional(),
  corridor: z.string().optional(),
});

const transitionSchema = z.object({
  limitCities: z.number().int().min(1).max(1000).optional(),
  maxActivations: z.number().int().min(1).max(25).optional(),
});

const initialBatchSchema = z.object({
  limitListings: z.number().int().min(1).max(500).optional(),
  limitCities: z.number().int().min(1).max(50).optional(),
  corridor: z.string().optional(),
  markContacted: z.boolean().optional(),
});

const directoryAutopopulateSchema = z.object({
  limitCities: z.number().int().min(1).max(40).optional(),
  limitPerCity: z.number().int().min(1).max(120).optional(),
  minQualityScore: z.number().int().min(0).max(100).optional(),
  includeCommissary: z.boolean().optional(),
  includeDelivery: z.boolean().optional(),
});

export function registerMarketExpansionRoutes(app: Express) {
  app.get(
    "/api/admin/market-expansion/queue",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const limit = Math.max(
          1,
          Math.min(500, Number.parseInt(String(req.query.limit || "100"), 10) || 100),
        );
        const rows = await listMarketExpansionQueue(limit);
        res.json({ rows, count: rows.length });
      } catch (error) {
        console.error("[market-expansion] queue failed:", error);
        res.status(500).json({ message: "Unable to load market expansion queue" });
      }
    },
  );

  app.post(
    "/api/admin/market-expansion/recompute",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const parsed = recomputeSchema.parse(_req.body || {});
        const result = await runMarketExpansionScoreRecompute(parsed);
        res.json(result);
      } catch (error) {
        if ((error as any)?.name === "ZodError") {
          return res.status(400).json({
            message: "Invalid recompute payload",
            issues: (error as any).issues,
          });
        }
        console.error("[market-expansion] recompute failed:", error);
        res.status(500).json({ message: "Unable to recompute market expansion scores" });
      }
    },
  );

  app.post(
    "/api/admin/market-expansion/advance",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const parsed = transitionSchema.parse(req.body || {});
        const result = await runMarketExpansionStateTransition(parsed);
        res.json(result);
      } catch (error) {
        if ((error as any)?.name === "ZodError") {
          return res.status(400).json({
            message: "Invalid transition payload",
            issues: (error as any).issues,
          });
        }
        console.error("[market-expansion] state transition failed:", error);
        res.status(500).json({ message: "Unable to run market state transition" });
      }
    },
  );

  app.get(
    "/api/admin/market-expansion/lifecycle",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const limit = Math.max(
          1,
          Math.min(500, Number.parseInt(String(req.query.limit || "200"), 10) || 200),
        );
        const rows = await listMarketExpansionLifecycle(limit);
        res.json({ rows, count: rows.length });
      } catch (error) {
        console.error("[market-expansion] lifecycle failed:", error);
        res.status(500).json({ message: "Unable to load lifecycle state" });
      }
    },
  );

  app.get(
    "/api/admin/market-expansion/usage",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const limit = Math.max(
          1,
          Math.min(500, Number.parseInt(String(req.query.limit || "120"), 10) || 120),
        );
        const payload = await listMarketExpansionUsage({
          jobName: String(req.query.jobName || ""),
          limit,
        });
        res.json(payload);
      } catch (error) {
        console.error("[market-expansion] usage failed:", error);
        res.status(500).json({ message: "Unable to load usage tracking" });
      }
    },
  );

  app.post(
    "/api/admin/market-expansion/onboarding/initial-batch",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const parsed = initialBatchSchema.parse(req.body || {});
        const payload = await createInitialOnboardingBatch(parsed);
        res.json(payload);
      } catch (error) {
        if ((error as any)?.name === "ZodError") {
          return res.status(400).json({
            message: "Invalid initial onboarding batch payload",
            issues: (error as any).issues,
          });
        }
        console.error("[market-expansion] initial onboarding batch failed:", error);
        res.status(500).json({ message: "Unable to build initial onboarding batch" });
      }
    },
  );

  app.post(
    "/api/admin/market-expansion/directory/autopopulate",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const parsed = directoryAutopopulateSchema.parse(req.body || {});
        const result = await autoPopulateDirectoryForActiveCities(parsed);
        res.json(result);
      } catch (error) {
        if ((error as any)?.name === "ZodError") {
          return res.status(400).json({
            message: "Invalid directory autopopulate payload",
            issues: (error as any).issues,
          });
        }
        console.error("[market-expansion] directory autopopulate failed:", error);
        res.status(500).json({ message: "Unable to auto-populate partner directory" });
      }
    },
  );

  app.get(
    "/api/admin/market-expansion/chains",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const limit = Math.max(
          1,
          Math.min(200, Number.parseInt(String(req.query.limit || "50"), 10) || 50),
        );
        const rows = await summarizeFastFoodChainPresence(limit);
        res.json({ rows, count: rows.length });
      } catch (error) {
        console.error("[market-expansion] chain summary failed:", error);
        res.status(500).json({ message: "Unable to load chain summary" });
      }
    },
  );

  app.get(
    "/api/admin/market-expansion/directory",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const rows = await listMarketDirectory({
          entityType: String(req.query.entityType || ""),
          state: String(req.query.state || ""),
          city: String(req.query.city || ""),
          limit: Number.parseInt(String(req.query.limit || "100"), 10) || 100,
        });
        res.json({ rows, count: rows.length });
      } catch (error) {
        console.error("[market-expansion] directory list failed:", error);
        res.status(500).json({ message: "Unable to load directory entries" });
      }
    },
  );

  app.post(
    "/api/admin/market-expansion/directory",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const parsed = upsertDirectorySchema.parse(req.body || {});
        const result = await upsertMarketDirectoryEntry(parsed);
        res.json({ success: true, ...result });
      } catch (error: any) {
        if (error?.name === "ZodError") {
          return res.status(400).json({
            message: "Invalid directory payload",
            issues: error.issues,
          });
        }
        console.error("[market-expansion] directory upsert failed:", error);
        res.status(500).json({ message: "Unable to save directory entry" });
      }
    },
  );
}
