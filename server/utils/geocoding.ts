import { getCached, setCached } from "./googleApiCache";
import { getGoogleMapsServerApiKey } from "../services/googleMapsCredentials";

type ReverseGeocodeResult = {
  city?: string;
  state?: string;
};

type ForwardGeocodeResult = {
  lat: number;
  lng: number;
};

// ─── L1 in-process caches (hot path) ─────────────────────────────────────────
const reverseL1 = new Map<string, ReverseGeocodeResult>();
type ForwardCacheEntry = { value: ForwardGeocodeResult | null; ts: number };
const forwardL1 = new Map<string, ForwardCacheEntry>();
const forwardGoogleL1 = new Map<string, ForwardCacheEntry>();

const FORWARD_FAILURE_TTL_MS = 10 * 60 * 1000;
const FORWARD_QUEUE_INTERVAL_MS = 250;
const GEOCODE_MAX_ATTEMPTS = 3;
const GEOCODE_BASE_BACKOFF_MS = 250;
let forwardQueue: Promise<void> = Promise.resolve();
let lastForwardRunAt = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const roundCoord = (value: number, digits = 3) => {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
};

const getCacheKey = (lat: number, lng: number) =>
  `${roundCoord(lat)}:${roundCoord(lng)}`;

const normalizeAddressKey = (address: string) =>
  address.trim().toLowerCase();

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const shouldRetryStatus = (status: number) =>
  status === 408 || status === 429 || status >= 500;

const getGoogleMapsApiKey = getGoogleMapsServerApiKey;

async function fetchWithBackoff(
  url: string,
  init?: RequestInit,
): Promise<Response | null> {
  let delay = GEOCODE_BASE_BACKOFF_MS;
  for (let attempt = 1; attempt <= GEOCODE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if (res.ok || !shouldRetryStatus(res.status) || attempt === GEOCODE_MAX_ATTEMPTS) {
        return res;
      }
    } catch {
      if (attempt === GEOCODE_MAX_ATTEMPTS) {
        return null;
      }
    }
    await sleep(delay);
    delay *= 2;
  }
  return null;
}

async function enqueueForwardTask<T>(task: () => Promise<T>): Promise<T> {
  const run = forwardQueue.then(async () => {
    const waitMs = Math.max(
      0,
      lastForwardRunAt + FORWARD_QUEUE_INTERVAL_MS - Date.now(),
    );
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    try {
      return await task();
    } finally {
      lastForwardRunAt = Date.now();
    }
  });

  forwardQueue = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

// ─── Provider implementations ─────────────────────────────────────────────────
const extractCityState = (data: any): ReverseGeocodeResult => {
  const address = data?.address || {};
  const city =
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.county;
  const state = address.state || address.region;
  return { city, state };
};

async function reverseWithNominatim(
  lat: number,
  lng: number,
): Promise<ReverseGeocodeResult | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
  const res = await fetchWithBackoff(url, {
    headers: {
      "User-Agent": "MealScout/1.0 (location lookup)",
      "Accept-Language": "en",
    },
  });
  if (!res?.ok) return null;
  const data = await res.json();
  return extractCityState(data);
}

async function reverseWithGoogle(
  lat: number,
  lng: number,
): Promise<ReverseGeocodeResult | null> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
  const res = await fetchWithBackoff(url);
  if (!res?.ok) return null;
  const data = await res.json();
  const result = data?.results?.[0];
  if (!result) return null;
  const components = result.address_components || [];
  const city =
    components.find((c: any) => c.types?.includes("locality"))?.long_name ||
    components.find((c: any) => c.types?.includes("administrative_area_level_2"))
      ?.long_name;
  const state = components.find((c: any) =>
    c.types?.includes("administrative_area_level_1"),
  )?.short_name;
  return { city, state };
}

async function forwardWithNominatim(
  address: string,
): Promise<ForwardGeocodeResult | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(
    address,
  )}`;
  const res = await fetchWithBackoff(url, {
    headers: {
      "User-Agent": "MealScout/1.0 (geocoding)",
      "Accept-Language": "en",
    },
  });
  if (!res?.ok) return null;
  const data = await res.json();
  const first = Array.isArray(data) ? data[0] : null;
  if (!first?.lat || !first?.lon) return null;
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

async function forwardWithCensus(
  address: string,
): Promise<ForwardGeocodeResult | null> {
  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(
    address,
  )}&benchmark=Public_AR_Current&format=json`;
  const res = await fetchWithBackoff(url);
  if (!res?.ok) return null;
  const data = await res.json();
  const match = data?.result?.addressMatches?.[0];
  const x = Number(match?.coordinates?.x);
  const y = Number(match?.coordinates?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { lat: y, lng: x };
}

