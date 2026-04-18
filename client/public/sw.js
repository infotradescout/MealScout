/* Lightweight service worker for installability + basic offline fallback.
   Uses network-first for navigations and hashed assets to avoid chunk/version mismatches after deploys. */

const VERSION = "2026-04-18-1";
const CACHE_NAME = `mealscout-sw-${VERSION}`;
const APP_SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/favicon.ico",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
];

self.addEventListener("install", (event) => {
  // Activate new SW quickly.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL_URLS).catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("mealscout-sw-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

const isSameOrigin = (url) => {
  try {
    return url.origin === self.location.origin;
  } catch {
    return false;
  }
};

const isHashedAsset = (pathname) =>
  pathname.includes("/assets/") && /-[A-Za-z0-9_]{8,}\.(js|css|png|jpg|jpeg|webp|svg)$/.test(pathname);

const isCacheableAssetResponse = (res) => {
  if (!res || !res.ok) return false;
  const contentType = String(res.headers.get("content-type") || "").toLowerCase();
  // Never cache HTML for asset requests; that's how chunk mismatches poison cache.
  if (contentType.includes("text/html")) return false;
  return (
    contentType.includes("javascript") ||
    contentType.includes("ecmascript") ||
    contentType.includes("css") ||
    contentType.startsWith("image/")
  );
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (!isSameOrigin(url)) return;

  // Network-first for navigations (avoid stale HTML).
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put("/index.html", res.clone()).catch(() => undefined);
          return res;
        } catch {
          const cached = await caches.match("/index.html");
          if (cached) return cached;
          return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })(),
    );
    return;
  }

  // Network-first for hashed assets. Fallback to cache only if offline/network fails.
  // This prevents stale chunk graphs after a new deploy.
  if (isHashedAsset(url.pathname)) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (isCacheableAssetResponse(res)) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(req, res.clone()).catch(() => undefined);
          }
          return res;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          throw new Error("asset_fetch_failed");
        }
      })(),
    );
    return;
  }
});
