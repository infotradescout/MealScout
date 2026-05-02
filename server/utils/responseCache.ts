import type { NextFunction, Request, RequestHandler, Response } from "express";
import Redis from "ioredis";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type CachedResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const DEFAULT_MAX_ENTRIES =
  Number(process.env.RESPONSE_CACHE_MAX_ENTRIES || 500) || 500;
const KEY_PREFIX = String(process.env.REDIS_KEY_PREFIX || "mealscout").replace(
  /:+$/,
  "",
);
const redisUrl = String(process.env.REDIS_URL || "").trim();

const l1Cache = new Map<string, CacheEntry<string>>();
let redisClient: Redis | null = null;
let redisReady = false;
let redisLastError: string | null = null;

const stats = {
  hits: 0,
  misses: 0,
  sets: 0,
  bypasses: 0,
  errors: 0,
  redisHits: 0,
  l1Hits: 0,
};

function getRedisClient() {
  if (!redisUrl) return null;
  if (redisClient) return redisClient;

  redisClient = new Redis(redisUrl, {
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 750) || 750,
    commandTimeout: Number(process.env.REDIS_COMMAND_TIMEOUT_MS || 750) || 750,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
  });

  redisClient.on("ready", () => {
    redisReady = true;
    redisLastError = null;
    console.log("[cache] Redis response cache connected");
  });
  redisClient.on("error", (error) => {
    redisReady = false;
    redisLastError = error?.message || String(error);
    stats.errors += 1;
    console.warn("[cache] Redis response cache unavailable:", redisLastError);
  });
  redisClient.on("end", () => {
    redisReady = false;
  });

  return redisClient;
}

function normalizeKey(key: string) {
  return `${KEY_PREFIX}:response:${key}`;
}

function pruneL1() {
  if (l1Cache.size <= DEFAULT_MAX_ENTRIES) return;
  const overflow = l1Cache.size - DEFAULT_MAX_ENTRIES;
  const keys = l1Cache.keys();
  for (let i = 0; i < overflow; i += 1) {
    const next = keys.next();
    if (next.done) return;
    l1Cache.delete(next.value);
  }
}

async function getRaw(key: string): Promise<string | null> {
  const now = Date.now();
  const redis = getRedisClient();
  const cacheKey = normalizeKey(key);

  if (redis && redisReady) {
    try {
      const value = await redis.get(cacheKey);
      if (value !== null) {
        stats.hits += 1;
        stats.redisHits += 1;
        return value;
      }
    } catch (error: any) {
      stats.errors += 1;
      redisLastError = error?.message || String(error);
    }
  }

  const l1 = l1Cache.get(cacheKey);
  if (l1 && l1.expiresAt > now) {
    stats.hits += 1;
    stats.l1Hits += 1;
    return l1.value;
  }
  if (l1) l1Cache.delete(cacheKey);

  stats.misses += 1;
  return null;
}

async function setRaw(key: string, value: string, ttlSeconds: number) {
  const cacheKey = normalizeKey(key);
  const ttlMs = ttlSeconds * 1000;
  l1Cache.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
  pruneL1();
  stats.sets += 1;

  const redis = getRedisClient();
  if (!redis || !redisReady) return;

  try {
    await redis.set(cacheKey, value, "EX", ttlSeconds);
  } catch (error: any) {
    stats.errors += 1;
    redisLastError = error?.message || String(error);
  }
}

function routeTtlSeconds(path: string): number | null {
  if (path === "/api/restaurants/public") return 60;
  if (path.startsWith("/api/restaurants/nearby/")) return 45;
  if (path === "/api/restaurants/search") return 45;
  if (
    path === "/api/search" ||
    path === "/api/search/trending" ||
    path === "/api/search/latest" ||
    path.startsWith("/api/search/suggestions/")
  )
    return 45;
  if (path.startsWith("/api/deals/nearby/")) return 45;
  if (
    path === "/api/deals/active" ||
    path === "/api/deals/featured" ||
    path === "/api/deals/search"
  )
    return 60;
  if (path.startsWith("/api/deals/restaurant/")) return 60;
  if (path.startsWith("/api/menus/")) return 30;
  if (path === "/api/map/locations" || path === "/api/map/overlays") return 30;
  if (path === "/api/parking-pass/host-status") return 60;
  if (path.startsWith("/api/map/place-")) return 300;
  if (path.startsWith("/api/public/discovery/")) return 120;
  if (path.startsWith("/api/public/profiles/")) return 120;
  if (path.startsWith("/api/public/evidence/")) return 120;
  if (path.startsWith("/api/public/deals/city/")) return 120;
  if (path === "/api/cities" || path.startsWith("/api/cities/")) return 300;
  return null;
}

function isCookieSafePublicPath(path: string) {
  return (
    path === "/api/map/locations" ||
    path === "/api/map/overlays" ||
    path === "/api/search/trending" ||
    path === "/api/search/latest" ||
    path === "/api/parking-pass/host-status" ||
    path.startsWith("/api/deals/nearby/")
  );
}

