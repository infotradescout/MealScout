import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  eventBookings,
  eventInterests,
  events,
  hosts,
  restaurants,
  telemetryEvents,
} from "@shared/schema";
import { eq, and, or, desc, gte, inArray } from "drizzle-orm";
import { isAuthenticated } from "../unifiedAuth";
import { storage } from "../storage";
import { emailService } from "../emailService";
import { canEmailForTopic } from "../utils/notificationPreferences";
import { resolveCityTimeZoneSync } from "../services/cityTimeZone";
import {
  getPublicSlotGateConfigFromEnv,
  isSlotPublic,
} from "../services/publicSlotGate";
import { buildSlotDateTimes } from "../services/timeIntent";
import { dateKeyInZone } from "../services/dateKeys";
import Stripe from "stripe";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

type BookingRouteDependencies = {
  hasBusinessDistributionAccess: (userId: string) => Promise<boolean>;
};

/**
 * Booking Management Routes
 * - GET /api/bookings/my-truck - Get all bookings for user's food truck
 * - GET /api/bookings/my-host - Get all bookings for user's host locations
 * - POST /api/bookings/:bookingId/cancel - Cancel a booking (non-refundable)
 */
export function registerBookingRoutes(
  app: Express,
  { hasBusinessDistributionAccess }: BookingRouteDependencies,
) {
  const toDateKey = (value: unknown, timeZone?: string): string | null => {
    if (value instanceof Date) {
      const key = dateKeyInZone(value, timeZone || "America/Chicago");
      return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
    }
    const raw = String(value || "").trim();
    if (!raw) return null;
    const key = raw.includes("T") ? raw.split("T")[0] : raw;
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
  };

  // Lookup booking state by Stripe PaymentIntent (used by the client to poll after payment confirmation).
  app.get(
    "/api/bookings/payment-intent/:paymentIntentId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const paymentIntentId = String(req.params.paymentIntentId || "").trim();
        const truckId = String(req.query?.truckId || "").trim();
        if (!paymentIntentId) {
          return res.status(400).json({ message: "PaymentIntent ID required" });
        }
        if (!truckId) {
          return res.status(400).json({ message: "Truck ID required" });
        }

        const isOwner = await storage.verifyRestaurantOwnership(
          truckId,
          req.user.id,
          "manageParkingPass",
        );
        const isAdmin = [
          "admin",
          "duper_admin",
          "super_admin",
          "staff",
        ].includes(req.user?.userType || "");
        if (!isOwner && !isAdmin) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const rows: Array<{
          id: string;
          eventId: string;
          status: string;
          refundStatus: string | null;
          bookingConfirmedAt: Date | null;
          cancelledAt: Date | null;
        }> = await db
          .select({
            id: eventBookings.id,
            eventId: eventBookings.eventId,
            status: eventBookings.status,
            refundStatus: eventBookings.refundStatus,
            bookingConfirmedAt: eventBookings.bookingConfirmedAt,
            cancelledAt: eventBookings.cancelledAt,
          })
          .from(eventBookings)
          .where(
            and(
              eq(eventBookings.stripePaymentIntentId, paymentIntentId),
              eq(eventBookings.truckId, truckId),
            ),
          )
          .orderBy(desc(eventBookings.createdAt));

        if (rows.length === 0) {
          return res.json({ status: "pending", bookings: [] });
        }

        const hasConfirmed = rows.some((row) => row.status === "confirmed");
        if (hasConfirmed) {
          const confirmed = rows.filter((row) => row.status === "confirmed");
          return res.json({
            status: "confirmed",
            bookings: confirmed.map((row) => ({
              id: row.id,
              eventId: row.eventId,
              bookingConfirmedAt: row.bookingConfirmedAt,
            })),
          });
        }

        const allCredited = rows.every(
          (row) => row.status === "cancelled" && row.refundStatus === "credit",
        );
        if (allCredited) {
          return res.json({ status: "credited", bookings: [] });
        }

        return res.json({
          status: rows[0].status,
          bookings: rows.map((row) => ({
            id: row.id,
            eventId: row.eventId,
            bookingConfirmedAt: row.bookingConfirmedAt,
            cancelledAt: row.cancelledAt,
          })),
        });
      } catch (error) {
        console.error("Error checking booking by payment intent:", error);
        res.status(500).json({ message: "Failed to check booking status" });
      }
    },
  );

  // Cancel an in-progress checkout: releases pending holds and cancels the Stripe PaymentIntent (if possible).
  app.post(
    "/api/bookings/payment-intent/:paymentIntentId/cancel",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const paymentIntentId = String(req.params.paymentIntentId || "").trim();
        const truckId = String(req.query?.truckId || "").trim();
        if (!paymentIntentId) {
          return res.status(400).json({ message: "PaymentIntent ID required" });
        }
        if (!truckId) {
          return res.status(400).json({ message: "Truck ID required" });
        }

        const isOwner = await storage.verifyRestaurantOwnership(
          truckId,
          req.user.id,
          "manageParkingPass",
        );
        const isAdmin = [
          "admin",
          "duper_admin",
          "super_admin",
          "staff",
        ].includes(req.user?.userType || "");
        if (!isOwner && !isAdmin) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const rows: Array<{
          id: string;
          eventId: string;
          hostId: string | null;
          status: string;
          stripePaymentStatus: string | null;
          stripeTransferDestination: string | null;
        }> = await db
          .select({
            id: eventBookings.id,
            eventId: eventBookings.eventId,
            hostId: eventBookings.hostId,
            status: eventBookings.status,
            stripePaymentStatus: eventBookings.stripePaymentStatus,
            stripeTransferDestination: eventBookings.stripeTransferDestination,
          })
          .from(eventBookings)
          .where(
            and(
              eq(eventBookings.stripePaymentIntentId, paymentIntentId),
              eq(eventBookings.truckId, truckId),
            ),
          )
          .orderBy(desc(eventBookings.createdAt));

        if (rows.length === 0) {
          return res.json({ ok: true });
        }

        const hasConfirmed = rows.some((row) => row.status === "confirmed");
        if (hasConfirmed) {
          return res.status(409).json({
            message: "Booking already confirmed and cannot be cancelled.",
          });
        }

        const now = new Date();
        const pendingRows = rows.filter((row) => row.status === "pending");
        if (pendingRows.length === 0) {
          // Nothing to cancel (already cancelled/credited/etc.). Idempotent success.
          return res.json({ ok: true });
        }

        const accountIdFromRows =
          rows.find((row) => Boolean(row.stripeTransferDestination))
            ?.stripeTransferDestination ?? null;

        let stripeAccountId: string | null = accountIdFromRows;
        if (!stripeAccountId) {
          const first = rows[0];
          if (first?.hostId) {
            const [host] = await db
              .select({ stripeConnectAccountId: hosts.stripeConnectAccountId })
              .from(hosts)
              .where(eq(hosts.id, first.hostId));
            stripeAccountId = host?.stripeConnectAccountId || null;
          }
        }

        // Best effort cancel at Stripe so the user can't later complete the payment in another tab.
        if (stripe) {
          try {
            const intent = await stripe.paymentIntents.retrieve(
              paymentIntentId,
              {},
              stripeAccountId ? { stripeAccount: stripeAccountId } : undefined,
            );
            if (intent.status === "succeeded") {
              return res.status(409).json({
                message:
                  "Payment already completed. Please wait for booking confirmation.",
              });
            }
            if (intent.status !== "canceled") {
              await stripe.paymentIntents.cancel(
                paymentIntentId,
                {},
                stripeAccountId
                  ? { stripeAccount: stripeAccountId }
                  : undefined,
              );
            }
          } catch (stripeError) {
            console.error(
              "Error cancelling PaymentIntent (continuing to release holds):",
              stripeError,
            );
            // Continue; holds release is still valuable and webhook will no-op if payment never completes.
          }
        }

        const holdIds = pendingRows.map((row) => row.id);
        await db
          .update(eventBookings)
          .set({
            status: "cancelled",
            stripePaymentStatus: "cancelled",
            cancelledAt: now,
            cancellationReason: "Checkout cancelled",
            updatedAt: now,
          })
          .where(inArray(eventBookings.id, holdIds));

        // Best-effort: release any pending booking-fee promo reservation tied to this PaymentIntent.
        try {
          const userRecord = await storage.getUser(req.user.id);
          const settings = (userRecord?.accountSettings as any) || {};
          const promos = settings.promos || {};
          const bookingFee10 = promos.bookingFee10 || {};
          if (bookingFee10.pendingPaymentIntentId === paymentIntentId) {
            promos.bookingFee10 = {
              ...bookingFee10,
              pendingPaymentIntentId: null,
              pendingAt: null,
            };
            await storage.updateUser(req.user.id, {
              accountSettings: { ...settings, promos } as any,
            });
          }
        } catch {
          // ignore
        }

        res.json({ ok: true });
      } catch (error) {
        console.error("Error cancelling checkout:", error);
        res.status(500).json({ message: "Failed to cancel checkout" });
      }
    },
  );

  // Get all bookings for the user's food truck
  app.get("/api/bookings/my-truck", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;

      // Get user's restaurants (trucks)
      const userTrucks = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.ownerId, userId));

      if (userTrucks.length === 0) {
        return res.json([]);
      }

      const truckIds = userTrucks.map((t: (typeof userTrucks)[number]) => t.id);

      // Get all bookings for these trucks
      const bookings = await db
        .select({
          id: eventBookings.id,
          eventId: eventBookings.eventId,
          truckId: eventBookings.truckId,
          hostId: eventBookings.hostId,
          status: eventBookings.status,
          totalCents: eventBookings.totalCents,
          hostPriceCents: eventBookings.hostPriceCents,
          platformFeeCents: eventBookings.platformFeeCents,
          stripePaymentIntentId: eventBookings.stripePaymentIntentId,
          bookingConfirmedAt: eventBookings.bookingConfirmedAt,
          cancelledAt: eventBookings.cancelledAt,
          createdAt: eventBookings.createdAt,
          event: events,
          host: hosts,
        })
        .from(eventBookings)
        .innerJoin(events, eq(eventBookings.eventId, events.id))
        .innerJoin(hosts, eq(eventBookings.hostId, hosts.id))
        .where(
          or(...truckIds.map((id: string) => eq(eventBookings.truckId, id))),
        )
        .orderBy(desc(events.date));

      // Format the response
      const formattedBookings = bookings.map(
        (b: (typeof bookings)[number]) => ({
          id: b.id,
          eventId: b.eventId,
          truckId: b.truckId,
          hostId: b.hostId,
          status: b.status,
          totalCents: b.totalCents,
          hostPriceCents: b.hostPriceCents,
          platformFeeCents: b.platformFeeCents,
          stripePaymentIntentId: b.stripePaymentIntentId,
          bookingConfirmedAt: b.bookingConfirmedAt,
          cancelledAt: b.cancelledAt,
          createdAt: b.createdAt,
          event: {
            id: b.event.id,
            date: b.event.date,
            startTime: b.event.startTime,
            endTime: b.event.endTime,
            status: b.event.status,
            host: {
              businessName: b.host.businessName,
              address: b.host.address,
              locationType: b.host.locationType,
            },
          },
        }),
      );

      res.json(formattedBookings);
    } catch (error) {
      console.error("Error fetching truck bookings:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });

  // Get all bookings for the user's host locations
  app.get("/api/bookings/my-host", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;

      // Get user's host profile
      const userHosts = await db
        .select()
        .from(hosts)
        .where(eq(hosts.userId, userId));

      if (userHosts.length === 0) {
        return res.json([]);
      }

      const hostIds = userHosts.map((h: (typeof userHosts)[number]) => h.id);

      // Get all bookings for these host locations
      const bookings = await db
        .select({
          id: eventBookings.id,
          eventId: eventBookings.eventId,
          truckId: eventBookings.truckId,
          hostId: eventBookings.hostId,
          status: eventBookings.status,
          totalCents: eventBookings.totalCents,
          hostPriceCents: eventBookings.hostPriceCents,
          platformFeeCents: eventBookings.platformFeeCents,
          stripePaymentIntentId: eventBookings.stripePaymentIntentId,
          bookingConfirmedAt: eventBookings.bookingConfirmedAt,
          cancelledAt: eventBookings.cancelledAt,
          createdAt: eventBookings.createdAt,
          event: events,
          host: hosts,
          truck: restaurants,
        })
        .from(eventBookings)
        .innerJoin(events, eq(eventBookings.eventId, events.id))
        .innerJoin(hosts, eq(eventBookings.hostId, hosts.id))
        .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id))
        .where(or(...hostIds.map((id: string) => eq(eventBookings.hostId, id))))
        .orderBy(desc(events.date));

      // Format the response
      const formattedBookings = bookings.map(
        (b: (typeof bookings)[number]) => ({
          id: b.id,
          eventId: b.eventId,
          truckId: b.truckId,
          hostId: b.hostId,
          status: b.status,
          totalCents: b.totalCents,
          hostPriceCents: b.hostPriceCents,
          platformFeeCents: b.platformFeeCents,
          stripePaymentIntentId: b.stripePaymentIntentId,
          bookingConfirmedAt: b.bookingConfirmedAt,
          cancelledAt: b.cancelledAt,
          createdAt: b.createdAt,
          event: {
            id: b.event.id,
            date: b.event.date,
            startTime: b.event.startTime,
            endTime: b.event.endTime,
            status: b.event.status,
            host: {
              businessName: b.host.businessName,
              address: b.host.address,
              locationType: b.host.locationType,
            },
          },
          truck: {
            id: b.truck.id,
            name: b.truck.name,
            cuisineType: b.truck.cuisineType,
            imageUrl: b.truck.imageUrl,
          },
        }),
      );

      res.json(formattedBookings);
    } catch (error) {
      console.error("Error fetching host bookings:", error);
      res.status(500).json({ message: "Failed to fetch bookings" });
    }
  });

  // Truck manual schedule (public or owner view)
  app.get("/api/trucks/:truckId/manual-schedule", async (req: any, res) => {
    try {
      const { truckId } = req.params;
      const [truck] = await db
        .select({ id: restaurants.id, ownerId: restaurants.ownerId })
        .from(restaurants)
        .where(eq(restaurants.id, truckId));

      if (!truck) {
        return res.status(404).json({ message: "Truck not found" });
      }

      const ownerHasPremiumAccess = truck.ownerId
        ? await hasBusinessDistributionAccess(String(truck.ownerId))
        : false;

      let includePrivate = false;
      if (req.isAuthenticated?.()) {
        includePrivate = await storage.verifyRestaurantOwnership(
          truckId,
          req.user.id,
          "manageParkingPass",
        );
      }

      const entries = await storage.getTruckManualSchedules(truckId);
      const filtered = !ownerHasPremiumAccess
        ? []
        : includePrivate
          ? entries
          : entries.filter((entry) => entry.isPublic);

      res.json(filtered);
    } catch (error) {
      console.error("Error fetching manual schedule:", error);
      res.status(500).json({ message: "Failed to fetch schedule" });
    }
  });

  // Create manual schedule entry (owner only)
  app.post(
    "/api/trucks/:truckId/manual-schedule",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const hasAccess = await hasBusinessDistributionAccess(req.user.id);
        if (!hasAccess) {
          return res.status(402).json({
            message:
              "Premium subscription required to manage off-platform schedule.",
          });
        }

        const { truckId } = req.params;
        const isAuthorized = await storage.verifyRestaurantOwnership(
          truckId,
          req.user.id,
          "manageParkingPass",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only update schedules for trucks you own",
          });
        }

        const schema = z.object({
          date: z.string().min(1),
          startTime: z.string().min(1),
          endTime: z.string().min(1),
          address: z.string().min(1),
          locationName: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          notes: z.string().optional(),
          isPublic: z.boolean().optional(),
        });

        const parsed = schema.parse(req.body);
        const parsedDate = new Date(`${parsed.date}T00:00:00`);
        if (Number.isNaN(parsedDate.getTime())) {
          return res.status(400).json({ message: "Invalid date" });
        }

        const created = await storage.createTruckManualSchedule({
          truckId,
          date: parsedDate,
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          locationName: parsed.locationName || null,
          address: parsed.address,
          city: parsed.city || null,
          state: parsed.state || null,
          notes: parsed.notes || null,
          isPublic: parsed.isPublic ?? true,
        });

        try {
          await db.insert(telemetryEvents).values({
            eventName: "premium_manual_schedule_used",
            userId: req.user.id,
            properties: {
              truckId,
              scheduleId: created.id,
              date: parsed.date,
            },
          });
        } catch (trackingError) {
          console.warn("Failed to track manual schedule usage:", trackingError);
        }

        res.json(created);
      } catch (error) {
        console.error("Error creating manual schedule:", error);
        res.status(500).json({ message: "Failed to create schedule entry" });
      }
    },
  );

  // Delete manual schedule entry (owner only)
  app.delete(
    "/api/trucks/:truckId/manual-schedule/:scheduleId",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const hasAccess = await hasBusinessDistributionAccess(req.user.id);
        if (!hasAccess) {
          return res.status(402).json({
            message:
              "Premium subscription required to manage off-platform schedule.",
          });
        }

        const { truckId, scheduleId } = req.params;
        const isAuthorized = await storage.verifyRestaurantOwnership(
          truckId,
          req.user.id,
          "manageParkingPass",
        );
        if (!isAuthorized) {
          return res.status(403).json({
            message:
              "Unauthorized: You can only update schedules for trucks you own",
          });
        }

        await storage.deleteTruckManualSchedule(scheduleId, truckId);
        res.json({ message: "Schedule entry deleted" });
      } catch (error) {
        console.error("Error deleting manual schedule:", error);
        res.status(500).json({ message: "Failed to delete schedule entry" });
      }
    },
  );

  // Truck daily parking reports (owner or admin/staff)
  app.get(
    "/api/trucks/:truckId/parking-reports",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { truckId } = req.params;
        const isOwner = await storage.verifyRestaurantOwnership(
          truckId,
          req.user.id,
          "manageParkingPass",
        );
        const isAdmin = [
          "admin",
          "duper_admin",
          "super_admin",
          "staff",
        ].includes(req.user?.userType || "");
        if (!isOwner && !isAdmin) {
          return res
            .status(403)
            .json({ message: "Unauthorized to view reports" });
        }

        const parseDate = (value?: string) => {
          if (!value) return undefined;
          const parsed = new Date(`${value}T00:00:00`);
          return Number.isNaN(parsed.getTime()) ? undefined : parsed;
        };

        const startDate = parseDate(req.query?.startDate as string | undefined);
        let endDate = parseDate(req.query?.endDate as string | undefined);
        if (endDate) {
          endDate.setHours(23, 59, 59, 999);
        }

        const reports = await storage.getTruckParkingReports(truckId, {
          startDate,
          endDate,
        });
        res.json(reports);
      } catch (error) {
        console.error("Error fetching parking reports:", error);
        res.status(500).json({ message: "Failed to fetch reports" });
      }
    },
  );

  app.post(
    "/api/trucks/:truckId/parking-reports",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { truckId } = req.params;
        const isOwner = await storage.verifyRestaurantOwnership(
          truckId,
          req.user.id,
          "manageParkingPass",
        );
        const isAdmin = [
          "admin",
          "duper_admin",
          "super_admin",
          "staff",
        ].includes(req.user?.userType || "");
        if (!isOwner && !isAdmin) {
          return res
            .status(403)
            .json({ message: "Unauthorized to create reports" });
        }

        const optionalNumber = (schema: z.ZodTypeAny) =>
          z.preprocess(
            (value) =>
              value === "" || value === null || value === undefined
                ? undefined
                : value,
            schema.optional(),
          );

        const schema = z.object({
          date: z.string().min(1),
          sourceType: z.string().optional(),
          bookingId: z.string().optional(),
          manualScheduleId: z.string().optional(),
          hostId: z.string().optional(),
          locationName: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          rating: optionalNumber(z.coerce.number().int().min(1).max(5)),
          arrivalCleanliness: optionalNumber(
            z.coerce.number().int().min(1).max(5),
          ),
          customersServed: optionalNumber(z.coerce.number().int().min(0)),
          salesCents: optionalNumber(z.coerce.number().int().min(0)),
          notes: z.string().optional(),
        });

        const parsed = schema.parse(req.body);
        const parsedDate = new Date(`${parsed.date}T00:00:00`);
        if (Number.isNaN(parsedDate.getTime())) {
          return res.status(400).json({ message: "Invalid date" });
        }

        const sourceType =
          parsed.sourceType ||
          (parsed.bookingId
            ? "booking"
            : parsed.manualScheduleId
              ? "manual"
              : "custom");

        const created = await storage.createTruckParkingReport({
          truckId,
          date: parsedDate,
          sourceType,
          bookingId: parsed.bookingId || null,
          manualScheduleId: parsed.manualScheduleId || null,
          hostId: parsed.hostId || null,
          locationName: parsed.locationName || null,
          address: parsed.address || null,
          city: parsed.city || null,
          state: parsed.state || null,
          rating: parsed.rating ?? null,
          arrivalCleanliness: parsed.arrivalCleanliness ?? null,
          customersServed: parsed.customersServed ?? null,
          salesCents: parsed.salesCents ?? null,
          notes: parsed.notes || null,
        });

        res.json(created);
      } catch (error) {
        console.error("Error creating parking report:", error);
        res.status(500).json({ message: "Failed to save report" });
      }
    },
  );

  // Public profile schedule (booked + accepted events + manual)
  app.get("/api/bookings/truck/:truckId/schedule", async (req: any, res) => {
    try {
      const { truckId } = req.params;

      const [truck] = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          ownerId: restaurants.ownerId,
        })
        .from(restaurants)
        .where(eq(restaurants.id, truckId));

      if (!truck) {
        return res.status(404).json({ message: "Truck not found" });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const isAdmin = ["admin", "duper_admin", "super_admin", "staff"].includes(
        req.user?.userType || "",
      );
      let includePending = false;
      const ownerHasPremiumAccess = truck.ownerId
        ? await hasBusinessDistributionAccess(String(truck.ownerId))
        : false;
      if (req.isAuthenticated?.() && req.user?.id) {
        const isOwner = await storage.verifyRestaurantOwnership(
          truckId,
          req.user.id,
          "manageParkingPass",
        );
        includePending = isAdmin || (isOwner && ownerHasPremiumAccess);
      }

      const bookingStatuses = includePending
        ? (["confirmed", "pending"] as const)
        : (["confirmed"] as const);

      const bookingRows = await db
        .select({
          bookingId: eventBookings.id,
          eventId: eventBookings.eventId,
          status: eventBookings.status,
          bookingConfirmedAt: eventBookings.bookingConfirmedAt,
          createdAt: eventBookings.createdAt,
          slotType: eventBookings.slotType,
          event: events,
          host: hosts,
        })
        .from(eventBookings)
        .innerJoin(events, eq(eventBookings.eventId, events.id))
        .innerJoin(hosts, eq(eventBookings.hostId, hosts.id))
        .where(
          and(
            eq(eventBookings.truckId, truckId),
            inArray(eventBookings.status, bookingStatuses as any),
            or(eq(events.status, "open"), eq(events.status, "booked")),
            gte(events.date, today),
          ),
        )
        .orderBy(desc(events.date));

      const acceptedInterestRows = await db
        .select({
          eventId: eventInterests.eventId,
          status: eventInterests.status,
          createdAt: eventInterests.createdAt,
          event: events,
          host: hosts,
        })
        .from(eventInterests)
        .innerJoin(events, eq(eventInterests.eventId, events.id))
        .innerJoin(hosts, eq(events.hostId, hosts.id))
        .where(
          and(
            eq(eventInterests.truckId, truckId),
            eq(eventInterests.status, "accepted"),
            or(eq(events.status, "open"), eq(events.status, "booked")),
            gte(events.date, today),
          ),
        )
        .orderBy(desc(events.date));

      const bookingEventIds = new Set(
        bookingRows.map((row: (typeof bookingRows)[number]) => row.eventId),
      );

      const gate = getPublicSlotGateConfigFromEnv();
      const isPublicBookingSlot = (row: (typeof bookingRows)[number]) => {
        const timeZone = resolveCityTimeZoneSync({
          city: (row.host as any)?.city ?? null,
          state: (row.host as any)?.state ?? null,
        });
        const interval = buildSlotDateTimes({
          timeZone,
          date: new Date(row.event.date as any),
          startTime: String(row.event.startTime || ""),
          endTime: String(row.event.endTime || ""),
        });
        if (!interval) return false;
        const lastConfirmedAtUtc = new Date(
          (row.event as any).lastConfirmedAt ??
            row.bookingConfirmedAt ??
            row.createdAt ??
            (row.event as any).updatedAt ??
            row.event.date ??
            Date.now(),
        );
        return isSlotPublic({
          slot: {
            source: "parking_pass_booking",
            status: row.status === "confirmed" ? "confirmed" : "tentative",
            startsAtUtc: interval.startUtc,
            endsAtUtc: interval.endUtc,
            lastConfirmedAtUtc,
          },
          ...gate,
        });
      };

      const isPublicAcceptedSlot = (
        row: (typeof acceptedInterestRows)[number],
      ) => {
        const timeZone = resolveCityTimeZoneSync({
          city: (row.host as any)?.city ?? null,
          state: (row.host as any)?.state ?? null,
        });
        const interval = buildSlotDateTimes({
          timeZone,
          date: new Date(row.event.date as any),
          startTime: String(row.event.startTime || ""),
          endTime: String(row.event.endTime || ""),
        });
        if (!interval) return false;
        const lastConfirmedAtUtc = new Date(
          (row.event as any).lastConfirmedAt ??
            row.createdAt ??
            (row.event as any).updatedAt ??
            row.event.date ??
            Date.now(),
        );
        return isSlotPublic({
          slot: {
            source: "parking_pass_booking",
            status: "confirmed",
            startsAtUtc: interval.startUtc,
            endsAtUtc: interval.endUtc,
            lastConfirmedAtUtc,
          },
          ...gate,
        });
      };

      const schedule = [
        ...bookingRows
          .filter((row: (typeof bookingRows)[number]) =>
            includePending ? true : isPublicBookingSlot(row),
          )
          .map((row: (typeof bookingRows)[number]) => ({
            type: "booking",
            status: row.status,
            createdAt: row.createdAt,
            bookingConfirmedAt: row.bookingConfirmedAt,
            bookingId: row.bookingId,
            slotType: row.slotType,
            event: {
              id: row.event.id,
              date:
                toDateKey(
                  row.event.date,
                  resolveCityTimeZoneSync({
                    city: (row.host as any)?.city ?? null,
                    state: (row.host as any)?.state ?? null,
                  }),
                ) ?? row.event.date,
              startTime: row.event.startTime,
              endTime: row.event.endTime,
              status: row.event.status,
              hostPriceCents: row.event.hostPriceCents,
              requiresPayment: row.event.requiresPayment,
              lastConfirmedAt: (row.event as any).lastConfirmedAt ?? null,
            },
            host: {
              id: row.host.id,
              businessName: row.host.businessName,
              address: row.host.address,
              locationType: row.host.locationType,
            },
          })),
        ...acceptedInterestRows
          .filter(
            (row: (typeof acceptedInterestRows)[number]) =>
              !bookingEventIds.has(row.eventId),
          )
          .filter((row: (typeof acceptedInterestRows)[number]) =>
            includePending ? true : isPublicAcceptedSlot(row),
          )
          .map((row: (typeof acceptedInterestRows)[number]) => ({
            type: "accepted_interest",
            status: row.status,
            createdAt: row.createdAt,
            event: {
              id: row.event.id,
              date:
                toDateKey(
                  row.event.date,
                  resolveCityTimeZoneSync({
                    city: (row.host as any)?.city ?? null,
                    state: (row.host as any)?.state ?? null,
                  }),
                ) ?? row.event.date,
              startTime: row.event.startTime,
              endTime: row.event.endTime,
              status: row.event.status,
              hostPriceCents: row.event.hostPriceCents,
              requiresPayment: row.event.requiresPayment,
              lastConfirmedAt: (row.event as any).lastConfirmedAt ?? null,
            },
            host: {
              businessName: row.host.businessName,
              address: row.host.address,
              locationType: row.host.locationType,
            },
          })),
      ];

      const manualEntries = await storage.getTruckManualSchedules(truckId);
      const isPublicManualSlot = (entry: (typeof manualEntries)[number]) => {
        const timeZone = resolveCityTimeZoneSync({
          city: (entry as any)?.city ?? null,
          state: (entry as any)?.state ?? null,
        });
        const interval =
          entry.startTime && entry.endTime
            ? buildSlotDateTimes({
                timeZone,
                date: new Date(entry.date as any),
                startTime: String(entry.startTime || ""),
                endTime: String(entry.endTime || ""),
              })
            : null;
        if (!interval) return false;
        const lastConfirmedAtUtc = new Date(
          (entry as any).lastConfirmedAt ??
            entry.createdAt ??
            entry.date ??
            Date.now(),
        );
        return isSlotPublic({
          slot: {
            source: "manual",
            status: "confirmed",
            startsAtUtc: interval.startUtc,
            endsAtUtc: interval.endUtc,
            lastConfirmedAtUtc,
          },
          ...gate,
        });
      };

      const manualSchedule = manualEntries
        .filter(() => ownerHasPremiumAccess)
        .filter((entry) => entry.isPublic)
        .filter((entry) => entry.date >= today)
        .filter((entry) => (includePending ? true : isPublicManualSlot(entry)))
        .map((entry) => ({
          type: "manual",
          status: "manual",
          createdAt: entry.createdAt,
          manual: {
            id: entry.id,
            date:
              toDateKey(
                entry.date,
                resolveCityTimeZoneSync({
                  city: (entry as any)?.city ?? null,
                  state: (entry as any)?.state ?? null,
                }),
              ) ?? entry.date,
            startTime: entry.startTime,
            endTime: entry.endTime,
            locationName: entry.locationName,
            address: entry.address,
            city: entry.city,
            state: entry.state,
            notes: entry.notes,
            lastConfirmedAt: (entry as any).lastConfirmedAt ?? null,
          },
        }));

      const combined = [...schedule, ...manualSchedule].sort((a, b) => {
        const dateA =
          a.type === "manual"
            ? new Date(a.manual.date).getTime()
            : new Date(a.event.date).getTime();
        const dateB =
          b.type === "manual"
            ? new Date(b.manual.date).getTime()
            : new Date(b.event.date).getTime();
        return dateB - dateA;
      });

      res.json({
        truck: { id: truck.id, name: truck.name },
        schedule: combined,
      });
    } catch (error) {
      console.error("Error fetching truck schedule:", error);
      res.status(500).json({ message: "Failed to fetch schedule" });
    }
  });

  // Admin/staff-only: booking request from public profile
  app.post("/api/trucks/:truckId/booking-request", async (req: any, res) => {
    try {
      const { truckId } = req.params;

      const schema = z.object({
        name: z.string().min(1),
        email: z.string().email(),
        phone: z.string().min(5),
        expectedGuests: z.string().min(1),
        date: z.string().min(1),
        startTime: z.string().min(1),
        endTime: z.string().min(1),
        location: z.string().min(1),
        notes: z.string().optional(),
      });

      const parsed = schema.parse(req.body);

      const truck = await storage.getRestaurant(truckId);
      if (!truck) {
        return res.status(404).json({ message: "Truck not found" });
      }

      const owner = await storage.getUser(truck.ownerId);
      if (!owner || !owner.email) {
        return res
          .status(400)
          .json({ message: "Truck owner email not available" });
      }

      const subject = `New booking request for ${truck.name}`;
      const html = `
          <h2>New booking request for ${truck.name}</h2>
          <p><strong>Requester:</strong> ${parsed.name}</p>
          <p><strong>Email:</strong> ${parsed.email}</p>
          <p><strong>Phone:</strong> ${parsed.phone}</p>
          <p><strong>Expected Guests:</strong> ${parsed.expectedGuests}</p>
          <p><strong>Date:</strong> ${parsed.date}</p>
          <p><strong>Time:</strong> ${parsed.startTime} - ${parsed.endTime}</p>
          <p><strong>Location:</strong> ${parsed.location}</p>
          ${parsed.notes ? `<p><strong>Notes:</strong> ${parsed.notes}</p>` : ""}
        `;

      if (canEmailForTopic((owner as any).accountSettings, "businessMessages")) {
        await emailService.sendBasicEmail(owner.email, subject, html);
      }

      if (!process.env.TWILIO_ACCOUNT_SID) {
        console.warn(
          "SMS not configured for booking requests (missing TWILIO_ACCOUNT_SID).",
        );
      }

      await storage.createTelemetryEvent({
        eventName: "truck_booking_request_created",
        userId: req.user?.id || null,
        properties: {
          truckId,
          requesterEmail: parsed.email,
          expectedGuests: parsed.expectedGuests,
        },
      });

      res.json({ message: "Request sent" });
    } catch (error: any) {
      console.error("Error sending booking request:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid request data", errors: error.errors });
      }
      res.status(500).json({ message: "Failed to send request" });
    }
  });
}
