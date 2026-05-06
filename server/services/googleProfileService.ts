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
import { restaurants, hosts, users } from "../../shared/schema/legacy";
import { getDefaultAffiliatePercent } from "@shared/affiliatePolicy";
import { eq, sql } from "drizzle-orm";

const PLACES_API_BASE = "https://places.googleapis.com/v1";

const getApiKey = () =>
  String(
    process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_PLACES_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_WEB_API_KEY ||
      "",
  ).trim();

type RestaurantGoogleMediaInput = {
  businessType?: unknown;
  claimedFromImportId?: unknown;
  coverImageUrl?: unknown;
  googleBusinessStatus?: unknown;
  googleCategories?: unknown;
  googleFormattedPhone?: unknown;
  googlePhotos?: unknown;
  googlePlaceId?: unknown;
  googlePriceLevel?: unknown;
  googleRating?: unknown;
  googleReviewCount?: unknown;
  isFoodTruck?: unknown;
  profileSource?: unknown;
};

export const isMobileFoodRestaurantProfile = (
  restaurant: RestaurantGoogleMediaInput | null | undefined,
) =>
  Boolean(restaurant?.isFoodTruck) ||
  String(restaurant?.businessType || "").toLowerCase() === "food_truck" ||
  Boolean(String(restaurant?.claimedFromImportId || "").trim());

export const isGoogleManagedImageUrl = (value: unknown) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return false;
  return (
    raw.includes("places.googleapis.com/") ||
    raw.includes("maps.googleapis.com/maps/api/place") ||
    raw.includes("/api/google/photo")
  );
};

export const shouldExposeGoogleRestaurantMedia = (
  restaurant: RestaurantGoogleMediaInput | null | undefined,
) => !isMobileFoodRestaurantProfile(restaurant);

export function sanitizeGoogleRestaurantMedia<T extends Record<string, any>>(
  restaurant: T | null | undefined,
): T | null | undefined {
  if (!restaurant || shouldExposeGoogleRestaurantMedia(restaurant)) {
    return restaurant;
  }

  const sanitized: Record<string, any> = { ...restaurant };
  sanitized.googlePlaceId = null;
  sanitized.googlePhotos = null;
  sanitized.googleCategories = null;
  sanitized.googleFormattedPhone = null;
  sanitized.googleRating = null;
  sanitized.googleReviewCount = null;
  sanitized.googlePriceLevel = null;
  sanitized.googleBusinessStatus = null;
  if (isGoogleManagedImageUrl(sanitized.coverImageUrl)) {
    sanitized.coverImageUrl = null;
  }
  if (String(sanitized.profileSource || "").toLowerCase() === "google") {
    sanitized.profileSource = "none";
  }
  return sanitized as T;
}

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
  "places.businessStatus",
  "places.photos",
].join(",");

const AUTOCOMPLETE_FIELD_MASK = [
  "suggestions.placePrediction.placeId",
  "suggestions.placePrediction.text.text",
  "suggestions.placePrediction.structuredFormat.mainText.text",
  "suggestions.placePrediction.structuredFormat.secondaryText.text",
].join(",");

const TOKEN_STOP_WORDS = new Set([
  "the",
  "and",
  "usa",
  "fl",
  "florida",
  "llc",
  "inc",
  "co",
  "company",
]);

const normalizePlaceText = (value: unknown): string =>
  String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const significantTokens = (value: unknown): string[] =>
  normalizePlaceText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !TOKEN_STOP_WORDS.has(token));

const expandAddressAbbreviations = (value: string): string =>
  String(value || "")
    .replace(/\bN\.?\b/gi, "North")
    .replace(/\bS\.?\b/gi, "South")
    .replace(/\bE\.?\b/gi, "East")
    .replace(/\bW\.?\b/gi, "West")
    .replace(/\bBlvd\.?\b/gi, "Boulevard")
    .replace(/\bRd\.?\b/gi, "Road")
    .replace(/\bSt\.?\b/gi, "Street")
    .replace(/\bAve\.?\b/gi, "Avenue")
    .replace(/\bDr\.?\b/gi, "Drive")
    .replace(/\bLn\.?\b/gi, "Lane")
    .replace(/\bHwy\.?\b/gi, "Highway")
    .replace(/\s+/g, " ")
    .trim();

