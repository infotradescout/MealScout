/**
 * Google Places Profile Service
 *
 * Fetches comprehensive business data from Google Places API (New)
 * and populates restaurant/host profiles automatically.
 *
 * Supports: descriptions, hours, photos, ratings, menus, categories,
 * phone, website, price level, and business status.
 */

import { db } from "../db";
import { restaurants, hosts } from "../../shared/schema/legacy";
import { eq } from "drizzle-orm";

const PLACES_API_BASE = "https://places.googleapis.com/v1";

const getApiKey = () =>
  String(
    process.env.GOOGLE_MAPS_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_WEB_API_KEY ||
      "",
  ).trim();

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

// Lighter field mask for text search matching
const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.rating",
  "places.userRatingCount",
].join(",");

export type GoogleProfileData = {
  googlePlaceId: string;
  description: string | null;
  googleRating: string | null;
  googleReviewCount: number | null;
  googlePriceLevel: number | null;
  googleBusinessStatus: string | null;
  googlePhotos: Array<{
    name: string;
    widthPx: number;
    heightPx: number;
    authorAttributions: Array<{ displayName: string; uri: string }>;
  }> | null;
  googleCategories: string[] | null;
  googleFormattedPhone: string | null;
  operatingHours: Record<string, { open: string; close: string }> | null;
  websiteUrl: string | null;
  menuUrl: string | null;
  orderUrl: string | null;
  amenities: Record<string, boolean> | null;
};

/**
 * Search Google Places for a business by name and address
 */
export async function findGooglePlace(
  businessName: string,
  address: string,
  city?: string | null,
  state?: string | null,
): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn("[GoogleProfile] No API key available");
    return null;
  }

  const locationQuery = [address, city, state].filter(Boolean).join(", ");
  const textQuery = `${businessName} ${locationQuery}`;

  try {
    const response = await fetch(`${PLACES_API_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": SEARCH_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery,
        maxResultCount: 3,
      }),
    });

    if (!response.ok) {
      console.error(
        "[GoogleProfile] Text search failed:",
        response.status,
        await response.text().catch(() => ""),
      );
      return null;
    }

    const data = (await response.json()) as any;
    const places = data?.places;
    if (!Array.isArray(places) || places.length === 0) return null;

    // Return the top match
    const placeId = String(places[0].id || "").trim();
    return placeId || null;
  } catch (err) {
    console.error("[GoogleProfile] Text search error:", err);
    return null;
  }
}

/**
 * Fetch full profile data from Google Places API for a given placeId
 */
export async function fetchGoogleProfile(
  placeId: string,
): Promise<GoogleProfileData | null> {
  const apiKey = getApiKey();
  if (!apiKey || !placeId) return null;

  try {
    const response = await fetch(
      `${PLACES_API_BASE}/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": PROFILE_FIELD_MASK,
        },
      },
    );

    if (!response.ok) {
      console.error(
        "[GoogleProfile] Fetch failed:",
        response.status,
        await response.text().catch(() => ""),
      );
      return null;
    }

    const raw = (await response.json()) as any;
    return normalizeGoogleProfile(placeId, raw);
  } catch (err) {
    console.error("[GoogleProfile] Fetch error:", err);
    return null;
  }
}

/**
 * Normalize raw Google Places API response into our profile schema
 */
