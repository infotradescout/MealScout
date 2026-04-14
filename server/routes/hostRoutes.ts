import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { emailService } from "../emailService";
import { db } from "../db";
import {
  insertHostSchema,
  insertEventSchema,
  events,
  eventSeries,
  hosts,
  eventBookings,
  hostPayoutRequests,
  parkingPassBlackoutDates,
} from "@shared/schema";
import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { isAuthenticated } from "../unifiedAuth";
import Stripe from "stripe";
import {
  upload,
  uploadToCloudinary,
  isCloudinaryConfigured,
} from "../imageUpload";
import {
  getHostByUserId,
  getEventAndHostForUser,
  getInterestEventAndHostForUser,
  userOwnsEvent,
} from "../services/hostOwnership";
import {
  computeAcceptedCount,
  shouldBlockAcceptance,
  buildCapacityFullError,
  computeFillRate,
} from "../services/interestDecision";
import { forwardGeocode } from "../utils/geocoding";
import {
  PARKING_PASS_BOOKING_DAYS,
  PARKING_PASS_MEAL_WINDOWS,
  PARKING_PASS_SLOT_TYPES,
  getSlotWindowMinutesWithCleanup,
  isSlotWithinHours,
  slotWindowsOverlap,
} from "@shared/parkingPassSlots";
import {
  ensureParkingPassEventRow,
  listParkingPassOccurrences,
} from "../services/parkingPassVirtual";
import {
  addDaysToDateKey,
  dateKeyFromUnknown,
  dateKeyInZone,
  utcDateFromDateKey,
} from "../services/dateKeys";
import {
  computeParkingPassQualityFlags,
  isParkingPassPublicReady,
} from "../services/parkingPassQuality";
import { imageUploads } from "@shared/schema";
import { logAudit } from "../auditLogger";
import { getHostEarningsSummary } from "../hostEarningsService";
import { resolveCityTimeZoneSync } from "../services/cityTimeZone";
import { requireIdempotencyKey } from "../middleware/idempotency";
import { distributedRateLimit } from "../middleware/distributedRateLimit";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export function registerHostRoutes(app: Express) {
  const parkingPassBookingBurstLimiter = distributedRateLimit({
    scope: "parking-pass-booking:burst",
    limit: 12,
    windowMs: 60 * 1000,
  });
  const parkingPassBookingDayLimiter = distributedRateLimit({
    scope: "parking-pass-booking:day",
    limit: 120,
    windowMs: 24 * 60 * 60 * 1000,
  });

  const isStaffOrAdminUser = (user: any) =>
    user?.userType === "staff" ||
    user?.userType === "admin" ||
    user?.userType === "super_admin";

  const normalizeLocationValue = (value?: string | null) =>
    (value ?? "").trim().toLowerCase();

  const buildLocationKey = (
    address?: string | null,
    city?: string | null,
    state?: string | null,
  ) =>
    [
      normalizeLocationValue(address),
      normalizeLocationValue(city),
      normalizeLocationValue(state),
    ].join("|");

  const buildGeocodeAddress = (
    address?: string | null,
    city?: string | null,
    state?: string | null,
  ) => [address, city, state, "USA"].filter(Boolean).join(", ");

  const getActiveParkingPassSeriesId = async (hostId: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows = await db
      .select({
        seriesId: events.seriesId,
        date: events.date,
        breakfastPriceCents: events.breakfastPriceCents,
        lunchPriceCents: events.lunchPriceCents,
        dinnerPriceCents: events.dinnerPriceCents,
        dailyPriceCents: events.dailyPriceCents,
        weeklyPriceCents: events.weeklyPriceCents,
        monthlyPriceCents: events.monthlyPriceCents,
      })
      .from(events)
      .where(
        and(
          eq(events.hostId, hostId),
          eq(events.requiresPayment, true),
          gte(events.date, today),
          isNotNull(events.seriesId),
        ),
      )
      .orderBy(asc(events.date))
      .limit(14);
    const hasActivePricing = (row: (typeof rows)[number]) =>
      (row.breakfastPriceCents ?? 0) > 0 ||
      (row.lunchPriceCents ?? 0) > 0 ||
      (row.dinnerPriceCents ?? 0) > 0 ||
      (row.dailyPriceCents ?? 0) > 0 ||
      (row.weeklyPriceCents ?? 0) > 0 ||
      (row.monthlyPriceCents ?? 0) > 0;
    const activeRow = rows.find((row: (typeof rows)[number]) =>
      hasActivePricing(row),
    );
    return activeRow?.seriesId ?? null;
  };

  const getOwnedHostForRequest = async (req: any) => {
    const userId = String(req.user?.id || "").trim();
    if (!userId) return null;

    const requestedHostId = String(
      req.body?.hostId || req.query?.hostId || "",
    ).trim();
    const ownedHosts = await storage.getHostsByUserId(userId);
    if (!ownedHosts.length) return null;

    if (!requestedHostId) return ownedHosts[0];
    return (
      ownedHosts.find((item: any) => String(item.id) === requestedHostId) ||
      null
    );
  };

  // Host Profile & Events
  app.post("/api/hosts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const locationRequestClaimId = String(
        req.body?.locationRequestClaimId || "",
      ).trim();
      // Check if host profile already exists
      const existing = await getHostByUserId(userId);
      if (existing) {
        return res.status(400).json({ message: "Host profile already exists" });
      }

      const parsed = insertHostSchema.parse({
        ...req.body,
        userId,
      });

      const existingHosts = await db
        .select({
          id: hosts.id,
          address: hosts.address,
          city: hosts.city,
          state: hosts.state,
        })
        .from(hosts)
        .where(eq(hosts.userId, userId));

      const newKey = buildLocationKey(
        parsed.address,
        parsed.city ?? null,
        parsed.state ?? null,
      );
      const hasDuplicate = existingHosts.some(
        (host: (typeof existingHosts)[number]) =>
          buildLocationKey(host.address, host.city, host.state) === newKey,
      );
      if (hasDuplicate) {
        return res.status(409).json({
          message:
            "You already have a location for this address. Edit the existing location instead.",
        });
      }

      const rawLat = parsed.latitude ?? null;
      const rawLng = parsed.longitude ?? null;
      const manualLat =
        rawLat === null || rawLat === undefined ? null : Number(rawLat);
      const manualLng =
        rawLng === null || rawLng === undefined ? null : Number(rawLng);
      const hasManualCoords = rawLat !== null || rawLng !== null;
      if (
        hasManualCoords &&
        (!Number.isFinite(manualLat) || !Number.isFinite(manualLng))
      ) {
        return res.status(400).json({ message: "Invalid coordinates" });
      }
      const manualCoords =
        hasManualCoords && manualLat !== null && manualLng !== null
          ? { lat: manualLat, lng: manualLng }
          : null;
      if (
        manualCoords &&
        (manualCoords.lat < -90 ||
          manualCoords.lat > 90 ||
          manualCoords.lng < -180 ||
          manualCoords.lng > 180)
      ) {
        return res.status(400).json({ message: "Invalid coordinates" });
      }

      const geocodeAddress = buildGeocodeAddress(
        parsed.address,
        parsed.city ?? null,
        parsed.state ?? null,
      );
      let coords: { lat: number; lng: number } | null = null;
      if (!manualCoords && geocodeAddress) {
        try {
          coords = await forwardGeocode(geocodeAddress);
        } catch {
          coords = null;
        }
      }

      const host = await storage.createHost({
        ...parsed,
        latitude: manualCoords
          ? manualCoords.lat.toString()
          : coords
            ? coords.lat.toString()
            : null,
        longitude: manualCoords
          ? manualCoords.lng.toString()
          : coords
            ? coords.lng.toString()
            : null,
      });
      const parkingPassSeriesReady = await storage
        .ensureDraftParkingPassForHost(host.id)
        .catch(() => false);

      if (locationRequestClaimId) {
        await storage
          .convertHostLocationClaim(locationRequestClaimId, host.id, userId)
          .catch((error: any) => {
            console.error("Failed to convert host location claim:", error);
          });
      }

      // Hosts should keep their existing user type (typically "customer").
      // We no longer auto-upgrade hosts into restaurant_owner accounts so
      // they don't see restaurant dashboards or deal creation flows.

      res.status(201).json({
        ...host,
        parkingPassSeriesReady,
        locationRequestClaimId: locationRequestClaimId || null,
      });
    } catch (error: any) {
      console.error("Error creating host:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid host data", errors: error.errors });
      }
      res
        .status(400)
        .json({ message: error.message || "Failed to create host profile" });
    }
  });

  app.get("/api/hosts/me", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      let host = await getHostByUserId(userId);
      if (!host) {
        const hostProfiles = await storage.getHostsByUserId(userId);
        host = hostProfiles[0];
      }
      if (!host) {
        return res.status(404).json({ message: "Host profile not found" });
      }
      res.json(host);
    } catch (error: any) {
      console.error("Error fetching host profile:", error);
      res.status(404).json({ message: "Host profile not found" });
    }
  });

  app.get("/api/hosts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const hostProfiles = await storage.getHostsByUserId(userId);
      res.json(hostProfiles);
    } catch (error: any) {
      console.error("Error fetching host profiles:", error);
      res.status(500).json({ message: "Failed to fetch host profiles" });
    }
  });

  app.get(
    "/api/hosts/:hostId",
    isAuthenticated,
    async (req: any, res, next) => {
      const reserved = new Set(["events", "event-series", "parking-pass"]);
      if (reserved.has(req.params.hostId)) {
        return next();
      }
      try {
        const { hostId } = req.params;
        const userId = req.user.id;
        const host = await storage.getHost(hostId);
        if (!host || host.userId !== userId) {
          return res.status(404).json({ message: "Host profile not found" });
        }
        res.json(host);
      } catch (error: any) {
        console.error("Error fetching host profile:", error);
        res.status(500).json({ message: "Failed to fetch host profile" });
      }
    },
  );

  app.patch("/api/hosts/me", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const host = await getHostByUserId(userId);
      if (!host) {
        return res.status(404).json({ message: "Host profile not found" });
      }

      const amenitiesSchema = z.record(z.boolean()).optional().nullable();
      const parsedAmenities = amenitiesSchema.parse(req.body?.amenities);

      const [updated] = await db
        .update(hosts)
        .set({
          amenities: parsedAmenities ?? null,
          updatedAt: new Date(),
        })
        .where(eq(hosts.id, host.id))
        .returning();

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating host profile:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid amenities data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update host profile" });
    }
  });

  app.patch("/api/hosts/:hostId", isAuthenticated, async (req: any, res) => {
    try {
      const { hostId } = req.params;
      const userId = req.user.id;
      const host = await storage.getHost(hostId);
      if (!host || host.userId !== userId) {
        return res.status(404).json({ message: "Host profile not found" });
      }

      const latitudeSchema = z.preprocess(
        (value) => (value === null ? undefined : value),
        z.coerce.number().min(-90).max(90),
      );
      const longitudeSchema = z.preprocess(
        (value) => (value === null ? undefined : value),
        z.coerce.number().min(-180).max(180),
      );
      const updateSchema = z.object({
        businessName: z.string().min(1).optional(),
        address: z.string().min(1).optional(),
        city: z.string().min(1).optional(),
        state: z.string().min(2).optional(),
        locationType: z.string().min(1).optional(),
        contactPhone: z.string().min(5).optional(),
        notes: z.string().optional().nullable(),
        amenities: z.record(z.boolean()).optional().nullable(),
        spotCount: z.number().int().min(1).optional(),
        latitude: latitudeSchema.optional(),
        longitude: longitudeSchema.optional(),
        // Parking Pass defaults live on the host (simple model: address + any price => bookable).
        parkingPassBreakfastPriceCents: z.number().int().min(0).optional(),
        parkingPassLunchPriceCents: z.number().int().min(0).optional(),
        parkingPassDinnerPriceCents: z.number().int().min(0).optional(),
        parkingPassDailyPriceCents: z.number().int().min(0).optional(),
        parkingPassWeeklyPriceCents: z.number().int().min(0).optional(),
        parkingPassMonthlyPriceCents: z.number().int().min(0).optional(),
        parkingPassStartTime: z.string().optional().nullable(),
        parkingPassEndTime: z.string().optional().nullable(),
        parkingPassDaysOfWeek: z
          .array(z.number().int().min(0).max(6))
          .optional(),
      });
      const parsed = updateSchema.parse(req.body || {});

      const hasManualCoords =
        parsed.latitude !== undefined || parsed.longitude !== undefined;
      if (
        hasManualCoords &&
        (parsed.latitude === undefined || parsed.longitude === undefined)
      ) {
        return res
          .status(400)
          .json({ message: "Latitude and longitude are required together." });
      }
      const manualCoords =
        parsed.latitude !== undefined && parsed.longitude !== undefined
          ? { lat: parsed.latitude, lng: parsed.longitude }
          : null;

      const nextAddress = parsed.address ?? host.address;
      const nextCity = parsed.city ?? host.city;
      const nextState = parsed.state ?? host.state;
      const nextKey = buildLocationKey(nextAddress, nextCity, nextState);

      const siblingHosts = await db
        .select({
          id: hosts.id,
          address: hosts.address,
          city: hosts.city,
          state: hosts.state,
        })
        .from(hosts)
        .where(eq(hosts.userId, userId));

      const hasDuplicate = siblingHosts.some(
        (item: (typeof siblingHosts)[number]) =>
          item.id !== host.id &&
          buildLocationKey(item.address, item.city, item.state) === nextKey,
      );
      if (hasDuplicate) {
        return res.status(409).json({
          message:
            "Another location already uses this address. Edit that location instead.",
        });
      }

      const addressChanged =
        buildLocationKey(host.address, host.city, host.state) !== nextKey;
      const shouldGeocode =
        !manualCoords && (addressChanged || !host.latitude || !host.longitude);
      const geocodeAddress = buildGeocodeAddress(
        nextAddress,
        nextCity ?? null,
        nextState ?? null,
      );
      let coords: { lat: number; lng: number } | null = null;
      if (shouldGeocode && geocodeAddress) {
        try {
          coords = await forwardGeocode(geocodeAddress);
        } catch {
          coords = null;
        }
      }

      const [updated] = await db
        .update(hosts)
        .set({
          businessName: parsed.businessName ?? host.businessName,
          address: nextAddress,
          city: nextCity,
          state: nextState,
          locationType: parsed.locationType ?? host.locationType,
          contactPhone: parsed.contactPhone ?? host.contactPhone,
          notes: parsed.notes ?? host.notes,
          amenities: parsed.amenities ?? host.amenities ?? null,
          spotCount: parsed.spotCount ?? host.spotCount ?? 1,
          parkingPassBreakfastPriceCents:
            parsed.parkingPassBreakfastPriceCents ??
            (host as any).parkingPassBreakfastPriceCents ??
            0,
          parkingPassLunchPriceCents:
            parsed.parkingPassLunchPriceCents ??
            (host as any).parkingPassLunchPriceCents ??
            0,
          parkingPassDinnerPriceCents:
            parsed.parkingPassDinnerPriceCents ??
            (host as any).parkingPassDinnerPriceCents ??
            0,
          parkingPassDailyPriceCents:
            parsed.parkingPassDailyPriceCents ??
            (host as any).parkingPassDailyPriceCents ??
            0,
          parkingPassWeeklyPriceCents:
            parsed.parkingPassWeeklyPriceCents ??
            (host as any).parkingPassWeeklyPriceCents ??
            0,
          parkingPassMonthlyPriceCents:
            parsed.parkingPassMonthlyPriceCents ??
            (host as any).parkingPassMonthlyPriceCents ??
            0,
          parkingPassStartTime:
            parsed.parkingPassStartTime !== undefined
              ? (parsed.parkingPassStartTime ?? null)
              : ((host as any).parkingPassStartTime ?? null),
          parkingPassEndTime:
            parsed.parkingPassEndTime !== undefined
              ? (parsed.parkingPassEndTime ?? null)
              : ((host as any).parkingPassEndTime ?? null),
          parkingPassDaysOfWeek:
            parsed.parkingPassDaysOfWeek !== undefined
              ? parsed.parkingPassDaysOfWeek
              : ((host as any).parkingPassDaysOfWeek ?? []),
          latitude: manualCoords
            ? manualCoords.lat.toString()
            : coords
              ? coords.lat.toString()
              : addressChanged
                ? null
                : host.latitude,
          longitude: manualCoords
            ? manualCoords.lng.toString()
            : coords
              ? coords.lng.toString()
              : addressChanged
                ? null
                : host.longitude,
          updatedAt: new Date(),
        })
        .where(eq(hosts.id, host.id))
        .returning();

      // Keep the implementation-detail series in sync so bookings are possible via virtual ids.
      try {
        await storage.syncParkingPassSeriesFromHost(host.id);
      } catch (e) {
        console.warn(
          "syncParkingPassSeriesFromHost failed after host update:",
          e,
        );
      }
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating host profile:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid amenities data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to update host profile" });
    }
  });

  app.post(
    "/api/hosts/:hostId/spot-image",
    isAuthenticated,
    upload.single("image"),
    async (req: any, res) => {
      try {
        const { hostId } = req.params;
        const userId = req.user.id;

        const host = await storage.getHost(hostId);
        if (!host) {
          return res.status(404).json({ message: "Host profile not found" });
        }

        const allowed =
          isStaffOrAdminUser(req.user) ||
          String(host.userId) === String(userId);
        if (!allowed) {
          return res.status(403).json({ message: "Not authorized" });
        }

        if (!isCloudinaryConfigured()) {
          return res.status(400).json({
            message: "Image uploads are not configured on this server.",
          });
        }

        if (!req.file?.buffer) {
          return res.status(400).json({ message: "No image uploaded." });
        }

        const result = await uploadToCloudinary(
          req.file.buffer,
          "host-spots",
          `host-${host.id}-spot`,
        );

        const [updated] = await db
          .update(hosts)
          .set({ spotImageUrl: result.secureUrl, updatedAt: new Date() })
          .where(eq(hosts.id, host.id))
          .returning();

        try {
          await db.insert(imageUploads).values({
            uploadedByUserId: userId,
            imageType: "host_spot",
            entityId: host.id,
            entityType: "host",
            cloudinaryPublicId: result.publicId,
            cloudinaryUrl: result.secureUrl,
            thumbnailUrl: result.thumbnailUrl,
            width: result.width,
            height: result.height,
            fileSize: result.bytes,
            mimeType: req.file.mimetype,
          } as any);
        } catch {
          // Non-blocking: host record already points to the new image.
        }

        res.json(updated ?? { ...host, spotImageUrl: result.secureUrl });
      } catch (error: any) {
        console.error("Error uploading host spot image:", error);
        res.status(500).json({ message: "Failed to upload image" });
      }
    },
  );

  app.patch(
    "/api/hosts/:hostId/coordinates",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { hostId } = req.params;
        const userId = req.user.id;
        const host = await storage.getHost(hostId);
        if (!host || host.userId !== userId) {
          return res.status(404).json({ message: "Host profile not found" });
        }

        const coordSchema = z.object({
          latitude: z.coerce.number().min(-90).max(90),
          longitude: z.coerce.number().min(-180).max(180),
        });
        const parsed = coordSchema.parse(req.body || {});

        const updated = await storage.updateHostCoordinates(
          host.id,
          parsed.latitude,
          parsed.longitude,
        );

        res.json(updated);
      } catch (error: any) {
        console.error("Error updating host coordinates:", error);
        if (error instanceof z.ZodError) {
          return res
            .status(400)
            .json({ message: "Invalid coordinates", errors: error.errors });
        }
        res.status(500).json({ message: "Failed to update coordinates" });
      }
    },
  );

  app.post(
    "/api/hosts/:hostId/geocode",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { hostId } = req.params;
        const userId = req.user.id;
        const host = await storage.getHost(hostId);
        if (!host || host.userId !== userId) {
          return res.status(404).json({ message: "Host profile not found" });
        }

        const geocodeAddress = buildGeocodeAddress(
          host.address,
          host.city ?? null,
          host.state ?? null,
        );
        let coords: { lat: number; lng: number } | null = null;
        if (geocodeAddress) {
          try {
            coords = await forwardGeocode(geocodeAddress);
          } catch {
            coords = null;
          }
        }

        if (!coords) {
          return res.status(400).json({
            message: "Unable to find coordinates for this address.",
          });
        }

        const updated = await storage.updateHostCoordinates(
          host.id,
          coords.lat,
          coords.lng,
        );

        res.json(updated);
      } catch (error: any) {
        console.error("Error geocoding host:", error);
        res.status(500).json({ message: "Failed to geocode host" });
      }
    },
  );

  app.get(
    "/api/hosts/:hostId/blackout-dates",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { hostId } = req.params;
        const userId = req.user.id;
        const host = await storage.getHost(hostId);
        if (!host || host.userId !== userId) {
          return res.status(404).json({ message: "Host profile not found" });
        }
        const seriesId = await getActiveParkingPassSeriesId(hostId);
        if (!seriesId) {
          return res.json([]);
        }
        const blackoutDates =
          await storage.getParkingPassBlackoutDates(seriesId);
        const timezone = resolveCityTimeZoneSync({
          city: host.city,
          state: host.state,
        });
        res.json(
          blackoutDates.map((row: any) => ({
            ...row,
            dateKey: dateKeyInZone(new Date(row.date), timezone),
          })),
        );
      } catch (error: any) {
        console.error("Error fetching blackout dates:", error);
        res.status(500).json({ message: "Failed to fetch blackout dates" });
      }
    },
  );

  app.post(
    "/api/hosts/:hostId/blackout-dates",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { hostId } = req.params;
        const userId = req.user.id;
        const host = await storage.getHost(hostId);
        if (!host || host.userId !== userId) {
          return res.status(404).json({ message: "Host profile not found" });
        }

        const seriesId = await getActiveParkingPassSeriesId(hostId);
        if (!seriesId) {
          return res
            .status(404)
            .json({ message: "No active parking pass found." });
        }

        const timezone = resolveCityTimeZoneSync({
          city: host.city,
          state: host.state,
        });
        const dateKey = dateKeyFromUnknown(req.body?.date, timezone);
        if (!dateKey) {
          return res.status(400).json({ message: "Valid date required" });
        }
        const date = utcDateFromDateKey(dateKey);

        const created = await storage.createParkingPassBlackoutDate({
          seriesId,
          date,
        });
        res.status(201).json(created);
      } catch (error: any) {
        console.error("Error creating blackout date:", error);
        res.status(500).json({ message: "Failed to create blackout date" });
      }
    },
  );

  app.delete(
    "/api/hosts/:hostId/blackout-dates",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { hostId } = req.params;
        const userId = req.user.id;
        const host = await storage.getHost(hostId);
        if (!host || host.userId !== userId) {
          return res.status(404).json({ message: "Host profile not found" });
        }

        const timezone = resolveCityTimeZoneSync({
          city: host.city,
          state: host.state,
        });
        const dateKey = dateKeyFromUnknown(req.body?.date, timezone);
        if (!dateKey) {
          return res.status(400).json({ message: "Valid date required" });
        }
        const date = utcDateFromDateKey(dateKey);
        const todayKey = dateKeyInZone(new Date(), timezone);
        if (dateKey <= todayKey) {
          return res.status(400).json({
            message: "Same-day blackout dates cannot be removed.",
          });
        }

        const seriesId = await getActiveParkingPassSeriesId(hostId);
        if (!seriesId) {
          return res
            .status(404)
            .json({ message: "No active parking pass found." });
        }

        await storage.deleteParkingPassBlackoutDate(seriesId, date);
        res.json({ message: "Blackout date removed" });
      } catch (error: any) {
        console.error("Error deleting blackout date:", error);
        res.status(500).json({ message: "Failed to delete blackout date" });
      }
    },
  );

  app.delete("/api/hosts/:hostId", isAuthenticated, async (req: any, res) => {
    try {
      const { hostId } = req.params;
      const userId = req.user.id;
      const host = await storage.getHost(hostId);
      if (!host || host.userId !== userId) {
        return res.status(404).json({ message: "Host profile not found" });
      }

      const existingBookings = await db
        .select({ id: eventBookings.id })
        .from(eventBookings)
        .where(eq(eventBookings.hostId, host.id))
        .limit(1);

      if (existingBookings.length > 0) {
        return res.status(409).json({
          message:
            "This location has bookings and cannot be deleted. Contact support if you need help.",
        });
      }

      await db.delete(hosts).where(eq(hosts.id, host.id));
      res.json({ message: "Location deleted" });
    } catch (error: any) {
      console.error("Error deleting host profile:", error);
      res.status(500).json({ message: "Failed to delete host profile" });
    }
  });

  const createHostParkingPassListing = async (req: any, res: any) => {
    try {
      const userId = req.user.id;
      const hostId = req.body?.hostId;
      if (!hostId) {
        return res.status(400).json({ message: "Host ID required" });
      }
      const host = await storage.getHost(hostId);
      if (!host || host.userId !== userId) {
        return res.status(404).json({ message: "Host profile not found" });
      }
      if (
        req.user.userType === "event_coordinator" ||
        host.locationType === "event_coordinator"
      ) {
        return res.status(403).json({
          message:
            "Event coordinators can only post events, not Parking Pass listings.",
        });
      }

      if (!req.body?.requiresPayment) {
        return res.status(400).json({
          message: "Hosts can only create Parking Pass listings.",
        });
      }

      const breakfastPriceCents = Number(req.body.breakfastPriceCents || 0);
      const lunchPriceCents = Number(req.body.lunchPriceCents || 0);
      const dinnerPriceCents = Number(req.body.dinnerPriceCents || 0);

      const parseOverrideCents = (value: any) => {
        if (value === null || value === undefined || value === "") return null;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return null;
        return Math.max(0, Math.round(parsed));
      };

      const slotSum = breakfastPriceCents + lunchPriceCents + dinnerPriceCents;
      const dailyPriceCents = slotSum;
      const weeklyOverrideCents = parseOverrideCents(
        req.body?.weeklyPriceCents,
      );
      const monthlyOverrideCents = parseOverrideCents(
        req.body?.monthlyPriceCents,
      );
      const weeklyPriceCents = weeklyOverrideCents ?? slotSum * 7;
      const monthlyPriceCents = monthlyOverrideCents ?? slotSum * 30;

      const daysOfWeekSchema = z.array(z.number().int().min(0).max(6));
      const daysOfWeek = daysOfWeekSchema.parse(req.body?.daysOfWeek || []);
      if (daysOfWeek.length === 0) {
        return res
          .status(400)
          .json({ message: "At least one day of week is required." });
      }

      const spotCount = Number(req.body.maxTrucks ?? host.spotCount ?? 1);
      if (!Number.isFinite(spotCount) || spotCount < 1) {
        return res
          .status(400)
          .json({ message: "Number of spots must be at least 1" });
      }

      if (host.spotCount !== spotCount) {
        await db
          .update(hosts)
          .set({ spotCount, updatedAt: new Date() })
          .where(eq(hosts.id, host.id));
      }

      const defaultStartTime = PARKING_PASS_MEAL_WINDOWS.breakfast.start;
      const defaultEndTime = PARKING_PASS_MEAL_WINDOWS.dinner.end;
      const startTimeRaw =
        typeof req.body?.startTime === "string"
          ? req.body.startTime.trim()
          : "";
      const endTimeRaw =
        typeof req.body?.endTime === "string" ? req.body.endTime.trim() : "";

      // New model: persist pricing defaults on the host as the source of truth.
      try {
        await db
          .update(hosts)
          .set({
            parkingPassBreakfastPriceCents: breakfastPriceCents,
            parkingPassLunchPriceCents: lunchPriceCents,
            parkingPassDinnerPriceCents: dinnerPriceCents,
            parkingPassDailyPriceCents: dailyPriceCents,
            parkingPassWeeklyPriceCents: weeklyPriceCents,
            parkingPassMonthlyPriceCents: monthlyPriceCents,
            parkingPassStartTime: startTimeRaw || null,
            parkingPassEndTime: endTimeRaw || null,
            parkingPassDaysOfWeek: daysOfWeek,
            updatedAt: new Date(),
          } as any)
          .where(eq(hosts.id, host.id));
      } catch (e) {
        // Non-blocking: older DBs may not have these columns yet.
        console.warn("Failed to persist host parking pass defaults:", e);
      }

      const parsed = insertEventSchema.parse({
        ...req.body,
        date: new Date(),
        requiresPayment: true,
        eventType: "parking_pass",
        hostId: host.id,
        maxTrucks: spotCount,
        startTime: startTimeRaw || defaultStartTime,
        endTime: endTimeRaw || defaultEndTime,
        breakfastPriceCents,
        lunchPriceCents,
        dinnerPriceCents,
        dailyPriceCents,
        weeklyPriceCents,
        monthlyPriceCents,
        hostPriceCents: slotSum,
      });

      // Validation: End time > Start time
      const [startHour, startMinute] = parsed.startTime.split(":").map(Number);
      const [endHour, endMinute] = parsed.endTime.split(":").map(Number);
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;

      if (endMinutes <= startMinutes) {
        return res
          .status(400)
          .json({ message: "End time must be after start time" });
      }

      const invalidSlotLabels: string[] = [];
      if (
        breakfastPriceCents > 0 &&
        !isSlotWithinHours("breakfast", parsed.startTime, parsed.endTime)
      ) {
        invalidSlotLabels.push("Breakfast");
      }
      if (
        lunchPriceCents > 0 &&
        !isSlotWithinHours("lunch", parsed.startTime, parsed.endTime)
      ) {
        invalidSlotLabels.push("Lunch");
      }
      if (
        dinnerPriceCents > 0 &&
        !isSlotWithinHours("dinner", parsed.startTime, parsed.endTime)
      ) {
        invalidSlotLabels.push("Dinner");
      }
      if (invalidSlotLabels.length > 0) {
        return res.status(400).json({
          message:
            "Parking hours must fully cover priced slots: " +
            invalidSlotLabels.join(", "),
        });
      }

      // Validation: Spots >= 1
      if (parsed.maxTrucks !== undefined && parsed.maxTrucks < 1) {
        return res
          .status(400)
          .json({ message: "Number of spots must be at least 1" });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const horizon = new Date(today);
      horizon.setDate(horizon.getDate() + 90);

      const hardCapEnabled = Boolean(req.body?.hardCapEnabled);

      // Airbnb-style listing: store defaults on the series; do not materialize occurrences here.
      const existingSeries = await db
        .select({ id: eventSeries.id })
        .from(eventSeries)
        .where(
          and(
            eq(eventSeries.hostId, host.id),
            eq(eventSeries.seriesType, "parking_pass"),
          ),
        )
        .limit(1);

      if (existingSeries.length === 0) {
        const legacyRows = await db
          .select({
            id: events.id,
            breakfastPriceCents: events.breakfastPriceCents,
            lunchPriceCents: events.lunchPriceCents,
            dinnerPriceCents: events.dinnerPriceCents,
            dailyPriceCents: events.dailyPriceCents,
            weeklyPriceCents: events.weeklyPriceCents,
            monthlyPriceCents: events.monthlyPriceCents,
          })
          .from(events)
          .where(
            and(
              eq(events.hostId, host.id),
              eq(events.eventType, "parking_pass"),
              eq(events.requiresPayment, true),
              gte(events.date, today),
            ),
          )
          .limit(1);

        const hasPricing =
          (legacyRows[0]?.breakfastPriceCents ?? 0) > 0 ||
          (legacyRows[0]?.lunchPriceCents ?? 0) > 0 ||
          (legacyRows[0]?.dinnerPriceCents ?? 0) > 0 ||
          (legacyRows[0]?.dailyPriceCents ?? 0) > 0 ||
          (legacyRows[0]?.weeklyPriceCents ?? 0) > 0 ||
          (legacyRows[0]?.monthlyPriceCents ?? 0) > 0;
        if (hasPricing) {
          return res.status(409).json({
            message:
              "This location already has a Parking Pass listing. Run the migration/backfill to convert it to the new listing model.",
          });
        }
      }

      const publicReady = isParkingPassPublicReady({
        host,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        maxTrucks: spotCount,
        breakfastPriceCents,
        lunchPriceCents,
        dinnerPriceCents,
        dailyPriceCents,
        weeklyPriceCents,
        monthlyPriceCents,
      });
      const seriesTimezone = resolveCityTimeZoneSync({
        city: host.city,
        state: host.state,
      });

      const seriesValues: typeof eventSeries.$inferInsert = {
        hostId: host.id,
        name: `Parking Pass - ${host.businessName}`,
        description: host.address,
        timezone: seriesTimezone,
        recurrenceRule: null,
        startDate: today,
        endDate: horizon,
        defaultStartTime: parsed.startTime,
        defaultEndTime: parsed.endTime,
        defaultMaxTrucks: spotCount,
        defaultHardCapEnabled: hardCapEnabled,
        seriesType: "parking_pass",
        parkingPassDaysOfWeek: daysOfWeek,
        defaultBreakfastPriceCents: breakfastPriceCents,
        defaultLunchPriceCents: lunchPriceCents,
        defaultDinnerPriceCents: dinnerPriceCents,
        defaultDailyPriceCents: dailyPriceCents,
        defaultWeeklyPriceCents: weeklyPriceCents,
        defaultMonthlyPriceCents: monthlyPriceCents,
        defaultHostPriceCents: slotSum,
        status: publicReady ? "published" : "draft",
        publishedAt: publicReady ? new Date() : null,
        updatedAt: new Date(),
      };

      let seriesId = existingSeries[0]?.id ?? null;
      if (seriesId) {
        await db
          .update(eventSeries)
          .set(seriesValues as any)
          .where(eq(eventSeries.id, seriesId));
      } else {
        const [created] = await db
          .insert(eventSeries)
          .values(seriesValues)
          .onConflictDoNothing()
          .returning();
        seriesId = created?.id ?? null;
        if (!seriesId) {
          const [existingAfterConflict] = await db
            .select({ id: eventSeries.id })
            .from(eventSeries)
            .where(
              and(
                eq(eventSeries.hostId, host.id),
                eq(eventSeries.seriesType, "parking_pass"),
              ),
            )
            .limit(1);
          if (existingAfterConflict?.id) {
            seriesId = existingAfterConflict.id;
            await db
              .update(eventSeries)
              .set(seriesValues as any)
              .where(eq(eventSeries.id, seriesId));
          }
        }
      }

      if (!seriesId) {
        return res
          .status(500)
          .json({ message: "Failed to create parking pass listing" });
      }

      void logAudit(
        req.user?.id || "",
        "parking_pass_series_upserted",
        "parking_pass_series",
        String(seriesId),
        String(req.ip || ""),
        String(req.get("User-Agent") || ""),
        {
          hostId: host.id,
          publicReady,
          paymentsEnabled: Boolean(
            host.stripeConnectAccountId && host.stripeChargesEnabled,
          ),
        },
      ).catch((err) =>
        console.error("Failed to write parking pass audit log:", err),
      );

      const { occurrences } = await listParkingPassOccurrences({
        hostIds: [host.id],
        start: today,
        horizonDays: 90,
        includeDraft: true,
      });
      res.status(201).json(
        occurrences
          .filter((item) => item.seriesId === seriesId)
          .map((item: any) => ({
            ...item,
            qualityFlags: computeParkingPassQualityFlags(item),
          })),
      );
    } catch (error: any) {
      console.error("Error creating parking pass listing:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid parking pass data",
          errors: error.errors,
        });
      }
      res.status(400).json({
        message: error.message || "Failed to create parking pass listing",
      });
    }
  };

  app.post(
    "/api/hosts/parking-pass",
    isAuthenticated,
    createHostParkingPassListing,
  );
  app.post("/api/hosts/events", isAuthenticated, createHostParkingPassListing);

  const listHostParkingPassListings = async (req: any, res: any) => {
    try {
      const userId = req.user.id;
      const hostId = req.query?.hostId;
      if (!hostId) {
        return res.status(400).json({ message: "Host ID required" });
      }
      const host = await storage.getHost(hostId);
      if (!host || host.userId !== userId) {
        return res.status(404).json({ message: "Host profile not found" });
      }

      const { occurrences } = await listParkingPassOccurrences({
        hostIds: [host.id],
        horizonDays: 90,
        includeDraft: true,
      });
      const legacyEvents =
        occurrences.length > 0
          ? []
          : (await storage.getEventsByHost(host.id)).filter(
              (event: any) =>
                event?.eventType === "parking_pass" && event?.requiresPayment,
            );

      const deduped = new Map<string, any>();
      for (const item of [...occurrences, ...legacyEvents]) {
        deduped.set(item.id, {
          ...item,
          qualityFlags: computeParkingPassQualityFlags(item),
        });
      }

      res.json(Array.from(deduped.values()));
    } catch (error: any) {
      console.error("Error fetching parking pass listings:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch parking pass listings" });
    }
  };

  app.get(
    "/api/hosts/parking-pass",
    isAuthenticated,
    listHostParkingPassListings,
  );
  app.get("/api/hosts/events", isAuthenticated, listHostParkingPassListings);

  // PATCH: Override a single parking pass listing occurrence (time window, capacity, hard cap)
  const updateHostParkingPassListing = async (req: any, res: any) => {
    try {
      const eventId = req.params.eventId ?? req.params.passId;
      if (!eventId) {
        return res.status(400).json({ message: "Parking pass ID required" });
      }
      const userId = req.user.id;

      await ensureParkingPassEventRow({ passId: eventId, requireFuture: true });

      // Verify event exists and host owns it
      const { event, host } = await getEventAndHostForUser(eventId, userId);

      if (!event) {
        return res
          .status(404)
          .json({ message: "Parking pass listing not found" });
      }
      if (!host) {
        return res.status(404).json({ message: "Host profile not found" });
      }

      // Verify host owns the event
      if (!userOwnsEvent(userId, host, event)) {
        return res.status(403).json({
          message: "Not authorized to edit this parking pass listing",
        });
      }

      // Don't allow editing past events
      const eventDate = new Date(event.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (eventDate < today) {
        return res
          .status(400)
          .json({ message: "Cannot edit past parking pass listings" });
      }

      const {
        startTime,
        endTime,
        maxTrucks,
        hardCapEnabled,
        breakfastPriceCents,
        lunchPriceCents,
        dinnerPriceCents,
        dailyPriceCents,
        weeklyPriceCents,
        monthlyPriceCents,
      } = req.body;
      const applyToFuture = Boolean(req.body?.applyToFuture);

      // Build updates object (only include provided fields)
      const updates: any = {};
      if (startTime !== undefined) updates.startTime = startTime;
      if (endTime !== undefined) updates.endTime = endTime;

      const hasPricingUpdates =
        breakfastPriceCents !== undefined ||
        lunchPriceCents !== undefined ||
        dinnerPriceCents !== undefined ||
        dailyPriceCents !== undefined ||
        weeklyPriceCents !== undefined ||
        monthlyPriceCents !== undefined;
      if (hasPricingUpdates && !event.requiresPayment) {
        return res.status(400).json({
          message:
            "Pricing updates are only available for Parking Pass listings.",
        });
      }

      const parseCentsField = (
        rawValue: any,
        label: string,
      ): { provided: boolean; cents: number | null } => {
        if (rawValue === undefined) {
          return { provided: false, cents: null };
        }
        if (rawValue === null || rawValue === "") {
          return { provided: true, cents: null };
        }
        const parsed = Number(rawValue);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`${label} must be a valid non-negative number`);
        }
        const cents = Math.round(parsed);
        // Keep explicit zero so hosts can intentionally set free pricing.
        return { provided: true, cents };
      };

      const parseOverrideField = (
        rawValue: any,
        label: string,
      ): { provided: boolean; cents: number | null } => {
        if (rawValue === undefined) {
          return { provided: false, cents: null };
        }
        if (rawValue === null || rawValue === "") {
          // Explicitly reset to derived pricing
          return { provided: true, cents: null };
        }
        const parsed = Number(rawValue);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`${label} must be a valid non-negative number`);
        }
        return { provided: true, cents: Math.round(parsed) };
      };

      let parsedBreakfast: { provided: boolean; cents: number | null } | null =
        null;
      let parsedLunch: { provided: boolean; cents: number | null } | null =
        null;
      let parsedDinner: { provided: boolean; cents: number | null } | null =
        null;
      let parsedWeekly: { provided: boolean; cents: number | null } | null =
        null;
      let parsedMonthly: { provided: boolean; cents: number | null } | null =
        null;
      let parsedDaily: { provided: boolean; cents: number | null } | null =
        null;

      try {
        parsedBreakfast = parseCentsField(
          breakfastPriceCents,
          "Breakfast price",
        );
        parsedLunch = parseCentsField(lunchPriceCents, "Lunch price");
        parsedDinner = parseCentsField(dinnerPriceCents, "Dinner price");
        parsedDaily = parseOverrideField(dailyPriceCents, "Daily price");
        parsedWeekly = parseOverrideField(weeklyPriceCents, "Weekly price");
        parsedMonthly = parseOverrideField(monthlyPriceCents, "Monthly price");
      } catch (error: any) {
        return res
          .status(400)
          .json({ message: error.message || "Invalid pricing" });
      }

      const currentBreakfastCents = (event.breakfastPriceCents ?? 0) || 0;
      const currentLunchCents = (event.lunchPriceCents ?? 0) || 0;
      const currentDinnerCents = (event.dinnerPriceCents ?? 0) || 0;

      const nextBreakfastCents =
        parsedBreakfast?.provided && parsedBreakfast.cents !== null
          ? parsedBreakfast.cents
          : parsedBreakfast?.provided
            ? 0
            : currentBreakfastCents;
      const nextLunchCents =
        parsedLunch?.provided && parsedLunch.cents !== null
          ? parsedLunch.cents
          : parsedLunch?.provided
            ? 0
            : currentLunchCents;
      const nextDinnerCents =
        parsedDinner?.provided && parsedDinner.cents !== null
          ? parsedDinner.cents
          : parsedDinner?.provided
            ? 0
            : currentDinnerCents;

      const nextSlotSum = nextBreakfastCents + nextLunchCents + nextDinnerCents;

      const anyMealPriceProvided =
        parsedBreakfast?.provided ||
        parsedLunch?.provided ||
        parsedDinner?.provided;

      const oldSlotSum =
        currentBreakfastCents + currentLunchCents + currentDinnerCents;
      const wasWeeklyDerived = (event.weeklyPriceCents ?? 0) === oldSlotSum * 7;
      const wasMonthlyDerived =
        (event.monthlyPriceCents ?? 0) === oldSlotSum * 30;
      let shouldSyncSpotCount = false;
      if (maxTrucks !== undefined) {
        const spotCount = Number(maxTrucks);
        if (!Number.isFinite(spotCount) || spotCount < 1) {
          return res
            .status(400)
            .json({ message: "Number of spots must be at least 1" });
        }
        updates.maxTrucks = spotCount;
        if (event.requiresPayment) {
          shouldSyncSpotCount = true;
        }
      }
      if (hardCapEnabled !== undefined) updates.hardCapEnabled = hardCapEnabled;

      // Pricing updates for Parking Pass listings.
      if (
        event.requiresPayment &&
        (hasPricingUpdates || anyMealPriceProvided)
      ) {
        if (parsedBreakfast?.provided) {
          updates.breakfastPriceCents = nextBreakfastCents;
        }
        if (parsedLunch?.provided) {
          updates.lunchPriceCents = nextLunchCents;
        }
        if (parsedDinner?.provided) {
          updates.dinnerPriceCents = nextDinnerCents;
        }

        const effectiveDaily =
          parsedDaily?.provided && parsedDaily.cents !== null
            ? parsedDaily.cents
            : parsedDaily?.provided && parsedDaily.cents === null
              ? nextSlotSum
              : nextSlotSum > 0
                ? nextSlotSum
                : Number(event.dailyPriceCents ?? 0);
        const effectiveHostPrice =
          nextSlotSum > 0
            ? nextSlotSum
            : Math.max(0, Number(effectiveDaily || 0));

        const computedWeeklyDerived =
          Math.max(0, Number(effectiveDaily || 0)) * 7;
        const computedMonthlyDerived =
          Math.max(0, Number(effectiveDaily || 0)) * 30;

        const effectiveWeekly = parsedWeekly?.provided
          ? parsedWeekly.cents === null
            ? computedWeeklyDerived
            : parsedWeekly.cents
          : computedWeeklyDerived > 0
            ? computedWeeklyDerived
            : Number(event.weeklyPriceCents ?? 0);

        const effectiveMonthly = parsedMonthly?.provided
          ? parsedMonthly.cents === null
            ? computedMonthlyDerived
            : parsedMonthly.cents
          : computedMonthlyDerived > 0
            ? computedMonthlyDerived
            : Number(event.monthlyPriceCents ?? 0);

        updates.hostPriceCents = effectiveHostPrice;
        updates.dailyPriceCents = effectiveDaily;
        updates.weeklyPriceCents = effectiveWeekly;
        updates.monthlyPriceCents = effectiveMonthly;
      }

      // Validation: End time > Start time (if both provided)
      const finalStartTime = updates.startTime || event.startTime;
      const finalEndTime = updates.endTime || event.endTime;

      const [startHour, startMinute] = finalStartTime.split(":").map(Number);
      const [endHour, endMinute] = finalEndTime.split(":").map(Number);
      const startMinutes = startHour * 60 + startMinute;
      const endMinutes = endHour * 60 + endMinute;

      if (endMinutes <= startMinutes) {
        return res
          .status(400)
          .json({ message: "End time must be after start time" });
      }

      const invalidSlotLabels: string[] = [];
      const slotBreakfastCents =
        updates.breakfastPriceCents !== undefined
          ? Number(updates.breakfastPriceCents || 0)
          : Number(event.breakfastPriceCents || 0);
      const slotLunchCents =
        updates.lunchPriceCents !== undefined
          ? Number(updates.lunchPriceCents || 0)
          : Number(event.lunchPriceCents || 0);
      const slotDinnerCents =
        updates.dinnerPriceCents !== undefined
          ? Number(updates.dinnerPriceCents || 0)
          : Number(event.dinnerPriceCents || 0);

      if (
        slotBreakfastCents > 0 &&
        !isSlotWithinHours("breakfast", finalStartTime, finalEndTime)
      ) {
        invalidSlotLabels.push("Breakfast");
      }
      if (
        slotLunchCents > 0 &&
        !isSlotWithinHours("lunch", finalStartTime, finalEndTime)
      ) {
        invalidSlotLabels.push("Lunch");
      }
      if (
        slotDinnerCents > 0 &&
        !isSlotWithinHours("dinner", finalStartTime, finalEndTime)
      ) {
        invalidSlotLabels.push("Dinner");
      }
      if (invalidSlotLabels.length > 0) {
        return res.status(400).json({
          message:
            "Parking hours must fully cover priced slots: " +
            invalidSlotLabels.join(", "),
        });
      }

      // Validation: Capacity >= 1
      const finalMaxTrucks =
        updates.maxTrucks !== undefined ? updates.maxTrucks : event.maxTrucks;
      if (finalMaxTrucks < 1) {
        return res
          .status(400)
          .json({ message: "Max trucks must be at least 1" });
      }

      const isCapacityChanging = updates.maxTrucks !== undefined;
      const isHoursChanging =
        updates.startTime !== undefined || updates.endTime !== undefined;
      const willSyncFuture = applyToFuture && Boolean(event.requiresPayment);

      if (event.requiresPayment && (isCapacityChanging || isHoursChanging)) {
        const affectedEvents: Array<{
          id: string;
          date: Date | string;
          maxTrucks: number | null;
        }> = willSyncFuture
          ? await db
              .select({
                id: events.id,
                date: events.date,
                maxTrucks: events.maxTrucks,
              })
              .from(events)
              .where(
                and(
                  eq(events.hostId, host.id),
                  eq(events.requiresPayment, true),
                  gte(events.date, today),
                ),
              )
          : [
              {
                id: event.id,
                date: event.date,
                maxTrucks: event.maxTrucks,
              },
            ];

        const affectedEventIds = affectedEvents.map((row) => row.id);
        const eventDateById = new Map<string, string>();
        const hostTimeZone = resolveCityTimeZoneSync({
          city: host.city,
          state: host.state,
        });
        for (const row of affectedEvents) {
          eventDateById.set(
            row.id,
            dateKeyInZone(new Date(row.date), hostTimeZone),
          );
        }

        if (isCapacityChanging) {
          const bookingCounts =
            affectedEventIds.length > 0
              ? await db
                  .select({
                    eventId: eventBookings.eventId,
                    count: sql<number>`count(*)`,
                  })
                  .from(eventBookings)
                  .where(inArray(eventBookings.eventId, affectedEventIds))
                  .where(
                    inArray(eventBookings.status, ["confirmed", "pending"]),
                  )
                  .groupBy(eventBookings.eventId)
              : [];

          const countsByEvent = new Map<string, number>();
          for (const row of bookingCounts) {
            countsByEvent.set(row.eventId, Number(row.count || 0));
          }

          const overCapacity = affectedEventIds.find((id) => {
            const count = countsByEvent.get(id) ?? 0;
            return count > finalMaxTrucks;
          });

          if (overCapacity) {
            const dateKey = eventDateById.get(overCapacity);
            const count = countsByEvent.get(overCapacity) ?? 0;
            return res.status(400).json({
              message: `Cannot set max trucks to ${finalMaxTrucks}. ${dateKey || "A date"} already has ${count} booking(s).`,
            });
          }
        }

        if (isHoursChanging) {
          const bookingRows =
            affectedEventIds.length > 0
              ? await db
                  .select({
                    eventId: eventBookings.eventId,
                    slotType: eventBookings.slotType,
                  })
                  .from(eventBookings)
                  .where(inArray(eventBookings.eventId, affectedEventIds))
                  .where(
                    inArray(eventBookings.status, ["confirmed", "pending"]),
                  )
              : [];

          for (const booking of bookingRows) {
            const rawSlotTypes = String(booking.slotType || "");
            const normalized = rawSlotTypes
              .split(",")
              .map((value) => value.trim().toLowerCase())
              .filter((value) =>
                PARKING_PASS_SLOT_TYPES.includes(value as any),
              );
            const slots =
              normalized.length > 0 ? normalized : (["daily"] as const);

            for (const slotType of slots) {
              if (
                (slotType === "breakfast" ||
                  slotType === "lunch" ||
                  slotType === "dinner") &&
                !isSlotWithinHours(slotType, finalStartTime, finalEndTime)
              ) {
                const dateKey = eventDateById.get(booking.eventId);
                return res.status(400).json({
                  message: `Cannot change hours. Existing ${slotType} booking(s) on ${dateKey || "a future date"} require the current parking window.`,
                });
              }
            }
          }
        }
      }

      // Store before state for telemetry
      const beforeState = {
        startTime: event.startTime,
        endTime: event.endTime,
        maxTrucks: event.maxTrucks,
        hardCapEnabled: event.hardCapEnabled,
      };

      // Apply updates
      updates.updatedAt = new Date();
      const [updatedEvent] = await db
        .update(events)
        .set(updates)
        .where(eq(events.id, eventId))
        .returning();

      const shouldSyncFuture = applyToFuture && Boolean(event.requiresPayment);

      if (shouldSyncSpotCount && updates.maxTrucks !== undefined) {
        await db
          .update(hosts)
          .set({ spotCount: updates.maxTrucks, updatedAt: new Date() })
          .where(eq(hosts.id, host.id));
      }

      const futureUpdates: Record<string, any> = {};
      if (shouldSyncSpotCount && updates.maxTrucks !== undefined) {
        futureUpdates.maxTrucks = updates.maxTrucks;
      }
      if (shouldSyncFuture) {
        if (updates.startTime !== undefined)
          futureUpdates.startTime = updates.startTime;
        if (updates.endTime !== undefined)
          futureUpdates.endTime = updates.endTime;
        if (updates.hardCapEnabled !== undefined)
          futureUpdates.hardCapEnabled = updates.hardCapEnabled;
        if (updates.breakfastPriceCents !== undefined)
          futureUpdates.breakfastPriceCents = updates.breakfastPriceCents;
        if (updates.lunchPriceCents !== undefined)
          futureUpdates.lunchPriceCents = updates.lunchPriceCents;
        if (updates.dinnerPriceCents !== undefined)
          futureUpdates.dinnerPriceCents = updates.dinnerPriceCents;
        if (updates.dailyPriceCents !== undefined)
          futureUpdates.dailyPriceCents = updates.dailyPriceCents;
        if (updates.weeklyPriceCents !== undefined)
          futureUpdates.weeklyPriceCents = updates.weeklyPriceCents;
        if (updates.monthlyPriceCents !== undefined)
          futureUpdates.monthlyPriceCents = updates.monthlyPriceCents;
        if (updates.hostPriceCents !== undefined)
          futureUpdates.hostPriceCents = updates.hostPriceCents;
      }

      if (
        Object.keys(futureUpdates).length > 0 &&
        Boolean(event.requiresPayment)
      ) {
        await db
          .update(events)
          .set({ ...futureUpdates, updatedAt: new Date() })
          .where(
            and(
              eq(events.hostId, host.id),
              eq(events.requiresPayment, true),
              gte(events.date, today),
            ),
          );
      }

      const seriesUpdates: Record<string, any> = {};
      if (shouldSyncSpotCount && updates.maxTrucks !== undefined) {
        seriesUpdates.defaultMaxTrucks = updates.maxTrucks;
      }
      if (shouldSyncFuture) {
        if (updates.startTime !== undefined)
          seriesUpdates.defaultStartTime = updates.startTime;
        if (updates.endTime !== undefined)
          seriesUpdates.defaultEndTime = updates.endTime;
        if (updates.hardCapEnabled !== undefined) {
          seriesUpdates.defaultHardCapEnabled = updates.hardCapEnabled;
        }
        if (updates.breakfastPriceCents !== undefined) {
          seriesUpdates.defaultBreakfastPriceCents =
            updates.breakfastPriceCents;
        }
        if (updates.lunchPriceCents !== undefined) {
          seriesUpdates.defaultLunchPriceCents = updates.lunchPriceCents;
        }
        if (updates.dinnerPriceCents !== undefined) {
          seriesUpdates.defaultDinnerPriceCents = updates.dinnerPriceCents;
        }
        if (updates.dailyPriceCents !== undefined) {
          seriesUpdates.defaultDailyPriceCents = updates.dailyPriceCents;
        }
        if (updates.weeklyPriceCents !== undefined) {
          seriesUpdates.defaultWeeklyPriceCents = updates.weeklyPriceCents;
        }
        if (updates.monthlyPriceCents !== undefined) {
          seriesUpdates.defaultMonthlyPriceCents = updates.monthlyPriceCents;
        }
        if (updates.hostPriceCents !== undefined) {
          seriesUpdates.defaultHostPriceCents = updates.hostPriceCents;
        }
      }

      if (event.seriesId && Object.keys(seriesUpdates).length > 0) {
        await db
          .update(eventSeries)
          .set({ ...seriesUpdates, updatedAt: new Date() })
          .where(eq(eventSeries.id, event.seriesId));
      }

      // Enforce: Parking Pass only becomes publicly visible when it is complete + priced.
      // Draft series are allowed to exist for incomplete data entry.
      if (event.seriesId) {
        const [seriesRow] = await db
          .select({
            status: eventSeries.status,
            publishedAt: eventSeries.publishedAt,
          })
          .from(eventSeries)
          .where(eq(eventSeries.id, event.seriesId))
          .limit(1);
        if (seriesRow) {
          const publicReady = isParkingPassPublicReady({
            host,
            startTime: updatedEvent.startTime,
            endTime: updatedEvent.endTime,
            maxTrucks: updatedEvent.maxTrucks,
            breakfastPriceCents: updatedEvent.breakfastPriceCents,
            lunchPriceCents: updatedEvent.lunchPriceCents,
            dinnerPriceCents: updatedEvent.dinnerPriceCents,
            dailyPriceCents: updatedEvent.dailyPriceCents,
            weeklyPriceCents: updatedEvent.weeklyPriceCents,
            monthlyPriceCents: updatedEvent.monthlyPriceCents,
          });
          const nextStatus = publicReady ? "published" : "draft";
          const shouldUpdateStatus = String(seriesRow.status) !== nextStatus;
          if (shouldUpdateStatus) {
            await db
              .update(eventSeries)
              .set({
                status: nextStatus as any,
                publishedAt: publicReady
                  ? (seriesRow.publishedAt ?? new Date())
                  : null,
                updatedAt: new Date(),
              })
              .where(eq(eventSeries.id, event.seriesId));
          }
        }
      }

      // Telemetry
      await storage.createTelemetryEvent({
        eventName: "occurrence_overridden",
        userId: req.user.id,
        properties: {
          eventId,
          seriesId: event.seriesId,
          applyToFuture,
          before: beforeState,
          after: {
            startTime: updatedEvent.startTime,
            endTime: updatedEvent.endTime,
            maxTrucks: updatedEvent.maxTrucks,
            hardCapEnabled: updatedEvent.hardCapEnabled,
          },
          changedFields: Object.keys(updates).filter((k) => k !== "updatedAt"),
        },
      });

      const changedFields = Object.keys(updates).filter(
        (k) => k !== "updatedAt",
      );
      const pricingFields = new Set([
        "breakfastPriceCents",
        "lunchPriceCents",
        "dinnerPriceCents",
        "dailyPriceCents",
        "weeklyPriceCents",
        "monthlyPriceCents",
      ]);
      const changedPricing = changedFields.some((field) =>
        pricingFields.has(field),
      );
      void logAudit(
        req.user?.id || "",
        changedPricing
          ? "parking_pass_pricing_updated"
          : "parking_pass_updated",
        "parking_pass",
        String(eventId),
        String(req.ip || ""),
        String(req.get("User-Agent") || ""),
        {
          hostId: host.id,
          seriesId: event.seriesId,
          applyToFuture,
          changedFields,
          before: beforeState,
          after: {
            startTime: updatedEvent.startTime,
            endTime: updatedEvent.endTime,
            maxTrucks: updatedEvent.maxTrucks,
            hardCapEnabled: updatedEvent.hardCapEnabled,
            breakfastPriceCents: updatedEvent.breakfastPriceCents,
            lunchPriceCents: updatedEvent.lunchPriceCents,
            dinnerPriceCents: updatedEvent.dinnerPriceCents,
            dailyPriceCents: updatedEvent.dailyPriceCents,
            weeklyPriceCents: updatedEvent.weeklyPriceCents,
            monthlyPriceCents: updatedEvent.monthlyPriceCents,
          },
        },
      ).catch((err) =>
        console.error("Failed to write parking pass audit log:", err),
      );

      res.json({
        ...updatedEvent,
        qualityFlags: computeParkingPassQualityFlags({ ...updatedEvent, host }),
      });
    } catch (error: any) {
      console.error("Error updating parking pass listing:", error);
      res
        .status(500)
        .json({ message: "Failed to update parking pass listing" });
    }
  };

  app.patch(
    "/api/hosts/parking-pass/:passId",
    isAuthenticated,
    updateHostParkingPassListing,
  );
  app.patch(
    "/api/hosts/events/:eventId",
    isAuthenticated,
    updateHostParkingPassListing,
  );

  app.patch(
    "/api/hosts/interests/:interestId/status",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { interestId } = req.params;
        const { status } = req.body;
        const userId = req.user.id;

        if (!["accepted", "declined"].includes(status)) {
          return res.status(400).json({ message: "Invalid status" });
        }

        // Verify host owns the event associated with this interest
        const { interest, event, host } = await getInterestEventAndHostForUser(
          interestId,
          userId,
        );

        if (!interest) {
          return res.status(404).json({ message: "Interest not found" });
        }

        if (!event) {
          return res
            .status(404)
            .json({ message: "Parking pass listing not found" });
        }

        if (!userOwnsEvent(userId, host, event)) {
          return res.status(403).json({
            message: "Not authorized to manage this parking pass listing",
          });
        }

        // Idempotency Check: If already in desired status, return success
        if (interest.status === status) {
          return res.json(interest);
        }

        // CAPACITY GUARD v2.2
        // If hard cap is enabled, block acceptance if full
        if (status === "accepted" && event.hardCapEnabled) {
          const currentInterests = await storage.getEventInterestsByEventId(
            event.id,
          );
          // Note: interest.status is definitely NOT 'accepted' here due to idempotency check above
          const acceptedCount = computeAcceptedCount(currentInterests);

          if (
            shouldBlockAcceptance({
              hardCapEnabled: event.hardCapEnabled,
              acceptedCount,
              maxTrucks: event.maxTrucks,
            })
          ) {
            // Telemetry: Blocked Attempt
            await storage.createTelemetryEvent({
              eventName: "interest_accept_blocked",
              userId: req.user.id,
              properties: {
                eventId: event.id,
                truckId: interest.truckId,
                reason: "capacity_guard_limit_reached",
                maxTrucks: event.maxTrucks,
                acceptedCount,
              },
            });

            const capacityError = buildCapacityFullError();

            return res.status(400).json(capacityError);
          }
        }

        const updatedInterest = await storage.updateEventInterestStatus(
          interestId,
          status,
        );

        // Send notification to truck (fire and forget)
        (async () => {
          try {
            // Telemetry: Interest Status Changed
            const allInterests = await storage.getEventInterestsByEventId(
              event.id,
            );
            const acceptedCount = computeAcceptedCount(allInterests);
            const isOverCap = acceptedCount >= event.maxTrucks;

            await storage.createTelemetryEvent({
              eventName:
                status === "accepted"
                  ? "interest_accepted"
                  : "interest_declined",
              userId: req.user.id,
              properties: {
                eventId: event.id,
                truckId: interest.truckId,
                fillRate: computeFillRate({
                  acceptedCount,
                  maxTrucks: event.maxTrucks,
                }),
                acceptedCount,
                maxTrucks: event.maxTrucks,
                isOverCap,
              },
            });

            const truck = await storage.getRestaurant(interest.truckId);
            if (truck) {
              // Get truck owner's email
              // Note: getRestaurant doesn't return ownerId directly in all schemas, but let's check schema.ts
              // restaurants table has ownerId.
              const owner = await storage.getUser(truck.ownerId);
              if (owner && owner.email) {
                await emailService.sendInterestStatusUpdate(
                  owner.email,
                  truck.name,
                  host!.businessName,
                  new Date(event.date).toLocaleDateString(),
                  status as "accepted" | "declined",
                );
              }
            }
          } catch (err) {
            console.error("Failed to send status update notification:", err);
          }
        })();

        res.json(updatedInterest);
      } catch (error: any) {
        console.error("Error updating interest status:", error);
        res.status(500).json({ message: "Failed to update status" });
      }
    },
  );

  const listHostParkingPassInterests = async (req: any, res: any) => {
    try {
      const eventId = req.params.eventId ?? req.params.passId;
      if (!eventId) {
        return res.status(400).json({ message: "Parking pass ID required" });
      }
      const userId = req.user.id;

      // Verify host owns this parking pass listing (indirectly via host profile)
      const host = await getHostByUserId(userId);
      if (!host) {
        return res.status(403).json({ message: "Not a host" });
      }

      const { event } = await getEventAndHostForUser(eventId, userId);
      if (!event || !userOwnsEvent(userId, host, event)) {
        return res
          .status(404)
          .json({ message: "Parking pass listing not found" });
      }

      const interests = await storage.getEventInterestsByEventId(eventId);
      res.json(interests);
    } catch (error: any) {
      console.error("Error fetching parking pass interests:", error);
      res.status(500).json({ message: "Failed to fetch interests" });
    }
  };

  app.get(
    "/api/hosts/parking-pass/:passId/interests",
    isAuthenticated,
    listHostParkingPassInterests,
  );
  app.get(
    "/api/hosts/events/:eventId/interests",
    isAuthenticated,
    listHostParkingPassInterests,
  );

  // =====================================================================
  // STRIPE CONNECT & PAYMENT ENDPOINTS
  // =====================================================================

  const startHostStripeOnboarding = async (req: any, res: any) => {
    try {
      if (!stripe) {
        return res.status(500).json({ message: "Stripe not configured" });
      }

      const host = await getOwnedHostForRequest(req);
      if (!host) {
        return res.status(404).json({ message: "Host profile not found" });
      }

      let accountId = host.stripeConnectAccountId;

      if (!accountId) {
        const account = await stripe.accounts.create({
          type: "express",
          country: "US",
          email: req.user.email,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          business_type: "individual",
          metadata: {
            hostId: host.id,
            businessName: host.businessName,
          },
        });

        accountId = account.id;

        await db
          .update(hosts)
          .set({
            stripeConnectAccountId: accountId,
            stripeConnectStatus: "pending",
            stripeOnboardingCompleted: false,
            stripeChargesEnabled: false,
            stripePayoutsEnabled: false,
            updatedAt: new Date(),
          })
          .where(eq(hosts.id, host.id));
      }

      const baseUrl =
        process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
      const normalizedBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${normalizedBaseUrl}/host/dashboard?setup=refresh&hostId=${encodeURIComponent(String(host.id))}`,
        return_url: `${normalizedBaseUrl}/host/dashboard?setup=complete&hostId=${encodeURIComponent(String(host.id))}`,
        type: "account_onboarding",
      });

      res.json({ onboardingUrl: accountLink.url });
    } catch (error: any) {
      console.error("Error creating Stripe Connect account:", error);
      res.status(500).json({ message: "Failed to initiate Stripe onboarding" });
    }
  };

  const checkHostStripeStatus = async (req: any, res: any) => {
    try {
      if (!stripe) {
        return res.status(500).json({ message: "Stripe not configured" });
      }

      const host = await getOwnedHostForRequest(req);
      if (!host) {
        return res.status(404).json({ message: "Host profile not found" });
      }

      if (!host.stripeConnectAccountId) {
        return res.json({
          connected: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          onboardingCompleted: false,
          connectStatus: "not_connected",
        });
      }

      const account = await stripe.accounts.retrieve(
        host.stripeConnectAccountId,
      );

      await db
        .update(hosts)
        .set({
          stripeChargesEnabled: account.charges_enabled,
          stripePayoutsEnabled: account.payouts_enabled,
          stripeOnboardingCompleted: account.details_submitted,
          stripeConnectStatus:
            account.charges_enabled && account.payouts_enabled
              ? "active"
              : "pending",
          updatedAt: new Date(),
        })
        .where(eq(hosts.id, host.id));

      res.json({
        connected: true,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        onboardingCompleted: account.details_submitted,
        connectStatus:
          account.charges_enabled && account.payouts_enabled
            ? "active"
            : "pending",
        accountId: host.stripeConnectAccountId,
      });
    } catch (error: any) {
      console.error("Error checking Stripe status:", error);
      res.status(500).json({ message: "Failed to check Stripe status" });
    }
  };

  // Stripe Connect Onboarding: Host enables payments
  app.post(
    "/api/hosts/stripe/onboard",
    isAuthenticated,
    startHostStripeOnboarding,
  );
  app.post(
    "/api/hosts/:hostId/stripe/onboard",
    isAuthenticated,
    async (req: any, res) => {
      req.body = {
        ...(req.body || {}),
        hostId: String(req.params.hostId || "").trim(),
      };
      return startHostStripeOnboarding(req, res);
    },
  );

  // Check Stripe Connect account status
  app.get("/api/hosts/stripe/status", isAuthenticated, checkHostStripeStatus);
  app.get(
    "/api/hosts/:hostId/stripe/status",
    isAuthenticated,
    async (req: any, res) => {
      req.query = {
        ...(req.query || {}),
        hostId: String(req.params.hostId || "").trim(),
      };
      return checkHostStripeStatus(req, res);
    },
  );

  app.get(
    "/api/hosts/earnings/summary",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const host = await getOwnedHostForRequest(req);
        if (!host) {
          return res.status(404).json({ message: "Host profile not found" });
        }

        const summary = await getHostEarningsSummary(host.id);
        const stripePayoutReady = Boolean(
          host.stripeConnectAccountId &&
          host.stripeChargesEnabled &&
          host.stripePayoutsEnabled &&
          host.stripeOnboardingCompleted,
        );

        res.json({
          ...summary,
          stripePayoutReady,
          canRequestPayout: stripePayoutReady && summary.availableCents > 0,
        });
      } catch (error: any) {
        console.error("Error loading host earnings summary:", error);
        res.status(500).json({ message: "Failed to load earnings summary" });
      }
    },
  );

  app.post(
    "/api/hosts/earnings/payout-request",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const host = await getOwnedHostForRequest(req);
        if (!host) {
          return res.status(404).json({ message: "Host profile not found" });
        }

        const stripePayoutReady = Boolean(
          host.stripeConnectAccountId &&
          host.stripeChargesEnabled &&
          host.stripePayoutsEnabled &&
          host.stripeOnboardingCompleted,
        );
        if (!stripePayoutReady) {
          return res.status(400).json({
            message:
              "Complete Stripe onboarding to request payout. Bookings can continue in the meantime.",
            code: "stripe_payout_not_ready",
          });
        }

        const summary = await getHostEarningsSummary(host.id);
        const requestedAmountRaw = Number(req.body?.amountCents);
        const requestedAmountCents = Number.isFinite(requestedAmountRaw)
          ? Math.floor(requestedAmountRaw)
          : summary.availableCents;

        if (requestedAmountCents <= 0) {
          return res
            .status(400)
            .json({ message: "Payout amount must be greater than $0.00" });
        }
        if (requestedAmountCents > summary.availableCents) {
          return res.status(400).json({
            message: "Requested amount exceeds available earnings.",
            availableCents: summary.availableCents,
          });
        }

        const [createdRequest] = await db
          .insert(hostPayoutRequests)
          .values({
            hostId: host.id,
            userId: req.user.id,
            amountCents: requestedAmountCents,
            status: "pending",
            notes:
              typeof req.body?.notes === "string" && req.body.notes.trim()
                ? req.body.notes.trim()
                : null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();

        const updatedSummary = await getHostEarningsSummary(host.id);

        res.status(201).json({
          request: createdRequest,
          summary: {
            ...updatedSummary,
            stripePayoutReady,
            canRequestPayout:
              stripePayoutReady && updatedSummary.availableCents > 0,
          },
        });
      } catch (error: any) {
        console.error("Error creating host payout request:", error);
        res.status(500).json({ message: "Failed to create payout request" });
      }
    },
  );

  // Book a Parking Pass (creates payment intent with $10/day platform fee auto-added)
  app.post(
    "/api/parking-pass/:passId/book",
    parkingPassBookingBurstLimiter,
    parkingPassBookingDayLimiter,
    requireIdempotencyKey({ scope: "parking_pass_booking" }),
    isAuthenticated,
    async (req: any, res) => {
      try {
        const testModeEnabled =
          String(process.env.MEALSCOUT_TEST_MODE || "").toLowerCase() ===
            "true" || process.env.NODE_ENV !== "production";
        const testPromosRequireAdmin =
          String(
            process.env.MEALSCOUT_TEST_PROMOS_REQUIRE_ADMIN || "",
          ).toLowerCase() === "true";
        const isAdminUser = ["admin", "super_admin", "staff"].includes(
          String(req.user?.userType || ""),
        );
        const bookingFeePromoEnabled =
          String(process.env.BOOKFEE10_ENABLED || "").toLowerCase() ===
            "true" || process.env.NODE_ENV !== "production";
        const bypassStripe =
          String(process.env.MEALSCOUT_BYPASS_STRIPE || "").toLowerCase() ===
            "true" ||
          String(process.env.MEALSCOUT_TEST_MODE || "").toLowerCase() ===
            "true";
        if (!stripe && !bypassStripe) {
          return res.status(500).json({ message: "Stripe not configured" });
        }

        const { passId } = req.params;
        const {
          truckId,
          slotType,
          slotTypes,
          selectedDates,
          applyCreditsCents,
          promoCode,
        } = req.body;
        const userId = req.user.id;

        if (!truckId) {
          return res.status(400).json({ message: "Truck ID required" });
        }

        const normalizedPromoCode = String(promoCode || "")
          .trim()
          .toUpperCase();
        const isTestDollarPromo =
          normalizedPromoCode === "TEST1" || normalizedPromoCode === "FREE100";
        const bookingPromoCodes = new Set(["TEST1", "FREE100", "BOOKFEE10"]);
        if (
          normalizedPromoCode &&
          !bookingPromoCodes.has(normalizedPromoCode)
        ) {
          return res.status(400).json({ message: "Invalid promo code" });
        }
        if (
          isTestDollarPromo &&
          (!testModeEnabled || (testPromosRequireAdmin && !isAdminUser))
        ) {
          return res.status(403).json({ message: "Not authorized" });
        }
        if (normalizedPromoCode === "BOOKFEE10" && !bookingFeePromoEnabled) {
          return res
            .status(400)
            .json({ message: "Promo code is not available" });
        }
        const allowedSlotTypes = new Set<string>(
          PARKING_PASS_SLOT_TYPES as readonly string[],
        );
        const requestedSlots = Array.isArray(slotTypes)
          ? slotTypes
          : slotType
            ? [slotType]
            : [];
        const normalizedSlots = Array.from(
          new Set(
            requestedSlots
              .filter((value: any) => typeof value === "string")
              .map((value: string) => value.trim())
              .filter((value: string) => value.length > 0),
          ),
        );
        if (normalizedSlots.length === 0) {
          return res.status(400).json({ message: "Valid slotTypes required" });
        }
        if (normalizedSlots.some((value) => !allowedSlotTypes.has(value))) {
          return res.status(400).json({ message: "Valid slotTypes required" });
        }

        const durationSlots = normalizedSlots.filter((value) =>
          ["daily", "weekly", "monthly"].includes(value),
        );
        const mealSlots = normalizedSlots.filter((value) =>
          ["breakfast", "lunch", "dinner"].includes(value),
        );
        if (durationSlots.length > 0 && mealSlots.length > 0) {
          return res.status(400).json({
            message:
              "Daily, weekly, and monthly bookings cannot be combined with meal slots.",
          });
        }
        if (durationSlots.length > 1) {
          return res.status(400).json({
            message: "Select only one of daily, weekly, or monthly.",
          });
        }

        const selectedSlotTypes = (
          durationSlots.length > 0 ? durationSlots : mealSlots
        ) as (typeof PARKING_PASS_SLOT_TYPES)[number][];

        // Verify truck ownership
        const truck = await storage.getRestaurant(truckId);
        if (!truck || truck.ownerId !== userId) {
          return res.status(403).json({ message: "Not authorized" });
        }
        if (!truck.isFoodTruck) {
          return res.status(403).json({
            message:
              "Parking Pass bookings are only available for food trucks.",
          });
        }
        if (
          !truck.isVerified &&
          !["admin", "super_admin", "staff"].includes(req.user?.userType)
        ) {
          return res.status(403).json({
            message:
              "Your truck must be verified before booking parking pass slots.",
          });
        }
        if (
          req.user?.userType &&
          !["food_truck", "admin", "super_admin", "staff"].includes(
            req.user.userType,
          )
        ) {
          return res.status(403).json({
            message: "Only food truck accounts can book Parking Pass slots.",
          });
        }

        // Get (or materialize) the Parking Pass occurrence row.
        const event = await ensureParkingPassEventRow({
          passId,
          requireFuture: true,
        });
        if (!event) {
          return res.status(404).json({ message: "Parking pass not found" });
        }

        if (event.status !== "open") {
          return res
            .status(400)
            .json({ message: "Parking pass not available for booking" });
        }

        if (!event.requiresPayment) {
          return res.status(400).json({
            message:
              "Payments are only available for Parking Pass listings, not events.",
          });
        }

        // Get host
        const host = await storage.getHost(event.hostId);
        if (!host) {
          return res.status(404).json({ message: "Host not found" });
        }

        const hostPaymentsEnabled = Boolean(
          host.stripeConnectAccountId &&
          host.stripeChargesEnabled &&
          host.stripePayoutsEnabled &&
          host.stripeOnboardingCompleted,
        );
        // Host payouts may still be configuring Stripe Connect.
        // We still allow bookings: if Connect is not ready we charge on platform,
        // and payouts are handled after host onboarding is completed.
        const hostStripeAccountId = hostPaymentsEnabled
          ? host.stripeConnectAccountId
          : null;
        const bookingTimeZone = resolveCityTimeZoneSync({
          city: host.city,
          state: host.state,
        });

        // Check for existing booking
        const existingBooking = await db
          .select()
          .from(eventBookings)
          .where(eq(eventBookings.eventId, passId))
          .where(eq(eventBookings.truckId, truckId))
          .where(inArray(eventBookings.status, ["pending", "confirmed"]))
          .limit(1);

        if (existingBooking.length > 0) {
          return res.status(400).json({
            message:
              existingBooking[0].status === "pending"
                ? "You already have a checkout in progress for this parking pass."
                : "You already have a booking for this parking pass",
            bookingId: existingBooking[0].id,
          });
        }

        const eventDateKey = dateKeyFromUnknown(event.date);
        const rangeStart = utcDateFromDateKey(eventDateKey);

        const requestedDateKeys = Array.isArray(selectedDates)
          ? Array.from(
              new Set(
                selectedDates
                  .filter((value: unknown) => typeof value === "string")
                  .map((value: string) => value.trim())
                  .filter((value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)),
              ),
            )
          : [];
        if (
          Array.isArray(selectedDates) &&
          selectedDates.length > 0 &&
          requestedDateKeys.length !== selectedDates.length
        ) {
          return res
            .status(400)
            .json({ message: "Invalid selectedDates format." });
        }

        const bookingDaysDefault = durationSlots.includes("monthly")
          ? 30
          : durationSlots.includes("weekly")
            ? 7
            : 1;
        const expectedDateKeys: string[] =
          requestedDateKeys.length > 0
            ? requestedDateKeys
            : Array.from({ length: bookingDaysDefault }, (_, offset) => {
                return addDaysToDateKey(eventDateKey, offset);
              });
        if (expectedDateKeys.length === 0) {
          return res
            .status(400)
            .json({ message: "No booking dates selected." });
        }
        if (expectedDateKeys.length > 31) {
          return res
            .status(400)
            .json({ message: "Too many booking dates selected." });
        }

        const sortedDateKeys = [...expectedDateKeys].sort();
        const firstDate = new Date(`${sortedDateKeys[0]}T00:00:00.000Z`);
        const lastDate = new Date(
          `${sortedDateKeys[sortedDateKeys.length - 1]}T00:00:00.000Z`,
        );
        if (
          !Number.isFinite(firstDate.getTime()) ||
          !Number.isFinite(lastDate.getTime())
        ) {
          return res
            .status(400)
            .json({ message: "Invalid booking dates selected." });
        }
        const rangeQueryStart = new Date(firstDate);
        const rangeQueryEnd = new Date(lastDate);
        rangeQueryEnd.setDate(rangeQueryEnd.getDate() + 1);

        const bookingEvents = await db
          .select()
          .from(events)
          .where(
            and(
              eq(events.hostId, host.id),
              eq(events.requiresPayment, true),
              gte(events.date, rangeQueryStart),
              lt(events.date, rangeQueryEnd),
            ),
          )
          .orderBy(asc(events.date));

        const eventsByDate = new Map<string, (typeof bookingEvents)[number]>();
        for (const row of bookingEvents) {
          const dateKey = dateKeyFromUnknown(row.date);
          eventsByDate.set(dateKey, row);
        }

        const missingDates = expectedDateKeys.filter(
          (dateKey) => !eventsByDate.has(dateKey),
        );
        if (missingDates.length > 0) {
          return res.status(400).json({
            message:
              "This parking pass does not have availability for the full booking range.",
          });
        }

        const now = new Date();
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const nowMinutes = now.getHours() * 60 + now.getMinutes();

        for (const dateKey of expectedDateKeys) {
          const row = eventsByDate.get(dateKey);
          if (!row) continue;
          const rowDate = new Date(row.date);
          const rowDayStart = new Date(rowDate);
          rowDayStart.setHours(0, 0, 0, 0);

          if (rowDayStart < todayStart) {
            return res.status(400).json({
              message: "Cannot book past parking pass dates.",
            });
          }

          const isSameDayBooking =
            rowDayStart.getTime() === todayStart.getTime();

          if (row.status !== "open") {
            return res.status(400).json({
              message: "This parking pass is not available for that date.",
            });
          }
          for (const slotType of selectedSlotTypes) {
            if (!isSlotWithinHours(slotType, row.startTime, row.endTime)) {
              return res.status(400).json({
                message: "Selected slots do not fit within host parking hours.",
              });
            }

            if (isSameDayBooking) {
              const window = getSlotWindowMinutesWithCleanup(
                slotType,
                row.startTime,
                row.endTime,
              );
              if (!window || window.startMinutes <= nowMinutes) {
                return res.status(400).json({
                  message:
                    "Selected slots must start in the future. Choose a later slot or a different date.",
                });
              }
            }
          }
        }

        // Expire stale pending holds for this truck so users aren't blocked forever if they abandon checkout.
        // We rely on webhook events for fast cleanup, this is a safety net.
        const holdTtlMinutesRaw = Number(
          process.env.PARKING_PASS_HOLD_TTL_MINUTES ?? 7,
        );
        const holdTtlMinutes = Number.isFinite(holdTtlMinutesRaw)
          ? Math.max(1, Math.min(holdTtlMinutesRaw, 60))
          : 7;
        const holdCutoff = new Date(Date.now() - holdTtlMinutes * 60 * 1000);
        await db
          .update(eventBookings)
          .set({
            status: "cancelled",
            stripePaymentStatus: "cancelled",
            cancelledAt: new Date(),
            cancellationReason: "Payment not completed (hold expired)",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(eventBookings.truckId, truckId),
              eq(eventBookings.status, "pending"),
              lt(eventBookings.createdAt, holdCutoff),
            ),
          );

        const existingBookings: Array<{
          slotType: string | null;
          eventDate: Date | string;
          eventStartTime: string | null;
          eventEndTime: string | null;
        }> = await db
          .select({
            slotType: eventBookings.slotType,
            eventDate: events.date,
            eventStartTime: events.startTime,
            eventEndTime: events.endTime,
          })
          .from(eventBookings)
          .innerJoin(events, eq(eventBookings.eventId, events.id))
          .where(
            and(
              eq(eventBookings.truckId, truckId),
              inArray(eventBookings.status, ["confirmed", "pending"]),
              gte(events.date, rangeQueryStart),
              lt(events.date, rangeQueryEnd),
            ),
          );

        const requestedWindowsByDate = new Map<
          string,
          Array<{ start: number; end: number }>
        >();
        for (const dateKey of expectedDateKeys) {
          const row = eventsByDate.get(dateKey);
          if (!row) continue;
          const windows: Array<{ start: number; end: number }> = [];
          for (const slotType of selectedSlotTypes) {
            const window = getSlotWindowMinutesWithCleanup(
              slotType,
              row.startTime,
              row.endTime,
            );
            if (window) {
              windows.push({
                start: window.startMinutes,
                end: window.endMinutes,
              });
            }
          }
          if (windows.length > 0) {
            requestedWindowsByDate.set(dateKey, windows);
          }
        }

        for (const booking of existingBookings) {
          const dateKey = dateKeyInZone(
            new Date(booking.eventDate),
            bookingTimeZone,
          );
          const requested = requestedWindowsByDate.get(dateKey);
          if (!requested || requested.length === 0) continue;
          const slotParts = (booking.slotType || "")
            .split(",")
            .map((value) => value.trim().toLowerCase())
            .filter((value) => value.length > 0);
          const normalizedExisting = slotParts.filter((value) =>
            allowedSlotTypes.has(value),
          );
          const existingSlots =
            normalizedExisting.length > 0 ? normalizedExisting : ["daily"];
          for (const slot of existingSlots) {
            const window = getSlotWindowMinutesWithCleanup(
              slot as (typeof PARKING_PASS_SLOT_TYPES)[number],
              booking.eventStartTime,
              booking.eventEndTime,
            );
            if (!window) continue;
            for (const requestedWindow of requested) {
              if (
                slotWindowsOverlap(
                  requestedWindow.start,
                  requestedWindow.end,
                  window.startMinutes,
                  window.endMinutes,
                )
              ) {
                return res.status(400).json({
                  message:
                    "You already have a booking that overlaps this time.",
                });
              }
            }
          }
        }

        const bookingDays = expectedDateKeys.length;
        // Calculate pricing: Host price + $10 platform fee
        const slotPriceMap: Record<string, number | null | undefined> = {
          breakfast: event.breakfastPriceCents,
          lunch: event.lunchPriceCents,
          dinner: event.dinnerPriceCents,
          daily: event.dailyPriceCents,
          weekly: event.weeklyPriceCents,
          monthly: event.monthlyPriceCents,
        };
        const selectedPrices = selectedSlotTypes.map((slot) => ({
          slot,
          price: slotPriceMap[slot] || 0,
        }));
        if (selectedPrices.some((item) => item.price <= 0)) {
          return res.status(400).json({
            message: "One or more selected slots are not available.",
          });
        }
        const hostPriceCents = selectedPrices.reduce(
          (sum, item) => sum + item.price,
          0,
        );
        let platformFeeCents = 1000 * bookingDays; // $10/day, no cap
        let adjustedHostPriceCents = hostPriceCents;
        let promoDiscountCents = 0;

        if (isTestDollarPromo) {
          // Admin/testing-only: force a $1 total booking regardless of slot price.
          // This is intentionally not available in production unless MEALSCOUT_TEST_MODE is enabled.
          adjustedHostPriceCents = 0;
          platformFeeCents = 100;
        } else if (normalizedPromoCode === "BOOKFEE10") {
          const userRecord = await storage.getUser(userId);
          const bookingPromoState = (userRecord?.accountSettings as any)?.promos
            ?.bookingFee10;
          if (bookingPromoState?.redeemedAt) {
            return res.status(400).json({ message: "Promo code already used" });
          }
          if (bookingPromoState?.pendingPaymentIntentId) {
            return res
              .status(400)
              .json({ message: "Promo code already pending" });
          }
          promoDiscountCents = Math.min(1000, platformFeeCents);
        }

        let creditAppliedCents = 0;
        const requestedCreditCents = isTestDollarPromo
          ? 0
          : Number(applyCreditsCents || 0);
        if (requestedCreditCents > 0) {
          const { getUserCreditBalance } = await import("../creditService");
          const creditBalance = await getUserCreditBalance(userId);
          const availableCents = Math.max(0, Math.floor(creditBalance * 100));
          creditAppliedCents = Math.min(
            requestedCreditCents,
            platformFeeCents,
            availableCents,
          );
        }

        const adjustedPlatformFeeCents = Math.max(
          platformFeeCents - creditAppliedCents - promoDiscountCents,
          0,
        );
        const totalCents = adjustedHostPriceCents + adjustedPlatformFeeCents;

        const splitAmount = (total: number, days: number) => {
          if (days <= 1) return [total];
          const base = Math.floor(total / days);
          const remainder = total - base * days;
          return Array.from({ length: days }, (_, index) =>
            index === 0 ? base + remainder : base,
          );
        };

        const hostSplit = splitAmount(adjustedHostPriceCents, bookingDays);
        const platformSplit = splitAmount(
          adjustedPlatformFeeCents,
          bookingDays,
        );

        // Create the pending holds inside a DB transaction with row-level locks on each event row.
        // This prevents two trucks from simultaneously booking the last spot and paying.
        let insertedHolds: any[] = [];
        try {
          insertedHolds = await db.transaction(async (tx: any) => {
            const now = new Date();
            const inserted: any[] = [];

            for (let index = 0; index < expectedDateKeys.length; index += 1) {
              const dateKey = expectedDateKeys[index];
              const row = eventsByDate.get(dateKey);
              if (!row) {
                throw new Error("Missing parking pass date in booking range.");
              }

              // Lock this event row so capacity checks + hold insert are serialized.
              await tx.execute(
                sql`select ${events.id} from ${events} where ${events.id} = ${row.id} for update`,
              );

              const counts = await tx
                .select({ count: sql<number>`count(*)` })
                .from(eventBookings)
                .where(
                  and(
                    eq(eventBookings.eventId, row.id),
                    inArray(eventBookings.status, ["confirmed", "pending"]),
                  ),
                );

              const reservedCount = Number(counts[0]?.count || 0);
              const maxSpots = row.maxTrucks ?? 1;
              if (reservedCount >= maxSpots) {
                const err: any = new Error(
                  "This parking pass is fully booked.",
                );
                err.code = "FULLY_BOOKED";
                throw err;
              }

              const hostCents = hostSplit[index] ?? 0;
              const feeCents = platformSplit[index] ?? 0;

              const [created] = await tx
                .insert(eventBookings)
                .values({
                  eventId: row.id,
                  truckId,
                  hostId: row.hostId,
                  hostPriceCents: hostCents,
                  platformFeeCents: feeCents,
                  totalCents: hostCents + feeCents,
                  status: "pending",
                  stripePaymentStatus: "pending",
                  stripeApplicationFeeAmount: hostStripeAccountId
                    ? feeCents
                    : null,
                  stripeTransferDestination: hostStripeAccountId,
                  slotType: selectedSlotTypes.join(","),
                  createdAt: now,
                  updatedAt: now,
                })
                .returning();

              if (!created) {
                throw new Error("Failed to reserve parking pass hold.");
              }

              inserted.push(created);
            }

            return inserted;
          });
        } catch (error: any) {
          if (error?.code === "FULLY_BOOKED") {
            return res
              .status(400)
              .json({ message: "This parking pass is fully booked." });
          }

          // Unique constraint or race conditions should surface as "already booked" / "in progress".
          console.error("Failed to create booking holds:", error);
          return res.status(409).json({
            message:
              "Unable to reserve this parking pass right now. Please refresh and try again.",
          });
        }

        if (bypassStripe) {
          const holdIds = insertedHolds.map((row) => row.id);
          const now = new Date();
          if (holdIds.length > 0) {
            await db
              .update(eventBookings)
              .set({
                status: "confirmed",
                stripePaymentStatus: "bypassed",
                bookingConfirmedAt: now,
                paidAt: now,
                updatedAt: now,
              })
              .where(inArray(eventBookings.id, holdIds));
          }

          if (normalizedPromoCode === "BOOKFEE10") {
            try {
              const userRecord = await storage.getUser(userId);
              const existingSettings =
                (userRecord?.accountSettings as any) || {};
              const promos = existingSettings.promos || {};
              promos.bookingFee10 = {
                ...(promos.bookingFee10 || {}),
                redeemedAt: now.toISOString(),
                redeemedPaymentIntentId: "bypass",
                discountCents: promoDiscountCents,
                pendingPaymentIntentId: null,
                pendingAt: null,
              };
              await storage.updateUser(userId, {
                accountSettings: { ...existingSettings, promos } as any,
              });
            } catch {
              // ignore
            }
          }

          return res.json({
            bypassed: true,
            bookingIds: holdIds,
            totalCents,
            breakdown: {
              hostPrice: adjustedHostPriceCents,
              platformFee: adjustedPlatformFeeCents,
              creditsApplied: creditAppliedCents,
              promoDiscount: promoDiscountCents,
              promoCode: normalizedPromoCode || undefined,
            },
          });
        }

        // Create Stripe PaymentIntent.
        // If the host has Stripe Connect payouts enabled, create a direct charge on their Connect account
        // and collect the MealScout application fee. Otherwise, charge on the platform account so the
        // booking can still go through (host payout will be handled later).
        if (!stripe) {
          return res.status(500).json({ message: "Stripe is not configured" });
        }

        let paymentIntent: Stripe.PaymentIntent;
        try {
          const intentParams: Stripe.PaymentIntentCreateParams = {
            amount: totalCents,
            currency: "usd",
            metadata: {
              passId: event.id,
              hostId: host.id,
              truckId,
              userId,
              slotTypes: selectedSlotTypes.join(","),
              bookingDays: bookingDays.toString(),
              bookingStartDate: sortedDateKeys[0],
              hostPriceCents: adjustedHostPriceCents.toString(),
              platformFeeCents: adjustedPlatformFeeCents.toString(),
              totalCents: totalCents.toString(),
              creditAppliedCents: creditAppliedCents.toString(),
              bookingPromoCode: normalizedPromoCode || "",
              bookingPromoDiscountCents: promoDiscountCents.toString(),
            },
          };

          // Only valid for Connect direct charges
          if (hostStripeAccountId) {
            intentParams.application_fee_amount = adjustedPlatformFeeCents;
          }

          paymentIntent = await stripe.paymentIntents.create(
            intentParams,
            hostStripeAccountId
              ? { stripeAccount: hostStripeAccountId }
              : undefined,
          );
        } catch (error: any) {
          // Best-effort release holds if Stripe fails.
          try {
            const holdIds = insertedHolds.map((row) => row.id);
            if (holdIds.length > 0) {
              await db
                .update(eventBookings)
                .set({
                  status: "cancelled",
                  cancelledAt: new Date(),
                  cancellationReason: "Payment setup failed",
                  updatedAt: new Date(),
                })
                .where(inArray(eventBookings.id, holdIds));
            }
          } catch (cleanupError) {
            console.error(
              "Failed to cancel holds after Stripe failure:",
              cleanupError,
            );
          }
          throw error;
        }

        const holdIds = insertedHolds.map((row) => row.id);
        if (holdIds.length > 0) {
          await db
            .update(eventBookings)
            .set({
              stripePaymentIntentId: paymentIntent.id,
              updatedAt: new Date(),
            })
            .where(inArray(eventBookings.id, holdIds));
        }

        res.json({
          clientSecret: paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          totalCents,
          breakdown: {
            hostPrice: adjustedHostPriceCents,
            platformFee: adjustedPlatformFeeCents,
            creditsApplied: creditAppliedCents,
            promoDiscount: promoDiscountCents,
            promoCode: normalizedPromoCode || undefined,
          },
        });

        if (normalizedPromoCode === "BOOKFEE10") {
          try {
            const userRecord = await storage.getUser(userId);
            const existingSettings = (userRecord?.accountSettings as any) || {};
            const promos = existingSettings.promos || {};
            promos.bookingFee10 = {
              ...(promos.bookingFee10 || {}),
              pendingPaymentIntentId: paymentIntent.id,
              pendingAt: new Date().toISOString(),
              discountCents: promoDiscountCents,
            };
            await storage.updateUser(userId, {
              accountSettings: { ...existingSettings, promos } as any,
            });
          } catch (error) {
            console.warn(
              "Failed to persist promo reservation (continuing):",
              error,
            );
          }
        }
      } catch (error: any) {
        console.error("Error creating booking:", error);
        res.status(500).json({ message: "Failed to create booking" });
      }
    },
  );
}
