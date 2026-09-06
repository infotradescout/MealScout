/**
 * URL Sharing Utility
 * 
 * Automatically converts any shared link into an affiliate link
 * Works for: deals, restaurants, collections, search, pages, etc.
 * 
 * When a logged-in user shares content, they become the affiliate
 */

import affiliateService from './affiliateService';
import { resolveCanonicalShareOrigin } from "./shareMiddleware";

interface ShareContext {
  userId: string;
  resourceType: 'deal' | 'restaurant' | 'page' | 'collection' | 'search';
  resourceId?: string;
  platform?: 'email' | 'sms' | 'facebook' | 'twitter' | 'whatsapp' | 'copy';
}

/**
 * Convert any URL into an affiliate link if user is logged in
 * This happens transparently - no extra friction
 */
export async function generateShareableLink(
  targetPath: string,
  context: ShareContext,
): Promise<{ url: string; code: string }> {
  // If no user, return original URL
  if (!context.userId) {
    return { url: targetPath, code: '' };
  }

  const publicOrigin = resolveCanonicalShareOrigin();

  // Create or get affiliate link
  const affiliateLink = await affiliateService.createAffiliateLink(
    context.userId,
    context.resourceType,
    targetPath,
    context.resourceId,
    publicOrigin,
  );

  return {
    url: affiliateLink.fullUrl,
    code: affiliateLink.code,
  };
}

/**
 * Share templates with placeholders
 * Pre-composed copy for different platforms
 */
export const shareTemplates = {
  email: (restaurantName: string, affiliateUrl: string) => ({
    subject: `Check out ${restaurantName} — killer deals on MealScout`,
    body: `Hey! Found this amazing spot on MealScout:\n\n${restaurantName}\n\nHere's a link with the best deals:\n${affiliateUrl}\n\nLet me know what you think!`,
  }),

  sms: (restaurantName: string, shortUrl: string) =>
    `Check out ${restaurantName} on MealScout for deals — ${shortUrl}`,

  facebook: (restaurantName: string, affiliateUrl: string) => ({
    title: `Just discovered ${restaurantName} on MealScout`,
    description: 'Amazing local food spot with killer deals 🍔',
    url: affiliateUrl,
  }),

  twitter: (restaurantName: string, shortUrl: string) =>
    `Just found ${restaurantName} on @MealScout with incredible deals 🔥 Check it out: ${shortUrl}`,

  whatsapp: (restaurantName: string, shortUrl: string) =>
    `Hey! You gotta check out ${restaurantName} on MealScout. Here's the link: ${shortUrl}`,

  copy: (affiliateUrl: string) => ({
    text: affiliateUrl,
    copyMessage: 'Affiliate link copied!',
  }),
};

/**
 * Track outbound share event
 * Called when user actually completes the share action
 */
export function trackShare(
  userId: string,
  affiliateCode: string,
  platform: string,
  resourceType: string,
) {
  // This could be sent to analytics
  return {
    userId,
    affiliateCode,
    platform,
    resourceType,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build share dialog copy based on context
 */
export function getShareDialogCopy(resourceType: string) {
  const copy: Record<string, any> = {
    deal: {
      title: '💰 Share this deal',
      subtitle: 'Earn recurring commission every time someone signs up',
      cta: 'Share now',
    },
    restaurant: {
      title: '🍽️ Recommend this restaurant',
      subtitle: 'Get paid when they become an MealScout partner',
      cta: 'Share now',
    },
    page: {
      title: '📱 Share MealScout',
      subtitle: 'Your friends earn money too when they recommend',
      cta: 'Share now',
    },
    collection: {
      title: '⭐ Share this collection',
      subtitle: 'Earn affiliate commissions on all recommendations',
      cta: 'Share now',
    },
    search: {
      title: '🔍 Share search results',
      subtitle: 'Get paid for recommendations that convert',
      cta: 'Share now',
    },
  };

  return copy[resourceType] || copy.page;
}

/**
 * Format affiliate URL for different platforms
 * Some platforms need shortened URLs, some need tracking params
 */
export function formatUrlForPlatform(
  fullUrl: string,
  platform: string,
): string {
  // URL shortening could be integrated here if needed
  // For now, return full URL - modern platforms handle long URLs fine
  return fullUrl;
}

export default {
  generateShareableLink,
  shareTemplates,
  trackShare,
  getShareDialogCopy,
  formatUrlForPlatform,
};