const compactAddress = (value: string): string =>
  String(value || "")
    .replace(/\bNorth\b/gi, "N")
    .replace(/\bSouth\b/gi, "S")
    .replace(/\bEast\b/gi, "E")
    .replace(/\bWest\b/gi, "W")
    .replace(/\bBoulevard\b/gi, "Blvd")
    .replace(/\bRoad\b/gi, "Rd")
    .replace(/\bStreet\b/gi, "St")
    .replace(/\bAvenue\b/gi, "Ave")
    .replace(/\bDrive\b/gi, "Dr")
    .replace(/\bLane\b/gi, "Ln")
    .replace(/\s+/g, " ")
    .trim();

const buildSearchQueries = (
  businessName: string,
  address: string,
  city?: string | null,
  state?: string | null,
): string[] => {
  const locationQuery = [address, city, state].filter(Boolean).join(", ");
  const expandedLocation = expandAddressAbbreviations(locationQuery);
  const compactLocation = compactAddress(locationQuery);
  const cityState = [city, state].filter(Boolean).join(", ");

  return Array.from(
    new Set(
      [
        `${businessName} ${locationQuery}`,
        `${businessName}, ${locationQuery}`,
        `${businessName} ${expandedLocation}`,
        `${businessName}, ${expandedLocation}`,
        `${businessName} ${compactLocation}`,
        cityState ? `${businessName}, ${cityState}` : "",
        address ? `${businessName}, ${address}` : "",
      ]
        .map((query) => query.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    ),
  );
};

const placeMatchScore = (
  place: any,
  businessName: string,
  locationQuery: string,
): number => {
  const displayName = normalizePlaceText(place?.displayName?.text);
  const formattedAddress = normalizePlaceText(place?.formattedAddress);
  const normalizedName = normalizePlaceText(businessName);
  const nameTokens = significantTokens(businessName);
  const locationTokens = significantTokens(locationQuery);

  const nameHits = nameTokens.filter((token) =>
    displayName.includes(token),
  ).length;
  const addressHits = locationTokens.filter((token) =>
    formattedAddress.includes(token),
  ).length;

  let score = nameHits * 12 + Math.min(addressHits, 5) * 3;
  if (normalizedName && displayName.includes(normalizedName)) score += 30;
  if (
    formattedAddress &&
    normalizePlaceText(locationQuery).includes(formattedAddress)
  ) {
    score += 8;
  }
  if (typeof place?.rating === "number") score += 1;
  if (
    typeof place?.userRatingCount === "number" &&
    place.userRatingCount > 0
  ) {
    score += 1;
  }
  return score;
};

const autocompleteMatchScore = (
  suggestion: any,
  businessName: string,
  locationQuery: string,
): number => {
  const prediction = suggestion?.placePrediction;
  const mainText = normalizePlaceText(
    prediction?.structuredFormat?.mainText?.text,
  );
  const secondaryText = normalizePlaceText(
    prediction?.structuredFormat?.secondaryText?.text,
  );
  const fullText = normalizePlaceText(prediction?.text?.text);
  const normalizedName = normalizePlaceText(businessName);
  const nameTokens = significantTokens(businessName);
  const locationTokens = significantTokens(locationQuery);

  const nameHits = nameTokens.filter(
    (token) => mainText.includes(token) || fullText.includes(token),
  ).length;
  const addressHits = locationTokens.filter(
    (token) => secondaryText.includes(token) || fullText.includes(token),
  ).length;

  let score = nameHits * 12 + Math.min(addressHits, 5) * 3;
  if (normalizedName && mainText.includes(normalizedName)) score += 30;
  return score;
};

const findGooglePlaceByAutocomplete = async (
  apiKey: string,
  queryAttempts: string[],
  businessName: string,
  locationQuery: string,
): Promise<{ placeId: string; score: number; query: string } | null> => {
  let bestMatch: { placeId: string; score: number; query: string } | null =
    null;

  for (const input of queryAttempts) {
    const response = await fetch(`${PLACES_API_BASE}/places:autocomplete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": AUTOCOMPLETE_FIELD_MASK,
      },
      body: JSON.stringify({
        input,
        includedRegionCodes: ["us"],
        languageCode: "en",
      }),
    });

    if (!response.ok) {
      console.error(
        "[GoogleProfile] Autocomplete failed:",
        response.status,
        await response.text().catch(() => ""),
      );
      continue;
    }

    const data = (await response.json().catch(() => ({}))) as any;
    const suggestions = data?.suggestions;
    if (!Array.isArray(suggestions) || suggestions.length === 0) continue;

    for (const suggestion of suggestions) {
      const placeId = String(
        suggestion?.placePrediction?.placeId || "",
      ).trim();
      if (!placeId) continue;
      const score = autocompleteMatchScore(
        suggestion,
        businessName,
        locationQuery,
      );
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { placeId, score, query: input };
      }
    }
  }

  return bestMatch;
};

const buildLocationBias = (
  latitude?: string | number | null,
  longitude?: string | number | null,
) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    circle: {
      center: { latitude: lat, longitude: lng },
      radius: 3000,
    },
  };
};

export type GoogleProfileData = {
  name: string | null;
  formattedAddress: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  primaryTypeDisplayName: string | null;
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
  latitude?: string | number | null,
  longitude?: string | number | null,
): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn("[GoogleProfile] No API key available");
    return null;
  }

  const locationQuery = [address, city, state].filter(Boolean).join(", ");
  const queryAttempts = buildSearchQueries(businessName, address, city, state);
  const locationBias = buildLocationBias(latitude, longitude);
  let bestMatch: { placeId: string; score: number; query: string } | null =
    null;

  try {
    for (const textQuery of queryAttempts) {
      const response = await fetch(`${PLACES_API_BASE}/places:searchText`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": SEARCH_FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery,
          maxResultCount: 5,
          ...(locationBias ? { locationBias } : {}),
        }),
      });

      if (!response.ok) {
        console.error(
          "[GoogleProfile] Text search failed:",
          response.status,
          await response.text().catch(() => ""),
        );
        continue;
      }

      const data = (await response.json()) as any;
      const places = data?.places;
      if (!Array.isArray(places) || places.length === 0) continue;

      for (const place of places) {
        const placeId = String(place?.id || "").trim();
        if (!placeId) continue;
        const score = placeMatchScore(place, businessName, locationQuery);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { placeId, score, query: textQuery };
        }
      }
    }

    if (!bestMatch || bestMatch.score < 18) {
      const autocompleteMatch = await findGooglePlaceByAutocomplete(
        apiKey,
        queryAttempts,
        businessName,
        locationQuery,
      );
      if (
        autocompleteMatch &&
        autocompleteMatch.score > (bestMatch?.score ?? 0)
      ) {
        bestMatch = autocompleteMatch;
      }
    }

    if (!bestMatch) {
      console.warn("[GoogleProfile] No Google Places match candidates", {
        businessName,
        address,
        city,
        state,
      });
      return null;
    }

    if (bestMatch.score < 18) {
      console.warn("[GoogleProfile] Google Places match score too low", {
        businessName,
        address,
        city,
        state,
        score: bestMatch.score,
        query: bestMatch.query,
      });
      return null;
    }

    return bestMatch.placeId;
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
  const components = Array.isArray(raw?.addressComponents)
    ? raw.addressComponents
    : [];
  const findComponent = (
    type: string,
    field: "longText" | "shortText" = "longText",
  ) => {
    const match = components.find((component: any) =>
      Array.isArray(component?.types) ? component.types.includes(type) : false,
    );
    return String(match?.[field] || match?.longText || match?.shortText || "")
      .trim() || null;
  };

  // Description
  const description =
    raw?.editorialSummary?.text ||
    raw?.primaryTypeDisplayName?.text ||
    null;
  const primaryTypeDisplayName =
    raw?.primaryTypeDisplayName?.text || null;

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
    name: raw?.displayName?.text || null,
    formattedAddress: raw?.formattedAddress || null,
    city:
      findComponent("locality") ||
      findComponent("postal_town") ||
      findComponent("administrative_area_level_2"),
    state: findComponent("administrative_area_level_1", "shortText"),
    latitude:
      typeof raw?.location?.latitude === "number"
        ? raw.location.latitude
        : null,
    longitude:
      typeof raw?.location?.longitude === "number"
        ? raw.location.longitude
        : null,
    primaryTypeDisplayName,
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

let importSystemUserIdPromise: Promise<string> | null = null;

async function getOrCreateImportSystemUserId(): Promise<string> {
  if (!importSystemUserIdPromise) {
    importSystemUserIdPromise = (async () => {
      const email =
        process.env.IMPORT_SYSTEM_EMAIL || "system-import@mealscout.us";
      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existing?.id) return existing.id;

      await db
        .insert(users)
        .values({
          email,
          firstName: "System",
          lastName: "Import",
          userType: "admin",
          emailVerified: true,
          affiliatePercent: getDefaultAffiliatePercent("admin"),
        })
        .onConflictDoNothing({ target: users.email });
      const [created] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return created.id;
    })();
  }
  return await importSystemUserIdPromise;
}

const inferBusinessType = (profile: GoogleProfileData) => {
  const categories = (profile.googleCategories || []).map((value) =>
    String(value || "").toLowerCase(),
  );
  if (
    categories.some((value) =>
      ["bar", "pub", "night_club", "brewery", "wine_bar"].includes(value),
    )
  ) {
    return { businessType: "bar", isFoodTruck: false };
  }
  return { businessType: "restaurant", isFoodTruck: false };
};

const fallbackCuisine = (profile: GoogleProfileData) => {
  if (profile.primaryTypeDisplayName) return profile.primaryTypeDisplayName;
  const category = (profile.googleCategories || []).find((value) =>
    String(value || "").includes("restaurant"),
  );
  if (category) {
    return String(category)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  return "Restaurant";
};

export async function ensureGoogleRestaurantProfile(
  placeId: string,
): Promise<{
  restaurant: typeof restaurants.$inferSelect;
  created: boolean;
}> {
  const normalizedPlaceId = String(placeId || "").trim();
  if (!normalizedPlaceId) {
    throw new Error("placeId is required");
  }

  const [existing] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.googlePlaceId, normalizedPlaceId))
    .limit(1);
  if (existing) {
    const refreshed = await refreshGeneratedGoogleRestaurant(existing, normalizedPlaceId);
    return { restaurant: refreshed || existing, created: false };
  }

  const profile = await fetchGoogleProfile(normalizedPlaceId);
  if (!profile?.name || !profile?.formattedAddress) {
    throw new Error("Google profile was missing name or address");
  }

  const { businessType, isFoodTruck } = inferBusinessType(profile);
  const firstPhotoName = profile.googlePhotos?.[0]?.name || "";
  const coverImageUrl = firstPhotoName ? getGooglePhotoUrl(firstPhotoName) : null;

  return await db.transaction(async (tx: any) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`google-profile:${normalizedPlaceId}`}))`,
    );

    const [existingAfterLock] = await tx
      .select()
      .from(restaurants)
      .where(eq(restaurants.googlePlaceId, normalizedPlaceId))
      .limit(1);
    if (existingAfterLock) {
      return { restaurant: existingAfterLock, created: false };
    }

    const ownerId = await getOrCreateImportSystemUserId();
    const [created] = await tx
      .insert(restaurants)
      .values({
        ownerId,
        name: profile.name,
        address: profile.formattedAddress,
        phone: profile.googleFormattedPhone,
        businessType,
        cuisineType: fallbackCuisine(profile),
        city: profile.city,
        state: profile.state,
        latitude:
          typeof profile.latitude === "number" ? String(profile.latitude) : null,
        longitude:
          typeof profile.longitude === "number"
            ? String(profile.longitude)
            : null,
        description: profile.description,
        websiteUrl: profile.websiteUrl,
        coverImageUrl,
        isFoodTruck,
        isActive: true,
        isVerified: false,
        googlePlaceId: normalizedPlaceId,
        googleRating: profile.googleRating,
        googleReviewCount: profile.googleReviewCount,
        googlePriceLevel: profile.googlePriceLevel,
        googleBusinessStatus: profile.googleBusinessStatus,
        googlePhotos: profile.googlePhotos,
        googleCategories: profile.googleCategories,
        googleFormattedPhone: profile.googleFormattedPhone,
        menuUrl: profile.menuUrl,
        orderUrl: profile.orderUrl,
        operatingHours: profile.operatingHours,
        amenities: profile.amenities,
        profileSource: "google",
        profileLastSynced: new Date(),
      } as any)
      .returning();

    return { restaurant: created, created: true };
  });
}

