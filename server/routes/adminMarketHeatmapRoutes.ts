import type { Express, RequestHandler } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import {
  marketCounties,
  marketEntities,
  marketMetrics,
  marketNotes,
} from "@shared/schema";
import {
  getStoredMarketMetrics,
  refreshMarketMetrics,
  type MarketHeatmapTimeframe,
} from "../services/adminMarketMetrics";

const timeframes = ["7d", "30d", "90d"] as const;
const noteCategories = [
  "restaurant",
  "delivery",
  "vendor",
  "operations",
  "risk",
  "growth",
  "general",
] as const;
const entityTypes = [
  "restaurant_partner",
  "delivery_partner",
  "vendor",
  "market_manager",
  "affiliate",
  "local_operator",
] as const;

const timeframeSchema = z.enum(timeframes).default("30d");
const noteSchema = z.object({
  countyName: z.string().trim().optional(),
  stateCode: z.string().trim().optional(),
  category: z.enum(noteCategories).default("general"),
  content: z.string().trim().min(1).max(5000),
});
const entitySchema = z.object({
  countyName: z.string().trim().optional(),
  stateCode: z.string().trim().optional(),
  entityType: z.enum(entityTypes),
  entityId: z.string().trim().optional().nullable(),
  label: z.string().trim().min(1).max(200),
  status: z.string().trim().min(1).max(80).default("active"),
  metadata: z.record(z.any()).optional().default({}),
});

const heatmapEnabled: RequestHandler = (_req, res, next) => {
  if (
    String(process.env.ADMIN_COUNTY_HEATMAP_ENABLED || "true").toLowerCase() ===
    "false"
  ) {
    return res.status(404).json({ message: "Admin heatmap is disabled" });
  }
  next();
};

const requireSuperAdminEquivalent: RequestHandler = (req: any, res, next) => {
  const userType = String(req.user?.userType || "");
  if (["duper_admin", "super_admin"].includes(userType)) return next();
  return res.status(403).json({ message: "Super admin access required" });
};

async function ensureCounty(
  countyFips: string,
  countyName?: string | null,
  stateCode?: string | null,
) {
  const fips = String(countyFips || "").trim();
  if (!fips) throw new Error("County FIPS is required");

  await db
    .insert(marketCounties)
    .values({
      countyFips: fips,
      countyName: String(countyName || fips).trim(),
      stateCode: String(stateCode || "US").trim().toUpperCase().slice(0, 2),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: marketCounties.countyFips,
      set: {
        countyName: String(countyName || fips).trim(),
        stateCode: String(stateCode || "US").trim().toUpperCase().slice(0, 2),
        updatedAt: new Date(),
      },
    });
}

