/**
 * PHASE 7: Share Anything = Affiliate Link Middleware
 *
 * Global middleware that appends ?ref=<userId> to any shared URL
 *
 * Catches:
 * - Share links
 * - Copy link
 * - Social share (SMS, email, etc)
 * - QR codes
 * - Restaurant profiles
 * - Deal pages
 * - Home page
 */

import { isDefaultLookingAffiliateTag } from "./affiliateTagService";
import {
  buildTrackedAttributedUrl,
  isEligibleInternalShareTarget,
  normalizeInternalShareTarget,
} from "./shareTargetPolicy";

function normalizeOrigin(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function isBackendRenderOrigin(origin: string): boolean {
  try {
    return new URL(origin).hostname.endsWith(".onrender.com");
  } catch {
    return false;
  }
}

function isLegacyShareOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === "meal-scout.vercel.app";
  } catch {
    return false;
  }
}

function isPublicShareOrigin(origin: string): boolean {
  return !isBackendRenderOrigin(origin) && !isLegacyShareOrigin(origin);
}

export function resolveCanonicalShareOrigin(req?: {
  protocol?: string;
  get?: (name: string) => string | undefined;
}): string {
  const configuredCandidates = [
    normalizeOrigin(process.env.PUBLIC_APP_URL),
    normalizeOrigin(process.env.CLIENT_ORIGIN),
    normalizeOrigin(process.env.APP_PUBLIC_URL),
    normalizeOrigin(process.env.PUBLIC_BASE_URL),
    normalizeOrigin(process.env.VITE_APP_URL),
  ].filter(Boolean) as string[];

  const configured = configuredCandidates.find(isPublicShareOrigin);
  if (configured) return configured;

  const requestOrigin = normalizeOrigin(req?.get?.("origin"));
  if (requestOrigin && isPublicShareOrigin(requestOrigin)) {
    return requestOrigin;
  }

  const host = String(req?.get?.("host") || "").trim();
  const protocol = String(req?.protocol || "https").trim() || "https";
  const hostOrigin = normalizeOrigin(`${protocol}://${host}`);
  if (hostOrigin && isPublicShareOrigin(hostOrigin)) return hostOrigin;
  return "https://www.mealscout.us";
}

/**
 * Generate shareable URL with affiliate param
 *
 * Can be used for:
 * - Restaurant pages: /restaurants/:id
 * - Deal pages: /deal/:id
 * - Searches: /search?q=pizza
 * - County pages: /counties/san_diego/ca
 * - Collection pages: /collections/best-of-town
 * - Any other page
 */
export function generateShareableUrl(
  path: string,
  baseUrl: string,
  affiliateTag?: string,
): string {
  const normalizedPath = normalizeInternalShareTarget(path);
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  if (!normalizedPath || !isEligibleInternalShareTarget(normalizedPath)) {
    throw new Error("Invalid share target");
  }

  if (!affiliateTag || isDefaultLookingAffiliateTag(affiliateTag)) {
    throw new Error("Affiliate tag required");
  }

  return buildTrackedAttributedUrl(
    normalizedBase,
    affiliateTag,
    normalizedPath,
  );
}

/**
 * Express middleware to add shareUrl to res.locals
 *
 * Makes generateShareableUrl available in all route handlers
 * Usage: res.locals.generateShareableUrl(path)
 */
export function shareUrlMiddleware(req: any, res: any, next: any) {
  const baseUrl = resolveCanonicalShareOrigin(req);

  res.locals.generateShareableUrl = (path: string) => {
    const tag = req.user?.affiliateTag;
    return generateShareableUrl(path, baseUrl, tag);
  };

  res.locals.appendAffiliateParam = (url: string) => {
    const tag = req.user?.affiliateTag;
    return generateShareableUrl(url, baseUrl, tag);
  };

  next();
}

/**
 * API endpoint to generate share links
 *
 * Called by frontend when user clicks share
 */
export async function generateShareLink(
  path: string,
  baseUrl: string,
  affiliateTag?: string,
): Promise<{
  shareLink: string;
  shortPath: string;
}> {
  const shareLink = generateShareableUrl(path, baseUrl, affiliateTag);

  return {
    shareLink,
    shortPath: path,
  };
}

export default {
  generateShareableUrl,
  shareUrlMiddleware,
  generateShareLink,
};
