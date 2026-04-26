import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import {
  listMarketDirectory,
  listMarketExpansionQueue,
  runMarketExpansionScoreRecompute,
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
        const result = await runMarketExpansionScoreRecompute();
        res.json(result);
      } catch (error) {
        console.error("[market-expansion] recompute failed:", error);
        res.status(500).json({ message: "Unable to recompute market expansion scores" });
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
