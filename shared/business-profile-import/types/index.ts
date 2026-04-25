/**
 * Business Profile Import SDK — Type Definitions
 *
 * Portable, provider-agnostic types for importing business profile data
 * from external platforms (Google Places, Facebook Pages, Yelp, etc.)
 *
 * Zero coupling to any specific application schema.
 * Consumers map UnifiedBusinessProfile → their own DB schema via adapters.
 *
 * @license MIT
 * @version 1.0.0
 */

// ─── Provider Identity ──────────────────────────────────────────────────────

export type ImportProvider = "google" | "facebook" | "yelp" | "manual";

export type ImportSourceMeta = {
  provider: ImportProvider;
  externalId: string; // Google Place ID, Facebook Page ID, Yelp Business ID
  importedAt: Date;
  rawPayload?: unknown; // Original API response for debugging
};

// ─── Unified Business Profile ───────────────────────────────────────────────

/**
 * The canonical output of any import provider.
 * Every provider normalizes its data into this shape.
 * Consumers never touch provider-specific types.
 */
export type UnifiedBusinessProfile = {
  source: ImportSourceMeta;

  // Identity
  name: string;
  description: string | null;
  category: string | null; // Primary category (e.g., "Restaurant", "Bar & Grill")
  subcategories: string[]; // Additional categories/tags

  // Location
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;

  // Contact
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;

  // Social links
  facebookUrl: string | null;
  instagramUrl: string | null;
  twitterUrl: string | null;

  // Media
  coverImageUrl: string | null;
  logoUrl: string | null;
  photos: ImportedPhoto[];

  // Operations
  hours: BusinessHours | null;
  priceLevel: PriceLevel | null;
  menuUrl: string | null;
  orderUrl: string | null;
  reservationUrl: string | null;

  // Reputation
  rating: number | null; // 0-5 scale, normalized
  reviewCount: number | null;
  businessStatus: BusinessStatus;

  // Capabilities / amenities
  amenities: Record<string, boolean>;
};

// ─── Sub-types ──────────────────────────────────────────────────────────────

export type ImportedPhoto = {
  url: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  attribution: string | null;
  source: ImportProvider;
};

export type DayHours = {
  open: string; // "HH:MM" 24h format
  close: string; // "HH:MM" 24h format
};

export type BusinessHours = {
  monday: DayHours[] | null;
  tuesday: DayHours[] | null;
  wednesday: DayHours[] | null;
  thursday: DayHours[] | null;
  friday: DayHours[] | null;
  saturday: DayHours[] | null;
  sunday: DayHours[] | null;
  isAlwaysOpen?: boolean;
  timezone?: string;
};

export type PriceLevel = 0 | 1 | 2 | 3 | 4; // Free, $, $$, $$$, $$$$

export type BusinessStatus =
  | "operational"
  | "closed_temporarily"
  | "closed_permanently"
  | "unknown";

// ─── Provider Interface ─────────────────────────────────────────────────────

/**
 * Every import provider implements this interface.
 * The SDK ships with Google and Facebook; consumers can add their own.
 */
export interface ImportProviderDriver {
  readonly providerId: ImportProvider;
  readonly displayName: string;

  /**
   * Search for a business by name + location.
   * Returns candidates the user can pick from.
   */
  search(query: BusinessSearchQuery): Promise<BusinessSearchResult[]>;

  /**
   * Fetch full profile data for a specific external business ID.
   */
  fetchProfile(externalId: string): Promise<UnifiedBusinessProfile | null>;
}

export type BusinessSearchQuery = {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
};

export type BusinessSearchResult = {
  externalId: string;
  name: string;
  address: string | null;
  rating: number | null;
  reviewCount: number | null;
  category: string | null;
  provider: ImportProvider;
  confidence: number; // 0-1, how likely this is the right match
};

// ─── Adapter Interface ──────────────────────────────────────────────────────

/**
 * Maps a UnifiedBusinessProfile to your application's database schema.
 * MealScout implements one; your app implements another.
 */
export interface ProfileAdapter<TEntity = unknown> {
  /**
   * Convert a unified profile into your app's entity shape.
   * Returns a partial update object suitable for your ORM.
   */
  toEntityUpdate(
    profile: UnifiedBusinessProfile,
    existingEntity?: TEntity,
  ): Record<string, unknown>;

  /**
   * Determine which fields from the import should overwrite existing data.
   * Default: only fill empty fields, never overwrite manual edits.
   */
  mergeStrategy?: "fill_empty" | "overwrite_all" | "prefer_import" | "custom";

  /**
   * Custom merge logic (when mergeStrategy is "custom").
   * Called per-field to decide whether to use the imported value.
   */
  shouldOverwrite?: (
    fieldName: string,
    importedValue: unknown,
    existingValue: unknown,
  ) => boolean;
}

// ─── Import Result ──────────────────────────────────────────────────────────

export type ImportResult = {
  success: boolean;
  provider: ImportProvider;
  externalId: string | null;
  profile: UnifiedBusinessProfile | null;
  fieldsImported: string[];
  fieldsSkipped: string[]; // Fields that already had data
  error: string | null;
  durationMs: number;
};

// ─── Multi-Source Merge ─────────────────────────────────────────────────────

/**
 * When importing from multiple sources (Google + Facebook),
 * this defines how to merge conflicting fields.
 */
export type MergePreference = {
  /** Which provider's data wins for each field category */
  identity: ImportProvider; // name, description
  contact: ImportProvider; // phone, email, website
  media: "combine" | ImportProvider; // photos: merge all or pick one source
  hours: ImportProvider; // operating hours
  reputation: ImportProvider; // rating, reviews
};

export const DEFAULT_MERGE_PREFERENCE: MergePreference = {
  identity: "google",
  contact: "google",
  media: "combine",
  hours: "google",
  reputation: "google",
};
