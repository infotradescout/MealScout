/**
 * PHASE 7: Share Link Routes
 *
 * Endpoints for generating shareable links with affiliate params
 */

import type { Express } from "express";
import { resolveCanonicalShareOrigin } from "./shareMiddleware";
import { db } from "./db";
import { affiliateLinks, affiliateShareEvents, users } from "@shared/schema";
import {
  isDefaultLookingAffiliateTag,
  isAffiliateTagValid,
} from "./affiliateTagService";
import {
  buildUniversalAttributedUrl,
  isEligibleInternalShareTarget,
  normalizeInternalShareTarget,
} from "./shareTargetPolicy";
import { and, desc, eq } from "drizzle-orm";

const INTERNAL_CODE_LENGTH = 8;
const INTERNAL_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

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

function generateInternalAttributionCode(): string {
  let code = "";
  for (let index = 0; index < INTERNAL_CODE_LENGTH; index += 1) {
    code += INTERNAL_CODE_CHARS.charAt(
      Math.floor(Math.random() * INTERNAL_CODE_CHARS.length),
    );
  }
  return code;
}

async function getOrCreateInternalAttributionCode(params: {
  affiliateUserId: string;
  sharePath: string;
  baseUrl: string;
}): Promise<string | null> {
  const { affiliateUserId, sharePath, baseUrl } = params;

  const existingRows = await db
    .select({ code: affiliateLinks.code })
    .from(affiliateLinks)
    .where(
      and(
        eq(affiliateLinks.affiliateUserId, affiliateUserId),
        eq(affiliateLinks.resourceType, "page"),
        eq(affiliateLinks.sourceUrl, sharePath),
      ),
    )
    .orderBy(desc(affiliateLinks.createdAt))
    .limit(1);

  const existingCode = String(existingRows[0]?.code || "")
    .trim()
    .toLowerCase();
  if (existingCode) return existingCode;

  const sourceUrl = `${baseUrl.replace(/\/+$/, "")}${sharePath}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const generatedCode = generateInternalAttributionCode();
    const fullUrl = buildUniversalAttributedUrl(
      baseUrl,
      generatedCode,
      sharePath,
    );

    try {
      const insertedRows = await db
        .insert(affiliateLinks)
        .values({
          affiliateUserId,
          code: generatedCode,
          resourceType: "page",
          resourceId: null,
          sourceUrl: sharePath,
          fullUrl,
        })
        .returning({ code: affiliateLinks.code });
      const insertedCode = String(insertedRows[0]?.code || "")
        .trim()
        .toLowerCase();
      if (insertedCode) return insertedCode;
    } catch {
      // Retry on uniqueness collisions.
    }
  }

  return null;
}

async function resolveShareAttributionIdentity(params: {
  req: any;
  sharePath: string;
  baseUrl: string;
}): Promise<{
  affiliateUserId: string;
  attributionKey: string;
  attributionMode: "vanity_tag" | "internal_key";
} | null> {
  const { req, sharePath, baseUrl } = params;
  const authenticatedUserId = String(req.user?.id || "").trim();
  if (!authenticatedUserId) return null;

  const vanity = await requireShareAffiliateTag(req);
  if (vanity) {
    return {
      affiliateUserId: vanity.affiliateUserId,
      attributionKey: vanity.affiliateTag,
      attributionMode: "vanity_tag",
    };
  }

  const internalKey = await getOrCreateInternalAttributionCode({
    affiliateUserId: authenticatedUserId,
    sharePath,
    baseUrl,
  });
  if (!internalKey) return null;

  return {
    affiliateUserId: authenticatedUserId,
    attributionKey: internalKey,
    attributionMode: "internal_key",
  };
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
          message: "Tracked link target is not eligible.",
        });
      }

      const baseUrl = resolveCanonicalShareOrigin(req);
      const attribution = await resolveShareAttributionIdentity({
        req,
        sharePath,
        baseUrl,
      });
      if (!attribution) {
        const authenticatedUserId = String(req.user?.id || "").trim();
        return res.status(authenticatedUserId ? 409 : 401).json({
          error: authenticatedUserId
            ? "attribution_identity_required"
            : "authentication_required",
          message: authenticatedUserId
            ? "Unable to resolve share attribution identity."
            : "Sign in to generate tracked links.",
        });
      }

      const shareLink = buildUniversalAttributedUrl(
        baseUrl,
        attribution.attributionKey,
        sharePath,
      );

      const resource = inferShareResource(sharePath);
      await db.insert(affiliateShareEvents).values({
        affiliateUserId: attribution.affiliateUserId,
        resourceType: resource.resourceType,
        resourceId: resource.resourceId,
        destinationUrl: sharePath,
        shareMethod: "link",
      });

      res.json({
        shareLink,
        shortPath: sharePath,
        attributionPath: `/ref/${encodeURIComponent(attribution.attributionKey)}`,
        attributionMode: attribution.attributionMode,
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
