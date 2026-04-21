import type { Express } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { storage } from "../storage";
import { emailService } from "../emailService";
import { db } from "../db";
import {
  isAuthenticated,
  isRestaurantOwner,
  isStaffOrAdmin,
} from "../unifiedAuth";
import {
  eventBookings,
  events,
  eventSeries,
  hosts,
  insertEventInterestSchema,
  restaurants,
  users,
  CLAIM_STATUS,
  CLAIM_TYPES,
} from "@shared/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;
import { forwardGeocode, reverseGeocode } from "../utils/geocoding";
import { listParkingPassOccurrences } from "../services/parkingPassVirtual";
import { PARKING_PASS_MEAL_WINDOWS } from "@shared/parkingPassSlots";
import {
  computeHostProfileQualityFlags,
  computeParkingPassQualityFlags,
  isHostProfileMapEligible,
  isParkingPassPublicReady,
  normalizeUsStateAbbr,
} from "../services/parkingPassQuality";
import crypto from "crypto";
import {
  handleReportRequest,
  renderReportPdfForToken,
  requestReportSchema,
} from "../services/pensacolaReportLeadMagnet";
import { buildSlotDateTimes } from "../services/timeIntent";
import {
  resolveCityTimeZone,
  resolveCityTimeZoneSync,
} from "../services/cityTimeZone";
import { isSlotPublic, type PublicSlot } from "../services/publicSlotGate";
import { distributedRateLimit } from "../middleware/distributedRateLimit";
import { dateKeyFromUnknown, dateKeyInZone } from "../services/dateKeys";

type EventRouteDependencies = {
  hasBusinessDistributionAccess: (userId: string) => Promise<boolean>;
};