function normalizeGoogleProfile(
  placeId: string,
  raw: any,
): GoogleProfileData {
  // Description
  const description =
    raw?.editorialSummary?.text ||
    raw?.primaryTypeDisplayName?.text ||
    null;

  // Rating
  const googleRating =
    typeof raw?.rating === "number"
      ? String(raw.rating)
      : null;

  // Review count
  const googleReviewCount =
    typeof raw?.userRatingCount === "number" ? raw.userRatingCount : null;

  // Price level: PRICE_LEVEL_FREE=0, PRICE_LEVEL_INEXPENSIVE=1, etc.
  const priceLevelMap: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  const googlePriceLevel = raw?.priceLevel
    ? priceLevelMap[raw.priceLevel] ?? null
    : null;

  // Business status
  const googleBusinessStatus = raw?.businessStatus || null;

  // Photos (up to 20)
  const googlePhotos = Array.isArray(raw?.photos)
    ? raw.photos.slice(0, 20).map((p: any) => ({
        name: String(p.name || ""),
        widthPx: p.widthPx || 0,
        heightPx: p.heightPx || 0,
        authorAttributions: Array.isArray(p.authorAttributions)
          ? p.authorAttributions.map((a: any) => ({
              displayName: a.displayName || "",
              uri: a.uri || "",
            }))
          : [],
      }))
    : null;

  // Categories
  const googleCategories = Array.isArray(raw?.types)
    ? raw.types.filter((t: string) => !t.startsWith("point_of_interest"))
    : null;

  // Phone
  const googleFormattedPhone =
    raw?.nationalPhoneNumber || raw?.internationalPhoneNumber || null;

  // Operating hours
  let operatingHours: Record<string, { open: string; close: string }> | null =
    null;
  const periods = raw?.regularOpeningHours?.periods;
  if (Array.isArray(periods) && periods.length > 0) {
    const dayNames = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    operatingHours = {};
    for (const period of periods) {
      const dayIdx = period?.open?.day;
      if (typeof dayIdx !== "number" || dayIdx < 0 || dayIdx > 6) continue;
      const dayName = dayNames[dayIdx];
      const openHour = String(period?.open?.hour ?? 0).padStart(2, "0");
      const openMin = String(period?.open?.minute ?? 0).padStart(2, "0");
      const closeHour = String(period?.close?.hour ?? 23).padStart(2, "0");
      const closeMin = String(period?.close?.minute ?? 59).padStart(2, "0");
      operatingHours[dayName] = {
        open: `${openHour}:${openMin}`,
        close: `${closeHour}:${closeMin}`,
      };
    }
  }

  // Website
  const websiteUrl = raw?.websiteUri || null;

  // Menu / Order URLs
  const menuUrl = raw?.menuUri || null;
  const orderUrl = raw?.orderUri || null;

  // Amenities from boolean fields
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
    googlePlaceId: placeId,
    description,
    googleRating,
    googleReviewCount,
    googlePriceLevel,
    googleBusinessStatus,
    googlePhotos,
    googleCategories,
    googleFormattedPhone,
    operatingHours,
    websiteUrl,
    menuUrl,
    orderUrl,
    amenities: Object.keys(amenities).length > 0 ? amenities : null,
  };
}

/**
 * Auto-populate a restaurant's profile from Google Places
 */
