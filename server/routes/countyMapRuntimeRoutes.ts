import { createHash, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import {
  mealScoutCountyMapRuntime,
  MealScoutCountyMapRuntimeError,
  type MealScoutCountyMapRuntime,
} from "../services/countyMapRuntime";

function configuredSyncToken(): string | null {
  const token = process.env.MEALSCOUT_COUNTY_MAP_SYNC_TOKEN;
  if (
    typeof token !== "string" ||
    token.length < 32 ||
    token.length > 512 ||
    /\s/.test(token)
  ) {
    return null;
  }
  return token;
}

function tokensMatch(expected: string, provided: string): boolean {
  const expectedHash = createHash("sha256").update(expected).digest();
  const providedHash = createHash("sha256").update(provided).digest();
  return timingSafeEqual(expectedHash, providedHash);
}

function authorize(
  req: Request,
  res: Response,
  runtime: MealScoutCountyMapRuntime
): boolean {
  const expected = configuredSyncToken();
  if (!expected || !runtime.isConfigured()) {
    res.status(503).json({ error: { code: "county_map_sync_unavailable" } });
    return false;
  }
  const provided = String(req.get("x-mealscout-county-sync-token") || "");
  if (!provided || !tokensMatch(expected, provided)) {
    res.status(401).json({ error: { code: "county_map_sync_unauthorized" } });
    return false;
  }
  return true;
}

function sendFailure(res: Response, error: unknown): Response {
  if (error instanceof MealScoutCountyMapRuntimeError) {
    return res.status(error.statusCode).json({ error: { code: error.code } });
  }
  return res.status(502).json({ error: { code: "county_map_upstream_failed" } });
}

export function registerMealScoutCountyMapRoutes(
  app: Express,
  runtime: MealScoutCountyMapRuntime = mealScoutCountyMapRuntime
): void {
  app.get(
    "/api/internal/county-map/context/:countyFips",
    async (req: Request, res: Response) => {
      if (!authorize(req, res, runtime)) return;
      try {
        const context = await runtime.readCountyContext(
          String(req.params.countyFips || "")
        );
        res.status(200).json({ context });
      } catch (error) {
        sendFailure(res, error);
      }
    }
  );

  app.post(
    "/api/internal/county-map/pickup-orders/:orderId/completion",
    async (req: Request, res: Response) => {
      if (!authorize(req, res, runtime)) return;
      try {
        const result = await runtime.publishCompletedPickup(
          String(req.params.orderId || ""),
          String(req.body?.countyFips || "")
        );
        res.status(200).json({ synced: true, result });
      } catch (error) {
        sendFailure(res, error);
      }
    }
  );
}