export function registerEventRoutes(
  app: Express,
  { hasBusinessDistributionAccess }: EventRouteDependencies,
) {
  const parkingPassFeedLimiter = distributedRateLimit({
    scope: "parking-pass-feed",
    limit: 120,
    windowMs: 60 * 1000,
  });
  const parkingPassBookabilityLimiter = distributedRateLimit({
    scope: "parking-pass-bookability",
    limit: 180,
    windowMs: 60 * 1000,
  });

  let parkingPassPublicFeedCache: { expiresAt: number; payload: any[] } | null =
    null;
  let parkingPassPublicFeedLastGood: { payload: any[] } | null = null;

  const toTeaserId = (value: string) =>
    crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);

  const normalizeLoose = (value: unknown) =>
    String(value || "")
      .trim()
      .toLowerCase();
  const normalizeStateToken = (value: unknown) =>
    normalizeLoose(value).replace(/[^a-z]/g, "");

  const isPensacola = (value: unknown) => {
    const raw = normalizeLoose(value);
    if (!raw) return false;
    if (raw === "pensacola") return true;
    // Accept common variants like "Pensacola, FL", "Pensacola Beach", etc.
    return raw.includes("pensacola");
  };

  const isFlorida = (value: unknown) => {
    const abbr = normalizeUsStateAbbr(String(value || "").trim());
    if (abbr === "FL") return true;
    const token = normalizeStateToken(value);
    if (!token) return false;
    if (token === "fl" || token === "fla") return true;
    // Common misspellings: flordia, floridia, etc.
    return token.startsWith("florid") || token.startsWith("flord");
  };

  const isFloridaLoose = (value: unknown) => {
    const raw = normalizeLoose(value);
    if (!raw) return false;
    if (isFlorida(raw)) return true;
    const token = normalizeStateToken(raw);
    if (token === "fl" || token === "fla") return true;
    return (
      raw.includes(", fl") ||
      raw.includes(" fl ") ||
      raw.endsWith(" fl") ||
      raw.includes(" florida") ||
      raw.includes(" flordia") ||
      raw.includes(" floridia")
    );
  };

  const roundCoord = (value: unknown, digits: number) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    const factor = Math.pow(10, digits);
    return Math.round(num * factor) / factor;
  };

  const minStartingPriceCents = (event: any): number | null => {
    const centsValues: number[] = [];
    for (const [key, raw] of Object.entries(event || {})) {
      if (!key.toLowerCase().endsWith("pricecents")) continue;
      const num = Number(raw);
      if (Number.isFinite(num) && num > 0) centsValues.push(Math.floor(num));
    }
    if (centsValues.length === 0) return null;
    return Math.min(...centsValues);
  };

  const redactParkingPassEventForGuest = (event: any) => {
    const host = event?.host ? { ...(event.host as any) } : null;
    const hostLat = host?.latitude ?? null;
    const hostLng = host?.longitude ?? null;
    if (host) {
      host.businessName = "Verified host";
      host.address = null;
      host.phone = null;
      host.email = null;
      host.latitude = roundCoord(hostLat, 2);
      host.longitude = roundCoord(hostLng, 2);
    }

    const redacted: any = { ...event, host };
    if ("hostAddress" in redacted) redacted.hostAddress = null;
    if ("address" in redacted) redacted.address = null;
    if ("hostBusinessName" in redacted)
      redacted.hostBusinessName = "Verified host";
    return redacted;
  };

  const buildParkingPassPublicFeed = async (): Promise<any[]> => {
    // Include draft series here; the public-ready filter below controls visibility.
    // This prevents "priced but still draft" series from disappearing from booking feeds.
    const { occurrences } = await listParkingPassOccurrences({
      horizonDays: 30,
      includeDraft: true,
    });

    // Decoupled: host Stripe Connect status no longer gates booking availability.
    // Payments are always enabled at the platform level; host payouts are deferred
    // until the host completes Stripe Connect onboarding.
    const payoutsEnabled = (_event: any) => true;
    const isPublicHostProfile = (host: any, event?: any) =>
      isHostProfileMapEligible({
        businessName: host?.businessName || event?.host?.businessName,
        address: host?.address || event?.hostAddress || event?.address,
        city: host?.city || event?.hostCity || event?.city,
        state: host?.state || event?.hostState || event?.state,
      });

    // NOTE: Public feed must only show Parking Pass listings that have pricing
    // and a clean, geocodable address. Draft/incomplete listings can exist
    // but must not be returned here.
    const virtualEvents = occurrences
      .filter(
        (event: any) =>
          isParkingPassPublicReady(event) &&
          isPublicHostProfile(event?.host, event),
      )
      .map((event: any) => ({
        ...event,
        paymentsEnabled: payoutsEnabled(event),
        qualityFlags: computeParkingPassQualityFlags(event),
      }));

    const legacyUpcoming = await storage.getAllUpcomingEvents();
    const legacyEvents = legacyUpcoming
      .filter(
        (event: any) =>
          event?.eventType === "parking_pass" &&
          isParkingPassPublicReady(event) &&
          isPublicHostProfile(event?.host, event),
      )
      .map((event: any) => ({
        ...event,
        paymentsEnabled: payoutsEnabled(event),
        qualityFlags: computeParkingPassQualityFlags(event),
      }));

    const dedupedById = new Map<string, any>();
    for (const item of [...virtualEvents, ...legacyEvents]) {
      dedupedById.set(item.id, item);
    }
    const parkingEvents = Array.from(dedupedById.values());

    // Best-effort: ensure host coordinates exist so map pins can render.
    // We intentionally cap work per request to avoid hammering geocoding providers.
    const MAX_GEOCODE_PER_REQUEST = 30;
    const seenHostIds = new Set<string>();
    let geocodeCount = 0;

    const candidateHosts: any[] = [];
    for (const event of parkingEvents) {
      const host: any = (event as any)?.host;
      const hostId = String(host?.id || "").trim();
      if (!hostId) continue;
      if (seenHostIds.has(hostId)) continue;
      seenHostIds.add(hostId);

      const lat =
        host.latitude !== null && host.latitude !== undefined
          ? Number(host.latitude)
          : NaN;
      const lng =
        host.longitude !== null && host.longitude !== undefined
          ? Number(host.longitude)
          : NaN;
      const hasCoords =
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lng) <= 180;
      if (hasCoords) continue;

      candidateHosts.push(host);
    }

    for (
      let index = 0;
      index < candidateHosts.length && geocodeCount < MAX_GEOCODE_PER_REQUEST;
      index += 1
    ) {
      const host: any = candidateHosts[index];
      const addressParts = [host.address, host.city, host.state, "USA"]
        .map((value: any) => String(value || "").trim())
        .filter((value: string) => value.length > 0);
      if (addressParts.length === 0) continue;

      const geocodeAddress = addressParts.join(", ");
      const coords = await forwardGeocode(geocodeAddress).catch(() => null);
      if (!coords) continue;

      geocodeCount += 1;

      // Persist and patch the in-memory host so this response includes the coords.
      try {
        await storage.updateHostCoordinates(host.id, coords.lat, coords.lng);
      } catch {
        // Ignore persistence errors; response can still use computed coords.
      }
      host.latitude = coords.lat.toString();
      host.longitude = coords.lng.toString();
    }

    // Do not drop listings just because coordinates are missing.
    // Host locations can still render via /api/map/locations coords or client geocode fallback.
    const eventIds = parkingEvents.map((event) => event.id);

    const bookingRows =
      eventIds.length > 0
        ? await db
            .select({
              eventId: eventBookings.eventId,
              spotNumber: eventBookings.spotNumber,
              bookingConfirmedAt: eventBookings.bookingConfirmedAt,
              slotType: eventBookings.slotType,
              truckId: eventBookings.truckId,
              truckName: restaurants.name,
            })
            .from(eventBookings)
            .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id))
            .where(inArray(eventBookings.eventId, eventIds))
            .where(inArray(eventBookings.status, ["confirmed"]))
            .orderBy(asc(eventBookings.bookingConfirmedAt))
        : [];

    const pendingCounts =
      eventIds.length > 0
        ? await db
            .select({
              eventId: eventBookings.eventId,
              count: sql<number>`count(*)`,
            })
            .from(eventBookings)
            .where(inArray(eventBookings.eventId, eventIds))
            .where(inArray(eventBookings.status, ["pending"]))
            .groupBy(eventBookings.eventId)
        : [];

    const pendingByEvent = new Map<string, number>();
    for (const row of pendingCounts) {
      pendingByEvent.set(row.eventId, Number(row.count || 0));
    }

    const bookingsByEvent = new Map<string, typeof bookingRows>();
    for (const row of bookingRows) {
      const list = bookingsByEvent.get(row.eventId) ?? [];
      list.push(row);
      bookingsByEvent.set(row.eventId, list);
    }

    const enhancedEvents = parkingEvents.map((event) => {
      const rows = bookingsByEvent.get(event.id) ?? [];
      const pending = pendingByEvent.get(event.id) ?? 0;
      const maxSpots = event.maxTrucks ?? 1;

      const usedSpotNumbers = new Set<number>();
      for (const row of rows) {
        if (row.spotNumber && row.spotNumber > 0) {
          usedSpotNumbers.add(row.spotNumber);
        }
      }

      let nextSpot = 1;
      for (const row of rows) {
        if (row.spotNumber && row.spotNumber > 0) {
          continue;
        }
        while (usedSpotNumbers.has(nextSpot) && nextSpot <= maxSpots) {
          nextSpot += 1;
        }
        if (nextSpot <= maxSpots) {
          usedSpotNumbers.add(nextSpot);
          nextSpot += 1;
        }
      }

      const availableSpotNumbers: number[] = [];
      for (let spot = 1; spot <= maxSpots; spot += 1) {
        if (!usedSpotNumbers.has(spot)) {
          availableSpotNumbers.push(spot);
        }
      }

      const confirmedCount = rows.length;
      const reservedCount = Math.min(confirmedCount + pending, maxSpots);
      const availableCount = Math.max(0, maxSpots - reservedCount);
      const trimmedAvailable = availableSpotNumbers.slice(0, availableCount);

      return {
        ...event,
        spotCount: maxSpots,
        bookedSpots: reservedCount,
        availableSpotNumbers: trimmedAvailable,
        bookings: rows.map((row: (typeof rows)[number]) => ({
          truckId: row.truckId,
          truckName: row.truckName,
          slotType: row.slotType,
          spotNumber: row.spotNumber,
          bookingConfirmedAt: row.bookingConfirmedAt,
        })),
      };
    });

    parkingPassPublicFeedCache = {
      payload: enhancedEvents,
      expiresAt: Date.now() + 60_000,
    };
    parkingPassPublicFeedLastGood = { payload: enhancedEvents };

    return enhancedEvents;
  };
  // Get all upcoming events (public)
  app.get("/api/events/upcoming", async (req: any, res) => {
    try {
      const upcomingEvents = await storage.getAllUpcomingEvents();
      res.json(
        (Array.isArray(upcomingEvents) ? upcomingEvents : []).filter(
          (event: any) =>
            !Boolean(event?.requiresPayment) &&
            String(event?.eventType || "") !== "private_event",
        ),
      );
    } catch (error: any) {
      console.error("Error fetching upcoming events:", error);
      // Public feed should degrade gracefully instead of surfacing a 500.
      res.json([]);
    }
  });

  // Truck Discovery (authenticated)
  app.get("/api/events", isAuthenticated, async (req: any, res) => {
    try {
      const hostIdFilter = String(req.query?.hostId || "").trim();
      const includePrivate =
        req.user?.userType === "admin" ||
        req.user?.userType === "super_admin" ||
        req.user?.userType === "staff";
      const upcomingEvents = await storage.getAllUpcomingEvents();
      let filtered = Array.isArray(upcomingEvents) ? upcomingEvents : [];
      if (hostIdFilter) {
        filtered = filtered.filter(
          (event: any) => String(event?.hostId || "") === hostIdFilter,
        );
      }
      filtered = filtered.filter(
        (event: any) =>
          !Boolean(event?.requiresPayment) &&
          (includePrivate || String(event?.eventType || "") !== "private_event"),
      );
      res.json(filtered);
    } catch (error: any) {
      console.error("Error fetching all events:", error);
      res.json([]);
    }
  });

  // Parking Pass listings (truck-paid slots only)
  app.get(
    "/api/parking-pass",
    parkingPassFeedLimiter,
    async (req: any, res) => {
      try {
        res.setHeader("Cache-Control", "public, max-age=60");
        const isAuthed = Boolean(req.isAuthenticated?.() && req.user?.id);
        if (
          parkingPassPublicFeedCache &&
          parkingPassPublicFeedCache.expiresAt > Date.now()
        ) {
          const payload = parkingPassPublicFeedCache.payload;
          return res.json(
            isAuthed ? payload : payload.map(redactParkingPassEventForGuest),
          );
        }
        const enhancedEvents = await buildParkingPassPublicFeed();
        res.json(
          isAuthed
            ? enhancedEvents
            : enhancedEvents.map(redactParkingPassEventForGuest),
        );
      } catch (error: any) {
        console.error("Error fetching parking pass listings:", error);
        if (parkingPassPublicFeedLastGood?.payload) {
          res.setHeader("X-MealScout-Stale", "1");
          const isAuthed = Boolean(req.isAuthenticated?.() && req.user?.id);
          const payload = parkingPassPublicFeedLastGood.payload;
          return res.json(
            isAuthed ? payload : payload.map(redactParkingPassEventForGuest),
          );
        }
        res.status(200).json([]);
      }
    },
  );

  // Lead-magnet feed (Pensacola): redact exact host details unless logged in.
  app.get("/api/public/pensacola/parking-pass-leads", async (req: any, res) => {
    try {
      res.setHeader("Cache-Control", "public, max-age=60");
      const isAuthed = Boolean(req.isAuthenticated?.() && req.user?.id);

      const feed =
        parkingPassPublicFeedCache &&
        parkingPassPublicFeedCache.expiresAt > Date.now()
          ? parkingPassPublicFeedCache.payload
          : await buildParkingPassPublicFeed();

      const pensacolaEvents = (Array.isArray(feed) ? feed : []).filter(
        (row: any) => {
          const host = row?.host || {};
          const city = host.city ?? row?.hostCity ?? row?.city;
          const state = host.state ?? row?.hostState ?? row?.state;
          const address = host.address ?? row?.hostAddress ?? row?.address;
          return (
            (isPensacola(city) || isPensacola(address)) &&
            (isFlorida(state) || isFloridaLoose(address))
          );
        },
      );

      // One card per host location: pick the soonest upcoming occurrence per host.
      const byHost = new Map<string, any>();
      for (const row of pensacolaEvents) {
        const hostId = String(row?.host?.id || "").trim();
        if (!hostId) continue;
        const existing = byHost.get(hostId);
        if (!existing) {
          byHost.set(hostId, row);
          continue;
        }
        const existingDate = new Date(existing?.date || 0).getTime();
        const nextDate = new Date(row?.date || 0).getTime();
        if (
          Number.isFinite(nextDate) &&
          nextDate > 0 &&
          nextDate < existingDate
        ) {
          byHost.set(hostId, row);
        }
      }

      const limitRaw = Number(process.env.PENSACOLA_LEAD_LOCATIONS_LIMIT ?? 20);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(limitRaw, 200))
        : 20;

      const listings = Array.from(byHost.values())
        .slice(0, limit)
        .map((row: any) => {
          const host = row?.host || {};
          const teaserId = toTeaserId(
            String(row?.id || host?.id || JSON.stringify(row || {})),
          );
          const city = String(
            host.city || row?.hostCity || row?.city || "Pensacola",
          );
          const state = normalizeUsStateAbbr(
            String(host.state || row?.hostState || row?.state || "FL"),
          );
          const startingAtCents = minStartingPriceCents(row);
          const rowTimeZone = resolveCityTimeZoneSync({
            city: host.city || row?.hostCity || row?.city,
            state: host.state || row?.hostState || row?.state,
          });
          const nextDate = row?.date
            ? dateKeyInZone(new Date(row.date), rowTimeZone)
            : null;

          const lat = host.latitude ?? row?.hostLatitude ?? row?.latitude;
          const lng = host.longitude ?? row?.hostLongitude ?? row?.longitude;

          if (!isAuthed) {
            return {
              teaserId,
              locked: true,
              city,
              state,
              latitude: roundCoord(lat, 2),
              longitude: roundCoord(lng, 2),
              startingAtCents,
              nextDate,
            };
          }

          return {
            teaserId,
            locked: false,
            passId: String(row?.id || ""),
            hostName: String(
              host.businessName ||
                row?.hostBusinessName ||
                row?.businessName ||
                "Host",
            ),
            address: String(
              host.address || row?.hostAddress || row?.address || "",
            ),
            city,
            state,
            latitude: roundCoord(lat, 6),
            longitude: roundCoord(lng, 6),
            startingAtCents,
            nextDate,
          };
        });

      res.json({
        city: "Pensacola",
        state: "FL",
        totalLocations: byHost.size,
        locked: !isAuthed,
        listings,
      });
    } catch (error) {
      console.error("[pensacola-leads] Error building lead feed:", error);
      res.json({
        city: "Pensacola",
        state: "FL",
        totalLocations: 0,
        locked: true,
        listings: [],
      });
    }
  });

  // Public event detail (crawler-friendly JSON for /event/:slug pages).
  app.get("/api/public/events/:eventId", async (req: any, res) => {
    try {
      const eventId = String(req.params.eventId || "").trim();
      if (!eventId)
        return res.status(400).json({ message: "eventId required" });

      const [row] = await db
        .select({
          id: events.id,
          hostId: events.hostId,
          name: events.name,
          description: events.description,
          eventType: events.eventType,
          date: events.date,
          startTime: events.startTime,
          endTime: events.endTime,
          status: events.status,
          lastConfirmedAt: events.lastConfirmedAt,
          updatedAt: events.updatedAt,
          maxTrucks: events.maxTrucks,
          bookedRestaurantId: events.bookedRestaurantId,
          requiresPayment: events.requiresPayment,
          hostPriceCents: events.hostPriceCents,
          hostName: hosts.businessName,
          hostAddress: hosts.address,
          hostCity: hosts.city,
          hostState: hosts.state,
          hostLatitude: hosts.latitude,
          hostLongitude: hosts.longitude,
          truckName: restaurants.name,
          truckCuisineType: restaurants.cuisineType,
          truckCity: restaurants.city,
          truckState: restaurants.state,
        })
        .from(events)
        .innerJoin(hosts, eq(events.hostId, hosts.id))
        .leftJoin(restaurants, eq(events.bookedRestaurantId, restaurants.id))
        .where(eq(events.id, eventId))
        .limit(1);

      if (!row || String(row.eventType || "") === "private_event") {
        return res.status(404).json({ message: "Event not found" });
      }

      const toSlug = (value: string | null | undefined) =>
        String(value || "")
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)+/g, "")
          .slice(0, 80);

      const baseUrl = String(
        process.env.PUBLIC_BASE_URL || "https://www.mealscout.us",
      ).replace(/\/+$/, "");

      const title =
        row.name ||
        `${row.hostName || "Host"} ${row.eventType === "parking_pass" ? "Parking Pass" : "Event"}`;
      const slug = `${toSlug(title) || row.id}--${row.id}`;
      const canonicalUrl = `${baseUrl}/event/${encodeURIComponent(slug)}`;

      const timeZone = await resolveCityTimeZone({
        city: row.hostCity,
        state: row.hostState,
      });
      const dt = buildSlotDateTimes({
        timeZone,
        date: new Date(row.date as any),
        startTime: String(row.startTime || ""),
        endTime: String(row.endTime || ""),
      });

      const now = new Date();
      const lastConfirmedAtUtc = new Date(
        row.lastConfirmedAt || row.updatedAt || row.date || Date.now(),
      );
      const slot: PublicSlot | null = dt
        ? {
            source: "parking_pass_booking",
            status: row.bookedRestaurantId ? "confirmed" : "tentative",
            startsAtUtc: dt.startUtc,
            endsAtUtc: dt.endUtc,
            lastConfirmedAtUtc,
          }
        : null;
      const gateOk = slot ? isSlotPublic({ slot, now }) : false;
      const ended = dt ? dt.endUtc.getTime() < now.getTime() : false;

      const hostSlug = `${toSlug(row.hostName) || row.hostId}--${row.hostId}`;
      const hostPath = `/location/${encodeURIComponent(hostSlug)}`;

      const truckPath =
        row.bookedRestaurantId && row.truckName
          ? `/truck/${encodeURIComponent(`${toSlug(row.truckName) || row.bookedRestaurantId}--${row.bookedRestaurantId}`)}`
          : null;

      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({
        id: row.id,
        title,
        description: row.description || null,
        date: row.date ? new Date(row.date as any).toISOString() : null,
        startTime: row.startTime,
        endTime: row.endTime,
        timeZone,
        startsAtUtc: dt ? dt.startUtc.toISOString() : null,
        endsAtUtc: dt ? dt.endUtc.toISOString() : null,
        lastConfirmedAtUtc: lastConfirmedAtUtc.toISOString(),
        isPublic: gateOk,
        ended,
        noIndex: ended || !gateOk,
        status: row.status,
        maxTrucks: row.maxTrucks,
        requiresPayment: row.requiresPayment ?? false,
        hostPriceCents: row.hostPriceCents ?? null,
        host: {
          id: row.hostId,
          name: row.hostName,
          address: row.hostAddress,
          city: row.hostCity,
          state: row.hostState,
          latitude: row.hostLatitude,
          longitude: row.hostLongitude,
          path: hostPath,
        },
        truck: row.bookedRestaurantId
          ? {
              id: row.bookedRestaurantId,
              name: row.truckName,
              cuisineType: row.truckCuisineType || null,
              city: row.truckCity || null,
              state: row.truckState || null,
              path: truckPath,
            }
          : null,
        canonicalUrl,
      });
    } catch (error: any) {
      console.error("[public-event] error:", error);
      res.status(500).json({ message: "Unable to load event" });
    }
  });

  // Pensacola Report lead magnet: email capture -> send PDF link
  const reportBurstLimiter = distributedRateLimit({
    scope: "pensacola-report:burst",
    limit: 5,
    windowMs: 5 * 60 * 1000,
    key: (req) => {
      const ua = String(req.get("User-Agent") || "").slice(0, 80);
      return `${req.ip}:${ua}`;
    },
  });
  const reportDailyLimiter = distributedRateLimit({
    scope: "pensacola-report:day",
    limit: 30,
    windowMs: 24 * 60 * 60 * 1000,
  });
  const reportEmailLimiter = distributedRateLimit({
    scope: "pensacola-report:email",
    limit: 3,
    windowMs: 60 * 60 * 1000,
    key: (req) => {
      const email = String((req as any).body?.email || "")
        .trim()
        .toLowerCase();
      return email || String(req.ip || "unknown");
    },
  });

  app.post(
    "/api/public/pensacola/report/request",
    reportBurstLimiter,
    reportDailyLimiter,
    reportEmailLimiter,
    async (req: any, res) => {
      try {
        const parsed = requestReportSchema.parse(req.body);
        const result = await handleReportRequest({
          email: parsed.email,
          firstName: parsed.firstName || null,
          ip: String(req.ip || ""),
          userAgent: String(req.get("User-Agent") || ""),
        });

        if (!result.ok && result.code === "disabled") {
          return res
            .status(503)
            .json({ ok: false, message: "Report is temporarily unavailable." });
        }

        return res.json({
          ok: true,
          leadId: (result as any).leadId,
          emailed: (result as any).emailed ?? false,
          downloadUrl: (result as any).downloadUrl ?? null,
        });
      } catch (error: any) {
        if (error?.name === "ZodError") {
          return res
            .status(400)
            .json({ ok: false, message: "Valid email is required." });
        }
        console.error("[pensacola-report] request failed:", error);
        return res
          .status(500)
          .json({ ok: false, message: "Unable to send report right now." });
      }
    },
  );

  // Pensacola Report download: serve PDF by token (no auth required)
  app.get("/api/public/pensacola/report/download", async (req: any, res) => {
    try {
      const token = String(req.query?.token || "").trim();
      if (!token) {
        return res.status(400).send("Missing token");
      }

      const result = await renderReportPdfForToken(token);
      if (!result.ok) {
        return res.status(400).send("Invalid or expired link");
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="pensacola-food-truck-report.pdf"',
      );
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).send(result.pdf);
    } catch (error) {
      console.error("[pensacola-report] download failed:", error);
      return res.status(500).send("Unable to generate report");
    }
  });

  // Lightweight helper for map gating: which hosts have public-ready (priced) parking pass listings?
  // This endpoint intentionally avoids booking lookups/geocoding so maps can load quickly.
  let parkingPassHostIdsCache: {
    expiresAt: number;
    payload: { generatedAt: string; hostIds: string[] };
  } | null = null;
  let parkingPassHostIdsLastGood: {
    payload: { generatedAt: string; hostIds: string[] };
  } | null = null;
  app.get(
    "/api/parking-pass/host-ids",
    parkingPassBookabilityLimiter,
    async (_req: any, res) => {
      try {
        res.setHeader("Cache-Control", "public, max-age=60");
        if (
          parkingPassHostIdsCache &&
          parkingPassHostIdsCache.expiresAt > Date.now()
        ) {
          return res.json(parkingPassHostIdsCache.payload);
        }

        // Prefer the simple model: host pricing fields are the source of truth.
        // If host pricing columns are not present (older DB) this will naturally return [] and we'll fall back below.
        const hostPricingIds = new Set<string>();
        try {
          const allHosts = await storage.getAllHosts();
          for (const host of allHosts as any[]) {
            const hostId = String(host?.id || "").trim();
            if (!hostId) continue;
            if (
              !isHostProfileMapEligible({
                businessName: host?.businessName,
                address: host?.address,
                city: host?.city,
                state: host?.state,
              })
            ) {
              continue;
            }

            const listing = {
              host,
              startTime:
                String(host?.parkingPassStartTime || "").trim() ||
                PARKING_PASS_MEAL_WINDOWS.breakfast.start,
              endTime:
                String(host?.parkingPassEndTime || "").trim() ||
                PARKING_PASS_MEAL_WINDOWS.dinner.end,
              maxTrucks: host?.spotCount ?? 1,
              breakfastPriceCents: host?.parkingPassBreakfastPriceCents ?? 0,
              lunchPriceCents: host?.parkingPassLunchPriceCents ?? 0,
              dinnerPriceCents: host?.parkingPassDinnerPriceCents ?? 0,
              dailyPriceCents: host?.parkingPassDailyPriceCents ?? 0,
              weeklyPriceCents: host?.parkingPassWeeklyPriceCents ?? 0,
              monthlyPriceCents: host?.parkingPassMonthlyPriceCents ?? 0,
            };
            if (!isParkingPassPublicReady(listing as any)) continue;
            hostPricingIds.add(hostId);
          }
        } catch (error) {
          console.warn(
            "parking-pass/host-ids host-pricing fast path failed:",
            error,
          );
        }

        if (hostPricingIds.size > 0) {
          const payload = {
            generatedAt: new Date().toISOString(),
            hostIds: Array.from(hostPricingIds),
          };
          parkingPassHostIdsCache = {
            payload,
            expiresAt: Date.now() + 60_000,
          };
          parkingPassHostIdsLastGood = { payload };
          return res.json(payload);
        }

        // Bookable = host has a public-ready Parking Pass series (address + pricing + valid window/spots).
        // Coordinates are best-effort and do not block bookability.
        const rows = await db
          .select({
            host: hosts,
            series: eventSeries,
            isDisabled: users.isDisabled,
          })
          .from(eventSeries)
          .innerJoin(hosts, eq(hosts.id, eventSeries.hostId))
          .leftJoin(users, eq(hosts.userId, users.id))
          .where(eq(eventSeries.seriesType, "parking_pass"));

        const hostIds = new Set<string>();
        rows.forEach((row: any) => {
          const hostId = String(row?.host?.id || "").trim();
          if (!hostId) return;
          if (row?.isDisabled === true) return;
          if (
            !isHostProfileMapEligible({
              businessName: row?.host?.businessName,
              address: row?.host?.address,
              city: row?.host?.city,
              state: row?.host?.state,
            })
          ) {
            return;
          }

          const publicReady = isParkingPassPublicReady({
            host: row.host,
            startTime: row?.series?.defaultStartTime,
            endTime: row?.series?.defaultEndTime,
            maxTrucks: row?.series?.defaultMaxTrucks,
            breakfastPriceCents: row?.series?.defaultBreakfastPriceCents,
            lunchPriceCents: row?.series?.defaultLunchPriceCents,
            dinnerPriceCents: row?.series?.defaultDinnerPriceCents,
            dailyPriceCents: row?.series?.defaultDailyPriceCents,
            weeklyPriceCents: row?.series?.defaultWeeklyPriceCents,
            monthlyPriceCents: row?.series?.defaultMonthlyPriceCents,
          });
          if (!publicReady) return;

          hostIds.add(hostId);
        });

        const payload = {
          generatedAt: new Date().toISOString(),
          hostIds: Array.from(hostIds),
        };
        parkingPassHostIdsCache = {
          payload,
          expiresAt: Date.now() + 60_000,
        };
        parkingPassHostIdsLastGood = { payload };
        res.json(payload);
      } catch (error: any) {
        console.error("Error fetching parking pass host ids:", error);
        if (parkingPassHostIdsLastGood?.payload) {
          res.setHeader("X-MealScout-Stale", "1");
          return res.json(parkingPassHostIdsLastGood.payload);
        }
        res
          .status(200)
          .json({ generatedAt: new Date().toISOString(), hostIds: [] });
      }
    },
  );

  let parkingPassHostStatusCacheByDate = new Map<
    string,
    {
      expiresAt: number;
      payload: {
        generatedAt: string;
        date: string;
        hosts: Array<{
          hostId: string;
          availableCount: number;
          spotCount: number;
          reservedCount: number;
          isFull: boolean;
        }>;
      };
    }
  >();

  const normalizeDateKey = (value: unknown) =>
    dateKeyFromUnknown(value, "America/Chicago") ||
    dateKeyInZone(new Date(), "America/Chicago");

  const buildParkingPassHostStatusPayload = async (dateKey: string) => {
    const eventDateKey = (event: any) => {
      const tz = resolveCityTimeZoneSync({
        city: event?.host?.city || event?.hostCity || event?.city,
        state: event?.host?.state || event?.hostState || event?.state,
      });
      return dateKeyInZone(new Date(event?.date), tz);
    };
    const isPublicHostProfile = (host: any, event?: any) =>
      isHostProfileMapEligible({
        businessName: host?.businessName || event?.host?.businessName,
        address: host?.address || event?.hostAddress || event?.address,
        city: host?.city || event?.hostCity || event?.city,
        state: host?.state || event?.hostState || event?.state,
      });
    const { occurrences } = await listParkingPassOccurrences({
      horizonDays: 30,
      includeDraft: true,
    });
    const virtualEvents = occurrences.filter((event: any) => {
      if (!isParkingPassPublicReady(event)) return false;
      if (!isPublicHostProfile(event?.host, event)) return false;
      const eventDate = eventDateKey(event);
      return eventDate === dateKey;
    });

    const legacyUpcoming = await storage.getAllUpcomingEvents();
    const legacyEvents = legacyUpcoming.filter((event: any) => {
      if (event?.eventType !== "parking_pass") return false;
      if (!isParkingPassPublicReady(event)) return false;
      if (!isPublicHostProfile(event?.host, event)) return false;
      const eventDate = eventDateKey(event);
      return eventDate === dateKey;
    });

    const dedupedById = new Map<string, any>();
    for (const item of [...virtualEvents, ...legacyEvents]) {
      dedupedById.set(String(item.id), item);
    }
    const events = Array.from(dedupedById.values());
    const eventIds = events.map((event) => String(event.id));

    const bookingCounts =
      eventIds.length > 0
        ? await db
            .select({
              eventId: eventBookings.eventId,
              status: eventBookings.status,
              count: sql<number>`count(*)`,
            })
            .from(eventBookings)
            .where(inArray(eventBookings.eventId, eventIds))
            .where(inArray(eventBookings.status, ["confirmed", "pending"]))
            .groupBy(eventBookings.eventId, eventBookings.status)
        : [];

    const countsByEvent = new Map<
      string,
      { confirmed: number; pending: number }
    >();
    for (const row of bookingCounts) {
      const prev = countsByEvent.get(row.eventId) || {
        confirmed: 0,
        pending: 0,
      };
      if (row.status === "confirmed") prev.confirmed = Number(row.count || 0);
      if (row.status === "pending") prev.pending = Number(row.count || 0);
      countsByEvent.set(row.eventId, prev);
    }

    const byHost = new Map<
      string,
      { availableCount: number; spotCount: number; reservedCount: number }
    >();

    for (const event of events) {
      const hostId = String(event?.hostId ?? event?.host?.id ?? "").trim();
      if (!hostId) continue;
      const maxSpots = Number(event?.maxTrucks ?? 1) || 1;
      const counts = countsByEvent.get(String(event.id)) || {
        confirmed: 0,
        pending: 0,
      };
      const reservedCount = Math.min(
        maxSpots,
        Number(counts.confirmed) + Number(counts.pending),
      );
      const availableCount = Math.max(0, maxSpots - reservedCount);

      const prev = byHost.get(hostId) || {
        availableCount: 0,
        spotCount: 0,
        reservedCount: 0,
      };
      byHost.set(hostId, {
        availableCount: prev.availableCount + availableCount,
        spotCount: prev.spotCount + maxSpots,
        reservedCount: prev.reservedCount + reservedCount,
      });
    }

    const hosts = Array.from(byHost.entries()).map(([hostId, totals]) => ({
      hostId,
      availableCount: totals.availableCount,
      spotCount: totals.spotCount,
      reservedCount: totals.reservedCount,
      isFull: totals.availableCount <= 0,
    }));

    return {
      generatedAt: new Date().toISOString(),
      date: dateKey,
      hosts,
    };
  };

  app.get(
    "/api/parking-pass/host-status",
    parkingPassBookabilityLimiter,
    async (req: any, res) => {
      try {
        res.setHeader("Cache-Control", "public, max-age=60");
        const dateKey = normalizeDateKey(req.query?.date);
        const cached = parkingPassHostStatusCacheByDate.get(dateKey);
        if (cached && cached.expiresAt > Date.now()) {
          return res.json(cached.payload);
        }

        const payload = await buildParkingPassHostStatusPayload(dateKey);
        parkingPassHostStatusCacheByDate.set(dateKey, {
          payload,
          expiresAt: Date.now() + 60_000,
        });
        res.json(payload);
      } catch (error: any) {
        console.error("Error fetching parking pass host status:", error);
        const dateKey = normalizeDateKey(req.query?.date);
        const stale = parkingPassHostStatusCacheByDate.get(dateKey);
        if (stale?.payload) {
          res.setHeader("X-MealScout-Stale", "1");
          return res.json(stale.payload);
        }
        res.status(200).json({
          generatedAt: new Date().toISOString(),
          date: dateKey,
          hosts: [],
        });
      }
    },
  );

  app.get(
    "/api/admin/parking-pass/host-status",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      const dateKey = normalizeDateKey(req.query?.date);
      try {
        const payload = await buildParkingPassHostStatusPayload(dateKey);

        // Attach quality flags (staff/admin only) so map popups can show "needs fixes".
        const flagsByHost = new Map<string, Set<string>>();
        const { occurrences } = await listParkingPassOccurrences({
          horizonDays: 30,
          includeDraft: true,
        });
        occurrences.forEach((event: any) => {
          const hostId = String(event?.hostId ?? event?.host?.id ?? "").trim();
          const eventDate = dateKeyInZone(
            new Date(event?.date),
            resolveCityTimeZoneSync({
              city: event?.host?.city || event?.hostCity || event?.city,
              state: event?.host?.state || event?.hostState || event?.state,
            }),
          );
          if (!hostId || eventDate !== dateKey) return;
          const flags = computeParkingPassQualityFlags(event);
          const set = flagsByHost.get(hostId) || new Set<string>();
          flags.forEach((flag) => set.add(flag));
          flagsByHost.set(hostId, set);
        });

        const hosts = payload.hosts.map((host) => ({
          ...host,
          qualityFlags: Array.from(flagsByHost.get(host.hostId) || []),
        }));

        res.json({ ...payload, hosts });
      } catch (error: any) {
        console.error("Error fetching admin parking pass host status:", error);
        try {
          // Graceful fallback: keep map usable for staff/admin even if
          // quality-flag enrichment fails.
          const payload = await buildParkingPassHostStatusPayload(dateKey);
          res.setHeader("X-MealScout-Stale", "1");
          return res.status(200).json({
            ...payload,
            hosts: payload.hosts.map((host) => ({ ...host, qualityFlags: [] })),
          });
        } catch (fallbackError: any) {
          console.error(
            "Error building fallback admin parking pass host status:",
            fallbackError,
          );
          res.setHeader("X-MealScout-Stale", "1");
          return res.status(200).json({
            generatedAt: new Date().toISOString(),
            date: dateKey,
            hosts: [],
          });
        }
      }
    },
  );

  app.post(
    "/api/admin/parking-pass/cache/clear",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      parkingPassHostIdsCache = null;
      parkingPassHostIdsLastGood = null;
      parkingPassHostStatusCacheByDate = new Map();
      parkingPassPublicFeedCache = null;
      parkingPassPublicFeedLastGood = null;
      res.json({ success: true });
    },
  );

  app.get(
    "/api/admin/parking-pass/fix-queue",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const seriesRows = await storage.getParkingPassSeriesSafe();
        const hostIds = Array.from(
          new Set<string>(
            seriesRows
              .map((row) => String(row.hostId || "").trim())
              .filter(Boolean),
          ),
        );
        const hostRows = await storage.getHostsByIds(hostIds);
        const hostById = new Map<string, any>(
          (hostRows || []).map((host: any) => [host.id, host]),
        );

        const items = seriesRows.map((series: any) => {
          const hostId = String(series.hostId || "").trim();
          const host = hostById.get(hostId) ?? null;
          const platformPaymentsEnabled = Boolean(
            process.env.STRIPE_SECRET_KEY,
          );
          const listing = {
            host,
            startTime: series.defaultStartTime,
            endTime: series.defaultEndTime,
            maxTrucks: series.defaultMaxTrucks,
            breakfastPriceCents: series.defaultBreakfastPriceCents,
            lunchPriceCents: series.defaultLunchPriceCents,
            dinnerPriceCents: series.defaultDinnerPriceCents,
            dailyPriceCents: series.defaultDailyPriceCents,
            weeklyPriceCents: series.defaultWeeklyPriceCents,
            monthlyPriceCents: series.defaultMonthlyPriceCents,
          };
          const qualityFlags = computeParkingPassQualityFlags(listing);
          const publicReady = isParkingPassPublicReady(listing);

          return {
            seriesId: series.id,
            seriesStatus: series.status ?? null,
            hostId: host?.id ?? hostId,
            hostUserId: host?.userId ?? null,
            businessName: host?.businessName ?? null,
            address: host?.address ?? null,
            city: host?.city ?? null,
            state: host?.state ?? null,
            paymentsEnabled: platformPaymentsEnabled,
            publicReady,
            qualityFlags,
            hasSpotPhoto: Boolean((host as any)?.spotImageUrl),
          };
        });

        items.sort((a: any, b: any) => {
          const aScore = (a.publicReady ? 0 : 10) + a.qualityFlags.length;
          const bScore = (b.publicReady ? 0 : 10) + b.qualityFlags.length;
          return bScore - aScore;
        });

        res.json({ rows: items });
      } catch (error: any) {
        console.error("Error building parking pass fix queue:", error);
        res.status(500).json({ message: "Failed to load fix queue" });
      }
    },
  );

  app.get(
    "/api/admin/parking-pass/host-trace",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const horizonRaw = Number(req.query?.horizonDays ?? 30);
        const horizonDays = Number.isFinite(horizonRaw)
          ? Math.min(90, Math.max(1, Math.floor(horizonRaw)))
          : 30;

        const [hostRows, seriesRows, occurrenceResult, legacyUpcoming] =
          await Promise.all([
            db
              .select({
                id: hosts.id,
                userId: hosts.userId,
                businessName: hosts.businessName,
                address: hosts.address,
                city: hosts.city,
                state: hosts.state,
                latitude: hosts.latitude,
                longitude: hosts.longitude,
                isDisabled: users.isDisabled,
              })
              .from(hosts)
              .leftJoin(users, eq(hosts.userId, users.id)),
            db
              .select({
                id: eventSeries.id,
                hostId: eventSeries.hostId,
                status: eventSeries.status,
                updatedAt: eventSeries.updatedAt,
              })
              .from(eventSeries)
              .where(eq(eventSeries.seriesType, "parking_pass")),
            listParkingPassOccurrences({ horizonDays, includeDraft: true }),
            storage.getAllUpcomingEvents(),
          ]);

        const parseCoord = (value?: string | number | null) => {
          if (value === null || value === undefined) return null;
          const parsed = typeof value === "string" ? Number(value) : value;
          return Number.isFinite(parsed) ? parsed : null;
        };

        const hostById = new Map<string, (typeof hostRows)[number]>();
        hostRows.forEach((host: any) => {
          hostById.set(String(host.id), host);
        });

        const seriesByHost = new Map<
          string,
          {
            total: number;
            published: number;
            draft: number;
            latestUpdatedAt: string | null;
          }
        >();
        seriesRows.forEach((series: any) => {
          const hostId = String(series.hostId || "").trim();
          if (!hostId) return;
          const prev = seriesByHost.get(hostId) || {
            total: 0,
            published: 0,
            draft: 0,
            latestUpdatedAt: null,
          };
          prev.total += 1;
          if (String(series.status || "").toLowerCase() === "published") {
            prev.published += 1;
          }
          if (String(series.status || "").toLowerCase() === "draft") {
            prev.draft += 1;
          }
          const updatedAt = series.updatedAt
            ? new Date(series.updatedAt)
            : null;
          const prevUpdatedAt = prev.latestUpdatedAt
            ? new Date(prev.latestUpdatedAt)
            : null;
          if (
            updatedAt &&
            (!prevUpdatedAt || updatedAt.getTime() > prevUpdatedAt.getTime())
          ) {
            prev.latestUpdatedAt = updatedAt.toISOString();
          }
          seriesByHost.set(hostId, prev);
        });

        const occurrenceByHost = new Map<
          string,
          {
            total: number;
            publicReady: number;
            qualityFlags: Set<string>;
            nextDate: string | null;
          }
        >();
        occurrenceResult.occurrences.forEach((event: any) => {
          const hostId = String(event?.hostId ?? event?.host?.id ?? "").trim();
          if (!hostId) return;
          const prev = occurrenceByHost.get(hostId) || {
            total: 0,
            publicReady: 0,
            qualityFlags: new Set<string>(),
            nextDate: null,
          };
          prev.total += 1;
          const flags = computeParkingPassQualityFlags(event);
          flags.forEach((flag) => prev.qualityFlags.add(flag));
          if (flags.length === 0) {
            prev.publicReady += 1;
          }
          const dateKey = String(event?.date || "").slice(0, 10);
          if (dateKey && (!prev.nextDate || dateKey < prev.nextDate)) {
            prev.nextDate = dateKey;
          }
          occurrenceByHost.set(hostId, prev);
        });

        const legacyByHost = new Map<
          string,
          { total: number; publicReady: number }
        >();
        legacyUpcoming.forEach((event: any) => {
          if (event?.eventType !== "parking_pass") return;
          const hostId = String(event?.hostId ?? event?.host?.id ?? "").trim();
          if (!hostId) return;
          const prev = legacyByHost.get(hostId) || { total: 0, publicReady: 0 };
          prev.total += 1;
          if (isParkingPassPublicReady(event)) {
            prev.publicReady += 1;
          }
          legacyByHost.set(hostId, prev);
        });

        const allHostIds = new Set<string>();
        hostById.forEach((_v, hostId) => allHostIds.add(hostId));
        seriesByHost.forEach((_v, hostId) => allHostIds.add(hostId));
        occurrenceByHost.forEach((_v, hostId) => allHostIds.add(hostId));
        legacyByHost.forEach((_v, hostId) => allHostIds.add(hostId));

        const rows = Array.from(allHostIds)
          .map((hostId) => {
            const host = hostById.get(hostId) || null;
            const series = seriesByHost.get(hostId) || {
              total: 0,
              published: 0,
              draft: 0,
              latestUpdatedAt: null,
            };
            const occurrences = occurrenceByHost.get(hostId) || {
              total: 0,
              publicReady: 0,
              qualityFlags: new Set<string>(),
              nextDate: null,
            };
            const legacy = legacyByHost.get(hostId) || {
              total: 0,
              publicReady: 0,
            };

            const lat = parseCoord(host?.latitude);
            const lng = parseCoord(host?.longitude);
            const hasCoords =
              lat !== null &&
              lng !== null &&
              Math.abs(lat) <= 90 &&
              Math.abs(lng) <= 180;
            const hasAddress = Boolean(String(host?.address || "").trim());
            const isDisabled = Boolean(host?.isDisabled);
            const hostQualityFlags = computeHostProfileQualityFlags({
              businessName: host?.businessName,
              address: host?.address,
              city: host?.city,
              state: host?.state,
            });

            const reasons: string[] = [];
            if (!host) reasons.push("missing_host_profile");
            if (isDisabled) reasons.push("user_disabled");
            if (!hasAddress) reasons.push("missing_address");
            hostQualityFlags.forEach((flag) => reasons.push(`quality:${flag}`));
            if (!hasCoords) reasons.push("missing_coords");
            if (series.total === 0) reasons.push("no_parking_pass_series");
            if (occurrences.publicReady === 0 && legacy.publicReady === 0) {
              reasons.push("no_public_ready_parking_pass");
            }
            occurrences.qualityFlags.forEach((flag) =>
              reasons.push(`quality:${flag}`),
            );

            const mapFeedCandidate = Boolean(
              host &&
              !isDisabled &&
              hasAddress &&
              hostQualityFlags.length === 0,
            );
            const parkingPassFeedVisible =
              occurrences.publicReady > 0 || legacy.publicReady > 0;

            return {
              hostId,
              businessName: host?.businessName || null,
              city: host?.city || null,
              state: host?.state || null,
              isDisabled,
              hasAddress,
              hasCoords,
              mapFeedCandidate,
              parkingPass: {
                seriesTotal: series.total,
                seriesPublished: series.published,
                seriesDraft: series.draft,
                latestSeriesUpdatedAt: series.latestUpdatedAt,
                occurrencesTotal: occurrences.total,
                occurrencesPublicReady: occurrences.publicReady,
                nextOccurrenceDate: occurrences.nextDate,
                legacyEventsTotal: legacy.total,
                legacyPublicReady: legacy.publicReady,
                visibleInFeed: parkingPassFeedVisible,
              },
              reasons,
            };
          })
          .sort((a, b) => {
            const severityA = a.reasons.length;
            const severityB = b.reasons.length;
            if (severityA !== severityB) return severityB - severityA;
            return String(a.businessName || a.hostId).localeCompare(
              String(b.businessName || b.hostId),
            );
          });

        const summary = {
          hostCount: rows.length,
          mapFeedCandidates: rows.filter((row) => row.mapFeedCandidate).length,
          parkingPassVisible: rows.filter(
            (row) => row.parkingPass.visibleInFeed,
          ).length,
          withBlockingReasons: rows.filter((row) => row.reasons.length > 0)
            .length,
          generatedAt: new Date().toISOString(),
          horizonDays,
        };

        res.json({ summary, rows });
      } catch (error: any) {
        console.error("Error building parking pass host trace:", error);
        res.status(500).json({ message: "Failed to build host trace" });
      }
    },
  );

  app.post(
    "/api/events/:eventId/interests",
    isRestaurantOwner,
    async (req: any, res) => {
      try {
        const { eventId } = req.params;
        const { restaurantId, message } = req.body;

        if (!restaurantId) {
          return res.status(400).json({ message: "Restaurant ID is required" });
        }

        // Verify ownership
        const ownsRestaurant = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageParkingPass",
        );
        if (!ownsRestaurant) {
          return res.status(403).json({
            message: "You can only express interest for restaurants you own",
          });
        }

        // Check event expiry
        const event = await storage.getEvent(eventId);
        if (!event) {
          return res.status(404).json({ message: "Event not found" });
        }

        if (event.requiresPayment) {
          return res.status(400).json({
            message:
              "This listing uses Parking Pass. Events do not accept payments.",
          });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (new Date(event.date) < today) {
          return res
            .status(400)
            .json({ message: "Cannot express interest in past events" });
        }

        // Check idempotency
        const existing = await storage.getEventInterestByTruckId(
          eventId,
          restaurantId,
        );
        if (existing) {
          return res.status(200).json({
            message: "Interest already expressed",
            interest: existing,
          });
        }

        const parsed = insertEventInterestSchema.parse({
          eventId,
          truckId: restaurantId,
          message,
        });

        const interest = await storage.createEventInterest(parsed);

        // Send notification to host (fire and forget)
        (async () => {
          try {
            const event = await storage.getEvent(eventId);
            if (event) {
              // Telemetry: Interest Created
              await storage.createTelemetryEvent({
                eventName: "interest_created",
                userId: req.user.id,
                properties: {
                  eventId,
                  truckId: restaurantId,
                  eventDate: event.date,
                },
              });

              const host = await storage.getHost(event.hostId);
              const truck = await storage.getRestaurant(restaurantId);

              if (host && truck) {
                // Get host's user email
                const hostUser = await storage.getUser(host.userId);
                if (hostUser && hostUser.email) {
                  await emailService.sendInterestNotification(
                    hostUser.email,
                    host.businessName,
                    truck.name,
                    new Date(event.date).toLocaleDateString(),
                  );
                }
              }
            }
          } catch (err) {
            console.error("Failed to send interest notification:", err);
          }
        })();

        res.status(201).json({ message: "Interest sent", interest });
      } catch (error: any) {
        console.error("Error creating event interest:", error);
        if (error instanceof z.ZodError) {
          return res
            .status(400)
            .json({ message: "Invalid data", errors: error.errors });
        }
        res.status(500).json({ message: "Failed to submit interest" });
      }
    },
  );

  app.post("/api/events/signup", isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        eventName: z.string().min(1),
        date: z.string().min(1),
        city: z.string().min(1),
        expectedCrowd: z.string().min(1),
        requestedTruckCount: z.coerce.number().int().min(1).max(25).default(1),
        eventVisibility: z.enum(["private", "public"]).default("public"),
        contactEmail: z.string().email(),
        contactPhone: z.string().optional(),
        notes: z.string().optional(),
      });

      const parsed = schema.parse(req.body);
      let updatedUserType = req.user?.userType;
      if (req.user?.userType === "customer") {
        const updatedUser = await storage.updateUserType(
          req.user.id,
          "event_coordinator",
        );
        updatedUserType = updatedUser.userType;
      }

      const adminEmail =
        process.env.ADMIN_ALERT_EMAIL || "info.mealscout@gmail.com";

      const subject = `New event coordinator request: ${parsed.eventName}`;
      const html = `
        <h2>New event coordinator request</h2>
        <p><strong>Event:</strong> ${parsed.eventName}</p>
        <p><strong>Date:</strong> ${parsed.date}</p>
        <p><strong>City:</strong> ${parsed.city}</p>
        <p><strong>Expected Crowd:</strong> ${parsed.expectedCrowd}</p>
        <p><strong>Requested Trucks:</strong> ${parsed.requestedTruckCount}</p>
        <p><strong>Visibility:</strong> ${parsed.eventVisibility}</p>
        <p><strong>Contact Email:</strong> ${parsed.contactEmail}</p>
        ${parsed.contactPhone ? `<p><strong>Phone:</strong> ${parsed.contactPhone}</p>` : ""}
        ${parsed.notes ? `<p><strong>Notes:</strong> ${parsed.notes}</p>` : ""}
      `;

      await emailService.sendBasicEmail(adminEmail, subject, html);

      await storage.createTelemetryEvent({
        eventName: "event_coordinator_request_created",
        userId: req.user.id,
        properties: {
          eventName: parsed.eventName,
          city: parsed.city,
          expectedCrowd: parsed.expectedCrowd,
          requestedTruckCount: parsed.requestedTruckCount,
          eventVisibility: parsed.eventVisibility,
        },
      });

      await storage.createUnifiedClaim({
        personId: req.user.id,
        claimType: CLAIM_TYPES.EVENT,
        status: CLAIM_STATUS.PROVISIONAL,
        claimData: {
          eventName: parsed.eventName,
          date: parsed.date,
          city: parsed.city,
          expectedCrowd: parsed.expectedCrowd,
          requestedTruckCount: parsed.requestedTruckCount,
          eventVisibility: parsed.eventVisibility,
          contactEmail: parsed.contactEmail,
          contactPhone: parsed.contactPhone ?? null,
          notes: parsed.notes ?? null,
        },
        metadata: {
          source: "event_signup",
          discoverableByAllUsers: parsed.eventVisibility === "public",
        },
      });

      res.json({ message: "Request submitted", userType: updatedUserType });
    } catch (error: any) {
      console.error("Error submitting event coordinator request:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to submit request" });
    }
  });

  app.post("/api/events/private-truck-request", async (req: any, res) => {
    try {
      const schema = z.object({
        requesterName: z.string().min(1),
        contactEmail: z.string().email(),
        contactPhone: z.string().optional(),
        city: z.string().min(1),
        date: z.string().min(1),
        occasion: z.string().min(1),
        guestCount: z.string().min(1),
        requestedTruckCount: z.coerce.number().int().min(1).max(25).default(1),
        eventVisibility: z.enum(["private", "public"]).default("private"),
        details: z.string().optional(),
      });

      const parsed = schema.parse(req.body);
      const adminEmail =
        process.env.ADMIN_ALERT_EMAIL || "info.mealscout@gmail.com";
      const subject = `New private truck request: ${parsed.occasion} (${parsed.city})`;
      const html = `
        <h2>New private truck request</h2>
        <p><strong>Name:</strong> ${parsed.requesterName}</p>
        <p><strong>Email:</strong> ${parsed.contactEmail}</p>
        ${parsed.contactPhone ? `<p><strong>Phone:</strong> ${parsed.contactPhone}</p>` : ""}
        <p><strong>City:</strong> ${parsed.city}</p>
        <p><strong>Date:</strong> ${parsed.date}</p>
        <p><strong>Occasion:</strong> ${parsed.occasion}</p>
        <p><strong>Guest Count:</strong> ${parsed.guestCount}</p>
        <p><strong>Requested Trucks:</strong> ${parsed.requestedTruckCount}</p>
        <p><strong>Visibility:</strong> ${parsed.eventVisibility}</p>
        ${parsed.details ? `<p><strong>Details:</strong> ${parsed.details}</p>` : ""}
      `;

      await emailService.sendBasicEmail(adminEmail, subject, html);

      await storage.createTelemetryEvent({
        eventName: "private_truck_request_created",
        userId: req.user?.id || null,
        properties: {
          city: parsed.city,
          occasion: parsed.occasion,
          guestCount: parsed.guestCount,
          requestedTruckCount: parsed.requestedTruckCount,
          eventVisibility: parsed.eventVisibility,
        },
      });

      if (req.user?.id) {
        await storage.createUnifiedClaim({
          personId: req.user.id,
          claimType: CLAIM_TYPES.FOOD_TRUCK,
          status: CLAIM_STATUS.PROVISIONAL,
          claimData: {
            requesterName: parsed.requesterName,
            contactEmail: parsed.contactEmail,
            contactPhone: parsed.contactPhone ?? null,
            city: parsed.city,
            date: parsed.date,
            occasion: parsed.occasion,
            guestCount: parsed.guestCount,
            requestedTruckCount: parsed.requestedTruckCount,
            eventVisibility: parsed.eventVisibility,
            details: parsed.details ?? null,
          },
          metadata: {
            source: "private_truck_request",
            discoverableByAllUsers: parsed.eventVisibility === "public",
          },
        });
      }

      res.status(201).json({
        message: "Request submitted",
        discoverableByAllUsers: parsed.eventVisibility === "public",
      });
    } catch (error: any) {
      console.error("Error submitting private truck request:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to submit request" });
    }
  });

  // ─── Event Booking & Payment Routes ─────────────────────────────────────────

  /**
   * POST /api/events/:eventId/book
   * Truck creates a pending booking + Stripe PaymentIntent.
   * Returns { bookingId, clientSecret, totalCents, breakdown }
   */
  app.post(
    "/api/events/:eventId/book",
    isRestaurantOwner,
    async (req: any, res) => {
      try {
        const hasAccess = await hasBusinessDistributionAccess(req.user.id);
        if (!hasAccess) {
          return res.status(402).json({
            message: "Premium subscription required for event access.",
          });
        }

        const { eventId } = req.params;
        const { truckId } = req.body;

        if (!truckId) {
          return res.status(400).json({ message: "truckId is required" });
        }

        const ownsT = await storage.verifyRestaurantOwnership(
          truckId,
          req.user.id,
          "manageParkingPass",
        );
        if (!ownsT) {
          return res.status(403).json({ message: "You do not own that truck" });
        }

        const [event] = await db
          .select()
          .from(events)
          .where(eq(events.id, eventId))
          .limit(1);
        if (!event) {
          return res.status(404).json({ message: "Event not found" });
        }
        if (event.eventType !== "parking_pass") {
          return res.status(400).json({
            message:
              "Paid checkout is only available for Parking Pass bookings",
          });
        }
        if (!event.requiresPayment) {
          return res.status(400).json({
            message:
              "This event does not require payment — use the interest flow instead",
          });
        }
        if (event.status !== "open") {
          return res
            .status(409)
            .json({ message: "Event is not available for booking" });
        }
        if (new Date(event.date) < new Date()) {
          return res.status(400).json({ message: "Event has already passed" });
        }

        const hostPriceCents = event.hostPriceCents ?? 0;
        const PLATFORM_FEE = 1000; // always $10
        const totalCents = hostPriceCents + PLATFORM_FEE;

        const [host] = await db
          .select()
          .from(hosts)
          .where(eq(hosts.id, event.hostId))
          .limit(1);
        if (!host) {
          return res.status(500).json({ message: "Host not found" });
        }
        // Decoupled: allow bookings even when the host hasn't completed Stripe
        // Connect onboarding. When the host has a connected account we use a direct
        // charge; otherwise we charge on the platform account and defer the host
        // payout until they eventually onboard.
        const hostPaymentsEnabled = Boolean(
          host.stripeConnectAccountId && host.stripeChargesEnabled,
        );
        const hostStripeAccountId = hostPaymentsEnabled
          ? host.stripeConnectAccountId
          : null;
        if (!stripe) {
          return res
            .status(503)
            .json({ message: "Payments not configured on server" });
        }

        // Idempotency: check for existing booking
        const [existing] = await db
          .select({ id: eventBookings.id, status: eventBookings.status })
          .from(eventBookings)
          .where(
            and(
              eq(eventBookings.eventId, eventId),
              eq(eventBookings.truckId, truckId),
            ),
          )
          .limit(1);

        if (existing?.status === "confirmed") {
          return res
            .status(409)
            .json({ message: "This spot is already booked" });
        }
        if (existing?.status === "pending") {
          return res
            .status(409)
            .json({ message: "A pending booking already exists" });
        }

        // Capacity check
        const [countRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(eventBookings)
          .where(
            and(
              eq(eventBookings.eventId, eventId),
              inArray(eventBookings.status, ["confirmed"]),
            ),
          );
        const confirmedCount = Number(countRow?.count ?? 0);
        if (confirmedCount >= event.maxTrucks) {
          return res.status(409).json({ message: "Event is fully booked" });
        }

        // Insert pending booking record first (so we have the ID for metadata)
        const [booking] = await db
          .insert(eventBookings)
          .values({
            eventId,
            truckId,
            hostId: event.hostId,
            hostPriceCents,
            platformFeeCents: PLATFORM_FEE,
            totalCents,
            status: "pending",
            stripeApplicationFeeAmount: hostStripeAccountId ? PLATFORM_FEE : null,
            stripeTransferDestination: hostStripeAccountId,
          })
          .returning();

        // Create Stripe PaymentIntent.
        // If the host has a connected Stripe account, use a direct charge on that
        // account with an application fee. Otherwise, charge on the platform
        // account and defer the host payout.
        let paymentIntent: Stripe.PaymentIntent;
        try {
          const intentParams: Stripe.PaymentIntentCreateParams = {
            amount: totalCents,
            currency: "usd",
            metadata: {
              bookingId: booking.id,
              eventId,
              truckId,
              userId: req.user.id,
              hostPriceCents: hostPriceCents.toString(),
              platformFeeCents: PLATFORM_FEE.toString(),
              totalCents: totalCents.toString(),
            },
          };

          // Only set application_fee_amount for Connect direct charges
          if (hostStripeAccountId) {
            intentParams.application_fee_amount = PLATFORM_FEE;
          }

          paymentIntent = await stripe.paymentIntents.create(
            intentParams,
            hostStripeAccountId
              ? { stripeAccount: hostStripeAccountId }
              : undefined,
          );
        } catch (stripeError: any) {
          // Roll back the pending booking if Stripe fails
          await db
            .update(eventBookings)
            .set({
              status: "cancelled",
              cancelledAt: new Date(),
              cancellationReason: "Payment setup failed",
              updatedAt: new Date(),
            })
            .where(eq(eventBookings.id, booking.id));
          console.error("Stripe PaymentIntent creation failed:", stripeError);
          return res
            .status(502)
            .json({ message: "Payment setup failed, please try again" });
        }

        // Attach the PaymentIntent ID to the booking record
        await db
          .update(eventBookings)
          .set({
            stripePaymentIntentId: paymentIntent.id,
            updatedAt: new Date(),
          })
          .where(eq(eventBookings.id, booking.id));

        res.json({
          bookingId: booking.id,
          clientSecret: paymentIntent.client_secret,
          totalCents,
          hostPaymentsReady: hostPaymentsEnabled,
          breakdown: {
            hostPrice: hostPriceCents,
            platformFee: PLATFORM_FEE,
          },
        });
      } catch (error: any) {
        console.error("Error creating event booking:", error);
        res.status(500).json({ message: "Failed to create booking" });
      }
    },
  );

  /**
   * POST /api/bookings/:bookingId/confirm
   * Called after Stripe payment succeeds (idempotent).
   * The webhook also handles this; this is for immediate client feedback.
   */
  app.post(
    "/api/bookings/:bookingId/confirm",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { bookingId } = req.params;

        const [booking] = await db
          .select()
          .from(eventBookings)
          .where(eq(eventBookings.id, bookingId))
          .limit(1);
        if (!booking) {
          return res.status(404).json({ message: "Booking not found" });
        }

        // Verify caller owns the truck
        const ownsT = await storage.verifyRestaurantOwnership(
          booking.truckId,
          req.user.id,
          "manageParkingPass",
        );
        if (!ownsT) {
          return res.status(403).json({ message: "Not authorized" });
        }

        if (booking.status === "confirmed") {
          return res.json({ message: "Already confirmed", bookingId });
        }
        if (booking.status === "cancelled" || booking.status === "refunded") {
          return res
            .status(400)
            .json({ message: `Booking is ${booking.status}` });
        }

        // Verify payment via Stripe if we have a PaymentIntent
        if (booking.stripePaymentIntentId && stripe) {
          const hostStripeAccountId = booking.stripeTransferDestination;
          let intent: Stripe.PaymentIntent;
          try {
            intent = await stripe.paymentIntents.retrieve(
              booking.stripePaymentIntentId,
              hostStripeAccountId
                ? { stripeAccount: hostStripeAccountId }
                : undefined,
            );
          } catch (e: any) {
            console.error("Error retrieving PaymentIntent:", e);
            return res
              .status(502)
              .json({ message: "Could not verify payment" });
          }

          if (intent.status !== "succeeded") {
            return res
              .status(402)
              .json({ message: "Payment has not succeeded yet" });
          }
        }

        const now = new Date();
        await db
          .update(eventBookings)
          .set({
            status: "confirmed",
            stripePaymentStatus: "succeeded",
            paidAt: now,
            bookingConfirmedAt: now,
            updatedAt: now,
          })
          .where(eq(eventBookings.id, bookingId));

        // Update event status if now full
        const [countRow] = await db
          .select({ count: sql<number>`count(*)` })
          .from(eventBookings)
          .where(
            and(
              eq(eventBookings.eventId, booking.eventId),
              eq(eventBookings.status, "confirmed"),
            ),
          );
        const confirmedCount = Number(countRow?.count ?? 0);

        const [eventRow] = await db
          .select({ maxTrucks: events.maxTrucks })
          .from(events)
          .where(eq(events.id, booking.eventId))
          .limit(1);

        if (eventRow) {
          const newStatus =
            confirmedCount >= (eventRow.maxTrucks ?? 1) ? "filled" : "open";
          await db
            .update(events)
            .set({ status: newStatus, updatedAt: new Date() })
            .where(eq(events.id, booking.eventId));
        }

        res.json({ message: "Booking confirmed", bookingId });
      } catch (error: any) {
        console.error("Error confirming booking:", error);
        res.status(500).json({ message: "Failed to confirm booking" });
      }
    },
  );

  /**
   * POST /api/bookings/:bookingId/cancel
   * Host or truck owner may cancel. No refunds are allowed.
   */
  app.post(
    "/api/bookings/:bookingId/cancel",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { bookingId } = req.params;
        const { reason, refundType } = req.body;

        // Booking policy: no refunds allowed.
        if (refundType && String(refundType).toLowerCase() !== "none") {
          return res.status(400).json({
            message: "Refunds are not allowed for bookings",
          });
        }

        const [booking] = await db
          .select()
          .from(eventBookings)
          .where(eq(eventBookings.id, bookingId))
          .limit(1);
        if (!booking) {
          return res.status(404).json({ message: "Booking not found" });
        }

        // Authorization: truck owner, host, or staff/admin
        const isAdmin =
          req.user?.role === "admin" || req.user?.role === "staff";
        const ownsTruck = await storage.verifyRestaurantOwnership(
          booking.truckId,
          req.user.id,
          "manageParkingPass",
        );
        const [host] = await db
          .select({ userId: hosts.userId })
          .from(hosts)
          .where(eq(hosts.id, booking.hostId))
          .limit(1);
        const isHost = host?.userId === req.user.id;

        if (!ownsTruck && !isHost && !isAdmin) {
          return res.status(403).json({ message: "Not authorized" });
        }

        if (booking.status === "cancelled" || booking.status === "refunded") {
          return res
            .status(400)
            .json({ message: `Booking already ${booking.status}` });
        }

        const now = new Date();

        await db
          .update(eventBookings)
          .set({
            status: "cancelled",
            cancelledAt: now,
            cancellationReason: reason || null,
            refundStatus: "none",
            refundAmountCents: null,
            refundedAt: null,
            updatedAt: now,
          })
          .where(eq(eventBookings.id, bookingId));

        // Reopen the event if it was filled
        const [eventRow] = await db
          .select({ status: events.status, maxTrucks: events.maxTrucks })
          .from(events)
          .where(eq(events.id, booking.eventId))
          .limit(1);
        if (eventRow?.status === "filled") {
          await db
            .update(events)
            .set({ status: "open", updatedAt: new Date() })
            .where(eq(events.id, booking.eventId));
        }

        res.json({
          message: "Booking cancelled",
          bookingId,
          refunded: false,
        });
      } catch (error: any) {
        console.error("Error cancelling booking:", error);
        res.status(500).json({ message: "Failed to cancel booking" });
      }
    },
  );

  /**
   * GET /api/events/:eventId/bookings
   * Returns all bookings for this event (host view).
   */
  app.get(
    "/api/events/:eventId/bookings",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { eventId } = req.params;

        const [event] = await db
          .select({ hostId: events.hostId })
          .from(events)
          .where(eq(events.id, eventId))
          .limit(1);
        if (!event) {
          return res.status(404).json({ message: "Event not found" });
        }

        // Check caller is the host owner or staff/admin
        const isAdmin =
          req.user?.role === "admin" || req.user?.role === "staff";
        const [host] = await db
          .select({ userId: hosts.userId })
          .from(hosts)
          .where(eq(hosts.id, event.hostId))
          .limit(1);
        if (!isAdmin && host?.userId !== req.user.id) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const rows = await db
          .select({
            booking: eventBookings,
            truckName: restaurants.name,
            truckOwnerId: restaurants.ownerId,
          })
          .from(eventBookings)
          .leftJoin(restaurants, eq(eventBookings.truckId, restaurants.id))
          .where(eq(eventBookings.eventId, eventId))
          .orderBy(desc(eventBookings.createdAt));

        res.json({ bookings: rows });
      } catch (error: any) {
        console.error("Error fetching event bookings:", error);
        res.status(500).json({ message: "Failed to fetch bookings" });
      }
    },
  );

  /**
   * GET /api/my/bookings?truckId=…
   * Returns all bookings for the authenticated truck owner.
   */
  app.get("/api/my/bookings", isRestaurantOwner, async (req: any, res) => {
    try {
      const { truckId } = req.query;
      if (!truckId) {
        return res
          .status(400)
          .json({ message: "truckId query param required" });
      }

      const ownsT = await storage.verifyRestaurantOwnership(
        String(truckId),
        req.user.id,
        "manageParkingPass",
      );
      if (!ownsT) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const rows = await db
        .select({
          booking: eventBookings,
          eventName: events.name,
          eventDate: events.date,
          eventStartTime: events.startTime,
          eventEndTime: events.endTime,
          hostId: events.hostId,
          hostName: hosts.businessName,
          hostAddress: hosts.address,
          hostCity: hosts.city,
          hostState: hosts.state,
        })
        .from(eventBookings)
        .leftJoin(events, eq(eventBookings.eventId, events.id))
        .leftJoin(hosts, eq(eventBookings.hostId, hosts.id))
        .where(eq(eventBookings.truckId, String(truckId)))
        .orderBy(desc(eventBookings.createdAt));

      res.json({ bookings: rows });
    } catch (error: any) {
      console.error("Error fetching truck bookings:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });
}
