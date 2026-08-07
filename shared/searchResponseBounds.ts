/**
 * Release-matrix bounds for public search / live-truck discovery responses.
 *
 * Evidence (Render MealScout, 2026-08-02): Facebook in-app autocomplete storms
 * hit GET /api/search?q=Hu…Hungry brothers with responseTimeMS 2–14s; several
 * requests 502'd while the instance was wedged. GET /api/trucks/live failed
 * collaterally (3–6ms proxy 502s) during the same burst.
 *
 * #331 capped result counts. This module also provides fail-fast deadlines and
 * runtime JSON clamps so hung full-table work cannot pin the process until the
 * proxy emits 502.
 */

export const AGGREGATE_SEARCH_RESTAURANT_CANDIDATE_LIMIT = 80;
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

/** Fail-fast deadlines for public discovery routes. */
export const PUBLIC_SEARCH_TIMEOUT_MS = 5_000;
export const PUBLIC_LIVE_TRUCKS_TIMEOUT_MS = 4_000;

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

export type BoundedJsonResult<T> = {
  value: T;
  bytes: number;
  truncated: boolean;
};

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

export async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const ms = Math.max(1, Math.floor(timeoutMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isDeadlineError(error: unknown): boolean {
  return error instanceof Error && /\btimed out after\b/i.test(error.message);
}

type SearchBucketKey =
  | "restaurants"
  | "deals"
  | "parkingPassHosts"
  | "videos"
  | "events";

const SEARCH_TRIM_ORDER: SearchBucketKey[] = [
  "videos",
  "events",
  "parkingPassHosts",
  "deals",
  "restaurants",
];

/**
 * Shrink array buckets (least-critical first) until the JSON payload fits
 * under maxBytes. Never invents rows — only drops from the end of each bucket.
 */
export function clampJsonByBucketArrays<T extends Record<string, unknown>>(
  payload: T,
  maxBytes: number,
  bucketKeys: readonly SearchBucketKey[] = SEARCH_TRIM_ORDER,
): BoundedJsonResult<T> {
  const clone =
    typeof structuredClone === "function"
      ? (structuredClone(payload) as T)
      : (JSON.parse(JSON.stringify(payload)) as T);
  let bytes = jsonUtf8ByteLength(clone);
  if (bytes <= maxBytes) {
    return { value: clone, bytes, truncated: false };
  }

  let truncated = false;
  for (const key of bucketKeys) {
    const bucket = clone[key];
    if (!Array.isArray(bucket) || bucket.length === 0) continue;
    while (bucket.length > 0 && bytes > maxBytes) {
      bucket.pop();
      truncated = true;
      bytes = jsonUtf8ByteLength(clone);
    }
    if (bytes <= maxBytes) break;
  }

  return { value: clone, bytes, truncated };
}

export function clampArrayToMaxBytes<T>(
  items: T[],
  maxItems: number,
  maxBytes: number,
  wrap: (items: T[]) => unknown,
): BoundedJsonResult<T[]> {
  let next = items.slice(0, Math.max(0, maxItems));
  let wrapped = wrap(next);
  let bytes = jsonUtf8ByteLength(wrapped);
  let truncated = items.length > next.length;

  while (next.length > 0 && bytes > maxBytes) {
    next = next.slice(0, next.length - 1);
    truncated = true;
    wrapped = wrap(next);
    bytes = jsonUtf8ByteLength(wrapped);
  }

  return { value: next, bytes, truncated };
}
