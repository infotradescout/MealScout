import type { Express } from "express";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import {
  forwardGeocode,
  forwardGeocodeGoogle,
  reverseGeocode,
} from "../utils/geocoding";
import {
  isHostProfileMapEligible,
  normalizeUsStateAbbr,
} from "../services/parkingPassQuality";
import { computeExternalReviewAdjustment } from "../services/externalReviewScoring";
import { isLaunchDegradedMode } from "../launchMode";
import { resolveCityTimeZoneSync } from "../services/cityTimeZone";
import { buildSlotDateTimes } from "../services/timeIntent";
import { isSlotPublic } from "../services/publicSlotGate";
import { getSuppressedLocationResourceIds } from "../services/truckLocationTrust";
import { isTruckOperatingPlanRowPublic } from "../services/truckOperatingPlan";
import { loadConfirmedEventTrucks } from "../services/confirmedEventTrucks";
import { getCached, setCached } from "../utils/googleApiCache";
import {
  getGoogleMapsServerApiKey,
  resolveGoogleMapsCredentials,
} from "../services/googleMapsCredentials";
import {
  expandPublicMapBounds,
  isPointInPublicMapBounds,
  parsePublicMapBounds,
  toBoundedPublicMapLocationsPayload,
  toPublicMapLocationsPayload,
} from "../publicProfiles/toPublicMapLocations";
import { resolvePublicProfileVisibility } from "../publicProfiles/publicProfileUtils";
import { toPublicSupplierListingArray } from "../publicProfiles/toPublicSupplierListing";
import { toPublicRestaurantListingArrayWithVisibility } from "../publicProfiles/toPublicRestaurantListingWithVisibility";
import {
  dealClaims,
  deals,
  dealViews,
  eventBookings,
  events,
  geoLocationPings,
  hosts,
  locationRequests,
  moderationEvents,
  restaurants,
  suppliers,
  supplierProducts,
  truckManualSchedules,
  users,
} from "@shared/schema";

let mapLocationsCache: {
  expiresAt: number;
  capturedAt: number;
  payload: { hostLocations: any[]; eventLocations: any[]; supplierLocations: any[] };
} | null = null;

export const clearPublicMapLocationsCache = () => {
  mapLocationsCache = null;
  mapFootTrafficCache.clear();
};

const truckSightingRateLimits = new Map<string, number[]>();
const COMMUNITY_TRUCK_SIGHTING_EVENT = "truck_community_sighting";
const COMMUNITY_TRUCK_SIGHTING_TTL_MS = 60 * 60 * 1000;
// A 6MB uploaded image expands to roughly 8MB when sent as a data URL.
const MAX_TRUCK_SIGHTING_PHOTO_DATA_URL_LENGTH = 9 * 1024 * 1024;
const ALLOWED_TRUCK_SIGHTING_DATA_IMAGE =
  /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,/i;

const distanceKmBetween = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return 2 * 6371 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const clampText = (value: unknown, maxLength: number) => {
  const text = String(value || "").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

const serializeCommunityTruckSighting = (params: {
  id: string;
  metadata: Record<string, unknown>;
  description?: string | null;
  createdAt: Date | string;
  distanceKm?: number;
}) => {
  const createdAtDate =
    params.createdAt instanceof Date
      ? params.createdAt
      : new Date(params.createdAt as any);
  const createdAt = Number.isNaN(createdAtDate.getTime())
    ? new Date().toISOString()
    : createdAtDate.toISOString();
  const seenAtRaw = String(params.metadata.seenAt || createdAt);
  const seenAtDate = new Date(seenAtRaw);
  const seenAt = Number.isNaN(seenAtDate.getTime())
    ? createdAt
    : seenAtDate.toISOString();
  const expiresAt = new Date(
    new Date(createdAt).getTime() + COMMUNITY_TRUCK_SIGHTING_TTL_MS,
  ).toISOString();

  return {
    id: params.id,
    truckName: String(params.metadata.truckName || "Food truck"),
    photoUrl: String(params.metadata.photoUrl || ""),
    latitude: Number(params.metadata.latitude),
    longitude: Number(params.metadata.longitude),
    notes: params.metadata.notes
      ? String(params.metadata.notes)
      : params.description || null,
    locationLabel: params.metadata.locationLabel
      ? String(params.metadata.locationLabel)
      : null,
    source: String(params.metadata.source || "map_user_ping"),
    reportCount: Number(params.metadata.reportCount || 1),
    lastReportedAt: createdAt,
    seenAt,
    expiresAt,
    createdAt,
    status: "approved",
    ...(typeof params.distanceKm === "number"
      ? { distanceKm: Number(params.distanceKm.toFixed(2)) }
      : {}),
  };
};

const isAllowedTruckSightingPhotoUrl = (value: string) => {
  if (value.length > MAX_TRUCK_SIGHTING_PHOTO_DATA_URL_LENGTH) return false;
  if (ALLOWED_TRUCK_SIGHTING_DATA_IMAGE.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

type FootTrafficPayload = {
  generatedAt: string;
  windowMinutes: number;
  requestedWindowMinutes: number;
  bounds: BoundsLike;
  mode: "avg" | "live";
  degradedMode?: boolean;
  interpretation: {
    label: "area_activity";
    measuredFootTraffic: boolean;
    description: string;
  };
  signalQuality: {
    tier: "sparse" | "emerging" | "solid";
    isLowDensity: boolean;
  };
  firstParty: {
    totalPings: number;
    totalUniqueActors: number;
    cells: TrafficCell[];
  };
  supplySignals: {
    cells: TrafficCell[];
  };
  googlePlaces: {
    enabled: boolean;
    used: boolean;
    error: string | null;
    cells: TrafficCell[];
  };
  cells: TrafficCell[];
};

const mapFootTrafficCache = new Map<
  string,
  {
    expiresAt: number;
    payload: FootTrafficPayload;
  }
>();

const mapRouteSummaryCache = new Map<
  string,
  {
    expiresAt: number;
    payload: {
      distanceMeters: number;
      durationSeconds: number;
      travelMode: "DRIVE" | "WALK" | "BICYCLE";
      source: "google_routes";
      encodedPolyline: string | null;
    };
  }
>();

type BoundsLike = {
  north: number;
  south: number;
  east: number;
  west: number;
};

type TrafficCell = {
  id: string;
  lat: number;
  lng: number;
  weight: number;
  source: "first_party" | "google_places" | "supply_signal";
  count?: number;
  uniqueActors?: number;
  freshnessMinutes?: number;
};

const toFiniteNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBounds = parsePublicMapBounds;

const pointInBounds = (bounds: BoundsLike, lat: number, lng: number) => {
  return isPointInPublicMapBounds(bounds, lat, lng);
};

const estimateRadiusMetersFromBounds = (bounds: BoundsLike) => {
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = (bounds.east + bounds.west) / 2;
  const latDelta = Math.abs(bounds.north - bounds.south) / 2;
  let lngDelta = Math.abs(bounds.east - bounds.west) / 2;
  if (bounds.west > bounds.east) {
    lngDelta = (360 - Math.abs(bounds.west - bounds.east)) / 2;
  }
  const metersPerLat = 111_320;
  const metersPerLng = Math.max(
    111_320 * Math.cos((centerLat * Math.PI) / 180),
    1,
  );
  const latMeters = latDelta * metersPerLat;
  const lngMeters = lngDelta * metersPerLng;
  return Math.max(
    100,
    Math.round(Math.sqrt(latMeters * latMeters + lngMeters * lngMeters)),
  );
};

const cellId = (
  source: "first_party" | "google_places" | "supply_signal",
  lat: number,
  lng: number,
) => `${source}:${lat.toFixed(3)}:${lng.toFixed(3)}`;

// Public activity cells are approximately one-kilometre buckets. Exact or
// street-level movement is never part of this aggregate product.
const roundCell = (value: number) => Math.round(value * 100) / 100;

const normalizeBoundForKey = (value: number) => Number(value.toFixed(3));

const parseDurationSeconds = (value: unknown) => {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
};

type RoutePoint = { lat: number; lng: number };

type GoogleRouteResult = {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string | null;
};

const decodeGooglePolyline = (encoded: string): RoutePoint[] => {
  if (!encoded) return [];
  const points: RoutePoint[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  const readValue = () => {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && shift < 35);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    const latitudeDelta = readValue();
    const longitudeDelta = readValue();
    if (latitudeDelta === null || longitudeDelta === null) break;
    latitude += latitudeDelta;
    longitude += longitudeDelta;
    points.push({ lat: latitude / 1e5, lng: longitude / 1e5 });
  }
  return points;
};

const locatePointAlongRoute = (point: RoutePoint, path: RoutePoint[]) => {
  if (!path.length) {
    return { distanceKm: Number.POSITIVE_INFINITY, progressKm: 0 };
  }
  if (path.length === 1) {
    return {
      distanceKm: distanceKmBetween(
        point.lat,
        point.lng,
        path[0].lat,
        path[0].lng,
      ),
      progressKm: 0,
    };
  }

  const kmPerLatitudeDegree = 110.574;
  const kmPerLongitudeDegree = Math.max(
    111.32 * Math.cos((point.lat * Math.PI) / 180),
    1,
  );
  let bestDistanceKm = Number.POSITIVE_INFINITY;
  let bestProgressKm = 0;
  let traversedKm = 0;

  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    const startX = (start.lng - point.lng) * kmPerLongitudeDegree;
    const startY = (start.lat - point.lat) * kmPerLatitudeDegree;
    const endX = (end.lng - point.lng) * kmPerLongitudeDegree;
    const endY = (end.lat - point.lat) * kmPerLatitudeDegree;
    const segmentX = endX - startX;
    const segmentY = endY - startY;
    const lengthSquared = segmentX * segmentX + segmentY * segmentY;
    const projection =
      lengthSquared > 0
        ? Math.max(
            0,
            Math.min(
              1,
              -(startX * segmentX + startY * segmentY) / lengthSquared,
            ),
          )
        : 0;
    const projectedX = startX + projection * segmentX;
    const projectedY = startY + projection * segmentY;
    const distanceKm = Math.hypot(projectedX, projectedY);
    const segmentKm = distanceKmBetween(start.lat, start.lng, end.lat, end.lng);
    if (distanceKm < bestDistanceKm) {
      bestDistanceKm = distanceKm;
      bestProgressKm = traversedKm + segmentKm * projection;
    }
    traversedKm += segmentKm;
  }

  return { distanceKm: bestDistanceKm, progressKm: bestProgressKm };
};

const isMissingRelationError = (error: unknown, relationName?: string) => {
  const err = error as { code?: string; message?: string } | null;
  if (!err || err.code !== "42P01") return false;
  if (!relationName) return true;
  return err.message?.includes(`"${relationName}"`) ?? false;
};

type PlaceAutocompletePrediction = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
};

type PlaceDetailsResult = {
  placeId: string;
  formattedAddress: string;
  city: string;
  county: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
};

type PlaceAutocompleteIntent = "destination" | "food";

// Autocomplete: cache by normalised query string, 5-minute TTL.
// Suggestions for the same query are identical regardless of who asks.
const placeAutocompleteCache = new Map<
  string,
  { expiresAt: number; suggestions: PlaceAutocompletePrediction[] }
>();
const PLACE_AUTOCOMPLETE_TTL_MS = 5 * 60_000;

// Place details: cache by placeId, 24-hour TTL.
// A placeId maps to a fixed address — it never changes.
const placeDetailsCache = new Map<string, { expiresAt: number; place: any }>();
const PLACE_DETAILS_TTL_MS = 24 * 60 * 60_000;
const MAP_PROVIDER_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.MAP_PROVIDER_TIMEOUT_MS || 6500) || 6500,
);

// In-flight deduplication: if two requests arrive for the same query/placeId
// before the first one resolves, they share the same Promise instead of making
// two separate Google API calls.
const autocompleteInflight = new Map<
  string,
  Promise<PlaceAutocompletePrediction[]>
>();
const placeDetailsInflight = new Map<string, Promise<any>>();

const buildPlacesHeaders = (apiKey: string, fieldMask: string) => ({
  "Content-Type": "application/json",
  "X-Goog-Api-Key": apiKey,
  "X-Goog-FieldMask": fieldMask,
});

const fetchWithTimeout = async (
  input: string,
  init: RequestInit,
  timeoutMs = MAP_PROVIDER_TIMEOUT_MS,
) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const routeWaypoint = (point: RoutePoint) => ({
  location: {
    latLng: {
      latitude: point.lat,
      longitude: point.lng,
    },
  },
});

const computeGoogleRoute = async (params: {
  apiKey: string;
  origin: RoutePoint;
  destination: RoutePoint;
  travelMode?: "DRIVE" | "WALK" | "BICYCLE";
  intermediate?: RoutePoint;
}): Promise<GoogleRouteResult | null> => {
  const travelMode = params.travelMode || "DRIVE";
  const body: Record<string, unknown> = {
    origin: routeWaypoint(params.origin),
    destination: routeWaypoint(params.destination),
    travelMode,
    routingPreference:
      travelMode === "DRIVE" ? "TRAFFIC_AWARE_OPTIMAL" : undefined,
    computeAlternativeRoutes: false,
    languageCode: "en-US",
    units: "METRIC",
    polylineQuality: "OVERVIEW",
    polylineEncoding: "ENCODED_POLYLINE",
  };
  if (params.intermediate) {
    body.intermediates = [routeWaypoint(params.intermediate)];
  }

  const response = await fetchWithTimeout(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": params.apiKey,
        "X-Goog-FieldMask":
          "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify(body),
    },
    MAP_PROVIDER_TIMEOUT_MS,
  );
  if (!response.ok) return null;

  const data = (await response.json().catch(() => ({}))) as any;
  const route = Array.isArray(data?.routes) ? data.routes[0] : null;
  const distanceMeters = Number(route?.distanceMeters);
  const durationSeconds = parseDurationSeconds(route?.duration);
  if (!Number.isFinite(distanceMeters) || durationSeconds === null) return null;
  const encodedPolyline =
    String(route?.polyline?.encodedPolyline || "").trim() || null;
  return {
    distanceMeters: Math.max(0, Math.round(distanceMeters)),
    durationSeconds,
    encodedPolyline,
  };
};

const buildGoogleDirectionsUrl = (params: {
  origin: RoutePoint;
  destination: RoutePoint;
  waypoint?: RoutePoint;
}) => {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", `${params.origin.lat},${params.origin.lng}`);
  url.searchParams.set(
    "destination",
    `${params.destination.lat},${params.destination.lng}`,
  );
  if (params.waypoint) {
    url.searchParams.set(
      "waypoints",
      `${params.waypoint.lat},${params.waypoint.lng}`,
    );
  }
  url.searchParams.set("travelmode", "driving");
  return url.toString();
};

const extractAddressComponent = (
  components:
    | Array<{ longText?: string; shortText?: string; types?: string[] }>
    | undefined,
  type: string,
  preference: "long" | "short" = "long",
) => {
  if (!Array.isArray(components)) return "";
  const match = components.find((component) =>
    Array.isArray(component.types) ? component.types.includes(type) : false,
  );
  if (!match) return "";
  if (preference === "short") {
    return String(match.shortText || match.longText || "").trim();
  }
  return String(match.longText || match.shortText || "").trim();
};

const normalizePlaceDetails = (raw: any): PlaceDetailsResult => {
  const idFromName = String(raw?.name || "").replace(/^places\//, "");
  const placeId = String(raw?.id || idFromName || "").trim();
  const formattedAddress = String(raw?.formattedAddress || "").trim();
  const components = Array.isArray(raw?.addressComponents)
    ? raw.addressComponents
    : [];
  const city =
    extractAddressComponent(components, "locality", "long") ||
    extractAddressComponent(components, "postal_town", "long") ||
    extractAddressComponent(components, "administrative_area_level_2", "long");
  const county = extractAddressComponent(
    components,
    "administrative_area_level_2",
    "long",
  );
  const state =
    extractAddressComponent(
      components,
      "administrative_area_level_1",
      "short",
    ) || "";
  const latitude =
    typeof raw?.location?.latitude === "number" ? raw.location.latitude : null;
  const longitude =
    typeof raw?.location?.longitude === "number"
      ? raw.location.longitude
      : null;

  return {
    placeId,
    formattedAddress,
    city,
    county,
    state,
    latitude,
    longitude,
  };
};

const parseAutocompleteCoordinate = (
  value: unknown,
  maxAbs: number,
): number | null => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > maxAbs) return null;
  return parsed;
};

