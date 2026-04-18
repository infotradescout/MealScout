import type { Express } from "express";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";

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
import {
  events,
  geoLocationPings,
  hosts,
  locationRequests,
  restaurants,
  users,
} from "@shared/schema";

let mapLocationsCache: {
  expiresAt: number;
  payload: { hostLocations: any[]; eventLocations: any[] };
} | null = null;

let mapLocationsLastGood: {
  payload: { hostLocations: any[]; eventLocations: any[] };
} | null = null;

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
  source: "first_party" | "google_places";
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
  return Math.max(100, Math.round(Math.sqrt(latMeters * latMeters + lngMeters * lngMeters)));
};

const cellId = (source: "first_party" | "google_places", lat: number, lng: number) =>
  `${source}:${lat.toFixed(3)}:${lng.toFixed(3)}`;

const roundCell = (value: number) => Math.round(value * 1000) / 1000;

const isMissingRelationError = (error: unknown, relationName?: string) => {
  const err = error as { code?: string; message?: string } | null;
  if (!err || err.code !== "42P01") return false;
  if (!relationName) return true;
  return err.message?.includes(`"${relationName}"`) ?? false;
};

const getGoogleMapsApiKey = () =>
  String(
    process.env.GOOGLE_MAPS_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_WEB_API_KEY ||
      "",
  ).trim();

