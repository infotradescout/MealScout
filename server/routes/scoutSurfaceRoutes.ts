import type { Express } from "express";

import { buildScoutSurface } from "../services/scoutSurfaceService";

const parseOptionalNumber = (value: unknown): number | undefined => {
  const parsed =
    typeof value === "string"
      ? Number.parseFloat(value)
      : typeof value === "number"
        ? value
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function registerScoutSurfaceRoutes(app: Express) {
  app.get("/api/scout/surface", async (req: any, res) => {
    try {
      const lat = parseOptionalNumber(req.query.lat);
      const lng = parseOptionalNumber(req.query.lng);
      const radiusMiles = parseOptionalNumber(req.query.radiusMiles) ?? 10;
      const limit = parseOptionalNumber(req.query.limit) ?? 40;

      if (
        (lat !== undefined && lng === undefined) ||
        (lat === undefined && lng !== undefined)
      ) {
        return res
          .status(400)
          .json({ message: "lat and lng must be provided together" });
      }

      const userId =
        req?.isAuthenticated?.() && req?.user?.id
          ? String(req.user.id)
          : null;

      const payload = await buildScoutSurface({
        lat,
        lng,
        radiusMiles,
        limit,
        userId,
      });

      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(payload);
    } catch (error) {
      console.error("Error building scout surface:", error);
      res.status(500).json({ message: "Failed to load scout surface" });
    }
  });
}