type OperatorSupportKind = "gas" | "propane" | "supply" | "support";

type OperatorSupportPlace = {
  placeId: string;
  kind: OperatorSupportKind;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  primaryType: string | null;
  businessStatus: string | null;
  phone: string | null;
  googleMapsUri: string | null;
  straightLineMiles: number;
  driveDistanceMeters: number | null;
  driveDurationSeconds: number | null;
  source: "google_places";
};

type RouteCorridorSupportPlace = OperatorSupportPlace & {
  originToStopDistanceMeters: number | null;
  originToStopDurationSeconds: number | null;
  stopToDestinationDistanceMeters: number | null;
  stopToDestinationDurationSeconds: number | null;
  journeyDistanceMeters: number | null;
  journeyDurationSeconds: number | null;
  addedDistanceMeters: number | null;
  addedDurationSeconds: number | null;
  directionsUri: string;
};

type RouteCorridorHost = {
  locationId: string;
  hostId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  spotImageUrl: string | null;
  distanceFromRouteMiles: number;
  routeProgressMiles: number;
  journeyDistanceMeters: number | null;
  journeyDurationSeconds: number | null;
  addedDistanceMeters: number | null;
  addedDurationSeconds: number | null;
  directionsUri: string;
  source: "mealscout_parking_pass";
};

type PlaceIntelligencePayload = {
  available: boolean;
  source: "google_places";
  fetchedAt: string;
  reason?: string;
  place?: {
    placeId: string;
    name: string;
    formattedAddress: string;
    latitude: number | null;
    longitude: number | null;
    primaryType: string | null;
    types: string[];
    businessStatus: string | null;
    phone: string | null;
    websiteUri: string | null;
    googleMapsUri: string | null;
    openNow: boolean | null;
    weekdayDescriptions: string[];
    fuelPrices: {
      regularCents: number | null;
      midgradeCents: number | null;
      premiumCents: number | null;
      dieselCents: number | null;
      updatedAt: string | null;
      source: "google_places";
    } | null;
    parkingOptions: Record<string, boolean> | null;
    restroom: boolean | null;
    accessibilityOptions: Record<string, boolean> | null;
  };
};

const PLACE_INTELLIGENCE_TTL_MS = 60 * 60_000;
const OPERATOR_SUPPORT_TTL_MS = 30 * 60_000;
const ROUTE_CORRIDOR_TTL_MS = 30 * 60_000;
const ROUTE_CORRIDOR_HOST_RADIUS_MILES = 15;
const ROUTE_CORRIDOR_MAX_HOSTS = 6;

const normalizeCacheText = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 240);

const googleMoneyToCents = (money: any): number | null => {
  const units = Number(money?.units ?? 0);
  const nanos = Number(money?.nanos ?? 0);
  if (!Number.isFinite(units) || !Number.isFinite(nanos)) return null;
  const cents = Math.round(units * 100 + nanos / 10_000_000);
  return cents >= 0 ? cents : null;
};

const normalizeGoogleFuelPrices = (fuelOptions: any) => {
  const rows = Array.isArray(fuelOptions?.fuelPrices)
    ? fuelOptions.fuelPrices
    : [];
  if (!rows.length) return null;

  const normalized = {
    regularCents: null as number | null,
    midgradeCents: null as number | null,
    premiumCents: null as number | null,
    dieselCents: null as number | null,
    updatedAt: null as string | null,
    source: "google_places" as const,
  };
  let newestUpdateMs = 0;
  for (const row of rows) {
    const cents = googleMoneyToCents(row?.price);
    if (cents === null) continue;
    const fuelType = String(row?.type || "").trim().toUpperCase();
    if (fuelType === "REGULAR_UNLEADED" && normalized.regularCents === null) {
      normalized.regularCents = cents;
    } else if (
      ["MIDGRADE", "MIDGRADE_UNLEADED"].includes(fuelType) &&
      normalized.midgradeCents === null
    ) {
      normalized.midgradeCents = cents;
    } else if (
      ["PREMIUM", "PREMIUM_UNLEADED"].includes(fuelType) &&
      normalized.premiumCents === null
    ) {
      normalized.premiumCents = cents;
    } else if (
      ["DIESEL", "TRUCK_DIESEL", "BIO_DIESEL"].includes(fuelType) &&
      normalized.dieselCents === null
    ) {
      normalized.dieselCents = cents;
    }
    const updateMs = new Date(String(row?.updateTime || "")).getTime();
    if (Number.isFinite(updateMs) && updateMs > newestUpdateMs) {
      newestUpdateMs = updateMs;
      normalized.updatedAt = new Date(updateMs).toISOString();
    }
  }

  const hasPrice = [
    normalized.regularCents,
    normalized.midgradeCents,
    normalized.premiumCents,
    normalized.dieselCents,
  ].some((value) => typeof value === "number");
  return hasPrice ? normalized : null;
};

const normalizeBooleanRecord = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
  );
  return entries.length ? Object.fromEntries(entries) : null;
};

