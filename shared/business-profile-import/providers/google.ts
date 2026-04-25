/**
 * Business Profile Import SDK — Google Places Provider
 *
 * Fetches business data from Google Places API (New) and normalizes
 * it into UnifiedBusinessProfile format.
 *
 * Requires: GOOGLE_MAPS_API_KEY environment variable
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

const PLACES_API_BASE = "https://places.googleapis.com/v1";

// Full field mask for rich business profiles
const PROFILE_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "addressComponents",
  "types",
  "primaryType",
  "primaryTypeDisplayName",
  "editorialSummary",
  "regularOpeningHours",
  "currentOpeningHours",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "rating",
  "userRatingCount",
  "priceLevel",
  "businessStatus",
  "photos",
  "reviews",
  "servesBreakfast",
  "servesLunch",
  "servesDinner",
  "servesBeer",
  "servesWine",
  "servesCocktails",
  "servesVegetarianFood",
  "outdoorSeating",
  "liveMusic",
  "delivery",
  "dineIn",
  "takeout",
  "reservable",
  "menuUri",
  "orderUri",
].join(",");

const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.rating",
  "places.userRatingCount",
  "places.primaryTypeDisplayName",
].join(",");

export type GoogleProviderConfig = {
  apiKey: string;
  maxPhotos?: number; // Default: 10
  photoMaxWidth?: number; // Default: 800
};

export class GooglePlacesProvider implements ImportProviderDriver {
  readonly providerId = "google" as const;
  readonly displayName = "Google Places";

  private apiKey: string;
  private maxPhotos: number;
  private photoMaxWidth: number;

  constructor(config: GoogleProviderConfig) {
    this.apiKey = config.apiKey;
    this.maxPhotos = config.maxPhotos ?? 10;
    this.photoMaxWidth = config.photoMaxWidth ?? 800;
  }

  async search(query: BusinessSearchQuery): Promise<BusinessSearchResult[]> {
    if (!this.apiKey) return [];

    const locationParts = [query.address, query.city, query.state].filter(Boolean);
    const textQuery = `${query.name} ${locationParts.join(", ")}`;

    try {
      const response = await fetch(`${PLACES_API_BASE}/places:searchText`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey,
          "X-Goog-FieldMask": SEARCH_FIELD_MASK,
        },
        body: JSON.stringify({ textQuery, maxResultCount: 5 }),
      });

      if (!response.ok) {
        console.error("[GoogleProvider] Search failed:", response.status);
        return [];
      }

      const data = (await response.json()) as any;
      const places = data?.places;
      if (!Array.isArray(places)) return [];

      return places.map((place: any, idx: number) => ({
        externalId: String(place.id || ""),
        name: place.displayName?.text || "Unknown",
        address: place.formattedAddress || null,
        rating: typeof place.rating === "number" ? place.rating : null,
        reviewCount:
          typeof place.userRatingCount === "number"
            ? place.userRatingCount
            : null,
        category: place.primaryTypeDisplayName?.text || null,
        provider: "google" as const,
        confidence: idx === 0 ? 0.9 : Math.max(0.3, 0.8 - idx * 0.15),
      }));
    } catch (err) {
      console.error("[GoogleProvider] Search error:", err);
      return [];
    }
  }

  async fetchProfile(
    placeId: string,
  ): Promise<UnifiedBusinessProfile | null> {
    if (!this.apiKey || !placeId) return null;

    try {
      const response = await fetch(
        `${PLACES_API_BASE}/places/${encodeURIComponent(placeId)}`,
        {
          headers: {
            "X-Goog-Api-Key": this.apiKey,
            "X-Goog-FieldMask": PROFILE_FIELD_MASK,
          },
        },
      );

      if (!response.ok) {
        console.error("[GoogleProvider] Fetch failed:", response.status);
        return null;
      }

      const raw = (await response.json()) as any;
      return this.normalize(placeId, raw);
    } catch (err) {
      console.error("[GoogleProvider] Fetch error:", err);
      return null;
    }
  }

  /**
   * Build a proxied photo URL from a Google Places photo resource name.
   */
  getPhotoUrl(photoName: string, maxWidth?: number): string {
    return `${PLACES_API_BASE}/${photoName}/media?maxWidthPx=${maxWidth || this.photoMaxWidth}&key=${this.apiKey}`;
  }

  // ── Private normalization ────────────────────────────────────────────────

  private normalize(placeId: string, raw: any): UnifiedBusinessProfile {
    // Description
    const description =
      raw?.editorialSummary?.text ||
      raw?.primaryTypeDisplayName?.text ||
      null;

    // Rating
    const rating = typeof raw?.rating === "number" ? raw.rating : null;
    const reviewCount =
      typeof raw?.userRatingCount === "number" ? raw.userRatingCount : null;

    // Price level
    const priceLevelMap: Record<string, PriceLevel> = {
      PRICE_LEVEL_FREE: 0,
      PRICE_LEVEL_INEXPENSIVE: 1,
      PRICE_LEVEL_MODERATE: 2,
      PRICE_LEVEL_EXPENSIVE: 3,
      PRICE_LEVEL_VERY_EXPENSIVE: 4,
    };
    const priceLevel: PriceLevel | null = raw?.priceLevel
      ? priceLevelMap[raw.priceLevel] ?? null
      : null;

    // Business status
    const statusMap: Record<string, BusinessStatus> = {
      OPERATIONAL: "operational",
      CLOSED_TEMPORARILY: "closed_temporarily",
      CLOSED_PERMANENTLY: "closed_permanently",
    };
    const businessStatus: BusinessStatus =
      statusMap[raw?.businessStatus] || "unknown";

    // Photos
    const photos: ImportedPhoto[] = Array.isArray(raw?.photos)
      ? raw.photos.slice(0, this.maxPhotos).map((p: any) => ({
          url: this.getPhotoUrl(p.name),
          width: p.widthPx || null,
          height: p.heightPx || null,
          caption: null,
          attribution:
            p.authorAttributions?.[0]?.displayName || null,
          source: "google" as const,
        }))
      : [];

    // Categories
    const allTypes = Array.isArray(raw?.types)
      ? raw.types.filter((t: string) => !t.startsWith("point_of_interest"))
      : [];
    const category = raw?.primaryTypeDisplayName?.text || allTypes[0] || null;

    // Phone
    const phone =
      raw?.nationalPhoneNumber || raw?.internationalPhoneNumber || null;

    // Hours
    const hours = this.normalizeHours(raw?.regularOpeningHours);

    // Website
    const websiteUrl = raw?.websiteUri || null;
    const menuUrl = raw?.menuUri || null;
    const orderUrl = raw?.orderUri || null;

    // Address components
    const address = raw?.formattedAddress || null;
    const lat = raw?.location?.latitude ?? null;
    const lng = raw?.location?.longitude ?? null;

    let city: string | null = null;
    let state: string | null = null;
    let postalCode: string | null = null;
    let country: string | null = null;

    if (Array.isArray(raw?.addressComponents)) {
      for (const comp of raw.addressComponents) {
        const types: string[] = comp.types || [];
        if (types.includes("locality")) city = comp.longText || null;
        if (types.includes("administrative_area_level_1"))
          state = comp.shortText || null;
        if (types.includes("postal_code"))
          postalCode = comp.longText || null;
        if (types.includes("country")) country = comp.shortText || null;
      }
    }

    // Amenities
    const amenities: Record<string, boolean> = {};
    const boolFields = [
      "servesBreakfast",
      "servesLunch",
      "servesDinner",
      "servesBeer",
      "servesWine",
      "servesCocktails",
      "servesVegetarianFood",
      "outdoorSeating",
      "liveMusic",
      "delivery",
      "dineIn",
      "takeout",
      "reservable",
    ];
    for (const field of boolFields) {
      if (typeof raw?.[field] === "boolean") {
        amenities[field] = raw[field];
      }
    }

    return {
      source: {
        provider: "google",
        externalId: placeId,
        importedAt: new Date(),
        rawPayload: raw,
      },
      name: raw?.displayName?.text || "Unknown",
      description,
      category,
      subcategories: allTypes,
      address,
      city,
      state,
      postalCode,
      country,
      latitude: lat,
      longitude: lng,
      phone,
      email: null, // Google doesn't expose email
      websiteUrl,
      facebookUrl: null,
      instagramUrl: null,
      twitterUrl: null,
      coverImageUrl: photos[0]?.url || null,
      logoUrl: null,
      photos,
      hours,
      priceLevel,
      menuUrl,
      orderUrl,
      reservationUrl: null,
      rating,
      reviewCount,
      businessStatus,
      amenities,
    };
  }

  private normalizeHours(
    openingHours: any,
  ): BusinessHours | null {
    const periods = openingHours?.periods;
    if (!Array.isArray(periods) || periods.length === 0) return null;

    const dayNames: Array<keyof BusinessHours> = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];

    const hours: BusinessHours = {
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
      sunday: null,
    };

    for (const period of periods) {
      const dayIdx = period?.open?.day;
      if (typeof dayIdx !== "number" || dayIdx < 0 || dayIdx > 6) continue;

      const dayName = dayNames[dayIdx];
      const openHour = String(period?.open?.hour ?? 0).padStart(2, "0");
      const openMin = String(period?.open?.minute ?? 0).padStart(2, "0");
      const closeHour = String(period?.close?.hour ?? 23).padStart(2, "0");
      const closeMin = String(period?.close?.minute ?? 59).padStart(2, "0");

      const slot: DayHours = {
        open: `${openHour}:${openMin}`,
        close: `${closeHour}:${closeMin}`,
      };

      if (!hours[dayName] || !Array.isArray(hours[dayName])) {
        (hours as any)[dayName] = [slot];
      } else {
        (hours[dayName] as DayHours[]).push(slot);
      }
    }

    return hours;
  }
}
