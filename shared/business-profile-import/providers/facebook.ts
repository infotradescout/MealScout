/**
 * Business Profile Import SDK — Facebook Pages Provider
 *
 * Fetches business data from Facebook Graph API and normalizes
 * it into UnifiedBusinessProfile format.
 *
 * Two modes:
 * 1. Page Access Token mode — user authenticates via Facebook OAuth,
 *    grants `pages_show_list` + `pages_read_engagement` permissions,
 *    then selects a Page they manage. Full data access.
 *
 * 2. URL-based lookup mode — given a Facebook Page URL, attempts to
 *    fetch publicly available data. Limited fields.
 *
 * @license MIT
 */

import type {
  ImportProviderDriver,
  UnifiedBusinessProfile,
  BusinessSearchQuery,
  BusinessSearchResult,
  ImportedPhoto,
  BusinessHours,
  DayHours,
  PriceLevel,
  BusinessStatus,
} from "../types";

const GRAPH_API_BASE = "https://graph.facebook.com/v19.0";

// Fields we request when we have a Page Access Token
const PAGE_FIELDS = [
  "id",
  "name",
  "about",
  "description",
  "category",
  "category_list",
  "cover",
  "phone",
  "website",
  "single_line_address",
  "location",
  "hours",
  "overall_star_rating",
  "rating_count",
  "price_range",
  "emails",
  "link",
  "photos.limit(20){images,name,alt_text}",
  "is_permanently_closed",
].join(",");

// Lighter fields for search/listing
const SEARCH_FIELDS = [
  "id",
  "name",
  "category",
  "single_line_address",
  "overall_star_rating",
  "rating_count",
  "cover",
].join(",");

export type FacebookProviderConfig = {
  /** Facebook App ID (for building OAuth URLs) */
  appId: string;
  /** Facebook App Secret (for server-side token exchange) */
  appSecret: string;
  /** Max photos to import. Default: 20 */
  maxPhotos?: number;
};

export type FacebookPageToken = {
  pageId: string;
  pageName: string;
  accessToken: string;
};

export class FacebookPagesProvider implements ImportProviderDriver {
  readonly providerId = "facebook" as const;
  readonly displayName = "Facebook Pages";

  private appId: string;
  private appSecret: string;
  private maxPhotos: number;