function roundedNumberString(value: unknown, digits: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(value ?? "");
  return parsed.toFixed(digits);
}

function stableQueryString(params: URLSearchParams) {
  const entries = Array.from(params.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const stable = new URLSearchParams();
  entries.forEach(([key, value]) => stable.append(key, value));
  const query = stable.toString();
  return query ? `?${query}` : "";
}

function cacheKeyForRequest(req: Request) {
  const path = req.path;
  const method = req.method;

  const nearbyMatch = path.match(/^\/api\/deals\/nearby\/([^/]+)\/([^/]+)$/);
  if (nearbyMatch) {
    const radius = roundedNumberString((req.query as any)?.radius ?? 5, 1);
    return `${method}:/api/deals/nearby/${roundedNumberString(
      nearbyMatch[1],
      2,
    )}/${roundedNumberString(nearbyMatch[2], 2)}?radius=${radius}`;
  }

  if (path === "/api/search/trending") {
    const params = new URLSearchParams();
    params.set("limit", String((req.query as any)?.limit ?? 8));
    params.set("windowDays", String((req.query as any)?.windowDays ?? 7));
    params.set(
      "radiusKm",
      roundedNumberString((req.query as any)?.radiusKm ?? 25, 0),
    );
    const interest = String((req.query as any)?.interest || "").trim();
    if (interest) params.set("interest", interest.toLowerCase());
    if ((req.query as any)?.lat !== undefined) {
      params.set("lat", roundedNumberString((req.query as any).lat, 2));
    }
    if ((req.query as any)?.lng !== undefined) {
      params.set("lng", roundedNumberString((req.query as any).lng, 2));
    }
    return `${method}:${path}${stableQueryString(params)}`;
  }

  if (path === "/api/map/overlays") {
    const params = new URLSearchParams();
    ["north", "south", "east", "west"].forEach((key) => {
      if ((req.query as any)?.[key] !== undefined) {
        params.set(key, roundedNumberString((req.query as any)[key], 3));
      }
    });
    if ((req.query as any)?.zoom !== undefined) {
      params.set("zoom", roundedNumberString((req.query as any).zoom, 1));
    }
    return `${method}:${path}${stableQueryString(params)}`;
  }

  if (path === "/api/parking-pass/host-status") {
    const params = new URLSearchParams();
    if ((req.query as any)?.date !== undefined) {
      params.set("date", String((req.query as any).date));
    }
    return `${method}:${path}${stableQueryString(params)}`;
  }

  return `${method}:${req.originalUrl || req.url}`;
}

function shouldBypass(req: Request) {
  if (req.method !== "GET" && req.method !== "HEAD") return "method";
  if (req.headers.authorization) return "authorization";
  if (req.headers.cookie && !isCookieSafePublicPath(req.path)) return "cookie";
  if (String(req.headers.accept || "").includes("text/event-stream"))
    return "stream";
  return null;
}

export function publicResponseCache(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const bypassReason = shouldBypass(req);
    const ttlSeconds = routeTtlSeconds(req.path);
    if (bypassReason || !ttlSeconds) {
      stats.bypasses += 1;
      return next();
    }

    const cacheKey = cacheKeyForRequest(req);
    try {
      const cachedRaw = await getRaw(cacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as CachedResponse;
        res.setHeader("X-MealScout-Cache", "HIT");
        res.setHeader(
          "Cache-Control",
          `public, max-age=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`,
        );
        Object.entries(cached.headers).forEach(([name, value]) => {
          if (value) res.setHeader(name, value);
        });
        return res.status(cached.statusCode).send(cached.body);
      }
    } catch {
      stats.errors += 1;
    }

    const originalSend = res.send.bind(res);
    res.send = ((body?: any) => {
      if (res.statusCode === 200 && body !== undefined) {
        const contentType = String(res.getHeader("content-type") || "");
        const isCacheableType =
          !contentType ||
          contentType.includes("application/json") ||
          contentType.includes("text/plain");
        const bodyText = Buffer.isBuffer(body)
          ? body.toString("utf8")
          : String(body);
        const maxBytes =
          Number(process.env.RESPONSE_CACHE_MAX_BYTES || 512_000) || 512_000;
        if (
          isCacheableType &&
          Buffer.byteLength(bodyText, "utf8") <= maxBytes
        ) {
          const cached: CachedResponse = {
            statusCode: res.statusCode,
            headers: {
              "content-type": contentType,
            },
            body: bodyText,
          };
          res.setHeader("X-MealScout-Cache", "MISS");
          res.setHeader(
            "Cache-Control",
            `public, max-age=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 2}`,
          );
          void setRaw(cacheKey, JSON.stringify(cached), ttlSeconds);
        }
      }
      return originalSend(body);
    }) as Response["send"];

    return next();
  };
}

export function getResponseCacheSnapshot() {
  return {
    redisConfigured: Boolean(redisUrl),
    redisReady,
    redisLastError,
    l1Entries: l1Cache.size,
    maxEntries: DEFAULT_MAX_ENTRIES,
    stats: { ...stats },
  };
}