export async function populateRestaurantProfile(
  restaurantId: string,
): Promise<{ success: boolean; placeId?: string; error?: string }> {
  try {
    const [restaurant] = await db
      .select()
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);

    if (!restaurant) return { success: false, error: "Restaurant not found" };

    // If we already have a placeId, use it; otherwise search
    let placeId = restaurant.googlePlaceId;
    if (!placeId) {
      placeId = await findGooglePlace(
        restaurant.name,
        restaurant.address,
        restaurant.city,
        restaurant.state,
      );
      if (!placeId) {
        return { success: false, error: "No Google Places match found" };
      }
    }

    const profile = await fetchGoogleProfile(placeId);
    if (!profile) {
      return { success: false, error: "Failed to fetch Google profile data" };
    }

    // Only update fields that are currently empty (don't overwrite manual edits)
    const updates: Record<string, any> = {
      googlePlaceId: placeId,
      profileSource:
        restaurant.profileSource === "manual" ? "mixed" : "google",
      profileLastSynced: new Date(),
    };

    if (!restaurant.description && profile.description) {
      updates.description = profile.description;
    }
    if (profile.googleRating) updates.googleRating = profile.googleRating;
    if (profile.googleReviewCount != null)
      updates.googleReviewCount = profile.googleReviewCount;
    if (profile.googlePriceLevel != null)
      updates.googlePriceLevel = profile.googlePriceLevel;
    if (profile.googleBusinessStatus)
      updates.googleBusinessStatus = profile.googleBusinessStatus;
    if (profile.googlePhotos) updates.googlePhotos = profile.googlePhotos;
    if (profile.googleCategories)
      updates.googleCategories = profile.googleCategories;
    if (!restaurant.phone && profile.googleFormattedPhone) {
      updates.googleFormattedPhone = profile.googleFormattedPhone;
    }
    if (!restaurant.operatingHours && profile.operatingHours) {
      updates.operatingHours = profile.operatingHours;
    }
    if (!restaurant.websiteUrl && profile.websiteUrl) {
      updates.websiteUrl = profile.websiteUrl;
    }
    if (profile.menuUrl) updates.menuUrl = profile.menuUrl;
    if (profile.orderUrl) updates.orderUrl = profile.orderUrl;
    if (profile.amenities) {
      const existing =
        typeof restaurant.amenities === "object" && restaurant.amenities
          ? (restaurant.amenities as Record<string, any>)
          : {};
      updates.amenities = { ...profile.amenities, ...existing };
    }

    await db
      .update(restaurants)
      .set(updates)
      .where(eq(restaurants.id, restaurantId));

    return { success: true, placeId };
  } catch (err) {
    console.error("[GoogleProfile] populateRestaurantProfile error:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Auto-populate a host location's profile from Google Places
 */
export async function populateHostProfile(
  hostId: string,
): Promise<{ success: boolean; placeId?: string; error?: string }> {
  try {
    const [host] = await db
      .select()
      .from(hosts)
      .where(eq(hosts.id, hostId))
      .limit(1);

    if (!host) return { success: false, error: "Host not found" };

    // If we already have a placeId, use it; otherwise search
    let placeId = host.googlePlaceId;
    if (!placeId) {
      placeId = await findGooglePlace(
        host.businessName,
        host.address,
        host.city,
        host.state,
      );
      if (!placeId) {
        return { success: false, error: "No Google Places match found" };
      }
    }

    const profile = await fetchGoogleProfile(placeId);
    if (!profile) {
      return { success: false, error: "Failed to fetch Google profile data" };
    }

    const updates: Record<string, any> = {
      googlePlaceId: placeId,
      profileSource: host.profileSource === "manual" ? "mixed" : "google",
      profileLastSynced: new Date(),
    };

    if (!host.description && profile.description) {
      updates.description = profile.description;
    }
    if (profile.googleRating) updates.googleRating = profile.googleRating;
    if (profile.googleReviewCount != null)
      updates.googleReviewCount = profile.googleReviewCount;
    if (profile.googlePriceLevel != null)
      updates.googlePriceLevel = profile.googlePriceLevel;
    if (profile.googleBusinessStatus)
      updates.googleBusinessStatus = profile.googleBusinessStatus;
    if (profile.googlePhotos) updates.googlePhotos = profile.googlePhotos;
    if (profile.googleCategories)
      updates.googleCategories = profile.googleCategories;
    if (!host.contactPhone && profile.googleFormattedPhone) {
      updates.googleFormattedPhone = profile.googleFormattedPhone;
    }
    if (!host.businessHours && profile.operatingHours) {
      updates.businessHours = profile.operatingHours;
    }
    if (!host.businessWebsite && profile.websiteUrl) {
      updates.businessWebsite = profile.websiteUrl;
    }
    if (profile.menuUrl) updates.menuUrl = profile.menuUrl;
    if (profile.amenities) {
      const existing =
        typeof host.amenities === "object" && host.amenities
          ? (host.amenities as Record<string, any>)
          : {};
      updates.amenities = { ...profile.amenities, ...existing };
    }

    await db.update(hosts).set(updates).where(eq(hosts.id, hostId));

    return { success: true, placeId };
  } catch (err) {
    console.error("[GoogleProfile] populateHostProfile error:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Get a Google Places photo URL from a photo reference name
 */
export function getGooglePhotoUrl(
  photoName: string,
  maxWidth = 800,
): string | null {
  const apiKey = getApiKey();
  if (!apiKey || !photoName) return null;
  return `${PLACES_API_BASE}/${photoName}/media?maxWidthPx=${maxWidth}&key=${apiKey}`;
}
