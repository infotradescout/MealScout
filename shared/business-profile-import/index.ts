/**
 * Business Profile Import SDK
 *
 * A portable, provider-agnostic toolkit for importing business profile data
 * from external platforms (Google Places, Facebook Pages, and more).
 *
 * Usage:
 *   import { ImportManager, GooglePlacesProvider, FacebookPagesProvider } from './business-profile-import';
 *
 *   const manager = new ImportManager();
 *   manager.registerProvider(new GooglePlacesProvider({ apiKey: '...' }));
 *   manager.registerProvider(new FacebookPagesProvider({ appId: '...', appSecret: '...' }));
 *
 *   const results = await manager.search({ name: 'Taco Truck', city: 'Austin' });
 *   const profile = await manager.fetchProfile('google', 'ChIJ...');
 *
 * @license MIT
 * @version 1.0.0
 */

// Types
export type {
  ImportProvider,
  ImportSourceMeta,
  UnifiedBusinessProfile,
  ImportedPhoto,
  DayHours,
  BusinessHours,
  PriceLevel,
  BusinessStatus,
  ImportProviderDriver,
  BusinessSearchQuery,
  BusinessSearchResult,
  ProfileAdapter,
  ImportResult,
  MergePreference,
} from "./types";

export { DEFAULT_MERGE_PREFERENCE } from "./types";

// Providers
export { GooglePlacesProvider } from "./providers/google";
export type { GoogleProviderConfig } from "./providers/google";

export { FacebookPagesProvider } from "./providers/facebook";
export type {
  FacebookProviderConfig,
  FacebookPageToken,
} from "./providers/facebook";

// Core
export { mergeProfiles } from "./core/merge";

// ── Import Manager ──────────────────────────────────────────────────────

import type {
  ImportProvider,
  ImportProviderDriver,
  BusinessSearchQuery,
  BusinessSearchResult,
  UnifiedBusinessProfile,
  ImportResult,
  ProfileAdapter,
  MergePreference,
} from "./types";
import { DEFAULT_MERGE_PREFERENCE } from "./types";
import { mergeProfiles } from "./core/merge";

/**
 * Central orchestrator for business profile imports.
 * Register providers, search across all of them, fetch profiles,
 * and apply adapters to map data into your application schema.
 */
export class ImportManager {
  private providers = new Map<ImportProvider, ImportProviderDriver>();

  /**
   * Register an import provider (Google, Facebook, etc.)
   */
  registerProvider(provider: ImportProviderDriver): void {
    this.providers.set(provider.providerId, provider);
  }

  /**
   * Get a registered provider by ID.
   */
  getProvider(providerId: ImportProvider): ImportProviderDriver | undefined {
    return this.providers.get(providerId);
  }

  /**
   * List all registered provider IDs.
   */
  listProviders(): ImportProvider[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Search for a business across all registered providers.
   * Returns combined results sorted by confidence.
   */
  async search(query: BusinessSearchQuery): Promise<BusinessSearchResult[]> {
    const allResults: BusinessSearchResult[] = [];

    const searches = Array.from(this.providers.values()).map(
      async (provider) => {
        try {
          const results = await provider.search(query);
          allResults.push(...results);
        } catch (err) {
          console.error(
            `[ImportManager] Search failed for ${provider.providerId}:`,
            err,
          );
        }
      },
    );

    await Promise.all(searches);

    // Sort by confidence descending
    return allResults.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Fetch a full profile from a specific provider.
   */
  async fetchProfile(
    providerId: ImportProvider,
    externalId: string,
  ): Promise<UnifiedBusinessProfile | null> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      console.error(
        `[ImportManager] Provider "${providerId}" not registered`,
      );
      return null;
    }

    return provider.fetchProfile(externalId);
  }

  /**
   * Import a profile and apply an adapter to map it to your schema.
   * Returns an ImportResult with details about what was imported.
   */
  async importAndAdapt<TEntity>(
    providerId: ImportProvider,
    externalId: string,
    adapter: ProfileAdapter<TEntity>,
    existingEntity?: TEntity,
  ): Promise<ImportResult> {
    const start = Date.now();

    try {
      const profile = await this.fetchProfile(providerId, externalId);
      if (!profile) {
        return {
          success: false,
          provider: providerId,
          externalId,
          profile: null,
          fieldsImported: [],
          fieldsSkipped: [],
          error: "Failed to fetch profile from provider",
          durationMs: Date.now() - start,
        };
      }

      const updates = adapter.toEntityUpdate(profile, existingEntity);
      const fieldsImported = Object.keys(updates).filter(
        (k) => updates[k] !== null && updates[k] !== undefined,
      );
      const fieldsSkipped: string[] = [];

      // Track which fields were skipped due to existing data
      if (
        adapter.mergeStrategy === "fill_empty" &&
        existingEntity &&
        typeof existingEntity === "object"
      ) {
        for (const [key, value] of Object.entries(updates)) {
          const existing = (existingEntity as any)[key];
          if (existing && value) {
            fieldsSkipped.push(key);
          }
        }
      }

      return {
        success: true,
        provider: providerId,
        externalId,
        profile,
        fieldsImported,
        fieldsSkipped,
        error: null,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        provider: providerId,
        externalId,
        profile: null,
        fieldsImported: [],
        fieldsSkipped: [],
        error: String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Import from multiple providers and merge into a single profile.
   * Useful for combining Google + Facebook data.
   */
  async importAndMerge(
    sources: Array<{ providerId: ImportProvider; externalId: string; accessToken?: string }>,
    preference?: MergePreference,
  ): Promise<{
    merged: UnifiedBusinessProfile | null;
    individual: Array<{
      provider: ImportProvider;
      profile: UnifiedBusinessProfile | null;
      error: string | null;
    }>;
  }> {
    const individual: Array<{
      provider: ImportProvider;
      profile: UnifiedBusinessProfile | null;
      error: string | null;
    }> = [];

    const fetches = sources.map(async (source) => {
      try {
        const profile = await this.fetchProfile(
          source.providerId,
          source.externalId,
        );
        individual.push({
          provider: source.providerId,
          profile,
          error: profile ? null : "Failed to fetch",
        });
      } catch (err) {
        individual.push({
          provider: source.providerId,
          profile: null,
          error: String(err),
        });
      }
    });

    await Promise.all(fetches);

    const successfulProfiles = individual
      .filter((r) => r.profile !== null)
      .map((r) => r.profile!);

    if (successfulProfiles.length === 0) {
      return { merged: null, individual };
    }

    const merged = mergeProfiles(
      successfulProfiles,
      preference || DEFAULT_MERGE_PREFERENCE,
    );

    return { merged, individual };
  }
}
