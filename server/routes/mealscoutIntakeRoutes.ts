import type { Express } from "express";

export function registerMealScoutIntakeRoutes(app: Express) {
  app.get("/api/mealscout/intake/action-cards", (_req, res) => {
    res.type("application/json").status(200).json([]);
  });
}
