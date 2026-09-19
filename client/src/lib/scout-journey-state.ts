import type { ScoutSearchFilterId } from "@/components/scout/ScoutSearchDock";
import type { ScoutSceneId } from "@/features/scout/scoutTypes";
import { normalizeSafeInternalPath } from "@shared/safeInternalPath";

export type ScoutJourney = {
  route: string;
  search: { open: boolean; query: string; filter: ScoutSearchFilterId | null };
  scene: ScoutSceneId;
  craving: string;
  radiusKm: number;
  layers: { openNow: boolean; foodTrucks: boolean; deals: boolean; happeningToday: boolean };
  map: { center: { lat: number; lng: number } | null; zoom: number; expanded: boolean; selectedMarkerId: string | null };
  scrollY: number;
};
export const SCOUT_JOURNEY_TTL_MS = 30 * 60_000;
const prefix = "mealscout:scout-journey:v1:";
const filters = new Set(["now", "trucks", "restaurants", "dishes", "deals", "happy_hour", "events", "community", "new", "best"]);
const scenes = new Set(["for_you", "community", "nearby_now", "food_trucks", "restaurants", "deals", "events", "new_menus", "late_night", "worth_discovering"]);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

export function scoutJourneyRoute(value: unknown): string | null {
  if (!text(value, 2048)) return null;
  const safe = normalizeSafeInternalPath(value);
  if (!safe) return null;
  const url = new URL(safe, "https://scout.invalid");
  if (!/^\/(?:scout(?:\/[a-zA-Z0-9_-]{1,100})?|map)\/?$/.test(url.pathname)) return null;
  // Keep attribution/preview context, never OAuth codes, tokens or arbitrary destinations.
  for (const key of [...url.searchParams.keys()]) {
    if (!["ref", "source", "utm_source", "utm_medium", "utm_campaign", "scoutPreview", "previewCity"].includes(key)) url.searchParams.delete(key);
  }
  return url.pathname + url.search;
}

export function normalizeScoutJourney(value: unknown): ScoutJourney | null {
  if (!isRecord(value)) return null;
  const route = scoutJourneyRoute(value.route);
  const { search, layers, map } = value;
  if (!route || !isRecord(search) || !isRecord(layers) || !isRecord(map)) return null;
  if (typeof search.open !== "boolean" || !text(search.query, 300)) return null;
  if (search.filter !== null && (!text(search.filter, 30) || !filters.has(search.filter))) return null;
  if (!text(value.scene, 40) || !scenes.has(value.scene) || !text(value.craving, 100)) return null;
  if (!finite(value.radiusKm, 1, 1000) || !finite(value.scrollY, 0, 100000)) return null;
  if (![layers.openNow, layers.foodTrucks, layers.deals, layers.happeningToday].every(v => typeof v === "boolean")) return null;
  if (!finite(map.zoom, 1, 22) || typeof map.expanded !== "boolean") return null;
  if (map.selectedMarkerId !== null && !text(map.selectedMarkerId, 200)) return null;
  if (map.center !== null && (!isRecord(map.center) || !finite(map.center.lat, -90, 90) || !finite(map.center.lng, -180, 180))) return null;
  return {
    route, search: { open: search.open, query: search.query, filter: search.filter as ScoutSearchFilterId | null },
    scene: value.scene as ScoutSceneId, craving: value.craving, radiusKm: value.radiusKm, scrollY: value.scrollY,
    layers: { openNow: layers.openNow as boolean, foodTrucks: layers.foodTrucks as boolean, deals: layers.deals as boolean, happeningToday: layers.happeningToday as boolean },
    map: { center: map.center === null ? null : { lat: (map.center as { lat: number }).lat, lng: (map.center as { lng: number }).lng },
      zoom: map.zoom, expanded: map.expanded, selectedMarkerId: map.selectedMarkerId as string | null },
  };
}

export function readScoutJourney(account: string | null, now = Date.now()): ScoutJourney | null {
  if (!account || typeof window === "undefined") return null;
  const key = prefix + encodeURIComponent(account);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const record: unknown = JSON.parse(raw);
    if (!isRecord(record) || record.version !== 1 || record.account !== account ||
        !finite(record.savedAt, now - SCOUT_JOURNEY_TTL_MS, now)) {
      window.sessionStorage.removeItem(key); return null;
    }
    const state = normalizeScoutJourney(record.state);
    if (!state) window.sessionStorage.removeItem(key);
    return state;
  } catch { return null; }
}

export function writeScoutJourney(account: string | null, value: ScoutJourney, now = Date.now()): void {
  if (!account || typeof window === "undefined") return;
  const state = normalizeScoutJourney(value);
  if (!state) return;
  try {
    // Tab/account scoped view preferences only. No profiles, availability, auth or payment data.
    window.sessionStorage.setItem(prefix + encodeURIComponent(account), JSON.stringify({ version: 1, account, savedAt: now, state }));
  } catch { /* Storage denial or quota must never stop discovery/navigation. */ }
}
