import type { Express } from "express";
import { eq } from "drizzle-orm";

import { db } from "../db";
import { getMapEndpointWatchdogSnapshot } from "../mapEndpointWatchdog";
import { storage } from "../storage";
import { isAdmin, isAuthenticated } from "../unifiedAuth";
import { hosts, restaurants, users } from "@shared/schema";

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

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractCleanProfileEntity(path: string):
  | { entityType: "restaurant"; id: string }
  | { entityType: "host"; id: string }
  | null {
  const segments = String(path || "")
    .split("?")[0]
    .split("/")
    .filter(Boolean);
  if (segments.length < 2) return null;

  const [kind, first, second] = segments;
  if ((kind === "truck" || kind === "bar") && first) {
    const marker = first.lastIndexOf("--");
    const id = marker >= 0 ? first.slice(marker + 2) : "";
    return uuidPattern.test(id) ? { entityType: "restaurant", id } : null;
  }
  if (kind === "restaurant" && first && uuidPattern.test(first)) {
    return { entityType: "restaurant", id: first };
  }
  if (kind === "menu" && first && uuidPattern.test(first)) {
    return { entityType: "restaurant", id: first };
  }
  if (kind === "location" && first) {
    const marker = first.lastIndexOf("--");
    const id = marker >= 0 ? first.slice(marker + 2) : second || "";
    return uuidPattern.test(id) ? { entityType: "host", id } : null;
  }
  return null;
}

export function registerSystemUtilityRoutes(
  app: Express,
  { incidentRoutes }: SystemUtilityRouteDependencies,
) {
  app.use(async (req: any, res, next) => {
    if (req.method !== "GET") return next();
    if (req.cookies?.referralTag || req.cookies?.referralId) return next();

    const entity = extractCleanProfileEntity(req.path || "");
    if (!entity) return next();

    try {
      const ownerRows =
        entity.entityType === "host"
          ? await db
              .select({
                ownerId: users.id,
                affiliateTag: users.affiliateTag,
              })
              .from(hosts)
              .innerJoin(users, eq(hosts.userId, users.id))
              .where(eq(hosts.id, entity.id))
              .limit(1)
          : await db
              .select({
                ownerId: users.id,
                affiliateTag: users.affiliateTag,
              })
              .from(restaurants)
              .innerJoin(users, eq(restaurants.ownerId, users.id))
              .where(eq(restaurants.id, entity.id))
              .limit(1);
      const owner = ownerRows[0];
      const tag = String(owner?.affiliateTag || "").trim();
      if (owner?.ownerId && tag) {
        const { recordReferralClick } = await import("../referralService");
        const result = await recordReferralClick(
          owner.ownerId,
          req.originalUrl || req.path || "/",
          req.get("user-agent") || undefined,
          req.ip || undefined,
        );
        res.cookie("referralId", tag, {
          maxAge: 1000 * 60 * 60 * 24 * 365,
          httpOnly: false,
          sameSite: "lax",
        });
        res.cookie("referralTag", tag, {
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
      }
    } catch (error) {
      console.error("[affiliate] Failed to process clean profile attribution:", error);
    }

    next();
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      service: "MealScout API",
    });
  });

  // Public config endpoint — exposes non-secret config to the frontend
  // (Facebook App ID is public by design — it's embedded in the JS SDK)
  app.get("/api/config/public", (_req, res) => {
    res.json({
      facebookAppId: process.env.FACEBOOK_APP_ID || "",
      googleMapsConfigured: !!process.env.GOOGLE_MAPS_API_KEY,
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

  app.get("/ref/:tag", (req, res) => {
    const tag = req.params?.tag || "";
    const safeTag = encodeURIComponent(tag);
    res.redirect(`/?ref=${safeTag}`);
  });

  app.get("/ref/:tag/*", async (req: any, res) => {
    const tag = String(req.params?.tag || "").trim();
    const rest = String(req.params?.[0] || "").replace(/^\/+/, "");
    const targetPath = `/${rest || ""}`;
    if (!tag) return res.redirect(targetPath || "/");

    try {
      const { resolveAffiliateUserId } = await import("../affiliateTagService");
      const { recordReferralClick } = await import("../referralService");
      const affiliateUserId = await resolveAffiliateUserId(tag);
      let referralRecordId: string | null = null;

      if (affiliateUserId) {
        const result = await recordReferralClick(
          affiliateUserId,
          targetPath || "/",
          req.get("user-agent") || undefined,
          req.ip || undefined,
        );
        referralRecordId = result?.referralId || null;
      }

      res.cookie("referralId", tag, {
        maxAge: 1000 * 60 * 60 * 24 * 365,
        httpOnly: false,
        sameSite: "lax",
      });
      res.cookie("referralTag", tag, {
        maxAge: 1000 * 60 * 60 * 24 * 365,
        httpOnly: false,
        sameSite: "lax",
      });
      if (referralRecordId) {
        res.cookie("referralRecordId", referralRecordId, {
          maxAge: 1000 * 60 * 60 * 24 * 365,
          httpOnly: true,
          sameSite: "lax",
        });
      }
    } catch (error) {
      console.error("[affiliate] Failed to process clean referral path:", error);
    }

    res.redirect(targetPath || "/");
  });

  app.post(
    "/api/cron/auto-close",
    findIncidentHandler(incidentRoutes, "/cron/auto-close"),
  );
}
