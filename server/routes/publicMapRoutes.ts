import type { Express } from "express";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
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
import {
  dealClaims,
  deals,
  dealViews,
  events,
  geoLocationPings,
  hosts,
  locationRequests,
  restaurants,
  suppliers,
  supplierProducts,
  users,
} from "@shared/schema";

let mapLocationsCache: {
  expiresAt: number;
  payload: { hostLocations: any[]; eventLocations: any[]; supplierLocations: any[] };
} | null = null;

let mapLocationsLastGood: {
  payload: { hostLocations: any[]; eventLocations: any[]; supplierLocations: any[] };
} | null = null;

type FootTrafficPayload = {
  generatedAt: string;
  windowMinutes: number;
  requestedWindowMinutes: number;
  bounds: BoundsLike;
  mode: "avg" | "live";
  degradedMode?: boolean;
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

const parseBounds = (raw: Record<string, unknown>): BoundsLike | null => {
  const north = toFiniteNumber(raw.north);
  const south = toFiniteNumber(raw.south);
  const east = toFiniteNumber(raw.east);
  const west = toFiniteNumber(raw.west);
  if (
    north === null ||
    south === null ||
    east === null ||
    west === null ||
    north < south
  ) {
    return null;
  }
  return { north, south, east, west };
};

const pointInBounds = (bounds: BoundsLike, lat: number, lng: number) => {
  if (lat > bounds.north || lat < bounds.south) return false;
  if (bounds.west <= bounds.east) {
    return lng >= bounds.west && lng <= bounds.east;
  }
  return lng >= bounds.west || lng <= bounds.east;
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

const roundCell = (value: number) => Math.round(value * 1000) / 1000;

const normalizeBoundForKey = (value: number) => Number(value.toFixed(3));

const parseDurationSeconds = (value: unknown) => {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d+(?:\.\d+)?)s$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
};

const isMissingRelationError = (error: unknown, relationName?: string) => {
  const err = error as { code?: string; message?: string } | null;
  if (!err || err.code !== "42P01") return false;
  if (!relationName) return true;
  return err.message?.includes(`"${relationName}"`) ?? false;
};

const getGoogleMapsApiKey = () =>
  String(
    process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_WEB_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.VITE_GOOGLE_API_KEY ||
      "",
  ).trim();

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
  state: string;
  latitude: number | null;
  longitude: number | null;
};

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
  app.get("/api/map/runtime", async (_req, res) => {
    try {
      const googleMapsApiKey = getGoogleMapsApiKey();
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
      });
    } catch {
      res.status(500).json({
        hasGoogleMapsKey: false,
        googleMapsApiKey: null,
        hasGoogleMapsMapId: false,
        googleMapsMapId: null,
      });
    }
  });

  app.get("/api/map/locations", async (_req, res) => {
    try {
      res.setHeader(
        "Cache-Control",
        "public, max-age=120, stale-while-revalidate=240",
      );
      if (mapLocationsCache && mapLocationsCache.expiresAt > Date.now()) {
        return res.json(mapLocationsCache.payload);
      }

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
        !launchDegradedMode && getGoogleMapsApiKey().length > 0;

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

      const [
        openLocations,
        upcomingEvents,
        allHosts,
        activeSuppliers,
        activeSupplierProducts,
      ] = await Promise.all([
        storage.getOpenLocationRequests(),
        storage.getAllUpcomingEvents(),
        storage.getAllHosts(),
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
            offersDelivery: suppliers.offersDelivery,
            deliveryRadiusMiles: suppliers.deliveryRadiusMiles,
            updatedAt: suppliers.updatedAt,
          })
          .from(suppliers)
          .where(eq(suppliers.isActive, true))
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

      const activeHostUserIds =
        hostUserIds.length > 0
          ? new Set(
              (
                await db
                  .select({ id: users.id })
                  .from(users)
                  .where(
                    and(
                      inArray(users.id, hostUserIds),
                      or(eq(users.isDisabled, false), isNull(users.isDisabled)),
                    ),
                  )
              ).map((row: { id: string }) => row.id),
            )
          : null;

      const hostProfiles = typedAllHosts.filter((host) => {
        const address = String(host.address || "").trim();
        if (!address) return false;
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
        if (!activeHostUserIds) return true;
        const userId = String(host.userId || "").trim();
        return userId ? activeHostUserIds.has(userId) : true;
      });

      const hostProfileById = new Map<string, (typeof hostProfiles)[number]>();
      hostProfiles.forEach((host) => {
        hostProfileById.set(String(host.id), host);
      });

      const publicEvents = upcomingEvents.filter((event) => {
        if (event.requiresPayment) return false;
        const hostId = String(event.hostId || event.host?.id || "").trim();
        if (!hostId) return true;
        const fromProfile = hostProfileById.get(hostId);
        if (fromProfile) return true;
        return isHostProfileMapEligible({
          businessName: event.host?.businessName,
          address: event.host?.address,
          city: event.host?.city,
          state: event.host?.state,
        });
      });

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
        googleFormattedPhone: (host as any).googleFormattedPhone ?? null,
        businessHours: (host as any).businessHours ?? null,
        businessWebsite: (host as any).businessWebsite ?? null,
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

      const hostLocations = [
        ...openLocations
          .filter((loc) =>
            isHostProfileMapEligible({
              businessName: loc.businessName,
              address: loc.address,
            }),
          )
          .map((loc) => ({
            id: loc.id,
            type: "host_location" as const,
            hostId: null,
            name: loc.businessName,
            address: loc.address,
            city: null,
            state: null,
            locationType: loc.locationType,
            expectedFootTraffic: loc.expectedFootTraffic,
            notes: loc.notes,
            preferredDates: loc.preferredDates,
            status: loc.status,
            latitude: loc.latitude,
            longitude: loc.longitude,
            locationRequestId: loc.id,
          })),
        ...primaryHostLocations,
      ];

      const eventLocations = publicEvents.map((event) => ({
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
        hostName: event.host?.businessName,
        hostAddress: event.host?.address,
        hostCity: event.host?.city ?? null,
        hostState: event.host?.state ?? null,
        hostLatitude: event.host?.latitude,
        hostLongitude: event.host?.longitude,
        hardCapEnabled: event.hardCapEnabled,
        seriesId: event.seriesId,
        bookedRestaurantId: event.bookedRestaurantId,
      }));

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

      const supplierLocations = (activeSuppliers as any[])
        .filter((supplier) => {
          const hasAddress = String(supplier.address || "").trim();
          const lat = parseCoord(supplier.latitude);
          const lng = parseCoord(supplier.longitude);
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
            contactPhone: supplier.contactPhone ?? null,
            contactEmail: supplier.contactEmail ?? null,
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

      const applyCoords = (
        target: { latitude?: string | null; longitude?: string | null },
        coords: { lat: number; lng: number },
      ) => {
        target.latitude = coords.lat.toString();
        target.longitude = coords.lng.toString();
      };

      const MAX_COORD_MISMATCH_FIXES =
        Math.max(
          0,
          Number(process.env.MAP_LOCATIONS_MAX_COORD_MISMATCH_FIXES || 0) || 0,
        ) || (process.env.NODE_ENV === "production" ? 0 : 10);
      let mismatchFixes = 0;
      let reverseGeocodeChecks = 0;
      let coordCalibrations = 0;
      const deadline = Date.now() + GEOCODE_BUDGET_MS;

      for (const host of hostLocations) {
        const lat = parseCoord(host.latitude);
        const lng = parseCoord(host.longitude);
        const expectedState = expectedStateAbbrFor(host);
        const address = buildFullAddress(host.address, host.city, host.state);
        if (
          lat !== null &&
          lng !== null &&
          address &&
          Date.now() <= deadline &&
          coordCalibrations < MAX_COORD_CALIBRATIONS_PER_REQUEST
        ) {
          coordCalibrations += 1;
          const calibrated = await withTimeout(
            (useGoogleCalibration ? forwardGeocodeGoogle : forwardGeocode)(
              address,
            ),
            GEOCODE_TIMEOUT_MS,
          ).catch(() => null);
          if (calibrated) {
            const driftMeters = haversineMeters(
              lat,
              lng,
              calibrated.lat,
              calibrated.lng,
            );
            if (driftMeters > COORD_CALIBRATION_THRESHOLD_METERS) {
              applyCoords(host, calibrated);
              if (host.hostId) {
                await storage
                  .updateHostCoordinates(
                    host.hostId,
                    calibrated.lat,
                    calibrated.lng,
                  )
                  .catch(() => undefined);
              } else if (host.locationRequestId) {
                await db
                  .update(locationRequests)
                  .set({
                    latitude: calibrated.lat.toString(),
                    longitude: calibrated.lng.toString(),
                  })
                  .where(eq(locationRequests.id, host.locationRequestId))
                  .catch(() => undefined);
              }
            }
          }
        }
        if (
          lat !== null &&
          lng !== null &&
          expectedState &&
          Date.now() <= deadline &&
          reverseGeocodeChecks < MAX_REVERSE_GEOCODE_PER_REQUEST &&
          mismatchFixes < MAX_COORD_MISMATCH_FIXES
        ) {
          reverseGeocodeChecks += 1;
          const reversed = await withTimeout(
            reverseGeocode(lat, lng),
            GEOCODE_TIMEOUT_MS,
          ).catch(() => null);
          const reversedState = normalizeUsStateAbbr(
            String(reversed?.state || "").trim(),
          );
          if (reversedState && reversedState !== expectedState) {
            mismatchFixes += 1;
            if (Date.now() > deadline) {
              continue;
            }

            host.latitude = null;
            host.longitude = null;
            if (address) {
              const coords = await withTimeout(
                forwardGeocode(address, {
                  force: true,
                }),
                GEOCODE_TIMEOUT_MS,
              ).catch(() => null);
              if (coords) {
                if (Date.now() > deadline) {
                  continue;
                }
                const verify = await withTimeout(
                  reverseGeocode(coords.lat, coords.lng),
                  GEOCODE_TIMEOUT_MS,
                ).catch(() => null);
                const verifyState = normalizeUsStateAbbr(
                  String(verify?.state || "").trim(),
                );
                if (!verifyState || verifyState === expectedState) {
                  applyCoords(host, coords);
                  if (host.hostId) {
                    await storage
                      .updateHostCoordinates(
                        host.hostId,
                        coords.lat,
                        coords.lng,
                      )
                      .catch(() => undefined);
                  } else if (host.locationRequestId) {
                    await db
                      .update(locationRequests)
                      .set({
                        latitude: coords.lat.toString(),
                        longitude: coords.lng.toString(),
                      })
                      .where(eq(locationRequests.id, host.locationRequestId))
                      .catch(() => undefined);
                  }
                }
              }
            }
          }
        }

        if (
          parseCoord(host.latitude) !== null &&
          parseCoord(host.longitude) !== null
        ) {
          continue;
        }
        if (!address) continue;
        queueGeocode(
          address,
          (coords) => applyCoords(host, coords),
          host.hostId
            ? async (coords) => {
                await storage.updateHostCoordinates(
                  host.hostId,
                  coords.lat,
                  coords.lng,
                );
              }
            : host.locationRequestId
              ? async (coords) => {
                  await db
                    .update(locationRequests)
                    .set({
                      latitude: coords.lat.toString(),
                      longitude: coords.lng.toString(),
                    })
                    .where(eq(locationRequests.id, host.locationRequestId));
                }
              : undefined,
        );
      }

      for (const event of eventLocations) {
        const lat = parseCoord(event.hostLatitude);
        const lng = parseCoord(event.hostLongitude);
        if (lat !== null && lng !== null) continue;
        const address = buildFullAddress(
          event.hostAddress,
          event.hostCity,
          event.hostState,
        );
        if (!address) continue;
        queueGeocode(address, (coords) => {
          event.hostLatitude = coords.lat.toString();
          event.hostLongitude = coords.lng.toString();
        });
      }

      for (const supplier of supplierLocations) {
        const lat = parseCoord(supplier.latitude);
        const lng = parseCoord(supplier.longitude);
        if (lat !== null && lng !== null) continue;
        const address = buildFullAddress(
          supplier.address,
          supplier.city,
          supplier.state,
        );
        if (!address) continue;
        queueGeocode(
          address,
          (coords) => applyCoords(supplier, coords),
          async (coords) => {
            await db
              .update(suppliers)
              .set({
                latitude: coords.lat.toString(),
                longitude: coords.lng.toString(),
                updatedAt: new Date(),
              })
              .where(eq(suppliers.id, supplier.supplierId));
          },
        );
      }

      const pendingTasks = Array.from(pendingByAddress.values()).slice(
        0,
        MAX_GEOCODE_PER_REQUEST,
      );
      for (const task of pendingTasks) {
        if (Date.now() > deadline) break;
        const coords = await withTimeout(
          forwardGeocode(task.address),
          GEOCODE_TIMEOUT_MS,
        ).catch(() => null);
        if (!coords) continue;
        task.onResolved.forEach((handler) => handler(coords));
        await Promise.all(
          task.persist.map((handler) => handler(coords).catch(() => undefined)),
        );
      }

      const payload = { hostLocations, eventLocations, supplierLocations };
      mapLocationsCache = {
        payload,
        expiresAt:
          Date.now() +
          (Math.max(
            0,
            Number(process.env.MAP_LOCATIONS_CACHE_TTL_MS || 0) || 0,
          ) || 300_000),
      };
      mapLocationsLastGood = { payload };
      res.json(payload);
    } catch (error) {
      console.error("Error building map locations feed:", error);
      if (mapLocationsLastGood?.payload) {
        res.setHeader("X-MealScout-Stale", "1");
        return res.json(mapLocationsLastGood.payload);
      }
      res
        .status(200)
        .json({ hostLocations: [], eventLocations: [], supplierLocations: [] });
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
      const expandedBounds: BoundsLike = {
        north: Math.min(90, bounds.north + pad),
        south: Math.max(-90, bounds.south - pad),
        east: bounds.east + pad,
        west: bounds.west - pad,
      };

      const payloadSource = mapLocationsCache?.payload ||
        mapLocationsLastGood?.payload || {
          hostLocations: [],
          eventLocations: [],
          supplierLocations: [],
        };

      const parseCoord = (value?: string | number | null) => {
        if (value === null || value === undefined) return null;
        const parsed = typeof value === "string" ? Number(value) : value;
        return Number.isFinite(parsed) ? parsed : null;
      };

      const hostLocations = (payloadSource.hostLocations || []).filter(
        (host) => {
          const lat = parseCoord(host?.latitude);
          const lng = parseCoord(host?.longitude);
          if (lat === null || lng === null) return false;
          return pointInBounds(expandedBounds, lat, lng);
        },
      );

      const eventLocations = (payloadSource.eventLocations || []).filter(
        (event) => {
          const lat = parseCoord(event?.hostLatitude);
          const lng = parseCoord(event?.hostLongitude);
          if (lat === null || lng === null) return false;
          return pointInBounds(expandedBounds, lat, lng);
        },
      );
      const supplierLocations = (payloadSource.supplierLocations || []).filter(
        (supplier) => {
          const lat = parseCoord(supplier?.latitude);
          const lng = parseCoord(supplier?.longitude);
          if (lat === null || lng === null) return false;
          return pointInBounds(expandedBounds, lat, lng);
        },
      );

      const maxPerLayer = zoom <= 9 ? 800 : zoom <= 12 ? 1200 : 2000;
      const clippedHosts = hostLocations.slice(0, maxPerLayer);
      const clippedEvents = eventLocations.slice(0, maxPerLayer);
      const clippedSuppliers = supplierLocations.slice(0, maxPerLayer);

      const version = String(
        mapLocationsCache?.expiresAt ||
          mapLocationsLastGood?.payload?.hostLocations?.length ||
          Date.now(),
      );

      res.setHeader("Cache-Control", "public, max-age=20");
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
      res.status(200).json({
        version: "fallback",
        zoom: Number(req.query.zoom || 12) || 12,
        hostLocations: [],
        eventLocations: [],
        supplierLocations: [],
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
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.json(cached.payload);
    }

    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) {
      return res
        .status(503)
        .json({ message: "Google Maps key not configured" });
    }

    try {
      const response = await fetchWithTimeout(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
          },
          body: JSON.stringify({
            origin: {
              location: {
                latLng: {
                  latitude: originLat,
                  longitude: originLng,
                },
              },
            },
            destination: {
              location: {
                latLng: {
                  latitude: destLat,
                  longitude: destLng,
                },
              },
            },
            travelMode,
            routingPreference:
              travelMode === "DRIVE" ? "TRAFFIC_AWARE_OPTIMAL" : undefined,
            computeAlternativeRoutes: false,
            languageCode: "en-US",
            units: "METRIC",
          }),
        },
        MAP_PROVIDER_TIMEOUT_MS,
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return res.status(502).json({
          message: text || "Unable to compute route",
        });
      }

      const data = (await response.json().catch(() => ({}))) as any;
      const route = Array.isArray(data?.routes) ? data.routes[0] : null;
      const distanceMeters = Number(route?.distanceMeters);
      const durationSeconds = parseDurationSeconds(route?.duration);
      if (!Number.isFinite(distanceMeters) || durationSeconds === null) {
        return res.status(404).json({ message: "Route not available" });
      }

      const payload = {
        distanceMeters: Math.max(0, Math.round(distanceMeters)),
        durationSeconds,
        travelMode,
        source: "google_routes" as const,
      };
      mapRouteSummaryCache.set(cacheKey, {
        expiresAt: Date.now() + 10 * 60_000, // 10-minute TTL
        payload,
      });
      res.setHeader("Cache-Control", "public, max-age=600");
      return res.json(payload);
    } catch (error) {
      console.error("[map.route-summary] failed", error);
      return res.status(500).json({ message: "Unable to compute route" });
    }
  });

  app.get("/api/map/place-autocomplete", async (req, res) => {
    const input = String(req.query.input || "").trim();
    if (input.length < 2) {
      return res.json({ suggestions: [] as PlaceAutocompletePrediction[] });
    }

    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) {
      return res.json({ suggestions: [] as PlaceAutocompletePrediction[] });
    }

    // ── Server-side cache check (5-minute TTL) ──────────────────────────────────
    // Cache key excludes sessionToken so the same query always hits the same entry.
    // sessionToken is only used for billing grouping, not for result differentiation.
    const biasLat = parseAutocompleteCoordinate(req.query.lat, 90);
    const biasLng = parseAutocompleteCoordinate(req.query.lng, 180);
    const hasLocationBias = biasLat !== null && biasLng !== null;
    const autocompleteCacheKey = [
      input.toLowerCase(),
      hasLocationBias ? biasLat.toFixed(2) : "no-lat",
      hasLocationBias ? biasLng.toFixed(2) : "no-lng",
    ].join(":");
    const acCached = placeAutocompleteCache.get(autocompleteCacheKey);
    if (acCached && acCached.expiresAt > Date.now()) {
      res.setHeader("Cache-Control", "public, max-age=300");
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
          includedPrimaryTypes: [
            "restaurant",
            "cafe",
            "bar",
            "meal_takeaway",
            "meal_delivery",
          ],
          languageCode: "en",
        };
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
      res.setHeader("Cache-Control", "public, max-age=300");
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

    const apiKey = getGoogleMapsApiKey();
    if (!apiKey) {
      return res
        .status(503)
        .json({ message: "Google Maps key not configured" });
    }

    // ── Server-side cache check (24-hour TTL) ─────────────────────────────────
    // placeId is a permanent identifier — the address it points to never changes.
    const pdCached = placeDetailsCache.get(placeId);
    if (pdCached && pdCached.expiresAt > Date.now()) {
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.json({ place: pdCached.place });
    }

    // ── In-flight deduplication ────────────────────────────────────────────
    let pdInflight = placeDetailsInflight.get(placeId);
    if (!pdInflight) {
      pdInflight = (async () => {
        const response = await fetchWithTimeout(
          `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
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
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.json({ place });
    } catch (error) {
      console.error("[map.place-details] failed", error);
      res.status(500).json({ message: "Unable to fetch place details" });
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
        })
        .from(hosts)
        .where(eq(hosts.id, hostId))
        .limit(1);

      if (!hostRow) {
        return res.status(404).json({ message: "Host not found" });
      }

      const now = new Date();
      const rangeEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

      const rows = await db
        .select({
          eventId: events.id,
          date: events.date,
          startTime: events.startTime,
          endTime: events.endTime,
          truckId: restaurants.id,
          truckName: restaurants.name,
          truckCuisine: restaurants.cuisineType,
        })
        .from(events)
        .innerJoin(restaurants, eq(events.bookedRestaurantId, restaurants.id))
        .where(
          and(
            eq(events.hostId, hostId),
            ne(events.status, "cancelled"),
            isNotNull(events.bookedRestaurantId),
            gte(events.date, now),
            lte(events.date, rangeEnd),
          ),
        )
        .orderBy(asc(events.date), asc(events.startTime))
        .limit(12);

      const bookings = rows.map((row: (typeof rows)[number]) => ({
        eventId: String(row.eventId),
        date:
          row.date instanceof Date ? row.date.toISOString() : String(row.date),
        startTime: String(row.startTime || ""),
        endTime: String(row.endTime || ""),
        truck: {
          id: String(row.truckId),
          name: String(row.truckName || "Food truck"),
          cuisineType: row.truckCuisine ? String(row.truckCuisine) : null,
        },
      }));

      res.setHeader("Cache-Control", "public, max-age=60");
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

  app.get("/api/map/business-popularity", async (req, res) => {
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
          googleRating: restaurants.googleRating,
          googleReviewCount: restaurants.googleReviewCount,
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
          restaurantId: events.bookedRestaurantId,
          count: sql<number>`count(*)`,
        })
        .from(events)
        .where(
          and(
            inArray(events.bookedRestaurantId, uniqueRestaurantIds),
            ne(events.status, "cancelled"),
            gte(events.date, since30d),
          ),
        )
        .groupBy(events.bookedRestaurantId);

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

      res.setHeader("Cache-Control", "public, max-age=180");
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
  });

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
          String(row.visitorId || "").trim() ||
          `${roundCell(lat)}:${roundCell(lng)}`;
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
        (bucket) => bucket.count >= 2 || bucket.uniqueActors.size >= 2,
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
      }
    >();
    const countedHostIds = new Set<string>();
    const upsertSupplyBucket = (
      lat: number,
      lng: number,
      options?: { hostId?: string; truckDelta?: number; bookingDelta?: number },
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
      };

      const hostId = String(options?.hostId || "").trim();
      if (hostId && !countedHostIds.has(hostId)) {
        bucket.hostCount += 1;
        countedHostIds.add(hostId);
      }
      bucket.truckCount += Math.max(0, Number(options?.truckDelta || 0));
      bucket.bookingCount += Math.max(0, Number(options?.bookingDelta || 0));
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
        const liveTrucks = await storage.getLiveTrucksNearby(
          centerLat,
          centerLng,
          radiusKm,
        );
        for (const truck of liveTrucks) {
          if (!(truck as any)?.isVerified) continue;
          const lat = toFiniteNumber((truck as any).currentLatitude);
          const lng = toFiniteNumber((truck as any).currentLongitude);
          if (lat === null || lng === null) continue;
          upsertSupplyBucket(lat, lng, { truckDelta: 1 });
        }
      } catch (error) {
        console.error("Error loading map supply truck signals:", error);
      }

      try {
        const now = new Date();
        const bookingWindowEnd = new Date(
          now.getTime() + 14 * 24 * 60 * 60 * 1000,
        );
        const upcomingHostBookings = await db
          .select({
            hostId: hosts.id,
            lat: hosts.latitude,
            lng: hosts.longitude,
          })
          .from(events)
          .innerJoin(hosts, eq(events.hostId, hosts.id))
          .where(
            and(
              ne(events.status, "cancelled"),
              gte(events.date, now),
              lte(events.date, bookingWindowEnd),
            ),
          )
          .limit(6000);

        for (const row of upcomingHostBookings) {
          const lat = toFiniteNumber(row.lat);
          const lng = toFiniteNumber(row.lng);
          if (lat === null || lng === null) continue;
          upsertSupplyBucket(lat, lng, {
            hostId: String(row.hostId || ""),
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
      .filter((bucket) => bucket.rawWeight > 0);

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
          uniqueActors: bucket.hostCount + bucket.truckCount,
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

    const googleApiKey = getGoogleMapsApiKey();
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

    const payload: FootTrafficPayload = {
      generatedAt: new Date().toISOString(),
      windowMinutes: effectiveWindowMinutes,
      requestedWindowMinutes,
      bounds,
      mode: trafficMode,
      degradedMode: launchDegradedMode,
      signalQuality: {
        tier: signalTier,
        isLowDensity: signalTier === "sparse",
      },
      firstParty: {
        totalPings,
        totalUniqueActors,
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
      mapLocationsLastGood = null;
      mapFootTrafficCache.clear();
      res.json({ success: true });
    },
  );
}
