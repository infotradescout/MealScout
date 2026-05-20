import type { Express } from "express";

import { buildLocalRecommendations } from "../services/recommendationEngine";

function parseNumber(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "string"
      ? Number.parseFloat(value)
      : typeof value === "number"
        ? value
        : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function registerRecommendationRoutes(app: Express) {
  app.get("/api/recommendations/local", async (req: any, res) => {
    try {
      const lat = parseNumber(req.query.lat, NaN);
      const lng = parseNumber(req.query.lng, NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res
          .status(400)
          .json({ message: "lat and lng query params are required" });
      }

      const radiusKm = parseNumber(req.query.radiusKm, 16);
      const limit = parseNumber(req.query.limit, 24);
      const userId =
        req?.isAuthenticated?.() && req?.user?.id
          ? String(req.user.id)
          : null;

      const recommendations = await buildLocalRecommendations({
        lat,
        lng,
        radiusKm,
        limit,
        userId,
      });

      res.json({
        generatedAt: new Date().toISOString(),
        lat,
        lng,
        radiusKm,
        limit,
        count: recommendations.length,
        recommendations,
      });
    } catch (error) {
      console.error("Error building local recommendations:", error);
      res.status(500).json({ message: "Failed to build recommendations" });
    }
  });
}