async function refreshGeneratedGoogleRestaurant(
  restaurant: typeof restaurants.$inferSelect,
  placeId: string,
): Promise<typeof restaurants.$inferSelect | null> {
  if (!placeId || restaurant.profileSource !== "google") return null;

  const profile = await fetchGoogleProfile(placeId);
  if (!profile) return null;

  const firstPhotoName = profile.googlePhotos?.[0]?.name || "";
  const coverImageUrl = firstPhotoName ? getGooglePhotoUrl(firstPhotoName) : null;
  const { businessType, isFoodTruck } = inferBusinessType(profile);

  const updates: Record<string, any> = {
    businessType,
    isFoodTruck,
    googlePlaceId: placeId,
    googleRating: profile.googleRating,
    googleReviewCount: profile.googleReviewCount,
    googlePriceLevel: profile.googlePriceLevel,
    googleBusinessStatus: profile.googleBusinessStatus,
    googlePhotos: profile.googlePhotos,
    googleCategories: profile.googleCategories,
    googleFormattedPhone: profile.googleFormattedPhone,
    menuUrl: profile.menuUrl,
    orderUrl: profile.orderUrl,
    operatingHours: profile.operatingHours,
    amenities: profile.amenities,
    profileSource: "google",
    profileLastSynced: new Date(),
  };

  if (profile.name) updates.name = profile.name;
  if (profile.formattedAddress) updates.address = profile.formattedAddress;
  if (profile.city) updates.city = profile.city;
  if (profile.state) updates.state = profile.state;
  if (typeof profile.latitude === "number") updates.latitude = String(profile.latitude);
  if (typeof profile.longitude === "number") updates.longitude = String(profile.longitude);
  if (profile.description) updates.description = profile.description;
  if (profile.websiteUrl) updates.websiteUrl = profile.websiteUrl;
  if (profile.googleFormattedPhone) updates.phone = profile.googleFormattedPhone;
  if (coverImageUrl) updates.coverImageUrl = coverImageUrl;
  if (profile.googleCategories?.length) updates.cuisineType = fallbackCuisine(profile);

  const [updated] = await db
    .update(restaurants)
    .set(updates)
    .where(eq(restaurants.id, restaurant.id))
    .returning();

  return updated || null;
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

    if (!shouldExposeGoogleRestaurantMedia(restaurant)) {
      return {
        success: false,
        error:
          "Google Places auto-fill is disabled for food truck profiles; owners should upload business photos directly.",
      };
    }

    // If we already have a placeId, use it; otherwise search
    let placeId = restaurant.googlePlaceId;
    if (!placeId) {
      placeId = await findGooglePlace(
        restaurant.name,
        restaurant.address,
        restaurant.city,
        restaurant.state,
        restaurant.latitude,
        restaurant.longitude,
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
      updates.phone = profile.googleFormattedPhone;
      updates.googleFormattedPhone = profile.googleFormattedPhone;
    } else if (profile.googleFormattedPhone) {
      updates.googleFormattedPhone = profile.googleFormattedPhone;
    }
    const firstPhotoName = profile.googlePhotos?.[0]?.name || "";
    if (!restaurant.coverImageUrl && firstPhotoName) {
      updates.coverImageUrl = getGooglePhotoUrl(firstPhotoName);
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
        host.latitude,
        host.longitude,
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
      updates.contactPhone = profile.googleFormattedPhone;
      updates.googleFormattedPhone = profile.googleFormattedPhone;
    } else if (profile.googleFormattedPhone) {
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

export type GooglePlaceTextResult = {
  placeId: string;
  name: string;
  formattedAddress: string;
  latitude: number | null;
  longitude: number | null;
  types: string[];
  rating: number | null;
  userRatingCount: number | null;
  businessStatus: string | null;
  photos: Array<{ name: string; widthPx?: number | null; heightPx?: number | null }>;
};

/**
 * Run a freeform Google Places text search. Used when a user searches for a
 * place that isn't in our DB yet so we can seed an unclaimed listing.
 */
export async function searchPlacesFreeText(
  query: string,
  maxResults = 5,
  opts?: { latitude?: string | number | null; longitude?: string | number | null },
): Promise<GooglePlaceTextResult[]> {
  const apiKey = getApiKey();
  const trimmed = String(query || "").trim();
  if (!apiKey || trimmed.length < 3) return [];
  const locationBias = buildLocationBias(opts?.latitude, opts?.longitude);

  try {
    const response = await fetch(`${PLACES_API_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": SEARCH_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: trimmed,
        maxResultCount: Math.max(1, Math.min(10, maxResults)),
        includedRegionCodes: ["us"],
        ...(locationBias ? { locationBias } : {}),
      }),
    });

    if (!response.ok) {
      console.error(
        "[GoogleProfile] Free-text search failed:",
        response.status,
        await response.text().catch(() => ""),
      );
      return [];
    }

    const data = (await response.json().catch(() => ({}))) as any;
    const places = Array.isArray(data?.places) ? data.places : [];

    return places
      .map((place: any): GooglePlaceTextResult => ({
        placeId: String(place?.id || "").trim(),
        name: String(place?.displayName?.text || "").trim(),
        formattedAddress: String(place?.formattedAddress || "").trim(),
        latitude:
          typeof place?.location?.latitude === "number"
            ? place.location.latitude
            : null,
        longitude:
          typeof place?.location?.longitude === "number"
            ? place.location.longitude
            : null,
        types: Array.isArray(place?.types)
          ? place.types.map((t: any) => String(t))
          : [],
        rating: typeof place?.rating === "number" ? place.rating : null,
        userRatingCount:
          typeof place?.userRatingCount === "number"
            ? place.userRatingCount
            : null,
        businessStatus: place?.businessStatus
          ? String(place.businessStatus)
          : null,
        photos: Array.isArray(place?.photos)
          ? place.photos
              .map((p: any) => ({
                name: String(p?.name || "").trim(),
                widthPx: typeof p?.widthPx === "number" ? p.widthPx : null,
                heightPx: typeof p?.heightPx === "number" ? p.heightPx : null,
              }))
              .filter((p: any) => p.name)
              .slice(0, 10)
          : [],
      }))
      .filter((p: GooglePlaceTextResult) => p.placeId && p.name);
  } catch (err) {
    console.error("[GoogleProfile] Free-text search error:", err);
    return [];
  }
}
