import type { Express } from "express";
import { z } from "zod";

import {
  getMealScoutCreditActionCatalog,
  getMealScoutCreditEvents,
  getMealScoutCreditFormula,
  getMealScoutCreditUserSummaries,
  getMealScoutCreditUserSummary,
  recordMealScoutCreditAction,
} from "../mealScoutCreditsService";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";

const manualAwardSchema = z.object({
  userId: z.string().trim().min(1),
  action: z.string().trim().min(1),
  sourceId: z.string().trim().min(1),
  entityType: z.string().trim().max(80).optional().nullable(),
  entityId: z.string().trim().max(120).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export function registerMealScoutCreditsRoutes(app: Express) {
  app.get(
    "/api/admin/mealscout-credits/rules",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req, res) => {
      res.json({
        formula: getMealScoutCreditFormula(),
        rules: getMealScoutCreditActionCatalog(),
      });
    },
  );

  app.get(
    "/api/admin/mealscout-credits/users",
    isAuthenticated,
    isStaffOrAdmin,
    async (req, res) => {
      const users = await getMealScoutCreditUserSummaries({
        search: typeof req.query.q === "string" ? req.query.q : undefined,
        limit: Number(req.query.limit || 100),
        offset: Number(req.query.offset || 0),
      });
      res.json({
        formula: getMealScoutCreditFormula(),
        users,
      });
    },
  );

  app.get(
    "/api/admin/mealscout-credits/users/:userId",
    isAuthenticated,
    isStaffOrAdmin,
    async (req, res) => {
      const result = await getMealScoutCreditUserSummary(req.params.userId);
      if (!result.summary) {
        return res.status(404).json({ message: "User credit summary not found" });
      }
      res.json(result);
    },
  );

  app.get(
    "/api/admin/mealscout-credits/events",
    isAuthenticated,
    isStaffOrAdmin,
    async (req, res) => {
      const events = await getMealScoutCreditEvents({
        userId: typeof req.query.userId === "string" ? req.query.userId : undefined,
        action: typeof req.query.action === "string" ? req.query.action : undefined,
        limit: Number(req.query.limit || 100),
      });
      res.json({ events });
    },
  );

  app.post(
    "/api/admin/mealscout-credits/award",
    isAuthenticated,
    isStaffOrAdmin,
    async (req, res) => {
      const parsed = manualAwardSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          message: "Credit award needs a user, action, and source id.",
          errors: parsed.error.flatten(),
        });
      }

      try {
        const result = await recordMealScoutCreditAction(parsed.data as any);
        res.status(result.credited ? 201 : 200).json(result);
      } catch (error: any) {
        res.status(400).json({
          message: error?.message || "Failed to award MealScout Credits",
        });
      }
    },
  );
}
