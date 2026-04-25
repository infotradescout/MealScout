/**
 * MealScout Adapter for Business Profile Import SDK
 *
 * Maps UnifiedBusinessProfile → MealScout restaurant/host schema.
 * This is the only file with MealScout-specific coupling.
 * Other consumers implement their own adapter.
 *
 * @license MIT
 */

import type {
  UnifiedBusinessProfile,
  ProfileAdapter,
  ImportProvider,
  ImportedPhoto,
} from "../types";

// ─── Restaurant Adapter ─────────────────────────────────────────────────────

type RestaurantEntity = {
  name?: string;
  address?: string;
  phone?: string;
  description?: string;
  websiteUrl?: string;
  facebookPageUrl?: string;
  instagramUrl?: string;
  xUrl?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  operatingHours?: any;
  amenities?: any;
  cuisineType?: string;
  city?: string;
  state?: string;
  latitude?: string;
  longitude?: string;
  googlePlaceId?: string;
  googleRating?: string;
  googleReviewCount?: number;
  googlePriceLevel?: number;
  googleBusinessStatus?: string;
  googlePhotos?: any;
  googleCategories?: any;
  googleFormattedPhone?: string;
  menuUrl?: string;
  orderUrl?: string;
  reservationUrl?: string;
  profileSource?: string;
  profileLastSynced?: Date;
  facebookPageId?: string;
  facebookCoverUrl?: string;
  facebookAbout?: string;
  facebookCategory?: string;
  facebookHours?: any;
  facebookPhotos?: any;
};

export class MealScoutRestaurantAdapter
  implements ProfileAdapter<RestaurantEntity>
{
  mergeStrategy: "fill_empty" | "overwrite_all" | "prefer_import" = "fill_empty";

  constructor(strategy?: "fill_empty" | "overwrite_all" | "prefer_import") {
    if (strategy) this.mergeStrategy = strategy;
  }

  toEntityUpdate(
    profile: UnifiedBusinessProfile,
    existing?: RestaurantEntity,
  ): Record<string, unknown> {
    const updates: Record<string, unknown> = {};
    const provider = profile.source.provider;

    // Determine the new profile source
    const currentSource = existing?.profileSource || "none";
    let newSource: string;
    if (currentSource === "none" || currentSource === provider) {
      newSource = provider;
    } else {
      newSource = "mixed";
    }
    updates.profileSource = newSource;
    updates.profileLastSynced = new Date();

    // Helper: only set if empty or strategy allows overwrite
    const set = (field: string, value: unknown) => {
      if (value === null || value === undefined) return;
      const existingVal = existing ? (existing as any)[field] : undefined;

      if (this.mergeStrategy === "overwrite_all") {
        updates[field] = value;
      } else if (this.mergeStrategy === "prefer_import") {
        updates[field] = value;
      } else {
        // fill_empty: only set if current value is empty/null
        if (!existingVal) {
          updates[field] = value;
        }
      }
    };

    // Always update provider-specific fields (these are "owned" by the provider)
    if (provider === "google") {
      updates.googlePlaceId = profile.source.externalId;
      if (profile.rating !== null) updates.googleRating = String(profile.rating);
      if (profile.reviewCount !== null) updates.googleReviewCount = profile.reviewCount;
      if (profile.priceLevel !== null) updates.googlePriceLevel = profile.priceLevel;
      if (profile.businessStatus !== "unknown") {
        updates.googleBusinessStatus = profile.businessStatus.toUpperCase();
      }
      if (profile.photos.length > 0) {
        updates.googlePhotos = profile.photos
          .filter((p) => p.source === "google")
          .map((p) => ({
            name: p.url, // Google photo URLs contain the resource name
            widthPx: p.width || 0,
            heightPx: p.height || 0,
            authorAttributions: p.attribution
              ? [{ displayName: p.attribution, uri: "" }]
              : [],
          }));
      }
      if (profile.subcategories.length > 0) {
        updates.googleCategories = profile.subcategories;
      }
      if (profile.phone) updates.googleFormattedPhone = profile.phone;
    }

    if (provider === "facebook") {
      updates.facebookPageId = profile.source.externalId;
      if (profile.coverImageUrl) updates.facebookCoverUrl = profile.coverImageUrl;
      if (profile.description) updates.facebookAbout = profile.description;
      if (profile.category) updates.facebookCategory = profile.category;
      if (profile.hours) updates.facebookHours = profile.hours;
      if (profile.photos.length > 0) {
        updates.facebookPhotos = profile.photos
          .filter((p) => p.source === "facebook")
          .map((p) => ({
            url: p.url,
            width: p.width,
            height: p.height,
            caption: p.caption,
          }));
      }
    }

    // Shared fields — fill_empty by default
    set("description", profile.description);
    set("phone", profile.phone);
    set("websiteUrl", profile.websiteUrl);
    set("facebookPageUrl", profile.facebookUrl);
    set("instagramUrl", profile.instagramUrl);
    set("xUrl", profile.twitterUrl);
    set("logoUrl", profile.logoUrl);
    set("coverImageUrl", profile.coverImageUrl);
    set("menuUrl", profile.menuUrl);
    set("orderUrl", profile.orderUrl);
    set("reservationUrl", profile.reservationUrl);
    set("city", profile.city);
    set("state", profile.state);

    if (profile.latitude !== null) set("latitude", String(profile.latitude));
    if (profile.longitude !== null) set("longitude", String(profile.longitude));

    // Operating hours
    if (profile.hours) {
      set("operatingHours", profile.hours);
    }

    // Amenities — merge with existing
    if (Object.keys(profile.amenities).length > 0) {
      const existingAmenities =
        typeof existing?.amenities === "object" && existing.amenities
          ? (existing.amenities as Record<string, any>)
          : {};
      updates.amenities = { ...profile.amenities, ...existingAmenities };
    }

    // Cuisine type from categories
    if (!existing?.cuisineType && profile.category) {
      updates.cuisineType = profile.category;
    }

    return updates;
  }
}

