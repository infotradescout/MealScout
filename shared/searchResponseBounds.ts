/**
 * Release-matrix bounds for public search / live-truck discovery responses.
 *
 * Chosen to keep Facebook in-app / mobile proxy responses well under the
 * multi-MB, multi-second payloads seen in Aug 2026 Render 502 clusters, while
 * still fitting the existing Scout/search UI bucket sizes.
 */
export const AGGREGATE_SEARCH_RESTAURANT_LIMIT = 24;
export const AGGREGATE_SEARCH_DEAL_LIMIT = 12;
export const AGGREGATE_SEARCH_HOST_LIMIT = 12;
export const AGGREGATE_SEARCH_VIDEO_LIMIT = 12;
export const AGGREGATE_SEARCH_EVENT_LIMIT = 12;

/** Hard cap for GET /api/restaurants/search (was previously unbounded). */
export const RESTAURANT_SEARCH_RESULT_LIMIT = 48;

/** Default / hard max for GET /api/trucks/live (client may request up to this). */
export const LIVE_TRUCKS_DEFAULT_LIMIT = 100;
export const LIVE_TRUCKS_MAX_LIMIT = 200;

/**
 * Serialized UTF-8 JSON ceiling for aggregate + restaurant search responses.
 * 256 KiB is large enough for capped UI buckets with long descriptions, but
 * fails closed on unbounded listing dumps.
 */
export const MAX_SEARCH_RESPONSE_BYTES = 256 * 1024;

/**
 * Live-truck responses carry fuller restaurant rows; allow a slightly higher
 * ceiling at the hard truck cap.
 */
export const MAX_LIVE_TRUCKS_RESPONSE_BYTES = 512 * 1024;

/** Synthetic assemble/serialize budget for offline bound proofs (not DB I/O). */
export const MAX_SEARCH_ASSEMBLE_MS = 100;

export function jsonUtf8ByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function clampLiveTrucksLimit(raw: unknown): number {
  const parsed = Number.parseInt(
    String(raw ?? LIVE_TRUCKS_DEFAULT_LIMIT),
    10,
  );
  if (!Number.isFinite(parsed)) return LIVE_TRUCKS_DEFAULT_LIMIT;
  return Math.max(1, Math.min(LIVE_TRUCKS_MAX_LIMIT, parsed));
}