export function registerAdminMarketHeatmapRoutes(app: Express) {
  app.get(
    "/api/admin/heatmap",
    isAuthenticated,
    isStaffOrAdmin,
    heatmapEnabled,
    requireSuperAdminEquivalent,
    async (req, res) => {
      try {
        const timeframe = timeframeSchema.parse(req.query.timeframe);
        const counties = await getStoredMarketMetrics(timeframe);
        res.json({ timeframe, counties });
      } catch (error) {
        console.error("Admin heatmap load failed:", error);
        res.status(500).json({ message: "Failed to load heatmap" });
      }
    },
  );

  app.get(
    "/api/admin/heatmap/users-by-county",
    isAuthenticated,
    isStaffOrAdmin,
    heatmapEnabled,
    requireSuperAdminEquivalent,
    async (req, res) => {
      try {
        const timeframe = timeframeSchema.parse(req.query.timeframe);
        const metric = String(req.query.metric || "users_total");
        const rows = await db
          .select({
            county: marketCounties,
            metric: marketMetrics,
          })
          .from(marketMetrics)
          .innerJoin(
            marketCounties,
            eq(marketMetrics.countyFips, marketCounties.countyFips),
          )
          .where(
            and(
              eq(marketMetrics.timeframe, timeframe),
              eq(marketMetrics.metricKey, metric),
            ),
          )
          .orderBy(desc(marketMetrics.metricValue));

        res.json({
          timeframe,
          metric,
          counties: rows.map((row: any) => ({
            ...row.county,
            metricValue: row.metric.metricValue,
            updatedAt: row.metric.updatedAt,
          })),
        });
      } catch (error) {
        console.error("Admin users-by-county load failed:", error);
        res.status(500).json({ message: "Failed to load county activity" });
      }
    },
  );

  app.post(
    "/api/admin/geo/metrics/refresh",
    isAuthenticated,
    isStaffOrAdmin,
    heatmapEnabled,
    requireSuperAdminEquivalent,
    async (req, res) => {
      try {
        const requested = req.body?.timeframe
          ? [timeframeSchema.parse(req.body.timeframe)]
          : timeframes;
        const results = [];
        for (const timeframe of requested) {
          results.push(await refreshMarketMetrics(timeframe));
        }
        res.json({ refreshed: results });
      } catch (error) {
        console.error("Admin market metric refresh failed:", error);
        res.status(500).json({ message: "Failed to refresh market metrics" });
      }
    },
  );

  app.get(
    "/api/admin/geo/coverage",
    isAuthenticated,
    isStaffOrAdmin,
    heatmapEnabled,
    requireSuperAdminEquivalent,
    async (req, res) => {
      try {
        const timeframe = timeframeSchema.parse(req.query.timeframe);
        const counties = await getStoredMarketMetrics(timeframe);
        res.json({
          timeframe,
          counties: counties.map((county) => ({
            countyFips: county.countyFips,
            countyName: county.countyName,
            stateCode: county.stateCode,
            coverageStatus:
              county.metrics.market_coverage_status >= 2
                ? "ready"
                : county.metrics.market_coverage_status >= 1
                  ? "partial"
                  : "empty",
            metrics: county.metrics,
          })),
        });
      } catch (error) {
        console.error("Admin coverage load failed:", error);
        res.status(500).json({ message: "Failed to load coverage" });
      }
    },
  );

  app.get(
    "/api/admin/geo/counties/:fips/notes",
    isAuthenticated,
    isStaffOrAdmin,
    heatmapEnabled,
    async (req, res) => {
      try {
        const notes = await db
          .select()
          .from(marketNotes)
          .where(eq(marketNotes.countyFips, req.params.fips))
          .orderBy(desc(marketNotes.createdAt));
        res.json(notes);
      } catch (error) {
        console.error("Admin notes load failed:", error);
        res.status(500).json({ message: "Failed to load notes" });
      }
    },
  );

  app.post(
    "/api/admin/geo/counties/:fips/notes",
    isAuthenticated,
    isStaffOrAdmin,
    heatmapEnabled,
    async (req: any, res) => {
      try {
        const payload = noteSchema.parse(req.body);
        await ensureCounty(req.params.fips, payload.countyName, payload.stateCode);
        const [note] = await db
          .insert(marketNotes)
          .values({
            countyFips: req.params.fips,
            authorUserId: req.user.id,
            category: payload.category,
            content: payload.content,
            updatedAt: new Date(),
          })
          .returning();
        res.status(201).json(note);
      } catch (error: any) {
        console.error("Admin note create failed:", error);
        res.status(error?.name === "ZodError" ? 400 : 500).json({
          message: error?.name === "ZodError" ? "Check note fields" : "Failed to add note",
        });
      }
    },
  );

  app.patch(
    "/api/admin/geo/notes/:noteId",
    isAuthenticated,
    isStaffOrAdmin,
    heatmapEnabled,
    async (req, res) => {
      try {
        const payload = noteSchema.partial().parse(req.body);
        const [note] = await db
          .update(marketNotes)
          .set({ ...payload, updatedAt: new Date() })
          .where(eq(marketNotes.id, req.params.noteId))
          .returning();
        if (!note) return res.status(404).json({ message: "Note not found" });
        res.json(note);
      } catch (error: any) {
        console.error("Admin note update failed:", error);
        res.status(error?.name === "ZodError" ? 400 : 500).json({
          message:
            error?.name === "ZodError" ? "Check note fields" : "Failed to update note",
        });
      }
    },
  );

  app.delete(
    "/api/admin/geo/notes/:noteId",
    isAuthenticated,
    isStaffOrAdmin,
    heatmapEnabled,
    async (req, res) => {
      try {
        await db.delete(marketNotes).where(eq(marketNotes.id, req.params.noteId));
        res.json({ ok: true });
      } catch (error) {
        console.error("Admin note delete failed:", error);
        res.status(500).json({ message: "Failed to delete note" });
      }
    },
  );

  app.get(
    "/api/admin/geo/counties/:fips/entities",
    isAuthenticated,
    isStaffOrAdmin,
    heatmapEnabled,
    async (req, res) => {
      try {
        const entities = await db
          .select()
          .from(marketEntities)
          .where(eq(marketEntities.countyFips, req.params.fips))
          .orderBy(desc(marketEntities.createdAt));
        res.json(entities);
      } catch (error) {
        console.error("Admin entities load failed:", error);
        res.status(500).json({ message: "Failed to load entities" });
      }
    },
  );

  app.post(
    "/api/admin/geo/counties/:fips/entities",
    isAuthenticated,
    isStaffOrAdmin,
    heatmapEnabled,
    async (req, res) => {
      try {
        const payload = entitySchema.parse(req.body);
        await ensureCounty(req.params.fips, payload.countyName, payload.stateCode);
        const [entity] = await db
          .insert(marketEntities)
          .values({
            countyFips: req.params.fips,
            entityType: payload.entityType,
            entityId: payload.entityId || null,
            label: payload.label,
            status: payload.status,
            metadata: payload.metadata,
            updatedAt: new Date(),
          })
          .returning();
        res.status(201).json(entity);
      } catch (error: any) {
        console.error("Admin entity create failed:", error);
        res.status(error?.name === "ZodError" ? 400 : 500).json({
          message:
            error?.name === "ZodError"
              ? "Check assignment fields"
              : "Failed to add entity",
        });
      }
    },
  );

  app.patch(
    "/api/admin/geo/entities/:entityId",
    isAuthenticated,
    isStaffOrAdmin,
    heatmapEnabled,
    async (req, res) => {
      try {
        const payload = entitySchema.partial().parse(req.body);
        const [entity] = await db
          .update(marketEntities)
          .set({ ...payload, updatedAt: new Date() })
          .where(eq(marketEntities.id, req.params.entityId))
          .returning();
        if (!entity) return res.status(404).json({ message: "Entity not found" });
        res.json(entity);
      } catch (error: any) {
        console.error("Admin entity update failed:", error);
        res.status(error?.name === "ZodError" ? 400 : 500).json({
          message:
            error?.name === "ZodError"
              ? "Check assignment fields"
              : "Failed to update entity",
        });
      }
    },
  );

  app.delete(
    "/api/admin/geo/entities/:entityId",
    isAuthenticated,
    isStaffOrAdmin,
    heatmapEnabled,
    async (req, res) => {
      try {
        await db
          .delete(marketEntities)
          .where(eq(marketEntities.id, req.params.entityId));
        res.json({ ok: true });
      } catch (error) {
        console.error("Admin entity delete failed:", error);
        res.status(500).json({ message: "Failed to delete entity" });
      }
    },
  );
}
