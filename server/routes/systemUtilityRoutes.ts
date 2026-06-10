import type { Express } from "express";

import {
  isAffiliateTagValid,
  isDefaultLookingAffiliateTag,
  resolveAffiliateUserId,
} from "../affiliateTagService";
import { getMapEndpointWatchdogSnapshot } from "../mapEndpointWatchdog";
import { recordReferralClick } from "../referralService";
import {
  isEligibleInternalShareTarget,
  normalizeInternalShareTarget,
} from "../shareTargetPolicy";
import { storage } from "../storage";
import { isAdmin, isAuthenticated } from "../unifiedAuth";

type IncidentRoutesLike = {
  stack?: Array<{
    route?: {
      path?: string;
    };
    handle?: any;
  }>;
};

type SystemUtilityRouteDependencies = {
  incidentRoutes: IncidentRoutesLike;
};

const findIncidentHandler = (
  incidentRoutes: IncidentRoutesLike,
  path: string,
) =>
  incidentRoutes.stack?.find((layer) => layer.route?.path === path)?.handle ||
  ((_req: any, res: any) => res.status(404).json({ error: "Not found" }));

export function registerSystemUtilityRoutes(
  app: Express,
  { incidentRoutes }: SystemUtilityRouteDependencies,
) {
  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      service: "MealScout API",
    });
  });

  app.get(
    "/api/admin/oauth/status",
    isAuthenticated,
    isAdmin,
    async (_req: any, res) => {
      try {
        const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:5000";

        const status = {
          google: {
            configured: !!(
              process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
            ),
            clientIdPresent: !!process.env.GOOGLE_CLIENT_ID,
            clientSecretPresent: !!process.env.GOOGLE_CLIENT_SECRET,
            callbackUrls: {
              customer: `${baseUrl}/api/auth/google/customer/callback`,
              restaurant: `${baseUrl}/api/auth/google/restaurant/callback`,
            },
          },
          facebook: {
            configured: !!(
              process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET
            ),
            appIdPresent: !!process.env.FACEBOOK_APP_ID,
            appSecretPresent: !!process.env.FACEBOOK_APP_SECRET,
            callbackUrl: `${baseUrl}/api/auth/facebook/callback`,
          },
          requiredUrls: {
            privacyPolicy: `${baseUrl}/privacy-policy`,
            dataDeletion: `${baseUrl}/data-deletion`,
            termsOfService: `${baseUrl}/terms-of-service`,
          },
          baseUrl,
          environment: process.env.NODE_ENV || "development",
        };

        res.json(status);
      } catch (error) {
        console.error("Error checking OAuth status:", error);
        res.status(500).json({ error: "Failed to check OAuth status" });
      }
    },
  );

  app.get("/api/health", async (_req, res) => {
    try {
      await storage.getUser("health-check");
      const endpointWatchdog = getMapEndpointWatchdogSnapshot();
      const isHealthy = Boolean(endpointWatchdog?.ok ?? true);

      res.status(200).json({
        status: isHealthy ? "healthy" : "degraded",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development",
        version: "1.0.0",
        criticalEndpointWatchdog: endpointWatchdog,
      });
    } catch (error) {
      res.status(503).json({
        status: "unhealthy",
        error: "Database connection failed",
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.post(
    "/api/cron/escalations",
    findIncidentHandler(incidentRoutes, "/cron/escalations"),
  );

  app.get("/ref/:tag", async (req, res) => {
    const tag = String(req.params?.tag || "")
      .trim()
      .toLowerCase();
    const targetPath = normalizeInternalShareTarget(req.query?.to);

    if (
      !tag ||
      !isAffiliateTagValid(tag) ||
      isDefaultLookingAffiliateTag(tag)
    ) {
      return res.status(404).send("Referral link not found");
    }

    if (!targetPath || !isEligibleInternalShareTarget(targetPath)) {
      return res.status(400).send("Referral destination unavailable");
    }

    try {
      const affiliateUserId = await resolveAffiliateUserId(tag);
      if (!affiliateUserId) {
        return res.status(404).send("Referral link not found");
      }

      const result = await recordReferralClick(
        affiliateUserId,
        req.originalUrl ||
          `/ref/${encodeURIComponent(tag)}?to=${encodeURIComponent(targetPath)}`,
        req.get("user-agent") || undefined,
        req.ip || undefined,
      );

      res.cookie("referralId", tag, {
        maxAge: 1000 * 60 * 60 * 24 * 365,
        httpOnly: false,
        sameSite: "lax",
      });
      if (result?.referralId) {
        res.cookie("referralRecordId", result.referralId, {
          maxAge: 1000 * 60 * 60 * 24 * 365,
          httpOnly: true,
          sameSite: "lax",
        });
      }
    } catch (error) {
      console.error(
        "[affiliate] Failed to record universal referral click:",
        error,
      );
    }

    const redirectUrl = new URL(targetPath, "https://www.mealscout.us");
    redirectUrl.searchParams.set("ref", tag);
    res.redirect(
      `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`,
    );
  });

  app.post(
    "/api/cron/auto-close",
    findIncidentHandler(incidentRoutes, "/cron/auto-close"),
  );
}
