/**
 * googleApiCache.ts
 *
 * Persistent DB-backed cache for Google Maps API results.
 * Geocoding results and address validation results are stored in Postgres so
 * they survive server restarts and are shared across all server instances.
 *
 * The cache table is `google_api_cache` (see migrations/092_google_api_cache.sql).
 *
 * Cache types:
 *   - "forward_geocode"      address string → { lat, lng }
 *   - "reverse_geocode"      "lat:lng" key  → { city, state }
 *   - "address_validation"   address string → AddressValidationResult
 */

import { db } from "../db";
import { sql } from "drizzle-orm";

export type CacheType =
  | "forward_geocode"
  | "reverse_geocode"
  | "address_validation";

// In-process L1 cache to avoid hitting Postgres on every hot path
const l1: Map<string, { value: unknown; expiresAt: number | null }> = new Map();
let dbCacheAvailable: boolean | null = null;

function isMissingCacheTableError(error: unknown) {
  const message = String((error as any)?.message || "").toLowerCase();
  const code = String((error as any)?.code || "");
  return code === "42P01" || message.includes('relation "google_api_cache" does not exist');
}

function markDbCacheUnavailable(error: unknown) {
  if (dbCacheAvailable !== false) {
    dbCacheAvailable = false;
    console.warn(
      "[googleApiCache] DB cache table unavailable; using in-memory cache only until restart:",
      (error as any)?.message || String(error),
    );
  }
}

function l1Key(cacheType: CacheType, cacheKey: string) {
  return `${cacheType}:${cacheKey}`;
}

/**
 * Read a cached value. Returns `undefined` if not found or expired.
 */
export async function getCached<T>(
  cacheType: CacheType,
  cacheKey: string,
): Promise<T | undefined> {
  // L1 check
  const k = l1Key(cacheType, cacheKey);
  const l1Entry = l1.get(k);
  if (l1Entry) {
    if (l1Entry.expiresAt === null || l1Entry.expiresAt > Date.now()) {
      return l1Entry.value as T;
    }
    l1.delete(k);
  }

  if (dbCacheAvailable === false) {
    return undefined;
  }

  // L2 (Postgres) check
  try {
    const rows = await db.execute(
      sql`SELECT value, expires_at
          FROM google_api_cache
          WHERE cache_key = ${cacheKey}
            AND cache_type = ${cacheType}
            AND (expires_at IS NULL OR expires_at > NOW())
          LIMIT 1`,
    );
    const row = (rows as any)?.rows?.[0] ?? (Array.isArray(rows) ? rows[0] : undefined);
    if (!row) return undefined;
    const value = row.value as T;
    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
    // Populate L1
    l1.set(k, { value, expiresAt });
    dbCacheAvailable = true;
    return value;
  } catch (error: unknown) {
    if (isMissingCacheTableError(error)) {
      markDbCacheUnavailable(error);
    }
    // DB unavailable — degrade gracefully, don't block the request
    return undefined;
  }
}

/**
 * Write a value to the cache.
 * @param ttlMs  Time-to-live in milliseconds. Pass `null` for permanent entries.
 */
export async function setCached(
  cacheType: CacheType,
  cacheKey: string,
  value: unknown,
  ttlMs: number | null = null,
): Promise<void> {
  const k = l1Key(cacheType, cacheKey);
  const expiresAt = ttlMs !== null ? Date.now() + ttlMs : null;
  // Update L1 immediately
  l1.set(k, { value, expiresAt });

  if (dbCacheAvailable === false) {
    return;
  }

  // Persist to Postgres asynchronously (fire-and-forget; failures are non-fatal)
  const expiresAtIso = expiresAt ? new Date(expiresAt).toISOString() : null;
  db.execute(
    sql`INSERT INTO google_api_cache (cache_key, cache_type, value, expires_at)
        VALUES (${cacheKey}, ${cacheType}, ${JSON.stringify(value)}::jsonb, ${expiresAtIso}::timestamptz)
        ON CONFLICT (cache_key, cache_type) DO UPDATE
          SET value      = EXCLUDED.value,
              created_at = NOW(),
              expires_at = EXCLUDED.expires_at`,
  ).catch((err: unknown) => {
    if (isMissingCacheTableError(err)) {
      markDbCacheUnavailable(err);
      return;
    }
    console.warn("[googleApiCache] DB write failed (non-fatal):", (err as any)?.message);
  });
}

/**
 * Evict a specific entry from both L1 and the DB.
 */
export async function evictCached(
  cacheType: CacheType,
  cacheKey: string,
): Promise<void> {
  l1.delete(l1Key(cacheType, cacheKey));
  if (dbCacheAvailable === false) {
    return;
  }
  await db
    .execute(
      sql`DELETE FROM google_api_cache
          WHERE cache_key = ${cacheKey} AND cache_type = ${cacheType}`,
    )
    .catch((error: unknown) => {
      if (isMissingCacheTableError(error)) {
        markDbCacheUnavailable(error);
      }
    });
}
