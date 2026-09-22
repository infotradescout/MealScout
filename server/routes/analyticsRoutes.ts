import type { Express } from "express";
import { pool } from "../db";
import { isAdmin } from "../unifiedAuth";
import { registerAnalyticsRoutes as registerEvidenceAnalyticsRoutes } from "./analyticsEvidenceRoutes";
import { registerAcquisitionQualityRoutes } from "./acquisitionQualityRoutes";

/** Preserve existing analytics writes; the new administrator report only reads retained evidence. */
export function registerAnalyticsRoutes(app: Express) {
  registerAcquisitionQualityRoutes(app, isAdmin, pool);
  registerEvidenceAnalyticsRoutes(app);
}