// ─── Host Adapter ───────────────────────────────────────────────────────────

type HostEntity = {
  businessName?: string;
  address?: string;
  contactPhone?: string;
  description?: string;
  businessWebsite?: string;
  city?: string;
  state?: string;
  latitude?: string;
  longitude?: string;
  googlePlaceId?: string;
  googleRating?: string;
  googleReviewCount?: number;
  googlePriceLevel?: number;
  googleBusinessStatus?: string;
  googlePhotos?: any;
  googleCategories?: any;
  googleFormattedPhone?: string;
  businessHours?: any;
  menuUrl?: string;
  amenities?: any;
  profileSource?: string;
  profileLastSynced?: Date;
  facebookPageId?: string;
  facebookPageUrl?: string;
  facebookCoverUrl?: string;
  facebookAbout?: string;
  facebookCategory?: string;
  facebookHours?: any;
  facebookPhotos?: any;
};

export class MealScoutHostAdapter implements ProfileAdapter<HostEntity> {
  mergeStrategy: "fill_empty" | "overwrite_all" | "prefer_import" = "fill_empty";

  constructor(strategy?: "fill_empty" | "overwrite_all" | "prefer_import") {
    if (strategy) this.mergeStrategy = strategy;
  }

  toEntityUpdate(
    profile: UnifiedBusinessProfile,
    existing?: HostEntity,
  ): Record<string, unknown> {
    const updates: Record<string, unknown> = {};
    const provider = profile.source.provider;

    const currentSource = existing?.profileSource || "none";
    let newSource: string;
    if (currentSource === "none" || currentSource === provider) {
      newSource = provider;
    } else {
      newSource = "mixed";
    }
    updates.profileSource = newSource;
    updates.profileLastSynced = new Date();

    const set = (field: string, value: unknown) => {
      if (value === null || value === undefined) return;
      const existingVal = existing ? (existing as any)[field] : undefined;
      if (this.mergeStrategy === "overwrite_all" || this.mergeStrategy === "prefer_import") {
        updates[field] = value;
      } else if (!existingVal) {
        updates[field] = value;
      }
    };

    // Google-specific
    if (provider === "google") {
      updates.googlePlaceId = profile.source.externalId;
      if (profile.rating !== null) updates.googleRating = String(profile.rating);
      if (profile.reviewCount !== null) updates.googleReviewCount = profile.reviewCount;
      if (profile.priceLevel !== null) updates.googlePriceLevel = profile.priceLevel;
      if (profile.businessStatus !== "unknown") {
        updates.googleBusinessStatus = profile.businessStatus.toUpperCase();
      }
      if (profile.photos.length > 0) {
        updates.googlePhotos = profile.photos
          .filter((p) => p.source === "google")
          .map((p) => ({
            name: p.url,
            widthPx: p.width || 0,
            heightPx: p.height || 0,
            authorAttributions: p.attribution
              ? [{ displayName: p.attribution, uri: "" }]
              : [],
          }));
      }
      if (profile.subcategories.length > 0) {
        updates.googleCategories = profile.subcategories;
      }
      if (profile.phone) updates.googleFormattedPhone = profile.phone;
    }

    // Facebook-specific
    if (provider === "facebook") {
      updates.facebookPageId = profile.source.externalId;
      if (profile.facebookUrl) updates.facebookPageUrl = profile.facebookUrl;
      if (profile.coverImageUrl) updates.facebookCoverUrl = profile.coverImageUrl;
      if (profile.description) updates.facebookAbout = profile.description;
      if (profile.category) updates.facebookCategory = profile.category;
      if (profile.hours) updates.facebookHours = profile.hours;
      if (profile.photos.length > 0) {
        updates.facebookPhotos = profile.photos
          .filter((p) => p.source === "facebook")
          .map((p) => ({
            url: p.url,
            width: p.width,
            height: p.height,
            caption: p.caption,
          }));
      }
    }

    // Shared fields
    set("description", profile.description);
    set("contactPhone", profile.phone);
    set("businessWebsite", profile.websiteUrl);
    set("city", profile.city);
    set("state", profile.state);
    if (profile.latitude !== null) set("latitude", String(profile.latitude));
    if (profile.longitude !== null) set("longitude", String(profile.longitude));

    if (profile.hours) {
      set("businessHours", profile.hours);
    }

    set("menuUrl", profile.menuUrl);

    if (Object.keys(profile.amenities).length > 0) {
      const existingAmenities =
        typeof existing?.amenities === "object" && existing.amenities
          ? (existing.amenities as Record<string, any>)
          : {};
      updates.amenities = { ...profile.amenities, ...existingAmenities };
    }

    return updates;
  }
}

// ─── Photo Import Helper ────────────────────────────────────────────────────

/**
 * Convert imported photos into business_photos insert rows.
 * This is used after fetching a profile to populate the gallery.
 */
export function toBusinessPhotoInserts(
  photos: ImportedPhoto[],
  opts: {
    restaurantId?: string;
    hostId?: string;
    uploadedByUserId: string;
    maxPhotos?: number;
  },
): Array<{
  restaurantId: string | null;
  hostId: string | null;
  uploadedByUserId: string;
  url: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  sortOrder: number;
  source: string;
  sourceProvider: string;
  isFeatured: boolean;
}> {
  const limit = opts.maxPhotos ?? 50;

  return photos.slice(0, limit).map((photo, idx) => ({
    restaurantId: opts.restaurantId || null,
    hostId: opts.hostId || null,
    uploadedByUserId: opts.uploadedByUserId,
    url: photo.url,
    width: photo.width,
    height: photo.height,
    caption: photo.caption,
    sortOrder: idx,
    source: "import",
    sourceProvider: photo.source,
    isFeatured: idx === 0, // First photo is featured by default
  }));
}
