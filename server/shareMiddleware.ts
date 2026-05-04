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

import { ensureAffiliateTag } from "./affiliateTagService";

/**
 * Generate shareable URL with affiliate param
 * 
 * Can be used for:
 * - Restaurant pages: /restaurants/:id
 * - Deal pages: /deals/:id
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
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const normalizedBase = baseUrl.replace(/\/+$/, "");

  if (!affiliateTag) {
    return `${normalizedBase}${normalizedPath}`;
  }

  return `${normalizedBase}/ref/${encodeURIComponent(affiliateTag)}${normalizedPath}`;
}

/**
 * Express middleware to add shareUrl to res.locals
 * 
 * Makes generateShareableUrl available in all route handlers
 * Usage: res.locals.generateShareableUrl(path)
 */
export function shareUrlMiddleware(req: any, res: any, next: any) {
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  res.locals.generateShareableUrl = (path: string) => {
    const tag = req.user?.affiliateTag || req.user?.id;
    return generateShareableUrl(path, baseUrl, tag);
  };

  res.locals.appendAffiliateParam = (url: string) => {
    const tag = req.user?.affiliateTag || req.user?.id;
    if (!tag) return url;
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
  userId?: string,
): Promise<{
  shareLink: string;
  shortPath: string;
}> {
  const tag = userId ? await ensureAffiliateTag(userId) : undefined;
  const shareLink = generateShareableUrl(path, baseUrl, tag);

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