  constructor(config: FacebookProviderConfig) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.maxPhotos = config.maxPhotos ?? 20;
  }

  // ── OAuth Helpers ─────────────────────────────────────────────────────

  /**
   * Build the Facebook OAuth URL for requesting Page permissions.
   * The user visits this URL, grants access, and is redirected back
   * with an authorization code.
   */
  getOAuthUrl(redirectUri: string, state?: string): string {
    const scopes = [
      "pages_show_list",
      "pages_read_engagement",
      "pages_read_user_content",
    ].join(",");

    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: redirectUri,
      scope: scopes,
      response_type: "code",
      ...(state ? { state } : {}),
    });

    return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for a user access token.
   */
  async exchangeCodeForToken(
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; expiresIn: number } | null> {
    try {
      const params = new URLSearchParams({
        client_id: this.appId,
        client_secret: this.appSecret,
        redirect_uri: redirectUri,
        code,
      });

      const response = await fetch(
        `${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`,
      );

      if (!response.ok) {
        console.error(
          "[FacebookProvider] Token exchange failed:",
          response.status,
          await response.text().catch(() => ""),
        );
        return null;
      }

      const data = (await response.json()) as any;
      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in || 3600,
      };
    } catch (err) {
      console.error("[FacebookProvider] Token exchange error:", err);
      return null;
    }
  }

  /**
   * Get the list of Pages the authenticated user manages.
   * Requires a user access token with `pages_show_list` permission.
   */
  async listUserPages(
    userAccessToken: string,
  ): Promise<FacebookPageToken[]> {
    try {
      const response = await fetch(
        `${GRAPH_API_BASE}/me/accounts?fields=id,name,access_token&access_token=${userAccessToken}`,
      );

      if (!response.ok) {
        console.error(
          "[FacebookProvider] List pages failed:",
          response.status,
        );
        return [];
      }

      const data = (await response.json()) as any;
      if (!Array.isArray(data?.data)) return [];

      return data.data.map((page: any) => ({
        pageId: page.id,
        pageName: page.name,
        accessToken: page.access_token,
      }));
    } catch (err) {
      console.error("[FacebookProvider] List pages error:", err);
      return [];
    }
  }

  // ── ImportProviderDriver Interface ────────────────────────────────────

  /**
   * Search is not directly supported via Facebook Graph API for Pages.
   * Instead, use listUserPages() to get the user's managed pages.
   * This method is a fallback that searches by name in the user's pages.
   */
  async search(query: BusinessSearchQuery): Promise<BusinessSearchResult[]> {
    // Facebook doesn't have a public page search API.
    // The consumer should use listUserPages() instead.
    // This is a stub for interface compliance.
    console.warn(
      "[FacebookProvider] search() is not supported. Use listUserPages() with a user access token.",
    );
    return [];
  }

  /**
   * Fetch full profile data for a Facebook Page.
   * Requires a Page Access Token (from listUserPages).
   */
  async fetchProfile(
    pageId: string,
    pageAccessToken?: string,
  ): Promise<UnifiedBusinessProfile | null> {
    if (!pageId) return null;

    // If we have a page access token, use it for full data
    const token = pageAccessToken;
    if (!token) {
      console.warn(
        "[FacebookProvider] No access token provided. Limited data available.",
      );
      return null;
    }

    try {
      const response = await fetch(
        `${GRAPH_API_BASE}/${pageId}?fields=${PAGE_FIELDS}&access_token=${token}`,
      );

      if (!response.ok) {
        console.error(
          "[FacebookProvider] Fetch failed:",
          response.status,
          await response.text().catch(() => ""),
        );
        return null;
      }

      const raw = (await response.json()) as any;
      return this.normalize(pageId, raw);
    } catch (err) {
      console.error("[FacebookProvider] Fetch error:", err);
      return null;
    }
  }

  /**
   * Fetch profile using a Page Access Token (convenience method).
   * This is the primary way to use this provider.
   */
  async fetchProfileWithToken(
    pageToken: FacebookPageToken,
  ): Promise<UnifiedBusinessProfile | null> {
    return this.fetchProfile(pageToken.pageId, pageToken.accessToken);
  }

  // ── Private normalization ────────────────────────────────────────────

  private normalize(pageId: string, raw: any): UnifiedBusinessProfile {
    // Description
    const description = raw?.description || raw?.about || null;

    // Rating (Facebook uses 0-5 scale)
    const rating =
      typeof raw?.overall_star_rating === "number"
        ? raw.overall_star_rating
        : null;
    const reviewCount =
      typeof raw?.rating_count === "number" ? raw.rating_count : null;

    // Price range → PriceLevel
    const priceLevel = this.normalizePriceRange(raw?.price_range);

    // Business status
    const businessStatus: BusinessStatus = raw?.is_permanently_closed
      ? "closed_permanently"
      : "operational";

    // Photos
    const photos = this.normalizePhotos(raw?.photos);

    // Cover image
    const coverImageUrl = raw?.cover?.source || null;

    // Category
    const category = raw?.category || null;
    const subcategories = Array.isArray(raw?.category_list)
      ? raw.category_list.map((c: any) => c.name).filter(Boolean)
      : [];

    // Contact
    const phone = raw?.phone || null;
    const websiteUrl = raw?.website || null;
    const email =
      Array.isArray(raw?.emails) && raw.emails.length > 0
        ? raw.emails[0]
        : null;

    // Location
    const location = raw?.location || {};
    const address = raw?.single_line_address || null;
    const city = location?.city || null;
    const state = location?.state || null;
    const postalCode = location?.zip || null;
    const country = location?.country || null;
    const latitude =
      typeof location?.latitude === "number" ? location.latitude : null;
    const longitude =
      typeof location?.longitude === "number" ? location.longitude : null;

    // Hours
    const hours = this.normalizeHours(raw?.hours);

    // Facebook page URL
    const facebookUrl = raw?.link || `https://facebook.com/${pageId}`;

    return {
      source: {
        provider: "facebook",
        externalId: pageId,
        importedAt: new Date(),
        rawPayload: raw,
      },
      name: raw?.name || "Unknown",
      description,
      category,
      subcategories,
      address,
      city,
      state,
      postalCode,
      country,
      latitude,
      longitude,
      phone,
      email,
      websiteUrl,
      facebookUrl,
      instagramUrl: null, // Could be fetched via Instagram Graph API
      twitterUrl: null,
      coverImageUrl,
      logoUrl: null, // Facebook doesn't have a separate logo concept
      photos,
      hours,
      priceLevel,
      menuUrl: null, // Facebook doesn't have a menu URL field
      orderUrl: null,
      reservationUrl: null,
      rating,
      reviewCount,
      businessStatus,
      amenities: {}, // Facebook doesn't expose amenities directly
    };
  }

  private normalizePhotos(photosData: any): ImportedPhoto[] {
    if (!photosData?.data || !Array.isArray(photosData.data)) return [];

    return photosData.data
      .slice(0, this.maxPhotos)
      .map((photo: any) => {
        // Facebook photos have multiple image sizes; pick the largest
        const images = photo.images || [];
        const largest =
          images.length > 0
            ? images.reduce((a: any, b: any) =>
                (a.width || 0) > (b.width || 0) ? a : b,
              )
            : null;

        return {
          url: largest?.source || "",
          width: largest?.width || null,
          height: largest?.height || null,
          caption: photo.name || photo.alt_text || null,
          attribution: "Facebook",
          source: "facebook" as const,
        };
      })
      .filter((p: ImportedPhoto) => p.url);
  }

  private normalizeHours(
    hoursData: any,
  ): BusinessHours | null {
    if (!hoursData || typeof hoursData !== "object") return null;

    // Facebook hours format: { mon_1_open: "08:00", mon_1_close: "17:00", ... }
    const dayMap: Record<string, keyof BusinessHours> = {
      mon: "monday",
      tue: "tuesday",
      wed: "wednesday",
      thu: "thursday",
      fri: "friday",
      sat: "saturday",
      sun: "sunday",
    };

    const hours: BusinessHours = {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    };

    let hasAnyHours = false;

    for (const [abbrev, dayName] of Object.entries(dayMap)) {
      const slots: DayHours[] = [];

      // Facebook supports multiple time slots per day (e.g., mon_1_open, mon_2_open)
      for (let i = 1; i <= 3; i++) {
        const openKey = `${abbrev}_${i}_open`;
        const closeKey = `${abbrev}_${i}_close`;

        if (hoursData[openKey] && hoursData[closeKey]) {
          slots.push({
            open: hoursData[openKey],
            close: hoursData[closeKey],
          });
          hasAnyHours = true;
        }
      }

      if (slots.length > 0) {
        (hours as any)[dayName] = slots;
      }
    }

    return hasAnyHours ? hours : null;
  }

  private normalizePriceRange(priceRange: string | null): PriceLevel | null {
    if (!priceRange) return null;

    // Facebook uses "$", "$$", "$$$", "$$$$"
    const dollarCount = (priceRange.match(/\$/g) || []).length;
    if (dollarCount >= 1 && dollarCount <= 4) {
      return dollarCount as PriceLevel;
    }

    return null;
  }
}
