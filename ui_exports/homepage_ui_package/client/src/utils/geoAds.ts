type GeoAdPlacement = "map" | "home" | "deals";
type GeoAdEventType = "impression" | "click";

const shouldThrottle = (key: string, ms: number) => {
  if (typeof window === "undefined") return false;
  const existing = sessionStorage.getItem(key);
  const now = Date.now();
  if (existing && now - Number(existing) < ms) {
    return true;
  }
  sessionStorage.setItem(key, String(now));
  return false;
};

export const sendGeoPing = async (params: {
  lat: number;
  lng: number;
  source: GeoAdPlacement;
}) => {
  if (!Number.isFinite(params.lat) || !Number.isFinite(params.lng)) return;
  const throttleKey = `geo-ping:${params.source}`;
  if (shouldThrottle(throttleKey, 2 * 60 * 1000)) return;

  try {
    await fetch("/api/geo/ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      credentials: "include",
    });
  } catch {
    // Ignore telemetry errors
  }
};

export const trackGeoAdEvent = async (params: {
  adId: string;
  eventType: GeoAdEventType;
  placement: GeoAdPlacement;
}) => {
  if (!params.adId) return;

  try {
    await fetch("/api/geo-ads/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      credentials: "include",
    });
  } catch {
    // Ignore tracking failures
  }
};

export const trackGeoAdImpression = (params: {
  adId: string;
  placement: GeoAdPlacement;
}) => {
  const key = `geo-ad-imp:${params.adId}:${params.placement}`;
  if (shouldThrottle(key, 12 * 60 * 60 * 1000)) return;
  trackGeoAdEvent({
    adId: params.adId,
    eventType: "impression",
    placement: params.placement,
  });
};