export function registerPublicMapRoutes(app: Express) {
  app.get("/api/map/runtime", async (_req, res) => {
    try {
      const googleMapsApiKey = getGoogleMapsApiKey();
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({
        hasGoogleMapsKey: googleMapsApiKey.length > 0,
        googleMapsApiKey: googleMapsApiKey || null,
      });
    } catch {
      res.status(500).json({
        hasGoogleMapsKey: false,
        googleMapsApiKey: null,
      });
    }
  });

  app.get("/api/map/locations", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=60");
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

      const MAX_GEOCODE_PER_REQUEST =
        Math.max(0, Number(process.env.MAP_LOCATIONS_MAX_GEOCODE || 0) || 0) ||
        (process.env.NODE_ENV === "production" ? 5 : 25);
      const GEOCODE_BUDGET_MS =
        Math.max(
          0,
          Number(process.env.MAP_LOCATIONS_GEOCODE_BUDGET_MS || 0) || 0,
        ) || (process.env.NODE_ENV === "production" ? 1500 : 5000);
      const GEOCODE_TIMEOUT_MS =
        Math.max(
          0,
          Number(process.env.MAP_LOCATIONS_GEOCODE_TIMEOUT_MS || 0) || 0,
        ) || (process.env.NODE_ENV === "production" ? 750 : 2000);
      const MAX_REVERSE_GEOCODE_PER_REQUEST =
        Math.max(
          0,
          Number(process.env.MAP_LOCATIONS_MAX_REVERSE_GEOCODE || 0) || 0,
        ) || (process.env.NODE_ENV === "production" ? 2 : 10);
      const MAX_COORD_CALIBRATIONS_PER_REQUEST =
        Math.max(
          0,
          Number(process.env.MAP_LOCATIONS_MAX_COORD_CALIBRATIONS || 0) || 0,
        ) || (process.env.NODE_ENV === "production" ? 10 : 30);
      const COORD_CALIBRATION_THRESHOLD_METERS =
        Math.max(
          0,
          Number(process.env.MAP_LOCATIONS_COORD_CALIBRATION_METERS || 0) || 0,
        ) || 120;
      const useGoogleCalibration = getGoogleMapsApiKey().length > 0;

      const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number) => {
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

      const [openLocations, upcomingEvents] = await Promise.all([
        storage.getOpenLocationRequests(),
        storage.getAllUpcomingEvents(),
      ]);

      const allHosts = (await storage.getAllHosts()) as Array<{
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
      }>;

      const hostUserIds = Array.from(
        new Set(
          allHosts
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

      const hostProfiles = allHosts.filter((host) => {
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
        spotImageUrl: null,
        locationType: host.locationType || "other",
        expectedFootTraffic: host.expectedFootTraffic ?? null,
        notes: host.notes ?? null,
        preferredDates: [],
        status: host.isVerified ? "verified" : "active",
        latitude: host.latitude ?? null,
        longitude: host.longitude ?? null,
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
            (
              useGoogleCalibration ? forwardGeocodeGoogle : forwardGeocode
            )(address),
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
                      .updateHostCoordinates(host.hostId, coords.lat, coords.lng)
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

      const payload = { hostLocations, eventLocations };
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
      res.status(200).json({ hostLocations: [], eventLocations: [] });
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
        date: row.date instanceof Date ? row.date.toISOString() : String(row.date),
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
      return res.status(500).json({ message: "Failed to load upcoming bookings" });
    }
  });

  app.get("/api/map/foot-traffic", async (req, res) => {
    const bounds = parseBounds(req.query as Record<string, unknown>);
    if (!bounds) {
      return res.status(400).json({ message: "Invalid map bounds" });
    }

    const requestedWindowRaw = toFiniteNumber(req.query.windowMinutes);
    const requestedWindowMinutes = Math.min(
      24 * 60,
      Math.max(10, Math.round(requestedWindowRaw ?? 180)),
    );
    const maxWindowMinutes = 24 * 60;
    const since = new Date(Date.now() - maxWindowMinutes * 60 * 1000);

    const googlePlacesRequested =
      String(req.query.includeGoogle || "")
        .trim()
        .toLowerCase() === "true";

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
      const rows = inBoundsRows.filter((row) => row.ageMinutes <= windowMinutes);
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
            1 - (freshnessMinutes ?? windowMinutes) / Math.max(15, windowMinutes),
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
          const nearbyUrl =
            "https://maps.googleapis.com/maps/api/place/nearbysearch/json";
          const params = new URLSearchParams({
            key: googleApiKey,
            location: `${centerLat},${centerLng}`,
            radius: String(radius),
            type: "restaurant",
          });
          const response = await fetch(`${nearbyUrl}?${params.toString()}`);
          const payload = (await response.json().catch(() => null)) as
            | {
                status?: string;
                error_message?: string;
                results?: Array<{
                  geometry?: { location?: { lat?: number; lng?: number } };
                  user_ratings_total?: number;
                }>;
              }
            | null;

          if (!response.ok || !payload || payload.status === "REQUEST_DENIED") {
            googlePlaces.error =
              payload?.error_message ||
              payload?.status ||
              `http_${response.status}`;
          } else {
            const buckets = new Map<
              string,
              { lat: number; lng: number; weight: number; count: number }
            >();
            const results = Array.isArray(payload?.results)
              ? payload.results
              : [];
            for (const place of results) {
              const lat = toFiniteNumber(place.geometry?.location?.lat);
              const lng = toFiniteNumber(place.geometry?.location?.lng);
              if (lat === null || lng === null) continue;
              if (!pointInBounds(bounds, lat, lng)) continue;
              const bucketLat = roundCell(lat);
              const bucketLng = roundCell(lng);
              const key = `${bucketLat}:${bucketLng}`;
              const ratingWeight = Math.max(
                1,
                Math.min(24, Number(place.user_ratings_total || 1)),
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
              weight: Math.max(6, Math.min(70, Math.round(bucket.weight * 0.75))),
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

    const combinedCells = [...firstPartyCells, ...googlePlaces.cells].sort(
      (a, b) => (b.weight || 0) - (a.weight || 0),
    );

    res.setHeader("Cache-Control", "public, max-age=45");
    return res.json({
      generatedAt: new Date().toISOString(),
      windowMinutes: effectiveWindowMinutes,
      requestedWindowMinutes,
      bounds,
      signalQuality: {
        tier: signalTier,
        isLowDensity: signalTier === "sparse",
      },
      firstParty: {
        totalPings,
        totalUniqueActors,
        cells: firstPartyCells,
      },
      googlePlaces,
      cells: combinedCells,
    });
  });

  app.post(
    "/api/admin/map/locations-cache/clear",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      mapLocationsCache = null;
      mapLocationsLastGood = null;
      res.json({ success: true });
    },
  );
}
