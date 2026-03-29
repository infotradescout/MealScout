import type { Express } from "express";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import { forwardGeocode, reverseGeocode } from "../utils/geocoding";
import {
  isHostProfileMapEligible,
  normalizeUsStateAbbr,
} from "../services/parkingPassQuality";
import { locationRequests, users } from "@shared/schema";

let mapLocationsCache: {
  expiresAt: number;
  payload: { hostLocations: any[]; eventLocations: any[] };
} | null = null;

let mapLocationsLastGood: {
  payload: { hostLocations: any[]; eventLocations: any[] };
} | null = null;

export function registerPublicMapRoutes(app: Express) {
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
      const deadline = Date.now() + GEOCODE_BUDGET_MS;

      for (const host of hostLocations) {
        const lat = parseCoord(host.latitude);
        const lng = parseCoord(host.longitude);
        const expectedState = expectedStateAbbrFor(host);
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
            const address = buildFullAddress(
              host.address,
              host.city,
              host.state,
            );
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
        const address = buildFullAddress(host.address, host.city, host.state);
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
