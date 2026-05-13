import type { Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { emailService } from "../../emailService";
import { db } from "../../db";
import {
  insertEventSchema,
  events,
  eventSeries,
  hosts,
  eventBookings,
} from "@shared/schema";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { isAuthenticated } from "../../unifiedAuth";
import {
  getHostByUserId,
  getEventAndHostForUser,
  getInterestEventAndHostForUser,
  userOwnsEvent,
} from "../../services/hostOwnership";
import {
  computeAcceptedCount,
  shouldBlockAcceptance,
  buildCapacityFullError,
  computeFillRate,
} from "../../services/interestDecision";
import {
  PARKING_PASS_MEAL_WINDOWS,
  PARKING_PASS_SLOT_TYPES,
  isSlotWithinHours,
} from "@shared/parkingPassSlots";
import {
  ensureParkingPassEventRow,
  listParkingPassOccurrences,
} from "../../services/parkingPassVirtual";
import {
  computeParkingPassQualityFlags,
  isParkingPassPublicReady,
} from "../../services/parkingPassQuality";
import { logAudit } from "../../auditLogger";
import { dateKeyInZone } from "../../services/dateKeys";
import { resolveCityTimeZoneSync } from "../../services/cityTimeZone";
import { canEmailForTopic } from "../../utils/notificationPreferences";

export function registerHostEventsRoutes(app: Express) {
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
        endDate: null as any,
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
              if (
                owner &&
                owner.email &&
                canEmailForTopic((owner as any).accountSettings, "nearbyEvents")
              ) {
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
}