const normalizeGooglePlaceIntelligence = (raw: any) => {
  const idFromName = String(raw?.name || "").replace(/^places\//, "");
  const latitude = toFiniteNumber(raw?.location?.latitude);
  const longitude = toFiniteNumber(raw?.location?.longitude);
  const weekdayDescriptions = Array.isArray(
    raw?.currentOpeningHours?.weekdayDescriptions,
  )
    ? raw.currentOpeningHours.weekdayDescriptions
        .map((value: unknown) => String(value || "").trim())
        .filter(Boolean)
    : Array.isArray(raw?.regularOpeningHours?.weekdayDescriptions)
      ? raw.regularOpeningHours.weekdayDescriptions
          .map((value: unknown) => String(value || "").trim())
          .filter(Boolean)
      : [];
  const openNow =
    typeof raw?.currentOpeningHours?.openNow === "boolean"
      ? raw.currentOpeningHours.openNow
      : null;

  return {
    placeId: String(raw?.id || idFromName || "").trim(),
    name: String(raw?.displayName?.text || "").trim(),
    formattedAddress: String(raw?.formattedAddress || "").trim(),
    latitude,
    longitude,
    primaryType: String(raw?.primaryType || "").trim() || null,
    types: Array.isArray(raw?.types)
      ? raw.types.map((value: unknown) => String(value || "").trim()).filter(Boolean)
      : [],
    businessStatus: String(raw?.businessStatus || "").trim() || null,
    phone: String(raw?.nationalPhoneNumber || "").trim() || null,
    websiteUri: String(raw?.websiteUri || "").trim() || null,
    googleMapsUri: String(raw?.googleMapsUri || "").trim() || null,
    openNow,
    weekdayDescriptions,
    fuelPrices: normalizeGoogleFuelPrices(raw?.fuelOptions),
    parkingOptions: normalizeBooleanRecord(raw?.parkingOptions),
    restroom: typeof raw?.restroom === "boolean" ? raw.restroom : null,
    accessibilityOptions: normalizeBooleanRecord(raw?.accessibilityOptions),
  };
};

const placeIntelligenceFieldMask = (prefix = "") =>
  [
    "id",
    "displayName",
    "formattedAddress",
    "location",
    "primaryType",
    "types",
    "businessStatus",
    "currentOpeningHours",
    "regularOpeningHours",
    "fuelOptions",
    "parkingOptions",
    "restroom",
    "accessibilityOptions",
    "nationalPhoneNumber",
    "websiteUri",
    "googleMapsUri",
  ]
    .map((field) => `${prefix}${field}`)
    .join(",");

const pickClosestGooglePlace = (
  places: any[],
  origin: { lat: number | null; lng: number | null },
) => {
  if (!Array.isArray(places) || !places.length) return null;
  if (origin.lat === null || origin.lng === null) return places[0];
  return [...places].sort((left, right) => {
    const leftLat = toFiniteNumber(left?.location?.latitude);
    const leftLng = toFiniteNumber(left?.location?.longitude);
    const rightLat = toFiniteNumber(right?.location?.latitude);
    const rightLng = toFiniteNumber(right?.location?.longitude);
    const leftDistance =
      leftLat === null || leftLng === null
        ? Number.POSITIVE_INFINITY
        : distanceKmBetween(origin.lat!, origin.lng!, leftLat, leftLng);
    const rightDistance =
      rightLat === null || rightLng === null
        ? Number.POSITIVE_INFINITY
        : distanceKmBetween(origin.lat!, origin.lng!, rightLat, rightLng);
    return leftDistance - rightDistance;
  })[0];
};

const normalizeRoutingSummary = (raw: any) => {
  const leg = Array.isArray(raw?.legs) ? raw.legs[0] : null;
  const distanceMeters = Number(leg?.distanceMeters);
  return {
    distanceMeters: Number.isFinite(distanceMeters)
      ? Math.max(0, Math.round(distanceMeters))
      : null,
    durationSeconds: parseDurationSeconds(leg?.duration),
  };
};

const optionalNonNegativeNumberEnv = (name: string): number | null => {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
};

export function registerPublicMapRoutes(app: Express) {
  app.get("/api/parking-pass/weather", async (req, res) => {
    try {
      const lat = toFiniteNumber(req.query.lat);
      const lng = toFiniteNumber(req.query.lng);
      const date = String(req.query.date || "").trim();
      const startTime = String(req.query.startTime || "").trim() || "11:00";
      const endTime = String(req.query.endTime || "").trim() || "14:00";
      if (lat === null || lng === null || !date) {
        return res.status(400).json({ message: "lat, lng, and date are required" });
      }

      const requestedDay = new Date(`${date}T00:00:00`);
      if (Number.isNaN(requestedDay.getTime())) {
        return res.status(400).json({ message: "Invalid date" });
      }

      const now = new Date();
      const dayDiff = Math.floor((requestedDay.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      if (dayDiff > 16) {
        return res.status(200).json({
          available: false,
          reason: "forecast_window_unavailable",
          message: "Forecast is not available this far in advance yet.",
        });
      }

      const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
      weatherUrl.searchParams.set("latitude", String(lat));
      weatherUrl.searchParams.set("longitude", String(lng));
      weatherUrl.searchParams.set("hourly", "temperature_2m,precipitation_probability,wind_speed_10m,weather_code");
      weatherUrl.searchParams.set("timezone", "auto");
      weatherUrl.searchParams.set("start_date", date);
      weatherUrl.searchParams.set("end_date", date);
      const upstream = await fetch(weatherUrl.toString(), { method: "GET" });
      if (!upstream.ok) {
        return res.status(200).json({
          available: false,
          reason: "provider_unavailable",
          message: "Weather provider is unavailable right now.",
        });
      }
      const payload = (await upstream.json()) as any;
      const hourly = payload?.hourly || {};
      const times: string[] = Array.isArray(hourly.time) ? hourly.time : [];
      const temps: Array<number | null> = Array.isArray(hourly.temperature_2m)
        ? hourly.temperature_2m
        : [];
      const precip: Array<number | null> = Array.isArray(hourly.precipitation_probability)
        ? hourly.precipitation_probability
        : [];
      const wind: Array<number | null> = Array.isArray(hourly.wind_speed_10m)
        ? hourly.wind_speed_10m
        : [];
      const codes: Array<number | null> = Array.isArray(hourly.weather_code)
        ? hourly.weather_code
        : [];

      const inWindow = (iso: string) => {
        const timePart = String(iso.split("T")[1] || "").slice(0, 5);
        return timePart >= startTime && timePart <= endTime;
      };
      const indexes = times
        .map((value, index) => (inWindow(value) ? index : -1))
        .filter((index) => index >= 0);
      if (!indexes.length) {
        return res.status(200).json({
          available: false,
          reason: "forecast_window_missing",
          message: "Forecast data is not available for that time window.",
        });
      }

      const avg = (values: Array<number | null>) => {
        const nums = indexes
          .map((index) => values[index])
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        if (!nums.length) return null;
        return Number((nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(1));
      };
      const max = (values: Array<number | null>) => {
        const nums = indexes
          .map((index) => values[index])
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        if (!nums.length) return null;
        return Math.max(...nums);
      };
      const maxPrecip = max(precip);
      const maxWind = max(wind);
      const severe = indexes.some((index) => {
        const code = Number(codes[index] ?? -1);
        return [95, 96, 99].includes(code);
      });

      const summary =
        severe
          ? "Severe weather risk in this window"
          : (maxPrecip ?? 0) >= 60
            ? "High rain risk during this slot"
            : (maxPrecip ?? 0) >= 30
              ? "Possible rain during this slot"
              : "Weather looks workable for this slot";

      return res.status(200).json({
        available: true,
        summary,
        temperatureF: avg(temps),
        rainRiskPercent: maxPrecip,
        windMph: maxWind,
        severeWeatherWarning: severe,
        source: "open-meteo",
      });
    } catch (error) {
      console.error("Error loading parking pass weather:", error);
      return res.status(200).json({
        available: false,
        reason: "provider_error",
        message: "Weather forecast is temporarily unavailable.",
      });
    }
  });

  app.get("/api/parking-pass/intelligence-status", async (_req, res) => {
    try {
      // Capability status must not inherit entity membership from a stale
      // public-map snapshot. Exact public entities are loaded by the map feed.
      const hostLocations: any[] = [];
      const supplierLocations: any[] = [];

      const gasHosts = hostLocations.filter((host: any) => {
        const prices = host?.fuelPrices || null;
        return (
          host?.showFuelPrices === true &&
          prices &&
          [prices.regularCents, prices.midgradeCents, prices.premiumCents, prices.dieselCents].some(
            (value) => typeof value === "number" && Number.isFinite(value),
          )
        );
      });
      const propane = supplierLocations.filter(
        (row: any) => String(row?.category || "").toLowerCase() === "propane_dealer",
      );
      const supplyStores = supplierLocations.filter((row: any) => {
        const category = String(row?.category || "").toLowerCase();
        return category === "supplier" || category === "equipment_supplier";
      });
      const supportProviders = supplierLocations.filter((row: any) => {
        const category = String(row?.category || "").toLowerCase();
        return ![
          "propane_dealer",
          "supplier",
          "equipment_supplier",
        ].includes(category);
      });
      const googleDiscoveryEnabled = getGoogleMapsServerApiKey().length > 0;

      return res.status(200).json({
        generatedAt: new Date().toISOString(),
        layers: {
          footTraffic: {
            status: "available",
            endpoint: "/api/map/foot-traffic",
            label: "Area activity",
            interpretation:
              "MealScout movement, scheduled activity, and nearby food-destination density are separate signals.",
          },
          gasPrices: {
            status:
              gasHosts.length > 0 || googleDiscoveryEnabled
                ? "available"
                : "unavailable",
            records: gasHosts.length,
            discoveryEnabled: googleDiscoveryEnabled,
          },
          propaneSuppliers: {
            status:
              propane.length > 0 || googleDiscoveryEnabled
                ? "available"
                : "unavailable",
            records: propane.length,
            discoveryEnabled: googleDiscoveryEnabled,
          },
          restaurantSupplyStores: {
            status:
              supplyStores.length > 0 || googleDiscoveryEnabled
                ? "available"
                : "unavailable",
            records: supplyStores.length,
            discoveryEnabled: googleDiscoveryEnabled,
          },
          operatorSupportPois: {
            status:
              supportProviders.length > 0 || googleDiscoveryEnabled
                ? "available"
                : "unavailable",
            records: supportProviders.length,
            discoveryEnabled: googleDiscoveryEnabled,
          },
          routeCorridor: {
            status: googleDiscoveryEnabled ? "available" : "unavailable",
            endpoint: "/api/map/route-corridor",
            discoveryEnabled: googleDiscoveryEnabled,
          },
        },
      });
    } catch (error) {
      console.error("Error loading parking pass intelligence status:", error);
      return res.status(200).json({
        generatedAt: new Date().toISOString(),
        layers: {
          footTraffic: { status: "unavailable" },
          gasPrices: { status: "unavailable" },
          propaneSuppliers: { status: "unavailable" },
          restaurantSupplyStores: { status: "unavailable" },
          operatorSupportPois: { status: "unavailable" },
          routeCorridor: { status: "unavailable" },
        },
      });
    }
  });

  app.get("/api/map/runtime", async (_req, res) => {
    try {
      const credentials = resolveGoogleMapsCredentials();
      const googleMapsApiKey = credentials.browserApiKey;
      const hasServerMapsKey = credentials.serverAuthorized;
      const googleMapsMapId = String(
        process.env.GOOGLE_MAPS_MAP_ID ||
          process.env.VITE_GOOGLE_MAPS_MAP_ID ||
          "",
      ).trim();
      res.setHeader(
        "Cache-Control",
        "public, max-age=120, stale-while-revalidate=240",
      );
      res.json({
        hasGoogleMapsKey: googleMapsApiKey.length > 0,
        googleMapsApiKey: googleMapsApiKey || null,
        hasGoogleMapsMapId: googleMapsMapId.length > 0,
        googleMapsMapId: googleMapsMapId || null,
        capabilities: {
          browserMaps: googleMapsApiKey.length > 0,
          serverPlaces: hasServerMapsKey,
          routes: hasServerMapsKey,
          addressValidation: hasServerMapsKey,
          placeIntelligence: hasServerMapsKey,
          operatorSupportDiscovery: hasServerMapsKey,
          routeCorridorDiscovery: hasServerMapsKey,
          serverAuthorized: hasServerMapsKey,
          serverCredentialMode: credentials.serverCredentialMode,
          dedicatedServerKey: hasServerMapsKey,
          usingBrowserKeyServerFallback: false,
        },
      });
    } catch {
      res.status(500).json({
        hasGoogleMapsKey: false,
        googleMapsApiKey: null,
        hasGoogleMapsMapId: false,
        googleMapsMapId: null,
        capabilities: {
          browserMaps: false,
          serverPlaces: false,
          routes: false,
          addressValidation: false,
          placeIntelligence: false,
          operatorSupportDiscovery: false,
          routeCorridorDiscovery: false,
          serverAuthorized: false,
          serverCredentialMode: "missing",
          dedicatedServerKey: false,
          usingBrowserKeyServerFallback: false,
        },
      });
    }
  });

  app.get("/api/map/locations", async (req, res) => {
    const requestedBounds = parseBounds(req.query as Record<string, unknown>);
    const hasBoundsQuery = ["north", "south", "east", "west"].some((field) =>
      Object.prototype.hasOwnProperty.call(req.query, field),
    );
    if (hasBoundsQuery && !requestedBounds) {
      return res.status(400).json({ message: "Valid bounds are required" });
    }
    const toRequestedMapPayload = (payload: unknown) =>
      toBoundedPublicMapLocationsPayload(payload, requestedBounds);
    try {
      res.setHeader("Cache-Control", "no-store");

      const VALID_US_STATE_ABBRS = new Set([
        "AL",
        "AK",
        "AZ",
        "AR",
        "CA",
        "CO",
        "CT",
        "DE",
        "FL",
        "GA",
        "HI",
        "ID",
        "IL",
        "IN",
        "IA",
        "KS",
        "KY",
        "LA",
        "ME",
        "MD",
        "MA",
        "MI",
        "MN",
        "MS",
        "MO",
        "MT",
        "NE",
        "NV",
        "NH",
        "NJ",
        "NM",
        "NY",
        "NC",
        "ND",
        "OH",
        "OK",
        "OR",
        "PA",
        "RI",
        "SC",
        "SD",
        "TN",
        "TX",
        "UT",
        "VT",
        "VA",
        "WA",
        "WV",
        "WI",
        "WY",
        "DC",
      ]);

      const extractStateAbbr = (value?: string | null) => {
        const raw = String(value || "").toUpperCase();
        if (!raw) return "";
        const matches = raw.match(/\b[A-Z]{2}\b/g) || [];
        for (let i = matches.length - 1; i >= 0; i -= 1) {
          const candidate = matches[i];
          if (VALID_US_STATE_ABBRS.has(candidate)) return candidate;
        }
        return "";
      };

      const expectedStateAbbrFor = (hostLike: {
        address?: string | null;
        city?: string | null;
        state?: string | null;
      }) => {
        const state = normalizeUsStateAbbr(String(hostLike.state || "").trim());
        if (state && VALID_US_STATE_ABBRS.has(state)) return state;
        const fromAddress = extractStateAbbr(hostLike.address);
        if (fromAddress) return fromAddress;
        const fromCity = extractStateAbbr(hostLike.city);
        if (fromCity) return fromCity;
        return "";
      };

      const parseCoord = (value?: string | number | null) => {
        if (value === null || value === undefined) return null;
        const parsed = typeof value === "string" ? Number(value) : value;
        return Number.isFinite(parsed) ? parsed : null;
      };

      const buildFullAddress = (
        address?: string | null,
        city?: string | null,
        state?: string | null,
      ) => {
        const base = (address ?? "").trim();
        if (!base) return "";
        const baseLower = base.toLowerCase();
        const normalizedCity = (city ?? "").trim();
        const normalizedState = (state ?? "").trim();

        const parts: string[] = [base];
        if (
          normalizedCity &&
          !baseLower.includes(normalizedCity.toLowerCase())
        ) {
          parts.push(normalizedCity);
        }
        if (
          normalizedState &&
          !baseLower.includes(normalizedState.toLowerCase())
        ) {
          parts.push(normalizedState);
        }
        parts.push("USA");
        return parts.join(", ");
      };

      const launchDegradedMode = isLaunchDegradedMode();
      const MAX_GEOCODE_PER_REQUEST = launchDegradedMode
        ? 0
        : (optionalNonNegativeNumberEnv("MAP_LOCATIONS_MAX_GEOCODE") ??
          (process.env.NODE_ENV === "production" ? 0 : 25));
      const GEOCODE_BUDGET_MS =
        Math.max(
          0,
          Number(process.env.MAP_LOCATIONS_GEOCODE_BUDGET_MS || 0) || 0,
        ) || (process.env.NODE_ENV === "production" ? 600 : 5000);
      const GEOCODE_TIMEOUT_MS =
        Math.max(
          0,
          Number(process.env.MAP_LOCATIONS_GEOCODE_TIMEOUT_MS || 0) || 0,
        ) || (process.env.NODE_ENV === "production" ? 350 : 2000);
      const MAX_REVERSE_GEOCODE_PER_REQUEST = launchDegradedMode
        ? 0
        : (optionalNonNegativeNumberEnv("MAP_LOCATIONS_MAX_REVERSE_GEOCODE") ??
          (process.env.NODE_ENV === "production" ? 0 : 10));
      const MAX_COORD_CALIBRATIONS_PER_REQUEST = launchDegradedMode
        ? 0
        : (optionalNonNegativeNumberEnv(
            "MAP_LOCATIONS_MAX_COORD_CALIBRATIONS",
          ) ?? (process.env.NODE_ENV === "production" ? 0 : 30));
      const COORD_CALIBRATION_THRESHOLD_METERS =
        Math.max(
          0,
          Number(process.env.MAP_LOCATIONS_COORD_CALIBRATION_METERS || 0) || 0,
        ) || 120;
      const useGoogleCalibration =
        !launchDegradedMode && getGoogleMapsServerApiKey().length > 0;

      const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number) => {
        if (timeoutMs <= 0) return promise;
        return await Promise.race([
          promise,
          new Promise<T>((_resolve, reject) =>
            setTimeout(() => reject(new Error("timeout")), timeoutMs),
          ),
        ]);
      };

      type PendingGeocode = {
        address: string;
        onResolved: Array<(coords: { lat: number; lng: number }) => void>;
        persist: Array<(coords: { lat: number; lng: number }) => Promise<void>>;
      };

      const pendingByAddress = new Map<string, PendingGeocode>();
      const normalizeAddressKey = (value: string) => value.trim().toLowerCase();
      const haversineMeters = (
        lat1: number,
        lng1: number,
        lat2: number,
        lng2: number,
      ) => {
        const toRad = (v: number) => (v * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1);
        const dLng = toRad(lng2 - lng1);
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2);
        return 2 * 6371000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      };
      const queueGeocode = (
        address: string,
        onResolved: (coords: { lat: number; lng: number }) => void,
        persist?: (coords: { lat: number; lng: number }) => Promise<void>,
      ) => {
        const key = normalizeAddressKey(address);
        if (!key) return;
        const existing = pendingByAddress.get(key);
        if (existing) {
          existing.onResolved.push(onResolved);
          if (persist) existing.persist.push(persist);
          return;
        }
        pendingByAddress.set(key, {
          address,
          onResolved: [onResolved],
          persist: persist ? [persist] : [],
        });
      };

      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const manualScheduleWindowStart = new Date(
        todayStart.getTime() - 24 * 60 * 60 * 1000,
      );
      const manualScheduleWindowEnd = new Date(
        todayStart.getTime() + 24 * 60 * 60 * 1000,
      );

      const [
        upcomingEvents,
        allHosts,
        publicManualSchedules,
        activeSuppliers,
        activeSupplierProducts,
      ] = await Promise.all([
        storage.getAllUpcomingEvents(),
        storage.getAllHosts(),
        db
          .select({
            id: truckManualSchedules.id,
            truckId: truckManualSchedules.truckId,
            date: truckManualSchedules.date,
            startTime: truckManualSchedules.startTime,
            endTime: truckManualSchedules.endTime,
            locationName: truckManualSchedules.locationName,
            address: truckManualSchedules.address,
            city: truckManualSchedules.city,
            state: truckManualSchedules.state,
            notes: truckManualSchedules.notes,
            isPublic: truckManualSchedules.isPublic,
            status: truckManualSchedules.status,
            timezone: truckManualSchedules.timezone,
            expiresAt: truckManualSchedules.expiresAt,
            sourceType: truckManualSchedules.sourceType,
            sourceConfidence: truckManualSchedules.sourceConfidence,
            ownerSubmittedEquivalent:
              truckManualSchedules.ownerSubmittedEquivalent,
            mapEligible: truckManualSchedules.mapEligible,
            liveFeedEligible: truckManualSchedules.liveFeedEligible,
            lastConfirmedAt: truckManualSchedules.lastConfirmedAt,
            updatedAt: truckManualSchedules.updatedAt,
            truckName: restaurants.name,
            truckOwnerId: restaurants.ownerId,
            truckIsActive: restaurants.isActive,
            truckIsFoodTruck: restaurants.isFoodTruck,
            truckIsVerified: restaurants.isVerified,
          })
          .from(truckManualSchedules)
          .innerJoin(restaurants, eq(truckManualSchedules.truckId, restaurants.id))
          .innerJoin(users, eq(restaurants.ownerId, users.id))
          .where(
            and(
              eq(truckManualSchedules.isPublic, true),
              gte(truckManualSchedules.date, manualScheduleWindowStart),
              lte(truckManualSchedules.date, manualScheduleWindowEnd),
              eq(restaurants.isActive, true),
              eq(users.isDisabled, false),
              or(
                eq(restaurants.isFoodTruck, true),
                inArray(restaurants.businessType, [
                  "food_truck",
                  "truck",
                  "food-truck",
                  "foodtruck",
                  "mobile_food_vendor",
                ]),
              ),
            ),
          )
          .limit(300)
          .catch(() => []),
        db
          .select({
            id: suppliers.id,
            businessName: suppliers.businessName,
            address: suppliers.address,
            city: suppliers.city,
            state: suppliers.state,
            latitude: suppliers.latitude,
            longitude: suppliers.longitude,
            contactPhone: suppliers.contactPhone,
            contactEmail: suppliers.contactEmail,
            isActive: suppliers.isActive,
            onlinePaymentsEnabled: suppliers.onlinePaymentsEnabled,
            onlinePaymentsAllowAch: suppliers.onlinePaymentsAllowAch,
            onlinePaymentsAllowCard: suppliers.onlinePaymentsAllowCard,
            onlinePaymentsMinOrderCents: suppliers.onlinePaymentsMinOrderCents,
            onlinePaymentsNotes: suppliers.onlinePaymentsNotes,
            offersDelivery: suppliers.offersDelivery,
            deliveryRadiusMiles: suppliers.deliveryRadiusMiles,
            deliveryFeeCents: suppliers.deliveryFeeCents,
            deliveryMinOrderCents: suppliers.deliveryMinOrderCents,
            deliveryNotes: suppliers.deliveryNotes,
            updatedAt: suppliers.updatedAt,
            ownerDisabled: users.isDisabled,
            publicProfileSettings: users.publicProfileSettings,
          })
          .from(suppliers)
          .innerJoin(users, eq(suppliers.userId, users.id))
          .where(
            and(eq(suppliers.isActive, true), eq(users.isDisabled, false)),
          )
          .limit(250)
          .catch(() => []),
        db
          .select({
            supplierId: supplierProducts.supplierId,
            name: supplierProducts.name,
            description: supplierProducts.description,
          })
          .from(supplierProducts)
          .where(eq(supplierProducts.isActive, true))
          .limit(1000)
          .catch(() => []),
      ]);

      const typedAllHosts = allHosts as Array<{
        id: string;
        userId?: string | null;
        businessName: string;
        address: string;
        city?: string | null;
        state?: string | null;
        latitude?: string | null;
        longitude?: string | null;
        locationType?: string | null;
        expectedFootTraffic?: number | null;
        notes?: string | null;
        isVerified?: boolean | null;
        showFuelPrices?: boolean | null;
        gasPriceRegularCents?: number | null;
        gasPriceMidgradeCents?: number | null;
        gasPricePremiumCents?: number | null;
        gasPriceDieselCents?: number | null;
        gasPriceUpdatedAt?: Date | string | null;
        gasPriceSource?: string | null;
      }>;

      const hostUserIds = Array.from(
        new Set(
          typedAllHosts
            .map((host) => String(host.userId || "").trim())
            .filter(Boolean),
        ),
      );

      const hostOwnerRows =
        hostUserIds.length > 0
          ? await db
              .select({
                id: users.id,
                isDisabled: users.isDisabled,
                publicProfileSettings: users.publicProfileSettings,
              })
              .from(users)
              .where(inArray(users.id, hostUserIds))
          : [];
      const hostOwnerById = new Map<
        string,
        { isDisabled: boolean | null; publicProfileSettings: unknown }
      >(
        hostOwnerRows.map((row: any) => [String(row.id), row]),
      );
      const hostVisibilityByHostId = new Map<
        string,
        { showAddress: boolean; showContact: boolean }
      >();

      const hostProfiles = typedAllHosts.filter((host) => {
        const userId = String(host.userId || "").trim();
        const owner = userId ? hostOwnerById.get(userId) : null;
        if (!owner || owner.isDisabled !== false) return false;
        const visibility = resolvePublicProfileVisibility(
          owner.publicProfileSettings,
        );
        if (!visibility.showAddress) return false;
        const address = String(host.address || "").trim();
        if (!address) return false;
        if (
          parseCoord(host.latitude) === null ||
          parseCoord(host.longitude) === null
        ) {
          return false;
        }
        if (
          !isHostProfileMapEligible({
            businessName: host.businessName,
            address: host.address,
            city: host.city,
            state: host.state,
          })
        ) {
          return false;
        }
        hostVisibilityByHostId.set(String(host.id), visibility);
        return true;
      });

      const hostProfileById = new Map<string, (typeof hostProfiles)[number]>();
      hostProfiles.forEach((host) => {
        hostProfileById.set(String(host.id), host);
      });

      const publicEvents = upcomingEvents.filter((event) => {
        if (event.requiresPayment) return false;
        const hostId = String(event.hostId || event.host?.id || "").trim();
        return Boolean(hostId && hostProfileById.has(hostId));
      });
      const confirmedTrucksByEvent = await loadConfirmedEventTrucks(
        publicEvents.map((event) => String(event.id || "")),
      );
      const suppressedEventScheduleIds = await getSuppressedLocationResourceIds({
        resourceIds: publicEvents
          .filter(
            (event) =>
              (confirmedTrucksByEvent.get(String(event.id || "")) || [])
                .length > 0,
          )
          .map((event) => String(event.id || "").trim())
          .filter(Boolean),
        targetType: "event_schedule",
        now,
      });
      const trustedPublicEvents = publicEvents.filter(
        (event) => !suppressedEventScheduleIds.has(String(event.id || "")),
      );

      const primaryHostLocations = hostProfiles.map((host) => ({
        id: host.id,
        type: "host_location" as const,
        hostId: host.id,
        locationRequestId: null,
        name: host.businessName,
        address: host.address,
        city: host.city ?? null,
        state: host.state ?? null,
        spotImageUrl: (host as any).spotImageUrl ?? null,
        locationType: host.locationType || "other",
        expectedFootTraffic: host.expectedFootTraffic ?? null,
        notes: host.notes ?? null,
        preferredDates: [],
        status: host.isVerified ? "verified" : "active",
        latitude: host.latitude ?? null,
        longitude: host.longitude ?? null,
        // Google profile enrichment
        description: (host as any).description ?? null,
        googlePlaceId: (host as any).googlePlaceId ?? null,
        googlePriceLevel: (host as any).googlePriceLevel ?? null,
        googleBusinessStatus: (host as any).googleBusinessStatus ?? null,
        googlePhotos: (host as any).googlePhotos ?? null,
        googleCategories: (host as any).googleCategories ?? null,
        googleFormattedPhone: hostVisibilityByHostId.get(String(host.id))
          ?.showContact
          ? (host as any).googleFormattedPhone ?? null
          : null,
        businessHours: (host as any).businessHours ?? null,
        businessWebsite: hostVisibilityByHostId.get(String(host.id))?.showContact
          ? (host as any).businessWebsite ?? null
          : null,
        showFuelPrices: Boolean((host as any).showFuelPrices),
        fuelPrices: (host as any).showFuelPrices
          ? {
              regularCents: (host as any).gasPriceRegularCents ?? null,
              midgradeCents: (host as any).gasPriceMidgradeCents ?? null,
              premiumCents: (host as any).gasPricePremiumCents ?? null,
              dieselCents: (host as any).gasPriceDieselCents ?? null,
              updatedAt: (host as any).gasPriceUpdatedAt ?? null,
              source: (host as any).gasPriceSource ?? null,
            }
          : null,
      }));

      // Open location-demand submissions are private signals, not public pins.
      const hostLocations = primaryHostLocations;

      const manualScheduleIds = (publicManualSchedules as any[])
        .map((schedule) => String(schedule.id || "").trim())
        .filter(Boolean);
      const suppressedManualScheduleIds =
        await getSuppressedLocationResourceIds({
          resourceIds: manualScheduleIds,
          targetType: "manual_schedule",
          now,
        });

      const manualScheduleLocations = (publicManualSchedules as any[])
        .filter((schedule) => {
          const address = String(schedule.address || "").trim();
          const truckName = String(schedule.truckName || "").trim();
          if (!address || !truckName) return false;
          if (schedule.mapEligible !== true) return false;
          if (
            !isTruckOperatingPlanRowPublic(
              {
                sourceKind: "manual",
                stopId: schedule.id,
                date: schedule.date,
                startTime: schedule.startTime,
                endTime: schedule.endTime,
                sourceStatus: schedule.status,
                isPublic: schedule.isPublic,
                locationName: schedule.locationName,
                address: schedule.address,
                city: schedule.city,
                state: schedule.state,
                timezone: schedule.timezone,
                updatedAt: schedule.updatedAt,
                lastConfirmedAt: schedule.lastConfirmedAt,
                expiresAt: schedule.expiresAt,
                sourceType: schedule.sourceType,
                sourceConfidence: schedule.sourceConfidence,
                ownerSubmittedEquivalent: schedule.ownerSubmittedEquivalent,
                notice: schedule.notes,
                mapEligible: schedule.mapEligible,
                liveFeedEligible: schedule.liveFeedEligible,
              },
              now,
            )
          ) {
            return false;
          }
          if (suppressedManualScheduleIds.has(String(schedule.id))) {
            return false;
          }

          const timeZone =
            String(schedule.timezone || "").trim() ||
            resolveCityTimeZoneSync({
              city: schedule.city ?? null,
              state: schedule.state ?? null,
            });
          const servingWindow = buildSlotDateTimes({
            timeZone,
            date: schedule.date,
            startTime: String(schedule.startTime || ""),
            endTime: String(schedule.endTime || ""),
          });
          if (!servingWindow) return false;
          return (
            servingWindow.startUtc.getTime() <= now.getTime() &&
            servingWindow.endUtc.getTime() >= now.getTime()
          );
        })
        .map((schedule) => ({
          id: `manual:${schedule.id}`,
          type: "truck_manual_schedule" as const,
          name: schedule.locationName
            ? `${schedule.truckName} at ${schedule.locationName}`
            : `${schedule.truckName} scheduled stop`,
          description: schedule.notes ?? null,
          date: schedule.date,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          maxTrucks: 1,
          status: "scheduled",
          hostId: null,
          hostName: schedule.locationName || schedule.truckName,
          hostAddress: schedule.address,
          hostCity: schedule.city ?? null,
          hostState: schedule.state ?? null,
          hostLatitude: null,
          hostLongitude: null,
          hardCapEnabled: true,
          seriesId: null,
          bookedRestaurantId: schedule.truckId,
          truckId: schedule.truckId,
          truckName: schedule.truckName,
          manualScheduleId: schedule.id,
          lastConfirmedAt: schedule.lastConfirmedAt ?? null,
        }));

      const eventLocations = [
        ...trustedPublicEvents.map((event) => {
          const publicHost = hostProfileById.get(String(event.hostId || ""));
          if (!publicHost) return null;
          const confirmedTrucks =
            confirmedTrucksByEvent.get(String(event.id || "")) || [];
          const primaryTruck = confirmedTrucks[0] || null;
          return {
            id: event.id,
            type: "event" as const,
            name: event.name || "Host Event",
            description: event.description,
            date: event.date,
            startTime: event.startTime,
            endTime: event.endTime,
            maxTrucks: event.maxTrucks,
            status: event.status,
            hostId: event.hostId,
            hostName: publicHost.businessName,
            hostAddress: publicHost.address,
            hostCity: publicHost.city ?? null,
            hostState: publicHost.state ?? null,
            hostLatitude: publicHost.latitude,
            hostLongitude: publicHost.longitude,
            hardCapEnabled: event.hardCapEnabled,
            seriesId: event.seriesId,
            bookedRestaurantId: primaryTruck?.truckId || null,
            truckId: primaryTruck?.truckId || null,
            truckName: primaryTruck?.name || null,
            trucks: confirmedTrucks.map((truck) => ({
              id: truck.truckId,
              name: truck.name,
              cuisineType: truck.cuisineType,
            })),
          };
        }).filter(Boolean),
        ...manualScheduleLocations,
      ];

      const supplierProductsById = new Map<string, string[]>();
      (activeSupplierProducts as any[]).forEach((product) => {
        const supplierId = String(product.supplierId || "").trim();
        if (!supplierId) return;
        const label = [product.name, product.description]
          .filter(Boolean)
          .join(" - ")
          .trim();
        if (!label) return;
        const previous = supplierProductsById.get(supplierId) || [];
        previous.push(label);
        supplierProductsById.set(supplierId, previous);
      });

      const classifySupplier = (supplier: any) => {
        const products = supplierProductsById.get(String(supplier.id)) || [];
        const haystack = [
          supplier.businessName,
          supplier.address,
          supplier.city,
          supplier.state,
          ...products,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (
          /\b(propane|lp gas|lpg|cylinder|tank refill|gas refill)\b/i.test(
            haystack,
          )
        ) {
          return {
            category: "propane_dealer",
            categoryLabel: "Propane dealer",
          };
        }
        if (
          /\b(equipment|manufacturer|fabricat|trailer|commissary|kitchen|generator|repair|service|parts)\b/i.test(
            haystack,
          )
        ) {
          return {
            category: "equipment_supplier",
            categoryLabel: "Equipment supplier",
          };
        }
        return {
          category: "supplier",
          categoryLabel: "Supplier",
        };
      };

      const supplierLocations = toPublicSupplierListingArray(
        activeSuppliers as any[],
      )
        .filter((supplier) => {
          const hasAddress = String(supplier.address || "").trim();
          const lat = parseCoord(
            supplier.latitude as string | number | null | undefined,
          );
          const lng = parseCoord(
            supplier.longitude as string | number | null | undefined,
          );
          return hasAddress || (lat !== null && lng !== null);
        })
        .map((supplier) => {
          const classified = classifySupplier(supplier);
          return {
            id: supplier.id,
            type: "supplier" as const,
            supplierId: supplier.id,
            name: supplier.businessName,
            address: supplier.address,
            city: supplier.city ?? null,
            state: supplier.state ?? null,
            latitude: supplier.latitude ?? null,
            longitude: supplier.longitude ?? null,
            offersDelivery: Boolean(supplier.offersDelivery),
            deliveryRadiusMiles: supplier.deliveryRadiusMiles ?? null,
            productHighlights: (
              supplierProductsById.get(String(supplier.id)) || []
            ).slice(0, 3),
            profileUrl: `/suppliers?supplier=${encodeURIComponent(
              String(supplier.id),
            )}`,
            ...classified,
          };
        });

      // Anonymous map reads are strictly read-only. Coordinate enrichment and
      // persistence belong in an explicit owner/admin background workflow.

      const payload = toPublicMapLocationsPayload({
        hostLocations,
        eventLocations,
        supplierLocations,
      });
      const capturedAt = Date.now();
      mapLocationsCache = {
        payload,
        capturedAt,
        // Overlay requests may reuse only the just-built response. Entity
        // authority is otherwise reloaded for every anonymous map request.
        expiresAt: capturedAt + 1_000,
      };
      res.json(toRequestedMapPayload(payload));
    } catch (error) {
      console.error("Error building map locations feed:", error);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-MealScout-Degraded", "1");
      res.setHeader("Retry-After", "30");
      return res.status(503).json({
        code: "MAP_LOCATIONS_UNAVAILABLE",
        message: "Map locations are temporarily unavailable",
      });
    }
  });

  app.post("/api/public/truck-sightings", async (req: any, res) => {
    try {
      const truckName = clampText(req.body?.truckName, 120);
      const notes = clampText(req.body?.notes, 500);
      const locationLabel = clampText(req.body?.locationLabel, 180);
      const source = clampText(req.body?.source, 80) || "map_user_ping";
      const photoUrl = String(req.body?.photoUrl || "").trim();
      const latitude = Number(req.body?.latitude);
      const longitude = Number(req.body?.longitude);
      const seenAtRaw = String(req.body?.seenAt || "").trim();
      const seenAt = seenAtRaw ? new Date(seenAtRaw) : new Date();

      if (!truckName) {
        return res.status(400).json({ message: "Truck name is required" });
      }
      if (!photoUrl) {
        return res.status(400).json({ message: "Photo is required" });
      }
      if (!isAllowedTruckSightingPhotoUrl(photoUrl)) {
        return res.status(400).json({
          message: "Photo must be a supported image under 6MB.",
        });
      }
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        return res.status(400).json({ message: "Valid coordinates are required" });
      }
      if (Number.isNaN(seenAt.getTime())) {
        return res.status(400).json({ message: "Valid sighting time is required" });
      }

      const rateLimitKey = String(req.user?.id || req.ip || "anonymous");
      const now = Date.now();
      const windowStart = now - 10 * 60 * 1000;
      const attempts = (truckSightingRateLimits.get(rateLimitKey) || []).filter(
        (timestamp) => timestamp > windowStart,
      );
      if (attempts.length >= 5) {
        return res.status(429).json({
          message: "Please wait before submitting another truck sighting.",
        });
      }
      attempts.push(now);
      truckSightingRateLimits.set(rateLimitKey, attempts);

      const [created] = await db
        .insert(moderationEvents)
        .values({
          eventType: COMMUNITY_TRUCK_SIGHTING_EVENT,
          severity: "low",
          reportedResourceType: "truck_sighting",
          reporterUserId: req.user?.id || null,
          reason: "Community food truck sighting",
          description: notes || `Community sighting for ${truckName}`,
          metadata: {
            truckName,
            photoUrl,
            latitude,
            longitude,
            notes: notes || null,
            locationLabel: locationLabel || null,
            source,
            seenAt: seenAt.toISOString(),
          },
          status: "open",
        })
        .returning({
          id: moderationEvents.id,
          createdAt: moderationEvents.createdAt,
        });

      return res.status(201).json({
        id: created?.id,
        status: "under_review",
      });
    } catch (error) {
      console.error("Error submitting community truck sighting:", error);
      return res.status(500).json({ message: "Failed to submit truck sighting" });
    }
  });

  app.get("/api/trucks/community-sightings/live", async (req, res) => {
    try {
      const latitude = Number(req.query.lat);
      const longitude = Number(req.query.lng);
      const radiusKm = Math.min(Math.max(Number(req.query.radiusKm) || 6, 0.5), 25);
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        return res.status(400).json({ message: "lat and lng are required" });
      }

      const since = new Date(Date.now() - COMMUNITY_TRUCK_SIGHTING_TTL_MS);
      const rows = await db
        .select({
          id: moderationEvents.id,
          metadata: moderationEvents.metadata,
          description: moderationEvents.description,
          createdAt: moderationEvents.createdAt,
        })
        .from(moderationEvents)
        .where(
          and(
            eq(moderationEvents.eventType, COMMUNITY_TRUCK_SIGHTING_EVENT),
            eq(moderationEvents.status, "approved"),
            gte(moderationEvents.createdAt, since),
          ),
        )
        .orderBy(desc(moderationEvents.createdAt))
        .limit(250);

      const sightings = rows
        .map((row: {
          id: string;
          metadata: unknown;
          description: string | null;
          createdAt: Date | string;
        }) => {
          const metadata = (row.metadata || {}) as Record<string, unknown>;
          const sightingLat = Number(metadata.latitude);
          const sightingLng = Number(metadata.longitude);
          if (!Number.isFinite(sightingLat) || !Number.isFinite(sightingLng)) {
            return null;
          }
          const distanceKm = distanceKmBetween(
            latitude,
            longitude,
            sightingLat,
            sightingLng,
          );
          if (distanceKm > radiusKm) return null;
          return serializeCommunityTruckSighting({
            id: row.id,
            metadata,
            description: row.description,
            createdAt: row.createdAt,
            distanceKm,
          });
        })
        .filter(Boolean);

      res.setHeader("Cache-Control", "no-store");
      return res.json(sightings);
    } catch (error) {
      console.error("Error loading community truck sightings:", error);
      return res.status(500).json({ message: "Failed to load truck sightings" });
    }
  });

  app.get("/api/map/overlays", async (req, res) => {
    try {
      const bounds = parseBounds(req.query as Record<string, unknown>);
      if (!bounds) {
        return res.status(400).json({ message: "Valid bounds are required" });
      }

      const zoom = Math.max(
        1,
        Math.min(22, Number(req.query.zoom || 12) || 12),
      );
      const pad =
        zoom <= 9 ? 0.12 : zoom <= 12 ? 0.06 : zoom <= 15 ? 0.03 : 0.015;
      const expandedBounds = expandPublicMapBounds(bounds, pad);

      const snapshot =
        mapLocationsCache && mapLocationsCache.expiresAt > Date.now()
          ? mapLocationsCache
          : null;
      if (!snapshot) {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-MealScout-Degraded", "1");
        res.setHeader("Retry-After", "30");
        return res.status(503).json({
          code: "MAP_LOCATIONS_UNAVAILABLE",
          message: "Map locations are temporarily unavailable",
        });
      }

      const boundedPayload = toBoundedPublicMapLocationsPayload(
        snapshot.payload,
        expandedBounds,
      );
      const hostLocations = boundedPayload.hostLocations;
      const eventLocations = boundedPayload.eventLocations;
      const supplierLocations = boundedPayload.supplierLocations;

      const maxPerLayer = zoom <= 9 ? 800 : zoom <= 12 ? 1200 : 2000;
      const clippedHosts = hostLocations.slice(0, maxPerLayer);
      const clippedEvents = eventLocations.slice(0, maxPerLayer);
      const clippedSuppliers = supplierLocations.slice(0, maxPerLayer);

      const version = String(snapshot.capturedAt);

      res.setHeader("Cache-Control", "no-store");
      res.json({
        version,
        zoom,
        bounds,
        hostLocations: clippedHosts,
        eventLocations: clippedEvents,
        supplierLocations: clippedSuppliers,
      });
    } catch (error) {
      console.error("Error building map overlays feed:", error);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-MealScout-Degraded", "1");
      res.setHeader("Retry-After", "30");
      return res.status(503).json({
        code: "MAP_LOCATIONS_UNAVAILABLE",
        message: "Map locations are temporarily unavailable",
      });
    }
  });

  app.get("/api/map/route-summary", async (req, res) => {
    const originLat = toFiniteNumber(req.query.originLat);
    const originLng = toFiniteNumber(req.query.originLng);
    const destLat = toFiniteNumber(req.query.destLat);
    const destLng = toFiniteNumber(req.query.destLng);
    const travelModeRaw = String(req.query.travelMode || "DRIVE")
      .trim()
      .toUpperCase();
    const travelMode: "DRIVE" | "WALK" | "BICYCLE" =
      travelModeRaw === "WALK" || travelModeRaw === "BICYCLE"
        ? (travelModeRaw as "WALK" | "BICYCLE")
        : "DRIVE";

    if (
      originLat === null ||
      originLng === null ||
      destLat === null ||
      destLng === null
    ) {
      return res
        .status(400)
        .json({ message: "origin/destination is required" });
    }

    const withinBounds =
      originLat >= -90 &&
      originLat <= 90 &&
      destLat >= -90 &&
      destLat <= 90 &&
      originLng >= -180 &&
      originLng <= 180 &&
      destLng >= -180 &&
      destLng <= 180;
    if (!withinBounds) {
      return res.status(400).json({ message: "Invalid coordinates" });
    }

    const cacheKey = [
      Number(originLat.toFixed(3)),
      Number(originLng.toFixed(3)),
      Number(destLat.toFixed(3)),
      Number(destLng.toFixed(3)),
      travelMode,
    ].join(":");
    const cached = mapRouteSummaryCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.setHeader("Cache-Control", "no-store");
      return res.json(cached.payload);
    }

    const apiKey = getGoogleMapsServerApiKey();
    if (!apiKey) {
      return res
        .status(503)
        .json({ message: "Google Maps key not configured" });
    }

    try {
      const route = await computeGoogleRoute({
        apiKey,
        origin: { lat: originLat, lng: originLng },
        destination: { lat: destLat, lng: destLng },
        travelMode,
      });
      if (!route) {
        return res.status(404).json({ message: "Route not available" });
      }

      const payload = {
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        travelMode,
        source: "google_routes" as const,
        encodedPolyline: route.encodedPolyline,
      };
      mapRouteSummaryCache.set(cacheKey, {
        expiresAt: Date.now() + 10 * 60_000, // 10-minute TTL
        payload,
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json(payload);
    } catch (error) {
      console.error("[map.route-summary] failed", error);
      return res.status(500).json({ message: "Unable to compute route" });
    }
  });

  app.get("/api/map/route-corridor", async (req, res) => {
    const originLat = parseAutocompleteCoordinate(req.query.originLat, 90);
    const originLng = parseAutocompleteCoordinate(req.query.originLng, 180);
    const destLat = parseAutocompleteCoordinate(req.query.destLat, 90);
    const destLng = parseAutocompleteCoordinate(req.query.destLng, 180);
    if (
      originLat === null ||
      originLng === null ||
      destLat === null ||
      destLng === null
    ) {
      return res.status(400).json({
        message: "Valid origin and destination coordinates are required",
      });
    }

    const apiKey = getGoogleMapsServerApiKey();
    if (!apiKey) {
      return res.status(503).json({
        available: false,
        message: "Google Maps routes are not configured",
      });
    }

    const origin = { lat: originLat, lng: originLng };
    const destination = { lat: destLat, lng: destLng };
    const cacheKey = [
      originLat.toFixed(3),
      originLng.toFixed(3),
      destLat.toFixed(3),
      destLng.toFixed(3),
      "drive-v1",
    ].join(":");
    try {
      const route = await computeGoogleRoute({
        apiKey,
        origin,
        destination,
        travelMode: "DRIVE",
      });
      if (!route?.encodedPolyline) {
        return res.status(404).json({
          available: false,
          message: "A drivable route was not found",
        });
      }

      const routePath = decodeGooglePolyline(route.encodedPolyline);
      if (routePath.length < 2) {
        return res.status(404).json({
          available: false,
          message: "Route geometry was not available",
        });
      }

      const storedHosts = (await storage.getAllHosts().catch(() => [])) as any[];
      const storedHostUserIds = Array.from(
        new Set(
          storedHosts
            .map((host) => String(host?.userId || "").trim())
            .filter(Boolean),
        ),
      );
      const activeStoredHostRows =
        storedHostUserIds.length > 0
          ? await db
              .select({
                id: users.id,
                isDisabled: users.isDisabled,
                publicProfileSettings: users.publicProfileSettings,
              })
              .from(users)
              .where(inArray(users.id, storedHostUserIds))
              .catch(() => null)
          : null;
      const activeStoredHostByUserId = new Map(
        (Array.isArray(activeStoredHostRows) ? activeStoredHostRows : []).map(
          (row: any) => [String(row.id), row],
        ),
      );
      const storedHostRows = storedHosts
        .filter((host) => {
          const userId = String(host?.userId || "").trim();
          const owner = userId ? activeStoredHostByUserId.get(userId) : null;
          if (!owner || owner.isDisabled !== false) return false;
          if (
            !resolvePublicProfileVisibility(owner.publicProfileSettings)
              .showAddress
          ) {
            return false;
          }
          if (
            !isHostProfileMapEligible({
              businessName: host?.businessName,
              address: host?.address,
              city: host?.city,
              state: host?.state,
            })
          ) {
            return false;
          }
          return (
            toFiniteNumber(host?.latitude) !== null &&
            toFiniteNumber(host?.longitude) !== null
          );
        })
        .map((host) => ({
          id: host.id,
          hostId: host.id,
          name: host.businessName,
          address: host.address,
          city: host.city ?? null,
          state: host.state ?? null,
          latitude: host.latitude ?? null,
          longitude: host.longitude ?? null,
          spotImageUrl: host.spotImageUrl ?? null,
        }));
      const hostRowsById = new Map<string, any>();
      storedHostRows.forEach((row: any) => {
        const rowId =
          String(row?.id || "").trim() ||
          `${String(row?.hostId || "")}:${String(row?.latitude || "")}:${String(
            row?.longitude || "",
          )}`;
        if (rowId) hostRowsById.set(rowId, row);
      });
      const hostRows = Array.from(hostRowsById.values());
      const seenLocationIds = new Set<string>();
      const hostCandidates = hostRows
        .map((row: any) => {
          const latitude = toFiniteNumber(row?.latitude);
          const longitude = toFiniteNumber(row?.longitude);
          const hostId = String(row?.hostId || "").trim();
          if (latitude === null || longitude === null || !hostId) return null;
          const locationId =
            String(row?.id || "").trim() ||
            `${hostId}:${latitude.toFixed(5)}:${longitude.toFixed(5)}`;
          if (seenLocationIds.has(locationId)) return null;
          seenLocationIds.add(locationId);
          const routeLocation = locatePointAlongRoute(
            { lat: latitude, lng: longitude },
            routePath,
          );
          const distanceFromRouteMiles = routeLocation.distanceKm * 0.621371;
          if (distanceFromRouteMiles > ROUTE_CORRIDOR_HOST_RADIUS_MILES) {
            return null;
          }
          return {
            locationId,
            hostId,
            name: String(row?.name || "Parking Pass host").trim(),
            address: String(row?.address || "").trim(),
            city: String(row?.city || "").trim(),
            state: String(row?.state || "").trim(),
            latitude,
            longitude,
            spotImageUrl: String(row?.spotImageUrl || "").trim() || null,
            distanceFromRouteMiles: Number(distanceFromRouteMiles.toFixed(1)),
            routeProgressMiles: Number(
              (routeLocation.progressKm * 0.621371).toFixed(1),
            ),
          };
        })
        .filter(
          (
            row,
          ): row is {
            locationId: string;
            hostId: string;
            name: string;
            address: string;
            city: string;
            state: string;
            latitude: number;
            longitude: number;
            spotImageUrl: string | null;
            distanceFromRouteMiles: number;
            routeProgressMiles: number;
          } => row !== null,
        );

      const selectedHostCandidates = (() => {
        if (hostCandidates.length <= ROUTE_CORRIDOR_MAX_HOSTS) {
          return [...hostCandidates].sort(
            (left, right) => left.routeProgressMiles - right.routeProgressMiles,
          );
        }
        const directRouteMiles = Math.max(route.distanceMeters / 1609.344, 1);
        const selected = new Map<string, (typeof hostCandidates)[number]>();
        for (let bucket = 0; bucket < ROUTE_CORRIDOR_MAX_HOSTS; bucket += 1) {
          const start = (directRouteMiles * bucket) / ROUTE_CORRIDOR_MAX_HOSTS;
          const end =
            (directRouteMiles * (bucket + 1)) / ROUTE_CORRIDOR_MAX_HOSTS;
          const best = hostCandidates
            .filter(
              (candidate) =>
                candidate.routeProgressMiles >= start &&
                (bucket === ROUTE_CORRIDOR_MAX_HOSTS - 1
                  ? candidate.routeProgressMiles <= end
                  : candidate.routeProgressMiles < end),
            )
            .sort(
              (left, right) =>
                left.distanceFromRouteMiles - right.distanceFromRouteMiles,
            )[0];
          if (best) selected.set(best.locationId, best);
        }
        if (selected.size < ROUTE_CORRIDOR_MAX_HOSTS) {
          [...hostCandidates]
            .sort(
              (left, right) =>
                left.distanceFromRouteMiles - right.distanceFromRouteMiles,
            )
            .forEach((candidate) => {
              if (selected.size >= ROUTE_CORRIDOR_MAX_HOSTS) return;
              selected.set(candidate.locationId, candidate);
            });
        }
        return Array.from(selected.values()).sort(
          (left, right) => left.routeProgressMiles - right.routeProgressMiles,
        );
      })();

      const enrichHosts = async (): Promise<RouteCorridorHost[]> =>
        Promise.all(
          selectedHostCandidates.map(async (host) => {
            const waypoint = { lat: host.latitude, lng: host.longitude };
            const viaRoute = await computeGoogleRoute({
              apiKey,
              origin,
              destination,
              intermediate: waypoint,
            }).catch(() => null);
            const addedDistanceMeters = viaRoute
              ? Math.max(0, viaRoute.distanceMeters - route.distanceMeters)
              : null;
            const addedDurationSeconds = viaRoute
              ? Math.max(0, viaRoute.durationSeconds - route.durationSeconds)
              : null;
            return {
              ...host,
              journeyDistanceMeters: viaRoute?.distanceMeters ?? null,
              journeyDurationSeconds: viaRoute?.durationSeconds ?? null,
              addedDistanceMeters,
              addedDurationSeconds,
              directionsUri: buildGoogleDirectionsUrl({
                origin,
                destination,
                waypoint,
              }),
              source: "mealscout_parking_pass" as const,
            };
          }),
        );

      const searches: Array<{
        kind: OperatorSupportKind;
        textQuery: string;
      }> = [
        { kind: "gas", textQuery: "gas station" },
        { kind: "propane", textQuery: "propane supplier" },
        { kind: "supply", textQuery: "restaurant supply store" },
        { kind: "support", textQuery: "commercial kitchen equipment repair" },
      ];

      const searchAlongRoute = async ({
        kind,
        textQuery,
      }: (typeof searches)[number]): Promise<RouteCorridorSupportPlace[]> => {
        const runSearch = async (includeRouting: boolean) => {
          const body: Record<string, unknown> = {
            textQuery,
            maxResultCount: 4,
            languageCode: "en",
            regionCode: "US",
            searchAlongRouteParameters: {
              polyline: { encodedPolyline: route.encodedPolyline },
            },
          };
          if (includeRouting) {
            body.routingParameters = {
              origin: { latitude: origin.lat, longitude: origin.lng },
              travelMode: "DRIVE",
            };
          }
          const fieldMask = [
            "places.id",
            "places.displayName",
            "places.formattedAddress",
            "places.location",
            "places.primaryType",
            "places.types",
            "places.businessStatus",
            "places.nationalPhoneNumber",
            "places.googleMapsUri",
            ...(includeRouting ? ["routingSummaries"] : []),
          ].join(",");
          const response = await fetchWithTimeout(
            "https://places.googleapis.com/v1/places:searchText",
            {
              method: "POST",
              headers: buildPlacesHeaders(apiKey, fieldMask),
              body: JSON.stringify(body),
            },
            MAP_PROVIDER_TIMEOUT_MS,
          );
          if (!response.ok) return null;
          return (await response.json().catch(() => null)) as any;
        };

        const data = (await runSearch(true)) || (await runSearch(false));
        const places = Array.isArray(data?.places) ? data.places : [];
        const routingSummaries = Array.isArray(data?.routingSummaries)
          ? data.routingSummaries
          : [];
        return places
          .map((place: any, index: number) => {
            const latitude = toFiniteNumber(place?.location?.latitude);
            const longitude = toFiniteNumber(place?.location?.longitude);
            if (latitude === null || longitude === null) return null;
            const businessStatus =
              String(place?.businessStatus || "").trim() || null;
            if (businessStatus && businessStatus !== "OPERATIONAL") return null;

            const summary = routingSummaries[index];
            const legs = Array.isArray(summary?.legs) ? summary.legs : [];
            const firstLegDistance = Number(legs[0]?.distanceMeters);
            const secondLegDistance = Number(legs[1]?.distanceMeters);
            const firstLegDuration = parseDurationSeconds(legs[0]?.duration);
            const secondLegDuration = parseDurationSeconds(legs[1]?.duration);
            const hasTwoLegDistance =
              Number.isFinite(firstLegDistance) &&
              Number.isFinite(secondLegDistance);
            const hasTwoLegDuration =
              firstLegDuration !== null && secondLegDuration !== null;
            const journeyDistanceMeters = hasTwoLegDistance
              ? Math.max(0, Math.round(firstLegDistance + secondLegDistance))
              : null;
            const journeyDurationSeconds = hasTwoLegDuration
              ? firstLegDuration! + secondLegDuration!
              : null;
            const waypoint = { lat: latitude, lng: longitude };
            return {
              placeId: String(place?.id || "").trim(),
              kind,
              name: String(place?.displayName?.text || textQuery).trim(),
              address: String(place?.formattedAddress || "").trim(),
              latitude,
              longitude,
              primaryType: String(place?.primaryType || "").trim() || null,
              businessStatus,
              phone: String(place?.nationalPhoneNumber || "").trim() || null,
              googleMapsUri: String(place?.googleMapsUri || "").trim() || null,
              straightLineMiles: Number(
                (
                  distanceKmBetween(
                    origin.lat,
                    origin.lng,
                    latitude,
                    longitude,
                  ) * 0.621371
                ).toFixed(1),
              ),
              driveDistanceMeters: Number.isFinite(firstLegDistance)
                ? Math.max(0, Math.round(firstLegDistance))
                : null,
              driveDurationSeconds: firstLegDuration,
              originToStopDistanceMeters: Number.isFinite(firstLegDistance)
                ? Math.max(0, Math.round(firstLegDistance))
                : null,
              originToStopDurationSeconds: firstLegDuration,
              stopToDestinationDistanceMeters: Number.isFinite(
                secondLegDistance,
              )
                ? Math.max(0, Math.round(secondLegDistance))
                : null,
              stopToDestinationDurationSeconds: secondLegDuration,
              journeyDistanceMeters,
              journeyDurationSeconds,
              addedDistanceMeters:
                journeyDistanceMeters === null
                  ? null
                  : Math.max(0, journeyDistanceMeters - route.distanceMeters),
              addedDurationSeconds:
                journeyDurationSeconds === null
                  ? null
                  : Math.max(0, journeyDurationSeconds - route.durationSeconds),
              directionsUri:
                String(summary?.directionsUri || "").trim() ||
                buildGoogleDirectionsUrl({
                  origin,
                  destination,
                  waypoint,
                }),
              source: "google_places" as const,
            } satisfies RouteCorridorSupportPlace;
          })
          .filter(
            (
              place: RouteCorridorSupportPlace | null,
            ): place is RouteCorridorSupportPlace => place !== null,
          )
          .sort(
            (
              left: RouteCorridorSupportPlace,
              right: RouteCorridorSupportPlace,
            ) => {
              const leftDetour =
                left.addedDurationSeconds ?? Number.POSITIVE_INFINITY;
              const rightDetour =
                right.addedDurationSeconds ?? Number.POSITIVE_INFINITY;
              if (leftDetour !== rightDetour) return leftDetour - rightDetour;
              return (
                (left.originToStopDurationSeconds ?? Number.POSITIVE_INFINITY) -
                (right.originToStopDurationSeconds ?? Number.POSITIVE_INFINITY)
              );
            },
          )
          .slice(0, 4);
      };

      const [parkingPassHosts, ...supportResults] = await Promise.all([
        enrichHosts(),
        ...searches.map(searchAlongRoute),
      ]);
      const categories = searches.reduce(
        (acc, search, index) => {
          acc[search.kind] = supportResults[index] || [];
          return acc;
        },
        {
          gas: [] as RouteCorridorSupportPlace[],
          propane: [] as RouteCorridorSupportPlace[],
          supply: [] as RouteCorridorSupportPlace[],
          support: [] as RouteCorridorSupportPlace[],
        },
      );
      const pathStride = Math.max(1, Math.ceil(routePath.length / 600));
      const displayPath = routePath.filter(
        (_point, index) =>
          index === 0 ||
          index === routePath.length - 1 ||
          index % pathStride === 0,
      );
      const payload = {
        available: true,
        source: "google_routes_places" as const,
        fetchedAt: new Date().toISOString(),
        route: {
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          encodedPolyline: route.encodedPolyline,
          path: displayPath,
          directionsUri: buildGoogleDirectionsUrl({ origin, destination }),
        },
        parkingPassHosts,
        categories,
        corridor: {
          hostRadiusMiles: ROUTE_CORRIDOR_HOST_RADIUS_MILES,
          mapHostLocationsReady: hostRows.length > 0,
        },
      };
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(payload);
    } catch (error) {
      console.warn("[map.route-corridor] failed", error);
      return res.status(500).json({
        available: false,
        message: "Unable to plan this route right now",
      });
    }
  });

  app.get("/api/map/place-autocomplete", async (req, res) => {
    const input = String(req.query.input || "").trim();
    if (input.length < 2) {
      return res.json({ suggestions: [] as PlaceAutocompletePrediction[] });
    }

    const apiKey = getGoogleMapsServerApiKey();
    if (!apiKey) {
      return res.json({ suggestions: [] as PlaceAutocompletePrediction[] });
    }

    // ── Server-side cache check (5-minute TTL) ──────────────────────────────────
    // Cache key excludes sessionToken so the same query always hits the same entry.
    // sessionToken is only used for billing grouping, not for result differentiation.
    const biasLat = parseAutocompleteCoordinate(req.query.lat, 90);
    const biasLng = parseAutocompleteCoordinate(req.query.lng, 180);
    const hasLocationBias = biasLat !== null && biasLng !== null;
    const autocompleteIntent: PlaceAutocompleteIntent =
      String(req.query.intent || "")
        .trim()
        .toLowerCase() === "food"
        ? "food"
        : "destination";
    const autocompleteCacheKey = [
      autocompleteIntent,
      input.toLowerCase(),
      hasLocationBias ? biasLat.toFixed(2) : "no-lat",
      hasLocationBias ? biasLng.toFixed(2) : "no-lng",
    ].join(":");
    const acCached = placeAutocompleteCache.get(autocompleteCacheKey);
    if (acCached && acCached.expiresAt > Date.now()) {
      res.setHeader("Cache-Control", "no-store");
      return res.json({ suggestions: acCached.suggestions });
    }

    const sessionToken = String(req.query.sessionToken || "").trim();

    // ── In-flight deduplication ────────────────────────────────────────────
    // If another request for the same query is already in-flight, wait for it.
    let inflightPromise = autocompleteInflight.get(autocompleteCacheKey);
    if (!inflightPromise) {
      inflightPromise = (async (): Promise<PlaceAutocompletePrediction[]> => {
        const payload: Record<string, unknown> = {
          input,
          includedRegionCodes: ["us"],
          languageCode: "en",
        };
        if (autocompleteIntent === "food") {
          payload.includedPrimaryTypes = [
            "restaurant",
            "cafe",
            "bar",
            "meal_takeaway",
            "meal_delivery",
          ];
        }
        if (sessionToken) payload.sessionToken = sessionToken;
        if (hasLocationBias) {
          payload.locationBias = {
            circle: {
              center: {
                latitude: biasLat,
                longitude: biasLng,
              },
              radius: 50_000,
            },
          };
        }
        const response = await fetchWithTimeout(
          "https://places.googleapis.com/v1/places:autocomplete",
          {
            method: "POST",
            headers: buildPlacesHeaders(
              apiKey,
              [
                "suggestions.placePrediction.placeId",
                "suggestions.placePrediction.text.text",
                "suggestions.placePrediction.structuredFormat.mainText.text",
                "suggestions.placePrediction.structuredFormat.secondaryText.text",
              ].join(","),
            ),
            body: JSON.stringify(payload),
          },
          MAP_PROVIDER_TIMEOUT_MS,
        );
        if (!response.ok) return [];
        const data = (await response.json().catch(() => ({}))) as any;
        const suggestions: PlaceAutocompletePrediction[] = Array.isArray(
          data?.suggestions,
        )
          ? (data.suggestions
              .map((item: any) => {
                const prediction = item?.placePrediction;
                if (!prediction?.placeId) return null;
                const text = String(prediction?.text?.text || "").trim();
                return {
                  placeId: String(prediction.placeId),
                  text,
                  mainText: String(
                    prediction?.structuredFormat?.mainText?.text || text,
                  ).trim(),
                  secondaryText: String(
                    prediction?.structuredFormat?.secondaryText?.text || "",
                  ).trim(),
                };
              })
              .filter(Boolean) as PlaceAutocompletePrediction[])
          : [];
        // Store in server-side cache
        placeAutocompleteCache.set(autocompleteCacheKey, {
          expiresAt: Date.now() + PLACE_AUTOCOMPLETE_TTL_MS,
          suggestions,
        });
        return suggestions;
      })();
      autocompleteInflight.set(autocompleteCacheKey, inflightPromise);
      inflightPromise.finally(() =>
        autocompleteInflight.delete(autocompleteCacheKey),
      );
    }

    try {
      const suggestions = await inflightPromise;
      res.setHeader("Cache-Control", "no-store");
      res.json({ suggestions });
    } catch (error) {
      console.warn("[map.place-autocomplete] failed", error);
      res
        .status(200)
        .json({ suggestions: [] as PlaceAutocompletePrediction[] });
    }
  });

  app.get("/api/map/place-details/:placeId", async (req, res) => {
    const placeId = String(req.params.placeId || "").trim();
    if (!placeId) {
      return res.status(400).json({ message: "placeId is required" });
    }

    const apiKey = getGoogleMapsServerApiKey();
    if (!apiKey) {
      return res
        .status(503)
        .json({ message: "Google Maps key not configured" });
    }

    // ── Server-side cache check (24-hour TTL) ─────────────────────────────────
    // placeId is a permanent identifier — the address it points to never changes.
    const pdCached = placeDetailsCache.get(placeId);
    if (pdCached && pdCached.expiresAt > Date.now()) {
      res.setHeader("Cache-Control", "no-store");
      return res.json({ place: pdCached.place });
    }

    // ── In-flight deduplication ────────────────────────────────────────────
    let pdInflight = placeDetailsInflight.get(placeId);
    if (!pdInflight) {
      pdInflight = (async () => {
        const sessionToken = String(req.query.sessionToken || "").trim();
        const detailsUrl = new URL(
          `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
        );
        if (sessionToken) {
          detailsUrl.searchParams.set("sessionToken", sessionToken);
        }
        const response = await fetchWithTimeout(
          detailsUrl.toString(),
          {
            headers: buildPlacesHeaders(
              apiKey,
              [
                "id",
                "name",
                "formattedAddress",
                "location",
                "addressComponents",
              ].join(","),
            ),
          },
          MAP_PROVIDER_TIMEOUT_MS,
        );
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(text || "Unable to fetch place details");
        }
        const data = (await response.json().catch(() => ({}))) as any;
        const normalized = normalizePlaceDetails(data);
        placeDetailsCache.set(placeId, {
          expiresAt: Date.now() + PLACE_DETAILS_TTL_MS,
          place: normalized,
        });
        return normalized;
      })();
      placeDetailsInflight.set(placeId, pdInflight);
      pdInflight.finally(() => placeDetailsInflight.delete(placeId));
    }

    try {
      const place = await pdInflight;
      res.setHeader("Cache-Control", "no-store");
      res.json({ place });
    } catch (error) {
      console.error("[map.place-details] failed", error);
      res.status(500).json({ message: "Unable to fetch place details" });
    }
  });

  app.get("/api/map/place-intelligence", async (req, res) => {
    const placeId = String(req.query.placeId || "").trim();
    const businessName = clampText(req.query.name, 160);
    const address = clampText(req.query.address, 240);
    const lat = parseAutocompleteCoordinate(req.query.lat, 90);
    const lng = parseAutocompleteCoordinate(req.query.lng, 180);
    const hasOrigin = lat !== null && lng !== null;

    if (!placeId && !businessName && !address) {
      return res.status(400).json({
        available: false,
        source: "google_places",
        fetchedAt: new Date().toISOString(),
        reason: "place_or_address_required",
      } satisfies PlaceIntelligencePayload);
    }

    const apiKey = getGoogleMapsServerApiKey();
    if (!apiKey) {
      return res.status(200).json({
        available: false,
        source: "google_places",
        fetchedAt: new Date().toISOString(),
        reason: "server_places_not_configured",
      } satisfies PlaceIntelligencePayload);
    }

    const cacheKey = placeId
      ? `place:${placeId}`
      : [
          "search",
          normalizeCacheText(businessName),
          normalizeCacheText(address),
          hasOrigin ? lat!.toFixed(3) : "no-lat",
          hasOrigin ? lng!.toFixed(3) : "no-lng",
        ].join(":");
    const cached = await getCached<PlaceIntelligencePayload>(
      "place_intelligence",
      cacheKey,
    );
    if (cached) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(cached);
    }

    try {
      let rawPlace: any = null;
      if (placeId) {
        const response = await fetchWithTimeout(
          `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
          {
            headers: buildPlacesHeaders(
              apiKey,
              placeIntelligenceFieldMask(),
            ),
          },
          MAP_PROVIDER_TIMEOUT_MS,
        );
        if (response.ok) {
          rawPlace = await response.json().catch(() => null);
        } else {
          console.warn(
            `[map.place-intelligence] details provider status ${response.status}`,
          );
        }
      } else {
        const body: Record<string, unknown> = {
          textQuery: [businessName, address].filter(Boolean).join(" "),
          pageSize: 5,
          languageCode: "en",
          regionCode: "US",
        };
        if (hasOrigin) {
          body.locationBias = {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: 5_000,
            },
          };
        }
        const response = await fetchWithTimeout(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: buildPlacesHeaders(
              apiKey,
              placeIntelligenceFieldMask("places."),
            ),
            body: JSON.stringify(body),
          },
          MAP_PROVIDER_TIMEOUT_MS,
        );
        if (response.ok) {
          const data = (await response.json().catch(() => ({}))) as any;
          rawPlace = pickClosestGooglePlace(
            Array.isArray(data?.places) ? data.places : [],
            { lat, lng },
          );
        } else {
          console.warn(
            `[map.place-intelligence] search provider status ${response.status}`,
          );
        }
      }

      if (!rawPlace) {
        const unavailable: PlaceIntelligencePayload = {
          available: false,
          source: "google_places",
          fetchedAt: new Date().toISOString(),
          reason: "place_not_found_or_provider_unavailable",
        };
        await setCached(
          "place_intelligence",
          cacheKey,
          unavailable,
          10 * 60_000,
        );
        return res.status(200).json(unavailable);
      }

      const normalized = normalizeGooglePlaceIntelligence(rawPlace);
      const payload: PlaceIntelligencePayload = {
        available: true,
        source: "google_places",
        fetchedAt: new Date().toISOString(),
        place: normalized,
      };
      await setCached(
        "place_intelligence",
        cacheKey,
        payload,
        PLACE_INTELLIGENCE_TTL_MS,
      );
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(payload);
    } catch (error) {
      console.warn("[map.place-intelligence] failed", error);
      return res.status(200).json({
        available: false,
        source: "google_places",
        fetchedAt: new Date().toISOString(),
        reason: "provider_unavailable",
      } satisfies PlaceIntelligencePayload);
    }
  });

  app.get("/api/map/operator-support", async (req, res) => {
    const lat = parseAutocompleteCoordinate(req.query.lat, 90);
    const lng = parseAutocompleteCoordinate(req.query.lng, 180);
    if (lat === null || lng === null) {
      return res.status(400).json({ message: "Valid lat and lng are required" });
    }

    const apiKey = getGoogleMapsServerApiKey();
    if (!apiKey) {
      return res.status(200).json({
        available: false,
        source: "google_places",
        fetchedAt: new Date().toISOString(),
        reason: "server_places_not_configured",
        categories: { gas: [], propane: [], supply: [], support: [] },
      });
    }

    const cacheKey = `${lat.toFixed(3)}:${lng.toFixed(3)}`;
    const cached = await getCached<any>("operator_support", cacheKey);
    if (cached) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(cached);
    }

    const searches: Array<{
      kind: OperatorSupportKind;
      textQuery: string;
    }> = [
      { kind: "gas", textQuery: "gas station" },
      { kind: "propane", textQuery: "propane supplier" },
      { kind: "supply", textQuery: "restaurant supply store" },
      { kind: "support", textQuery: "commercial kitchen equipment repair" },
    ];

    const searchCategory = async ({
      kind,
      textQuery,
    }: (typeof searches)[number]): Promise<OperatorSupportPlace[]> => {
      const runSearch = async (includeRouting: boolean) => {
        const body: Record<string, unknown> = {
          textQuery,
          pageSize: 5,
          languageCode: "en",
          regionCode: "US",
          rankPreference: "DISTANCE",
          locationBias: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: 50_000,
            },
          },
        };
        if (includeRouting) {
          body.routingParameters = {
            origin: { latitude: lat, longitude: lng },
            travelMode: "DRIVE",
          };
        }
        const fields = [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.location",
          "places.primaryType",
          "places.types",
          "places.businessStatus",
          "places.nationalPhoneNumber",
          "places.googleMapsUri",
          ...(includeRouting ? ["routingSummaries"] : []),
        ].join(",");
        const response = await fetchWithTimeout(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: buildPlacesHeaders(apiKey, fields),
            body: JSON.stringify(body),
          },
          MAP_PROVIDER_TIMEOUT_MS,
        );
        if (!response.ok) return null;
        return (await response.json().catch(() => null)) as any;
      };

      const data = (await runSearch(true)) || (await runSearch(false));
      const places = Array.isArray(data?.places) ? data.places : [];
      const routingSummaries = Array.isArray(data?.routingSummaries)
        ? data.routingSummaries
        : [];
      return places
        .map((place: any, index: number) => {
          const placeLat = toFiniteNumber(place?.location?.latitude);
          const placeLng = toFiniteNumber(place?.location?.longitude);
          if (placeLat === null || placeLng === null) return null;
          const businessStatus =
            String(place?.businessStatus || "").trim() || null;
          if (businessStatus && businessStatus !== "OPERATIONAL") return null;
          const routing = normalizeRoutingSummary(routingSummaries[index]);
          return {
            placeId: String(place?.id || "").trim(),
            kind,
            name: String(place?.displayName?.text || textQuery).trim(),
            address: String(place?.formattedAddress || "").trim(),
            latitude: placeLat,
            longitude: placeLng,
            primaryType: String(place?.primaryType || "").trim() || null,
            businessStatus,
            phone: String(place?.nationalPhoneNumber || "").trim() || null,
            googleMapsUri:
              String(place?.googleMapsUri || "").trim() || null,
            straightLineMiles: Number(
              (distanceKmBetween(lat, lng, placeLat, placeLng) * 0.621371).toFixed(
                1,
              ),
            ),
            driveDistanceMeters: routing.distanceMeters,
            driveDurationSeconds: routing.durationSeconds,
            source: "google_places" as const,
          } satisfies OperatorSupportPlace;
        })
        .filter((place: OperatorSupportPlace | null): place is OperatorSupportPlace =>
          Boolean(place),
        )
        .sort((left: OperatorSupportPlace, right: OperatorSupportPlace) => {
          const leftDistance =
            left.driveDistanceMeters ?? left.straightLineMiles * 1609.344;
          const rightDistance =
            right.driveDistanceMeters ?? right.straightLineMiles * 1609.344;
          return leftDistance - rightDistance;
        })
        .slice(0, 5);
    };

    try {
      const results = await Promise.all(searches.map(searchCategory));
      const categories = searches.reduce(
        (acc, search, index) => {
          acc[search.kind] = results[index] || [];
          return acc;
        },
        {
          gas: [] as OperatorSupportPlace[],
          propane: [] as OperatorSupportPlace[],
          supply: [] as OperatorSupportPlace[],
          support: [] as OperatorSupportPlace[],
        },
      );
      const available = Object.values(categories).some(
        (rows) => rows.length > 0,
      );
      const payload = {
        available,
        source: "google_places" as const,
        fetchedAt: new Date().toISOString(),
        categories,
      };
      await setCached(
        "operator_support",
        cacheKey,
        payload,
        OPERATOR_SUPPORT_TTL_MS,
      );
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(payload);
    } catch (error) {
      console.warn("[map.operator-support] failed", error);
      return res.status(200).json({
        available: false,
        source: "google_places",
        fetchedAt: new Date().toISOString(),
        reason: "provider_unavailable",
        categories: { gas: [], propane: [], supply: [], support: [] },
      });
    }
  });

  app.get("/api/map/hosts/:hostId/upcoming-bookings", async (req, res) => {
    try {
      const hostId = String(req.params.hostId || "").trim();
      if (!hostId) {
        return res.status(400).json({ message: "Host id is required" });
      }

      const [hostRow] = await db
        .select({
          id: hosts.id,
          userId: hosts.userId,
          businessName: hosts.businessName,
          address: hosts.address,
          city: hosts.city,
          state: hosts.state,
          ownerDisabled: users.isDisabled,
          publicProfileSettings: users.publicProfileSettings,
        })
        .from(hosts)
        .innerJoin(users, eq(hosts.userId, users.id))
        .where(and(eq(hosts.id, hostId), eq(users.isDisabled, false)))
        .limit(1);

      const hostVisibility = hostRow
        ? resolvePublicProfileVisibility(hostRow.publicProfileSettings)
        : null;
      if (
        !hostRow ||
        hostRow.ownerDisabled !== false ||
        !hostVisibility?.showAddress ||
        !isHostProfileMapEligible({
          businessName: hostRow.businessName,
          address: hostRow.address,
          city: hostRow.city,
          state: hostRow.state,
        })
      ) {
        return res.status(404).json({ message: "Host not found" });
      }

      const now = new Date();
      const queryStart = new Date(now);
      queryStart.setUTCHours(0, 0, 0, 0);
      queryStart.setUTCDate(queryStart.getUTCDate() - 1);
      const rangeEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

      const rows = await db
        .select({
          eventId: events.id,
          date: events.date,
          startTime: events.startTime,
          endTime: events.endTime,
          bookingConfirmedAt: eventBookings.bookingConfirmedAt,
          truckId: restaurants.id,
          truckName: restaurants.name,
          truckCuisine: restaurants.cuisineType,
        })
        .from(eventBookings)
        .innerJoin(events, eq(eventBookings.eventId, events.id))
        .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id))
        .where(
          and(
            eq(eventBookings.status, "confirmed"),
            isNotNull(eventBookings.bookingConfirmedAt),
            eq(events.hostId, hostId),
            inArray(events.status, ["open", "booked", "filled"]),
            eq(restaurants.isActive, true),
            or(
              eq(restaurants.isFoodTruck, true),
              inArray(restaurants.businessType, [
                "food_truck",
                "truck",
                "food-truck",
                "foodtruck",
                "mobile_food_vendor",
              ]),
            ),
            gte(events.date, queryStart),
            lte(events.date, rangeEnd),
          ),
        )
        .orderBy(asc(events.date), asc(events.startTime))
        .limit(250);

      const publicTrucksByEvent = await loadConfirmedEventTrucks(
        rows.map((row: (typeof rows)[number]) => String(row.eventId || "")),
      );

      const timeZone = resolveCityTimeZoneSync({
        city: hostRow.city || null,
        state: hostRow.state || null,
      });
      const bookings = rows
        .flatMap((row: (typeof rows)[number]) => {
          const publicTruck = (
            publicTrucksByEvent.get(String(row.eventId || "")) || []
          ).find((truck) => truck.truckId === String(row.truckId || ""));
          const interval = buildSlotDateTimes({
            timeZone,
            date: row.date,
            startTime: String(row.startTime || ""),
            endTime: String(row.endTime || ""),
          });
          if (
            !publicTruck ||
            !interval ||
            !row.bookingConfirmedAt ||
            !isSlotPublic({
              slot: {
                source: "parking_pass_booking",
                status: "confirmed",
                startsAtUtc: interval.startUtc,
                endsAtUtc: interval.endUtc,
                lastConfirmedAtUtc: row.bookingConfirmedAt,
              },
              now,
              lookaheadHours: 14 * 24,
              ttlHours: 24 * 365 * 100,
            })
          ) {
            return [];
          }
          return [
            {
              eventId: String(row.eventId),
              date: interval.startUtc.toISOString(),
              startTime: String(row.startTime || ""),
              endTime: String(row.endTime || ""),
              truck: {
                id: publicTruck.truckId,
                name: publicTruck.name,
                cuisineType: publicTruck.cuisineType,
              },
            },
          ];
        })
        .slice(0, 12);

      res.setHeader("Cache-Control", "no-store");
      return res.json({
        hostId,
        generatedAt: new Date().toISOString(),
        rangeDays: 14,
        count: bookings.length,
        bookings,
      });
    } catch (error) {
      console.error("[map] host upcoming bookings failed:", error);
      return res
        .status(500)
        .json({ message: "Failed to load upcoming bookings" });
    }
  });

  app.get(
    "/api/map/business-popularity",
    isAuthenticated,
    isStaffOrAdmin,
    async (req, res) => {
    try {
      const rawRestaurantIds = String(req.query.restaurantIds || "")
        .split(",")
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      const uniqueRestaurantIds = Array.from(new Set(rawRestaurantIds)).slice(
        0,
        200,
      );
      if (uniqueRestaurantIds.length === 0) {
        return res.json({
          generatedAt: new Date().toISOString(),
          restaurants: {},
        });
      }

      const now = new Date();
      const since30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const inTargetIds = inArray(restaurants.id, uniqueRestaurantIds);

      const restaurantRows = await db
        .select({
          id: restaurants.id,
          rankingScore: restaurants.rankingScore,
          googleRating: (restaurants as any).googleRating,
          googleReviewCount: (restaurants as any).googleReviewCount,
        })
        .from(restaurants)
        .where(and(inTargetIds, eq(restaurants.isActive, true)))
        .limit(250);

      const activeDealRows = await db
        .select({
          restaurantId: deals.restaurantId,
          count: sql<number>`count(*)`,
        })
        .from(deals)
        .where(
          and(
            inArray(deals.restaurantId, uniqueRestaurantIds),
            eq(deals.isActive, true),
            lte(deals.startDate, now),
            or(isNull(deals.endDate), gte(deals.endDate, now)),
          ),
        )
        .groupBy(deals.restaurantId);

      const claimRows = await db
        .select({
          restaurantId: deals.restaurantId,
          count: sql<number>`count(*)`,
        })
        .from(dealClaims)
        .innerJoin(deals, eq(dealClaims.dealId, deals.id))
        .where(
          and(
            inArray(deals.restaurantId, uniqueRestaurantIds),
            gte(dealClaims.claimedAt, since30d),
          ),
        )
        .groupBy(deals.restaurantId);

      const viewRows = await db
        .select({
          restaurantId: deals.restaurantId,
          count: sql<number>`count(*)`,
        })
        .from(dealViews)
        .innerJoin(deals, eq(dealViews.dealId, deals.id))
        .where(
          and(
            inArray(deals.restaurantId, uniqueRestaurantIds),
            gte(dealViews.viewedAt, since30d),
          ),
        )
        .groupBy(deals.restaurantId);

      const bookingRows = await db
        .select({
          restaurantId: eventBookings.truckId,
          count: sql<number>`count(*)`,
        })
        .from(eventBookings)
        .innerJoin(events, eq(eventBookings.eventId, events.id))
        .where(
          and(
            inArray(eventBookings.truckId, uniqueRestaurantIds),
            eq(eventBookings.status, "confirmed"),
            isNotNull(eventBookings.bookingConfirmedAt),
            inArray(events.status, ["open", "booked", "filled"]),
            gte(events.date, since30d),
          ),
        )
        .groupBy(eventBookings.truckId);

      const activeDealsByRestaurant = new Map<string, number>();
      const claimsByRestaurant = new Map<string, number>();
      const viewsByRestaurant = new Map<string, number>();
      const bookingsByRestaurant = new Map<string, number>();

      activeDealRows.forEach((row: (typeof activeDealRows)[number]) =>
        activeDealsByRestaurant.set(
          String(row.restaurantId || ""),
          Number(row.count || 0),
        ),
      );
      claimRows.forEach((row: (typeof claimRows)[number]) =>
        claimsByRestaurant.set(
          String(row.restaurantId || ""),
          Number(row.count || 0),
        ),
      );
      viewRows.forEach((row: (typeof viewRows)[number]) =>
        viewsByRestaurant.set(
          String(row.restaurantId || ""),
          Number(row.count || 0),
        ),
      );
      bookingRows.forEach((row: (typeof bookingRows)[number]) =>
        bookingsByRestaurant.set(
          String(row.restaurantId || ""),
          Number(row.count || 0),
        ),
      );

      const scored = restaurantRows.map(
        (row: (typeof restaurantRows)[number]) => {
          const restaurantId = String(row.id || "");
          const ranking = Math.max(0, Number(row.rankingScore || 0));
          const externalRating = Number(row.googleRating || 0);
          const externalReviewCount = Number(row.googleReviewCount || 0);
          const externalScoreAdjustment =
            Number.isFinite(externalRating) && externalRating > 0
              ? computeExternalReviewAdjustment(externalRating) *
                Math.min(1, Math.log10(Math.max(1, externalReviewCount)) / 3)
              : 0;
          const activeDeals = activeDealsByRestaurant.get(restaurantId) || 0;
          const claims30d = claimsByRestaurant.get(restaurantId) || 0;
          const views30d = viewsByRestaurant.get(restaurantId) || 0;
          const bookings30d = bookingsByRestaurant.get(restaurantId) || 0;
          const rawScore =
            ranking * 0.5 +
            externalScoreAdjustment +
            activeDeals * 15 +
            claims30d * 4 +
            bookings30d * 12 +
            Math.min(40, Math.round(views30d / 5));
          return {
            restaurantId,
            rawScore,
            metrics: {
              ranking,
              activeDeals,
              claims30d,
              views30d,
              bookings30d,
            },
          };
        },
      );

      const maxRawScore = Math.max(
        1,
        ...scored.map((row: (typeof scored)[number]) => row.rawScore),
      );
      const byRestaurant: Record<
        string,
        {
          tier: "hot" | "rising" | "steady" | "new";
          label: string;
          color: string;
          score: number;
          metrics: {
            ranking: number;
            activeDeals: number;
            claims30d: number;
            views30d: number;
            bookings30d: number;
          };
        }
      > = {};

      scored.forEach((row: (typeof scored)[number]) => {
        const score = Math.max(
          0,
          Math.min(100, Math.round((row.rawScore / maxRawScore) * 100)),
        );
        const tier =
          score >= 75
            ? "hot"
            : score >= 45
              ? "rising"
              : score >= 20
                ? "steady"
                : "new";
        const label =
          tier === "hot"
            ? "Hot spot"
            : tier === "rising"
              ? "Rising"
              : tier === "steady"
                ? "Steady"
                : "New";
        const color =
          tier === "hot"
            ? "#EF4444"
            : tier === "rising"
              ? "#F59E0B"
              : tier === "steady"
                ? "#84CC16"
                : "#64748B";
        byRestaurant[row.restaurantId] = {
          tier,
          label,
          color,
          score,
          metrics: row.metrics,
        };
      });

      res.setHeader("Cache-Control", "no-store");
      return res.json({
        generatedAt: new Date().toISOString(),
        restaurants: byRestaurant,
      });
    } catch (error) {
      console.error("[map] business popularity failed:", error);
      return res
        .status(500)
        .json({ message: "Failed to load business popularity" });
    }
    },
  );

  app.get("/api/map/foot-traffic", async (req, res) => {
    const launchDegradedMode = isLaunchDegradedMode();
    const bounds = parseBounds(req.query as Record<string, unknown>);
    if (!bounds) {
      return res.status(400).json({ message: "Invalid map bounds" });
    }

    const modeRaw = String(req.query.mode || "")
      .trim()
      .toLowerCase();
    const trafficMode: "avg" | "live" = modeRaw === "live" ? "live" : "avg";

    const requestedWindowRaw = toFiniteNumber(req.query.windowMinutes);
    const requestedWindowMinutesBase = Math.min(
      24 * 60,
      Math.max(10, Math.round(requestedWindowRaw ?? 180)),
    );
    const requestedWindowMinutes =
      trafficMode === "avg"
        ? Math.max(360, requestedWindowMinutesBase)
        : requestedWindowMinutesBase;
    const maxWindowMinutes = 24 * 60;
    const since = new Date(Date.now() - maxWindowMinutes * 60 * 1000);

    const googlePlacesRequested =
      !launchDegradedMode &&
      String(req.query.includeGoogle || "")
        .trim()
        .toLowerCase() === "true";
    const cacheKey = JSON.stringify({
      mode: trafficMode,
      north: normalizeBoundForKey(bounds.north),
      south: normalizeBoundForKey(bounds.south),
      east: normalizeBoundForKey(bounds.east),
      west: normalizeBoundForKey(bounds.west),
      includeGoogle: googlePlacesRequested,
      windowMinutes: requestedWindowMinutes,
    });
    const cached = mapFootTrafficCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.setHeader(
        "Cache-Control",
        trafficMode === "avg" ? "public, max-age=300" : "public, max-age=45",
      );
      return res.json(cached.payload);
    }

    const minLat = bounds.south;
    const maxLat = bounds.north;
    const minLng = Math.min(bounds.west, bounds.east);
    const maxLng = Math.max(bounds.west, bounds.east);
    const crossingDateLine = bounds.west > bounds.east;

    const inBoundsRows: Array<{
      lat: number;
      lng: number;
      actorKey: string;
      seenMs: number;
      ageMinutes: number;
    }> = [];
    try {
      const whereBase = [
        gte(geoLocationPings.createdAt, since),
        gte(geoLocationPings.lat, minLat.toFixed(8)),
        lte(geoLocationPings.lat, maxLat.toFixed(8)),
      ];
      const lngFilter = crossingDateLine
        ? or(
            gte(geoLocationPings.lng, bounds.west.toFixed(8)),
            lte(geoLocationPings.lng, bounds.east.toFixed(8)),
          )
        : and(
            gte(geoLocationPings.lng, minLng.toFixed(8)),
            lte(geoLocationPings.lng, maxLng.toFixed(8)),
          );

      const rows = await db
        .select({
          lat: geoLocationPings.lat,
          lng: geoLocationPings.lng,
          userId: geoLocationPings.userId,
          visitorId: geoLocationPings.visitorId,
          createdAt: geoLocationPings.createdAt,
        })
        .from(geoLocationPings)
        .where(and(...whereBase, lngFilter));

      for (const row of rows) {
        const lat = Number(row.lat);
        const lng = Number(row.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (!pointInBounds(bounds, lat, lng)) continue;
        const actorKey =
          String(row.userId || "").trim() ||
          String(row.visitorId || "").trim();
        if (!actorKey) continue;
        const seenMs = row.createdAt ? new Date(row.createdAt).getTime() : 0;
        const ageMinutes = seenMs
          ? Math.max(0, (Date.now() - seenMs) / 60_000)
          : maxWindowMinutes;
        inBoundsRows.push({ lat, lng, actorKey, seenMs, ageMinutes });
      }
    } catch (error) {
      if (!isMissingRelationError(error, "geo_location_pings")) {
        console.error("Error loading map foot-traffic pings:", error);
      }
    }

    const summarizeForWindow = (windowMinutes: number) => {
      const rows = inBoundsRows.filter(
        (row) => row.ageMinutes <= windowMinutes,
      );
      const buckets = new Map<
        string,
        {
          lat: number;
          lng: number;
          count: number;
          uniqueActors: Set<string>;
          lastSeenMs: number;
        }
      >();
      const actorSet = new Set<string>();
      for (const row of rows) {
        const bucketLat = roundCell(row.lat);
        const bucketLng = roundCell(row.lng);
        const key = `${bucketLat}:${bucketLng}`;
        const bucket = buckets.get(key) || {
          lat: bucketLat,
          lng: bucketLng,
          count: 0,
          uniqueActors: new Set<string>(),
          lastSeenMs: 0,
        };
        bucket.count += 1;
        bucket.uniqueActors.add(row.actorKey);
        bucket.lastSeenMs = Math.max(bucket.lastSeenMs, row.seenMs || 0);
        buckets.set(key, bucket);
        actorSet.add(row.actorKey);
      }

      const preCells = Array.from(buckets.values()).filter(
        (bucket) => bucket.uniqueActors.size >= 3,
      );
      const weightDenominator = Math.max(
        1,
        ...preCells.map((bucket) => {
          const freshnessMinutes = bucket.lastSeenMs
            ? Math.max(0, (Date.now() - bucket.lastSeenMs) / 60_000)
            : windowMinutes;
          const freshnessFactor = Math.max(
            0.35,
            1 - freshnessMinutes / Math.max(15, windowMinutes),
          );
          return (
            (bucket.uniqueActors.size * 2.4 + bucket.count * 0.7) *
            freshnessFactor
          );
        }),
      );

      const cells: TrafficCell[] = preCells
        .map((bucket) => {
          const freshnessMinutes = bucket.lastSeenMs
            ? Math.max(0, Math.round((Date.now() - bucket.lastSeenMs) / 60_000))
            : undefined;
          const freshnessFactor = Math.max(
            0.35,
            1 -
              (freshnessMinutes ?? windowMinutes) / Math.max(15, windowMinutes),
          );
          const weightRaw =
            (bucket.uniqueActors.size * 2.4 + bucket.count * 0.7) *
            freshnessFactor;
          const normalized = Math.round((weightRaw / weightDenominator) * 100);
          const weight = Math.max(8, Math.min(100, normalized));
          return {
            id: cellId("first_party", bucket.lat, bucket.lng),
            lat: bucket.lat,
            lng: bucket.lng,
            weight,
            source: "first_party" as const,
            count: bucket.count,
            uniqueActors: bucket.uniqueActors.size,
            freshnessMinutes,
          };
        })
        .sort((a, b) => (b.weight || 0) - (a.weight || 0))
        .slice(0, 120);

      return {
        windowMinutes,
        totalPings: rows.length,
        totalUniqueActors: actorSet.size,
        cells,
      };
    };

    const candidateWindows = Array.from(
      new Set([requestedWindowMinutes, 360, 720, 1440]),
    ).sort((a, b) => a - b);
    let firstPartySummary = summarizeForWindow(candidateWindows[0] || 180);
    for (const candidate of candidateWindows) {
      const summary = summarizeForWindow(candidate);
      firstPartySummary = summary;
      const enoughDensity =
        summary.totalUniqueActors >= 8 ||
        (summary.totalPings >= 20 && summary.cells.length >= 4);
      if (enoughDensity) break;
    }

    const firstPartyCells = firstPartySummary.cells;
    const totalPings = firstPartySummary.totalPings;
    const totalUniqueActors = firstPartySummary.totalUniqueActors;
    const effectiveWindowMinutes = firstPartySummary.windowMinutes;
    const signalTier =
      totalUniqueActors >= 18
        ? "solid"
        : totalUniqueActors >= 8
          ? "emerging"
          : "sparse";

    const supplyBuckets = new Map<
      string,
      {
        lat: number;
        lng: number;
        hostCount: number;
        truckCount: number;
        bookingCount: number;
        actorKeys: Set<string>;
      }
    >();
    const countedHostIds = new Set<string>();
    const upsertSupplyBucket = (
      lat: number,
      lng: number,
      options?: {
        hostId?: string;
        actorKey?: string;
        truckDelta?: number;
        bookingDelta?: number;
      },
    ) => {
      if (!pointInBounds(bounds, lat, lng)) return;
      const bucketLat = roundCell(lat);
      const bucketLng = roundCell(lng);
      const key = `${bucketLat}:${bucketLng}`;
      const bucket = supplyBuckets.get(key) || {
        lat: bucketLat,
        lng: bucketLng,
        hostCount: 0,
        truckCount: 0,
        bookingCount: 0,
        actorKeys: new Set<string>(),
      };

      const hostId = String(options?.hostId || "").trim();
      if (hostId && !countedHostIds.has(hostId)) {
        bucket.hostCount += 1;
        countedHostIds.add(hostId);
      }
      bucket.truckCount += Math.max(0, Number(options?.truckDelta || 0));
      bucket.bookingCount += Math.max(0, Number(options?.bookingDelta || 0));
      const actorKey = String(options?.actorKey || "").trim();
      if (actorKey) bucket.actorKeys.add(actorKey);
      supplyBuckets.set(key, bucket);
    };

    if (!launchDegradedMode) {
      try {
        const centerLat = (bounds.north + bounds.south) / 2;
        const centerLng = (bounds.east + bounds.west) / 2;
        const radiusKm = Math.max(
          2,
          Math.min(120, estimateRadiusMetersFromBounds(bounds) / 1000),
        );
        const liveTruckRows = await storage.getLiveTrucksNearby(
          centerLat,
          centerLng,
          radiusKm,
        );
        const liveTrucks =
          await toPublicRestaurantListingArrayWithVisibility(liveTruckRows);
        for (const truck of liveTrucks) {
          if (!(truck as any)?.isVerified) continue;
          const lat = toFiniteNumber((truck as any).currentLatitude);
          const lng = toFiniteNumber((truck as any).currentLongitude);
          if (lat === null || lng === null) continue;
          upsertSupplyBucket(lat, lng, {
            actorKey: `truck:${String((truck as any).id || "")}`,
            truckDelta: 1,
          });
        }
      } catch (error) {
        console.error("Error loading map supply truck signals:", error);
      }

      try {
        const now = new Date();
        const bookingWindowEnd = new Date(
          now.getTime() + 14 * 24 * 60 * 60 * 1000,
        );
        const bookingWindowStart = new Date(now);
        bookingWindowStart.setUTCHours(0, 0, 0, 0);
        bookingWindowStart.setUTCDate(bookingWindowStart.getUTCDate() - 1);
        const upcomingHostBookings = await db
          .select({
            hostId: hosts.id,
            lat: hosts.latitude,
            lng: hosts.longitude,
            city: hosts.city,
            state: hosts.state,
            date: events.date,
            startTime: events.startTime,
            endTime: events.endTime,
            bookingConfirmedAt: eventBookings.bookingConfirmedAt,
            ownerDisabled: users.isDisabled,
            publicProfileSettings: users.publicProfileSettings,
          })
          .from(eventBookings)
          .innerJoin(events, eq(eventBookings.eventId, events.id))
          .innerJoin(hosts, eq(events.hostId, hosts.id))
          .innerJoin(users, eq(hosts.userId, users.id))
          .where(
            and(
              eq(eventBookings.status, "confirmed"),
              isNotNull(eventBookings.bookingConfirmedAt),
              inArray(events.status, ["open", "booked", "filled"]),
              gte(events.date, bookingWindowStart),
              lte(events.date, bookingWindowEnd),
              eq(users.isDisabled, false),
            ),
          )
          .limit(6000);

        for (const row of upcomingHostBookings) {
          if (
            row.ownerDisabled !== false ||
            !resolvePublicProfileVisibility(row.publicProfileSettings)
              .showAddress
          ) {
            continue;
          }
          const timeZone = resolveCityTimeZoneSync({
            city: row.city || null,
            state: row.state || null,
          });
          const interval = buildSlotDateTimes({
            timeZone,
            date: row.date,
            startTime: String(row.startTime || ""),
            endTime: String(row.endTime || ""),
          });
          if (
            !interval ||
            !row.bookingConfirmedAt ||
            !isSlotPublic({
              slot: {
                source: "parking_pass_booking",
                status: "confirmed",
                startsAtUtc: interval.startUtc,
                endsAtUtc: interval.endUtc,
                lastConfirmedAtUtc: row.bookingConfirmedAt,
              },
              now,
              lookaheadHours: 14 * 24,
              ttlHours: 24 * 365 * 100,
            })
          ) {
            continue;
          }
          const lat = toFiniteNumber(row.lat);
          const lng = toFiniteNumber(row.lng);
          if (lat === null || lng === null) continue;
          upsertSupplyBucket(lat, lng, {
            hostId: String(row.hostId || ""),
            actorKey: `host:${String(row.hostId || "")}`,
            bookingDelta: 1,
          });
        }
      } catch (error) {
        console.error("Error loading map supply host signals:", error);
      }
    }

    const rawSupplyCells = Array.from(supplyBuckets.values())
      .map((bucket) => {
        const hostScore = bucket.hostCount * 18;
        const truckScore = bucket.truckCount * 24;
        const bookingScore = Math.min(10, bucket.bookingCount) * 6;
        const rawWeight = hostScore + truckScore + bookingScore;
        return { ...bucket, rawWeight };
      })
      .filter((bucket) => bucket.rawWeight > 0 && bucket.actorKeys.size >= 3);

    const supplyWeightDenominator = Math.max(
      1,
      ...rawSupplyCells.map((bucket) => bucket.rawWeight),
    );
    const supplyCells: TrafficCell[] = rawSupplyCells
      .map((bucket) => {
        const normalized = Math.round(
          (bucket.rawWeight / supplyWeightDenominator) * 100,
        );
        const weight = Math.max(12, Math.min(100, normalized));
        return {
          id: cellId("supply_signal", bucket.lat, bucket.lng),
          lat: bucket.lat,
          lng: bucket.lng,
          weight,
          source: "supply_signal" as const,
          count: bucket.bookingCount + bucket.truckCount,
          uniqueActors: bucket.actorKeys.size,
        };
      })
      .sort((a, b) => (b.weight || 0) - (a.weight || 0))
      .slice(0, 160);

    let googlePlaces = {
      enabled: false,
      used: false,
      error: null as string | null,
      cells: [] as TrafficCell[],
    };

    const googleApiKey = getGoogleMapsServerApiKey();
    if (googlePlacesRequested) {
      googlePlaces.enabled = true;
      if (!googleApiKey) {
        googlePlaces.error = "google_api_key_missing";
      } else {
        try {
          const centerLat = (bounds.north + bounds.south) / 2;
          const centerLng = (bounds.east + bounds.west) / 2;
          const radius = Math.min(
            50_000,
            estimateRadiusMetersFromBounds(bounds),
          );
          // Places API (New) — Nearby Search (POST)
          // https://developers.google.com/maps/documentation/places/web-service/nearby-search
          const nearbyUrl =
            "https://places.googleapis.com/v1/places:searchNearby";
          const nearbyBody = {
            includedTypes: ["restaurant"],
            maxResultCount: 20,
            locationRestriction: {
              circle: {
                center: { latitude: centerLat, longitude: centerLng },
                radius,
              },
            },
          };
          const response = await fetchWithTimeout(
            nearbyUrl,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Goog-Api-Key": googleApiKey,
                // Request only the fields we need to minimise billing SKU
                "X-Goog-FieldMask": "places.location,places.userRatingCount",
              },
              body: JSON.stringify(nearbyBody),
            },
            MAP_PROVIDER_TIMEOUT_MS,
          );
          const payload = (await response.json().catch(() => null)) as {
            error?: { message?: string; status?: string };
            places?: Array<{
              location?: { latitude?: number; longitude?: number };
              userRatingCount?: number;
            }>;
          } | null;

          if (!response.ok || !payload || payload.error) {
            googlePlaces.error =
              payload?.error?.message ||
              payload?.error?.status ||
              `http_${response.status}`;
          } else {
            const buckets = new Map<
              string,
              { lat: number; lng: number; weight: number; count: number }
            >();
            const results = Array.isArray(payload?.places)
              ? payload.places
              : [];
            for (const place of results) {
              const lat = toFiniteNumber(place.location?.latitude);
              const lng = toFiniteNumber(place.location?.longitude);
              if (lat === null || lng === null) continue;
              if (!pointInBounds(bounds, lat, lng)) continue;
              const bucketLat = roundCell(lat);
              const bucketLng = roundCell(lng);
              const key = `${bucketLat}:${bucketLng}`;
              const ratingWeight = Math.max(
                1,
                Math.min(24, Number(place.userRatingCount || 1)),
              );
              const existing = buckets.get(key) || {
                lat: bucketLat,
                lng: bucketLng,
                weight: 0,
                count: 0,
              };
              existing.weight += ratingWeight;
              existing.count += 1;
              buckets.set(key, existing);
            }
            googlePlaces.cells = Array.from(buckets.values()).map((bucket) => ({
              id: cellId("google_places", bucket.lat, bucket.lng),
              lat: bucket.lat,
              lng: bucket.lng,
              weight: Math.max(
                6,
                Math.min(70, Math.round(bucket.weight * 0.75)),
              ),
              source: "google_places" as const,
              count: bucket.count,
            }));
            googlePlaces.used = true;
          }
        } catch (error: any) {
          googlePlaces.error = error?.message || "google_places_failed";
        }
      }
    }

    const combinedCells = [
      ...firstPartyCells,
      ...supplyCells,
      ...googlePlaces.cells,
    ].sort((a, b) => (b.weight || 0) - (a.weight || 0));

    const publicFirstPartyPings = firstPartyCells.reduce(
      (sum, cell) => sum + Math.max(0, Number(cell.count || 0)),
      0,
    );
    const publicFirstPartyActors = firstPartyCells.reduce(
      (sum, cell) => sum + Math.max(0, Number(cell.uniqueActors || 0)),
      0,
    );
    const payload: FootTrafficPayload = {
      generatedAt: new Date().toISOString(),
      windowMinutes: effectiveWindowMinutes,
      requestedWindowMinutes,
      bounds,
      mode: trafficMode,
      degradedMode: launchDegradedMode,
      interpretation: {
        label: "area_activity",
        measuredFootTraffic: publicFirstPartyPings > 0,
        description:
          "First-party MealScout movement, scheduled host/truck activity, and Google food-destination density are separate opportunity signals.",
      },
      signalQuality: {
        tier: signalTier,
        isLowDensity: signalTier === "sparse",
      },
      firstParty: {
        totalPings: publicFirstPartyPings,
        totalUniqueActors: publicFirstPartyActors,
        cells: firstPartyCells,
      },
      supplySignals: {
        cells: supplyCells,
      },
      googlePlaces,
      cells: combinedCells,
    };
    mapFootTrafficCache.set(cacheKey, {
      expiresAt: Date.now() + (trafficMode === "avg" ? 5 * 60_000 : 45_000),
      payload,
    });
    res.setHeader(
      "Cache-Control",
      trafficMode === "avg" ? "public, max-age=300" : "public, max-age=45",
    );
    return res.json(payload);
  });

  app.post(
    "/api/admin/map/locations-cache/clear",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      mapLocationsCache = null;
      mapFootTrafficCache.clear();
      res.json({ success: true });
    },
  );
}
