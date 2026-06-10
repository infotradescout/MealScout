/**
 * PHASE 7: Share Link Routes
 *
 * Endpoints for generating shareable links with affiliate params
 */

import type { Express } from "express";
import { resolveCanonicalShareOrigin } from "./shareMiddleware";
import { db } from "./db";
import { affiliateShareEvents, users } from "@shared/schema";
import {
  isDefaultLookingAffiliateTag,
  isAffiliateTagValid,
} from "./affiliateTagService";
import {
  buildUniversalAttributedUrl,
  isEligibleInternalShareTarget,
  normalizeInternalShareTarget,
} from "./shareTargetPolicy";
import { eq } from "drizzle-orm";

async function requireShareAffiliateTag(
  req: any,
): Promise<{ affiliateUserId: string; affiliateTag: string } | null> {
  const authenticatedUserId = String(req.user?.id || "").trim();
  if (!authenticatedUserId) return null;

  const [user] = await db
    .select({ affiliateTag: users.affiliateTag })
    .from(users)
    .where(eq(users.id, authenticatedUserId))
    .limit(1);

  const affiliateTag = String(user?.affiliateTag || "").trim();
  if (
    !affiliateTag ||
    !isAffiliateTagValid(affiliateTag) ||
    isDefaultLookingAffiliateTag(affiliateTag)
  ) {
    return null;
  }

  return { affiliateUserId: authenticatedUserId, affiliateTag };
}

function inferShareResource(path: string): {
  resourceType: string;
  resourceId: string | null;
} {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  const resourceType = parts[0] || "page";
  const resourceId =
    parts.find((part) => /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(part)) || null;
  return { resourceType, resourceId };
}

export default function setupShareRoutes(app: Express) {
  /**
   * POST /api/share/generate
   * Generate a shareable link with affiliate param
   *
   * Body: { path: '/restaurants/123' | '/deals/456' | etc }
   * Returns: { shareLink, shortPath, copied: true }
   */
  app.post("/api/share/generate", async (req: any, res) => {
    try {
      const { path } = req.body;

      const sharePath = normalizeInternalShareTarget(path);

      if (!sharePath || !isEligibleInternalShareTarget(sharePath)) {
        return res.status(409).json({
          error: "share_target_required",
          message: "Set your share tag before sharing tracked links.",
        });
      }

      const baseUrl = resolveCanonicalShareOrigin(req);
      const affiliate = await requireShareAffiliateTag(req);
      if (!affiliate) {
        return res.status(409).json({
          error: "affiliate_tag_required",
          message: "Set your share tag before sharing tracked links.",
        });
      }

      const shareLink = buildUniversalAttributedUrl(
        baseUrl,
        affiliate.affiliateTag,
        sharePath,
      );

      const resource = inferShareResource(sharePath);
      await db.insert(affiliateShareEvents).values({
        affiliateUserId: affiliate.affiliateUserId,
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        destinationUrl: sharePath,
        shareMethod: "link",
      });

      res.json({
        shareLink,
        shortPath: sharePath,
        attributionPath: `/ref/${encodeURIComponent(affiliate.affiliateTag)}`,
        message: "Share link generated",
      });
    } catch (error: any) {
      console.error("[share routes] Error generating link:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/share/info
   * Get info about sharing capabilities
   *
   * Returns copy templates, platform info, etc
   */
  app.get("/api/share/info", async (req: any, res) => {
    try {
      res.json({
        shareChannels: [
          {
            name: "Email",
            icon: "mail",
            template: "Check out {name} on MealScout: {link}",
          },
          {
            name: "SMS",
            icon: "message",
            template: "MealScout: {link}",
          },
          {
            name: "Facebook",
            icon: "facebook",
            template: "Found something great on MealScout: {link}",
          },
          {
            name: "Twitter",
            icon: "twitter",
            template: "Check this out on @MealScout: {link}",
          },
          {
            name: "WhatsApp",
            icon: "message-circle",
            template: "Hey! Check this on MealScout: {link}",
          },
        ],
        message:
          "Share and earn! When restaurants you refer sign up, you get credits.",
        earnMessage:
          "Every share brings potential earnings. No limits, never expires.",
      });
    } catch (error: any) {
      console.error("[share routes] Error getting info:", error);
      res.status(500).json({ error: error.message });
    }
  });
}
