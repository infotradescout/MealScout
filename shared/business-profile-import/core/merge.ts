/**
 * Business Profile Import SDK — Multi-Source Merge Engine
 *
 * Combines profiles from multiple providers (Google + Facebook)
 * into a single UnifiedBusinessProfile using configurable preferences.
 *
 * @license MIT
 */

import type {
  UnifiedBusinessProfile,
  ImportProvider,
  MergePreference,
  ImportedPhoto,
  BusinessHours,
} from "../types";
import { DEFAULT_MERGE_PREFERENCE } from "../types";

/**
 * Merge two UnifiedBusinessProfiles from different providers.
 * The `preference` object controls which provider wins per category.
 */
export function mergeProfiles(
  profiles: UnifiedBusinessProfile[],
  preference: MergePreference = {
    identity: "google",
    contact: "google",
    media: "combine",
    hours: "google",
    reputation: "google",
  },
): UnifiedBusinessProfile {
  if (profiles.length === 0) {
    throw new Error("mergeProfiles requires at least one profile");
  }
  if (profiles.length === 1) return profiles[0];

  const byProvider = new Map<ImportProvider, UnifiedBusinessProfile>();
  for (const p of profiles) {
    byProvider.set(p.source.provider, p);
  }

  const pick = (provider: ImportProvider): UnifiedBusinessProfile | undefined =>
    byProvider.get(provider);

  const first = (field: keyof UnifiedBusinessProfile): unknown => {
    for (const p of profiles) {
      const val = p[field];
      if (val !== null && val !== undefined && val !== "") return val;
    }
    return null;
  };

  // Identity fields
  const identitySource = pick(preference.identity) || profiles[0];
  const contactSource = pick(preference.contact) || profiles[0];
  const hoursSource = pick(preference.hours) || profiles[0];
  const reputationSource = pick(preference.reputation) || profiles[0];

  // Media merge
  let photos: ImportedPhoto[];
  if (preference.media === "combine") {
    const seen = new Set<string>();
    photos = [];
    for (const p of profiles) {
      for (const photo of p.photos) {
        // Deduplicate by URL
        if (!seen.has(photo.url)) {
          seen.add(photo.url);
          photos.push(photo);
        }
      }
    }
  } else {
    const mediaSource = pick(preference.media as ImportProvider) || profiles[0];
    photos = mediaSource.photos;
  }

  // Merge amenities from all sources
  const amenities: Record<string, boolean> = {};
  for (const p of profiles) {
    Object.assign(amenities, p.amenities);
  }

  // Merge subcategories from all sources (deduplicated)
  const subcategories = [
    ...new Set(profiles.flatMap((p) => p.subcategories)),
  ];

  return {
    source: {
      provider: identitySource.source.provider,
      externalId: identitySource.source.externalId,
      importedAt: new Date(),
      rawPayload: Object.fromEntries(
        profiles.map((p) => [p.source.provider, p.source.rawPayload]),
      ),
    },

    // Identity — preferred provider, fallback to first non-null
    name: identitySource.name || (first("name") as string) || "Unknown",
    description:
      identitySource.description || (first("description") as string | null),
    category:
      identitySource.category || (first("category") as string | null),
    subcategories,

    // Location — prefer Google (usually more accurate)
    address: (first("address") as string | null),
    city: (first("city") as string | null),
    state: (first("state") as string | null),
    postalCode: (first("postalCode") as string | null),
    country: (first("country") as string | null),
    latitude: (first("latitude") as number | null),
    longitude: (first("longitude") as number | null),

    // Contact
    phone: contactSource.phone || (first("phone") as string | null),
    email: contactSource.email || (first("email") as string | null),
    websiteUrl:
      contactSource.websiteUrl || (first("websiteUrl") as string | null),

    // Social — combine from all sources
    facebookUrl: (first("facebookUrl") as string | null),
    instagramUrl: (first("instagramUrl") as string | null),
    twitterUrl: (first("twitterUrl") as string | null),

    // Media
    coverImageUrl: (first("coverImageUrl") as string | null),
    logoUrl: (first("logoUrl") as string | null),
    photos,

    // Operations
    hours: hoursSource.hours || (first("hours") as BusinessHours | null),
    priceLevel: reputationSource.priceLevel ?? (first("priceLevel") as any),
    menuUrl: (first("menuUrl") as string | null),
    orderUrl: (first("orderUrl") as string | null),
    reservationUrl: (first("reservationUrl") as string | null),

    // Reputation
    rating: reputationSource.rating ?? (first("rating") as number | null),
    reviewCount:
      reputationSource.reviewCount ??
      (first("reviewCount") as number | null),
    businessStatus:
      reputationSource.businessStatus !== "unknown"
        ? reputationSource.businessStatus
        : (first("businessStatus") as any) || "unknown",

    // Amenities — union of all
    amenities,
  };
}