async function forwardWithGoogle(
  address: string,
): Promise<ForwardGeocodeResult | null> {
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) return null;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address,
  )}&key=${apiKey}`;
  const res = await fetchWithBackoff(url);
  if (!res?.ok) return null;
  const data = await res.json();
  const result = data?.results?.[0];
  const location = result?.geometry?.location;
  if (!location) return null;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reverse geocode a lat/lng to city + state.
 * Cache hierarchy: L1 (in-process Map) → L2 (Postgres) → live API call.
 * Successful results are stored permanently (geocoding facts don't change).
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
): Promise<ReverseGeocodeResult> {
  const key = getCacheKey(lat, lng);

  // L1
  const l1Hit = reverseL1.get(key);
  if (l1Hit) return l1Hit;

  // L2 (DB)
  const dbHit = await getCached<ReverseGeocodeResult>("reverse_geocode", key);
  if (dbHit) {
    reverseL1.set(key, dbHit);
    return dbHit;
  }

  // Live: try Nominatim first (free), fall back to Google
  const nominatimResult = await reverseWithNominatim(lat, lng);
  if (nominatimResult?.city || nominatimResult?.state) {
    reverseL1.set(key, nominatimResult);
    setCached("reverse_geocode", key, nominatimResult, null); // permanent
    return nominatimResult;
  }

  const googleResult = await reverseWithGoogle(lat, lng);
  if (googleResult?.city || googleResult?.state) {
    reverseL1.set(key, googleResult);
    setCached("reverse_geocode", key, googleResult, null); // permanent
    return googleResult;
  }

  const fallback: ReverseGeocodeResult = {};
  reverseL1.set(key, fallback);
  // Don't persist empty fallbacks to DB — let them retry next time
  return fallback;
}

/**
 * Forward geocode an address string to lat/lng.
 * Cache hierarchy: L1 → L2 (DB) → live API call.
 * Successful results are stored permanently; failures are cached for 10 min (L1 only).
 */
export async function forwardGeocode(
  address: string,
  options?: { force?: boolean },
): Promise<ForwardGeocodeResult | null> {
  return enqueueForwardTask(async () => {
    const key = normalizeAddressKey(address);
    if (!key) return null;
    const force = options?.force === true;

    // L1
    if (!force) {
      const entry = forwardL1.get(key);
      if (entry) {
        if (entry.value) return entry.value;
        if (Date.now() - entry.ts < FORWARD_FAILURE_TTL_MS) return null;
        forwardL1.delete(key);
      }
    } else {
      forwardL1.delete(key);
    }

    // L2 (DB) — only for successful hits; failures are not persisted
    if (!force) {
      const dbHit = await getCached<ForwardGeocodeResult>("forward_geocode", key);
      if (dbHit) {
        forwardL1.set(key, { value: dbHit, ts: Date.now() });
        return dbHit;
      }
    }

    // Live
    const googleResult = await forwardWithGoogle(address);
    if (googleResult) {
      forwardL1.set(key, { value: googleResult, ts: Date.now() });
      setCached("forward_geocode", key, googleResult, null); // permanent
      return googleResult;
    }

    const nominatimResult = await forwardWithNominatim(address);
    if (nominatimResult) {
      forwardL1.set(key, { value: nominatimResult, ts: Date.now() });
      setCached("forward_geocode", key, nominatimResult, null); // permanent
      return nominatimResult;
    }

    const censusResult = await forwardWithCensus(address);
    if (censusResult) {
      forwardL1.set(key, { value: censusResult, ts: Date.now() });
      setCached("forward_geocode", key, censusResult, null); // permanent
      return censusResult;
    }

    // Failure — cache in L1 only, not DB
    forwardL1.set(key, { value: null, ts: Date.now() });
    return null;
  });
}

/**
 * Forward geocode using Google only (used when Nominatim/Census fallback is not desired).
 * Cache hierarchy: L1 → L2 (DB) → live Google API call.
 */
export async function forwardGeocodeGoogle(
  address: string,
  options?: { force?: boolean },
): Promise<ForwardGeocodeResult | null> {
  return enqueueForwardTask(async () => {
    const key = `google:${normalizeAddressKey(address)}`;
    if (!key) return null;
    const force = options?.force === true;

    // L1
    if (!force) {
      const entry = forwardGoogleL1.get(key);
      if (entry) {
        if (entry.value) return entry.value;
        if (Date.now() - entry.ts < FORWARD_FAILURE_TTL_MS) return null;
        forwardGoogleL1.delete(key);
      }
    } else {
      forwardGoogleL1.delete(key);
    }

    // L2 (DB)
    if (!force) {
      const dbHit = await getCached<ForwardGeocodeResult>("forward_geocode", key);
      if (dbHit) {
        forwardGoogleL1.set(key, { value: dbHit, ts: Date.now() });
        return dbHit;
      }
    }

    // Live
    const googleResult = await forwardWithGoogle(address);
    if (googleResult) {
      forwardGoogleL1.set(key, { value: googleResult, ts: Date.now() });
      setCached("forward_geocode", key, googleResult, null); // permanent
      return googleResult;
    }

    forwardGoogleL1.set(key, { value: null, ts: Date.now() });
    return null;
  });
}
