import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  eventBookings,
  eventInterests,
  events,
  eventSeries,
  hosts,
  parkingPassArrivalVersions,
  parkingPassCancellationOperations,
  parkingPassPurchases,
  restaurants,
  telemetryEvents,
  users,
} from "@shared/schema";
import { eq, and, or, desc, gte, inArray } from "drizzle-orm";
import { isAuthenticated } from "../unifiedAuth";
import { storage } from "../storage";
import { emailService } from "../emailService";
import { canEmailForTopic } from "../utils/notificationPreferences";
import { resolveCityTimeZoneStrict } from "../services/cityTimeZone";
import { buildSlotDateTimes } from "../services/timeIntent";
import {
  dateKeyFromUnknown,
  dateKeyInZone,
  utcDateFromDateKey,
} from "../services/dateKeys";
import {
  normalizePersistedIanaTimeZone,
  persistedVenueTimeZoneSql,
  resolvePersistedEventServiceTimeZone,
} from "../services/persistedServiceTimeZone";
import Stripe from "stripe";
import { isInternalTeamUserType } from "../roleAccess";
import { isTruckOperatingPlanRowPublic } from "../services/truckOperatingPlan";
import { resolveStoredFoodBusinessType } from "@shared/businessTypes";
import { resolvePublicProfileVisibility } from "../publicProfiles/publicProfileUtils";
import { toPublicRestaurantListingWithVisibility } from "../publicProfiles/toPublicRestaurantListingWithVisibility";
import { deriveProfileEvidenceQuarantineVisibility } from "../services/profileEvidenceQuarantine";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";
import {
  acknowledgeProtectedParkingPassArrival,
  cancelParkingPassLines,
  correctProtectedParkingPassArrival,
  getParkingPassCreditBalanceCents,
  getProtectedParkingPassArrival,
  ParkingPassBookingError,
  serializeParkingPassCancellationOperation,
} from "../services/parkingPassBookingService";

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const escapeHtml = (value: unknown) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

type BookingRouteDependencies = {
  hasCompleteProfileAccess: (userId: string) => Promise<boolean>;
};

/**
 * Booking Management Routes
 * - GET /api/bookings/my-truck - Get all bookings for user's food truck
 * - GET /api/bookings/my-host - Get all bookings for user's host locations
 * - POST /api/bookings/:bookingId/cancel - Cancel a booking (non-refundable)
 */
export function registerBookingRoutes(
  app: Express,
  { hasCompleteProfileAccess }: BookingRouteDependencies,
) {
  const sendParkingPassError = (res: any, error: unknown) => {
    if (error instanceof ParkingPassBookingError) {
      return res.status(error.statusCode).json({
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    }
    console.error("[parking-pass] Route failed:", error);
    return res.status(500).json({ message: "Parking Pass request failed" });
  };

  const bookingActor = async (req: any, bookingId: string) => {
    const [booking] = await db
      .select({ truckId: eventBookings.truckId })
      .from(eventBookings)
      .where(eq(eventBookings.id, bookingId))
      .limit(1);
    const canManageTruck = booking
      ? await storage.verifyRestaurantOwnership(
          booking.truckId,
          req.user.id,
          "manageParkingPass",
        )
      : false;
    return {
      userId: req.user.id,
      userType: req.user?.userType,
      canManageTruck,
    };
  };

  const toDateKey = (value: unknown, timeZone?: string): string | null => {
    const normalizedTimeZone = normalizePersistedIanaTimeZone(timeZone);
    if (value instanceof Date && !normalizedTimeZone) return null;
    return dateKeyFromUnknown(value, normalizedTimeZone || "UTC");
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

        const [purchase] = await db
          .select()
          .from(parkingPassPurchases)
          .where(
            and(
              eq(parkingPassPurchases.stripePaymentIntentId, paymentIntentId),
              eq(parkingPassPurchases.truckId, truckId),
            ),
          )
          .limit(1);

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

        if (purchase) {
          const operations = await db
            .select()
            .from(parkingPassCancellationOperations)
            .where(
              eq(parkingPassCancellationOperations.purchaseId, purchase.id),
            )
            .orderBy(desc(parkingPassCancellationOperations.createdAt));
          return res.json({
            purchaseId: purchase.id,
            status: purchase.status,
            settlementStatus: purchase.settlementStatus,
            chargedAmountCents: purchase.chargedAmountCents,
            refundedAmountCents: purchase.refundedAmountCents,
            cancellationCreditIssuedCents:
              purchase.cancellationCreditIssuedCents,
            cancellationOperations: operations.map(
              serializeParkingPassCancellationOperation,
            ),
            bookings: rows.map((row) => ({
              id: row.id,
              eventId: row.eventId,
              status: row.status,
              bookingConfirmedAt: row.bookingConfirmedAt,
              cancelledAt: row.cancelledAt,
              refundStatus: row.refundStatus,
            })),
          });
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

        const [purchase] = await db
          .select()
          .from(parkingPassPurchases)
          .where(
            and(
              eq(parkingPassPurchases.stripePaymentIntentId, paymentIntentId),
              eq(parkingPassPurchases.truckId, truckId),
            ),
          )
          .limit(1);
        if (purchase) {
          if (purchase.status === "confirmed") {
            return res.status(409).json({
              message:
                "Payment already completed. Refresh before choosing a confirmed-booking cancellation remedy.",
            });
          }
          const requestId = String(
            req.headers["idempotency-key"] ||
              req.body?.requestId ||
              `checkout-cancel:${paymentIntentId}:${req.user.id}`,
          ).trim();
          const operation = await cancelParkingPassLines({
            purchaseId: purchase.id,
            requestId,
            reason: "Checkout cancelled before payment capture",
            actor: {
              userId: req.user.id,
              userType: req.user?.userType,
              canManageTruck: isOwner,
            },
            stripe,
          });
          return res.json({
            ok: true,
            operation: serializeParkingPassCancellationOperation(operation),
          });
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

        return res.status(409).json({
          code: "legacy_payment_state_unbound",
          message:
            "This historical checkout is not bound to a durable purchase aggregate. Its provider and capacity state must be reconciled before it can be closed.",
        });
      } catch (error) {
        console.error("Error cancelling checkout:", error);
        res.status(500).json({ message: "Failed to cancel checkout" });
      }
    },
  );

  app.get(
    "/api/parking-pass/credits/balance",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const balanceCents = await getParkingPassCreditBalanceCents(
          req.user.id,
        );
        res.json({
          balanceCents,
          restriction:
            "May be applied only to MealScout platform fees on a future Parking Pass purchase.",
        });
      } catch (error) {
        sendParkingPassError(res, error);
      }
    },
  );

  app.post(
    "/api/parking-pass/purchases/:purchaseId/cancel",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const purchaseId = String(req.params.purchaseId || "").trim();
        const [purchase] = await db
          .select({ truckId: parkingPassPurchases.truckId })
          .from(parkingPassPurchases)
          .where(eq(parkingPassPurchases.id, purchaseId))
          .limit(1);
        const canManageTruck = purchase
          ? await storage.verifyRestaurantOwnership(
              purchase.truckId,
              req.user.id,
              "manageParkingPass",
            )
          : false;
        const operation = await cancelParkingPassLines({
          purchaseId,
          bookingLineIds: Array.isArray(req.body?.bookingLineIds)
            ? req.body.bookingLineIds.map(String)
            : undefined,
          requestId: String(
            req.headers["idempotency-key"] || req.body?.requestId || "",
          ).trim(),
          reason: String(req.body?.reason || "").trim(),
          actor: {
            userId: req.user.id,
            userType: req.user?.userType,
            canManageTruck,
          },
          stripe,
        });
        res.json({
          operation: serializeParkingPassCancellationOperation(operation),
        });
      } catch (error) {
        sendParkingPassError(res, error);
      }
    },
  );

  app.get(
    "/api/bookings/:bookingId/arrival",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const bookingId = String(req.params.bookingId || "").trim();
        const actor = await bookingActor(req, bookingId);
        res.json(await getProtectedParkingPassArrival(bookingId, actor));
      } catch (error) {
        sendParkingPassError(res, error);
      }
    },
  );

  app.post(
    "/api/bookings/:bookingId/arrival/corrections",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const bookingId = String(req.params.bookingId || "").trim();
        const actor = await bookingActor(req, bookingId);
        const parseOptionalDate = (value: unknown) => {
          if (value === undefined || value === null || value === "") {
            return undefined;
          }
          const date = new Date(String(value));
          if (Number.isNaN(date.getTime())) {
            throw new ParkingPassBookingError(
              400,
              "invalid_arrival_time",
              "Arrival start and end must be valid timestamps.",
            );
          }
          return date;
        };
        const version = await correctProtectedParkingPassArrival({
          bookingId,
          actor,
          idempotencyKey: String(
            req.headers["idempotency-key"] || req.body?.requestId || "",
          ).trim(),
          reason: String(req.body?.reason || ""),
          patch: {
            address: req.body?.address,
            city: req.body?.city,
            stateCode: req.body?.stateCode,
            latitude: req.body?.latitude,
            longitude: req.body?.longitude,
            startAt: parseOptionalDate(req.body?.startAt),
            endAt: parseOptionalDate(req.body?.endAt),
            accessInstructions: req.body?.accessInstructions,
            safetyInstructions: req.body?.safetyInstructions,
          },
        });
        res.status(202).json({ version });
      } catch (error) {
        sendParkingPassError(res, error);
      }
    },
  );

  app.post(
    "/api/bookings/:bookingId/arrival/:versionId/acknowledge",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const bookingId = String(req.params.bookingId || "").trim();
        const actor = await bookingActor(req, bookingId);
        const version = await acknowledgeProtectedParkingPassArrival({
          bookingId,
          versionId: String(req.params.versionId || "").trim(),
          actor,
          idempotencyKey: String(
            req.headers["idempotency-key"] || req.body?.requestId || "",
          ).trim(),
        });
        res.json({ version });
      } catch (error) {
        sendParkingPassError(res, error);
      }
    },
  );

  // Get all bookings for the user's food truck
  app.get("/api/bookings/my-truck", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const requestedTruckId = String(req.query?.truckId || "").trim();

      let truckIds: string[] = [];
      if (requestedTruckId) {
        const authorized =
          isInternalTeamUserType(req.user?.userType) ||
          (await storage.verifyRestaurantOwnership(
            requestedTruckId,
            userId,
            "manageParkingPass",
          ));
        if (!authorized) {
          return res.status(403).json({ message: "Not authorized" });
        }
        truckIds = [requestedTruckId];
      } else {
        // Preserve the existing account-wide response for callers that do not
        // select a truck explicitly.
        const userTrucks = await db
          .select({ id: restaurants.id })
          .from(restaurants)
          .where(eq(restaurants.ownerId, userId));
        truckIds = userTrucks.map((truck: (typeof userTrucks)[number]) => truck.id);
      }

      if (truckIds.length === 0) return res.json([]);

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
          purchaseId: eventBookings.purchaseId,
          arrivalState: eventBookings.arrivalState,
          currentArrivalVersionId: eventBookings.currentArrivalVersionId,
          pendingArrivalVersionId: eventBookings.pendingArrivalVersionId,
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
          purchaseId: b.purchaseId,
          arrivalState: b.arrivalState,
          currentArrivalVersionId: b.currentArrivalVersionId,
          pendingArrivalVersionId: b.pendingArrivalVersionId,
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
          purchaseId: eventBookings.purchaseId,
          arrivalState: eventBookings.arrivalState,
          currentArrivalVersionId: eventBookings.currentArrivalVersionId,
          pendingArrivalVersionId: eventBookings.pendingArrivalVersionId,
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
          purchaseId: b.purchaseId,
          arrivalState: b.arrivalState,
          currentArrivalVersionId: b.currentArrivalVersionId,
          pendingArrivalVersionId: b.pendingArrivalVersionId,
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
      res.setHeader("Cache-Control", "no-store");
      const truck = await storage.getRestaurant(truckId);

      if (
        !truck ||
        resolveStoredFoodBusinessType(truck) !== "food_truck"
      ) {
        return res.status(404).json({ message: "Truck not found" });
      }

      const truckOwner = truck.ownerId
        ? await storage.getUser(String(truck.ownerId))
        : null;
      if (!truckOwner || truckOwner.isDisabled !== false) {
        return res.status(404).json({ message: "Truck not found" });
      }

      const ownerHasProfileAccess = truck.ownerId
        ? await hasCompleteProfileAccess(String(truck.ownerId))
        : false;

      let includePrivate = false;
      if (req.isAuthenticated?.()) {
        includePrivate = await storage.verifyRestaurantOwnership(
          truckId,
          req.user.id,
          "manageParkingPass",
        );
      }
      if (!includePrivate) {
        const publicTruck =
          truck.isActive === true && isPublicBusinessVisible(truck)
            ? await toPublicRestaurantListingWithVisibility(truck)
            : null;
        if (
          !(publicTruck as any)?.id ||
          deriveProfileEvidenceQuarantineVisibility(truck).isQuarantined
        ) {
          return res.status(404).json({ message: "Truck not found" });
        }
      }

      const entries = await storage.getTruckManualSchedules(truckId);
      const now = new Date();
      const filtered = !ownerHasProfileAccess
        ? []
        : includePrivate
          ? entries
          : entries.filter((entry) =>
              isTruckOperatingPlanRowPublic(
                {
                  sourceKind: "manual",
                  stopId: entry.id,
                  date: entry.date,
                  startTime: entry.startTime,
                  endTime: entry.endTime,
                  sourceStatus: entry.status,
                  isPublic: entry.isPublic,
                  locationName: entry.locationName,
                  address: entry.address,
                  city: entry.city,
                  state: entry.state,
                  timezone: (entry as any).timezone,
                  updatedAt: entry.updatedAt,
                  lastConfirmedAt: (entry as any).lastConfirmedAt,
                  expiresAt: (entry as any).expiresAt,
                  sourceType: (entry as any).sourceType,
                  sourceConfidence: (entry as any).sourceConfidence,
                  ownerSubmittedEquivalent: (entry as any).ownerSubmittedEquivalent,
                  notice: entry.notes,
                  mapEligible: (entry as any).mapEligible,
                  liveFeedEligible: (entry as any).liveFeedEligible,
                },
                now,
              ),
            );

      res.json(
        includePrivate
          ? filtered
          : filtered.map((entry) => ({
              id: entry.id,
              date: entry.date,
              startTime: entry.startTime,
              endTime: entry.endTime,
              locationName: entry.locationName,
              address: entry.address,
              city: entry.city,
              state: entry.state,
              notes: entry.notes,
              status: entry.status,
            })),
      );
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
        const hasAccess = await hasCompleteProfileAccess(req.user.id);
        if (!hasAccess) {
          return res.status(402).json({
            message:
              "Profile access could not be verified for schedule management.",
          });
        }

        const { truckId } = req.params;
        const truck = await storage.getRestaurant(truckId);
        if (
          !truck ||
          resolveStoredFoodBusinessType(truck) !== "food_truck" ||
          !truck.isActive
        ) {
          return res.status(404).json({ message: "Truck not found" });
        }
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
          city: z.string().trim().min(1),
          state: z.string().trim().min(2),
          notes: z.string().optional(),
          isPublic: z.boolean().optional(),
        });

        const parsed = schema.parse(req.body);
        const timeZone = await resolveCityTimeZoneStrict({
          city: parsed.city || null,
          state: parsed.state || null,
        });
        if (!timeZone) {
          return res.status(409).json({
            code: "venue_timezone_unavailable",
            message:
              "This manual stop needs one valid persisted city timezone before it can be scheduled.",
          });
        }
        const interval = buildSlotDateTimes({
          timeZone,
          date: parsed.date,
          startTime: parsed.startTime,
          endTime: parsed.endTime,
        });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(parsed.date) || !interval) {
          return res.status(400).json({ message: "Invalid date" });
        }

        const created = await storage.createTruckManualSchedule({
          truckId,
          date: utcDateFromDateKey(parsed.date),
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          locationName: parsed.locationName || null,
          address: parsed.address,
          city: parsed.city || null,
          state: parsed.state || null,
          notes: parsed.notes || null,
          isPublic: parsed.isPublic ?? true,
          status: "confirmed",
          timezone: timeZone,
          sourceType: "owner_manual",
          sourceConfidence: "confirmed",
          ownerSubmittedEquivalent: true,
          expiresAt: interval.endUtc,
          lastConfirmedAt: new Date(),
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
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid schedule details" });
        }
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
        const hasAccess = await hasCompleteProfileAccess(req.user.id);
        if (!hasAccess) {
          return res.status(402).json({
            message:
              "Profile access could not be verified for schedule management.",
          });
        }

        const { truckId, scheduleId } = req.params;
        const truck = await storage.getRestaurant(truckId);
        if (
          !truck ||
          resolveStoredFoodBusinessType(truck) !== "food_truck" ||
          !truck.isActive
        ) {
          return res.status(404).json({ message: "Truck not found" });
        }
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
          rating: optionalNumber(z.coerce.number().int().min(0).max(100)),
          arrivalCleanliness: optionalNumber(
            z.coerce.number().int().min(0).max(100),
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
      res.setHeader("Cache-Control", "no-store");

      const [truck] = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          ownerId: restaurants.ownerId,
          businessType: restaurants.businessType,
          isFoodTruck: restaurants.isFoodTruck,
          isActive: restaurants.isActive,
          rawData: restaurants.rawData,
          ownerDisabled: users.isDisabled,
        })
        .from(restaurants)
        .innerJoin(users, eq(restaurants.ownerId, users.id))
        .where(eq(restaurants.id, truckId));

      const publicTruck = truck
        ? await toPublicRestaurantListingWithVisibility(truck)
        : null;
      if (
        !truck ||
        truck.ownerDisabled !== false ||
        !(publicTruck as any)?.id ||
        !isPublicBusinessVisible(truck) ||
        deriveProfileEvidenceQuarantineVisibility(truck).isQuarantined ||
        resolveStoredFoodBusinessType(truck) !== "food_truck"
      ) {
        return res.status(404).json({ message: "Truck not found" });
      }

      const queryStart = new Date();
      queryStart.setUTCHours(0, 0, 0, 0);
      queryStart.setUTCDate(queryStart.getUTCDate() - 1);

      const isAdmin = ["admin", "duper_admin", "super_admin", "staff"].includes(
        req.user?.userType || "",
      );
      let includePending = false;
      const ownerHasProfileAccess = truck.ownerId
        ? await hasCompleteProfileAccess(String(truck.ownerId))
        : false;
      if (req.isAuthenticated?.() && req.user?.id) {
        const isOwner = await storage.verifyRestaurantOwnership(
          truckId,
          req.user.id,
          "manageParkingPass",
        );
        includePending = isAdmin || (isOwner && ownerHasProfileAccess);
      }
      if (!truck.isActive && !includePending) {
        return res.status(404).json({ message: "Truck not found" });
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
          purchaseId: eventBookings.purchaseId,
          settlementTopology: eventBookings.settlementTopology,
          publicLocationConsentSnapshot:
            eventBookings.publicLocationConsentSnapshot,
          arrivalState: eventBookings.arrivalState,
          currentArrivalVersionId: eventBookings.currentArrivalVersionId,
          pendingArrivalVersionId: eventBookings.pendingArrivalVersionId,
          purchaseStatus: parkingPassPurchases.status,
          purchaseSettlementStatus: parkingPassPurchases.settlementStatus,
          currentArrivalId: parkingPassArrivalVersions.id,
          currentArrivalBookingId: parkingPassArrivalVersions.bookingId,
          currentArrivalState: parkingPassArrivalVersions.state,
          currentArrivalAddress: parkingPassArrivalVersions.address,
          currentArrivalCity: parkingPassArrivalVersions.city,
          currentArrivalStateCode: parkingPassArrivalVersions.stateCode,
          currentArrivalStartAt: parkingPassArrivalVersions.startAt,
          currentArrivalEndAt: parkingPassArrivalVersions.endAt,
          currentArrivalAcknowledgedAt:
            parkingPassArrivalVersions.acknowledgedAt,
          timezone: eventSeries.timezone,
          venueTimeZone: persistedVenueTimeZoneSql(hosts.city, hosts.state),
          event: events,
          host: hosts,
          hostOwnerDisabled: users.isDisabled,
          hostPublicProfileSettings: users.publicProfileSettings,
        })
        .from(eventBookings)
        .innerJoin(events, eq(eventBookings.eventId, events.id))
        .innerJoin(hosts, eq(events.hostId, hosts.id))
        .innerJoin(users, eq(hosts.userId, users.id))
        .leftJoin(
          parkingPassPurchases,
          eq(eventBookings.purchaseId, parkingPassPurchases.id),
        )
        .leftJoin(
          parkingPassArrivalVersions,
          and(
            eq(
              parkingPassArrivalVersions.id,
              eventBookings.currentArrivalVersionId,
            ),
            eq(parkingPassArrivalVersions.bookingId, eventBookings.id),
          ),
        )
        .leftJoin(eventSeries, eq(events.seriesId, eventSeries.id))
        .where(
          and(
            eq(eventBookings.truckId, truckId),
            inArray(eventBookings.status, bookingStatuses as any),
            inArray(events.status, ["open", "booked", "filled"]),
            gte(events.date, queryStart),
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
          seriesId: events.seriesId,
          seriesTimeZone: eventSeries.timezone,
          venueTimeZone: persistedVenueTimeZoneSql(hosts.city, hosts.state),
          hostOwnerDisabled: users.isDisabled,
          hostPublicProfileSettings: users.publicProfileSettings,
        })
        .from(eventInterests)
        .innerJoin(events, eq(eventInterests.eventId, events.id))
        .leftJoin(eventSeries, eq(events.seriesId, eventSeries.id))
        .innerJoin(hosts, eq(events.hostId, hosts.id))
        .innerJoin(users, eq(hosts.userId, users.id))
        .where(
          and(
            eq(eventInterests.truckId, truckId),
            eq(eventInterests.status, "accepted"),
            or(eq(events.status, "open"), eq(events.status, "booked")),
            gte(events.date, queryStart),
          ),
        )
        .orderBy(desc(events.date));

      const bookingEventIds = new Set(
        bookingRows.map((row: (typeof bookingRows)[number]) => row.eventId),
      );

      const isPublicBookingSlot = (row: (typeof bookingRows)[number]) => {
        if (
          row.hostOwnerDisabled !== false ||
          !resolvePublicProfileVisibility(row.hostPublicProfileSettings)
            .showAddress
        ) {
          return false;
        }
        if (
          row.event.requiresPayment &&
          (row.currentArrivalId !== row.currentArrivalVersionId ||
            row.currentArrivalBookingId !== row.bookingId ||
            row.currentArrivalState !== "current" ||
            !row.currentArrivalAcknowledgedAt)
        ) {
          return false;
        }
        const timeZone = resolvePersistedEventServiceTimeZone({
          seriesId: row.event.seriesId,
          seriesTimeZone: row.timezone,
          venueTimeZone: row.venueTimeZone,
        });
        if (!timeZone) return false;
        return isTruckOperatingPlanRowPublic({
          sourceKind: "booking",
          stopId: row.bookingId,
          date: row.event.date,
          startTime: row.event.startTime,
          endTime: row.event.endTime,
          sourceStatus: row.event.status,
          bookingStatus: row.status,
          eventRequiresPayment: row.event.requiresPayment,
          purchaseId: row.purchaseId,
          purchaseStatus: row.purchaseStatus,
          purchaseSettlementStatus: row.purchaseSettlementStatus,
          settlementTopology: row.settlementTopology,
          arrivalState: row.arrivalState,
          publicLocationConsentSnapshot:
            row.publicLocationConsentSnapshot,
          addressVisible: true,
          isPublic: true,
          locationName: row.host.businessName,
          address: row.host.address,
          city: (row.host as any).city,
          state: (row.host as any).state,
          latitude: (row.host as any).latitude,
          longitude: (row.host as any).longitude,
          hostId: row.host.id,
          hostName: row.host.businessName,
          timezone: timeZone,
          updatedAt: row.createdAt,
          lastConfirmedAt: row.bookingConfirmedAt,
          mapEligible: true,
          liveFeedEligible: true,
        });
      };

      const schedule = [
        ...bookingRows
          .filter((row: (typeof bookingRows)[number]) =>
            includePending ? true : isPublicBookingSlot(row),
          )
          .flatMap((row: (typeof bookingRows)[number]) => {
            const paidAggregate = Boolean(
              row.event.requiresPayment && row.purchaseId,
            );
            const paidArrivalReady = Boolean(
              paidAggregate &&
                row.status === "confirmed" &&
                [
                  "confirmed",
                  "partially_cancelled",
                  "partially_refunded",
                ].includes(String(row.purchaseStatus || "")) &&
                ["transferred_to_connect", "partially_reversed"].includes(
                  String(row.purchaseSettlementStatus || ""),
                ) &&
                row.arrivalState === "acknowledged" &&
                row.currentArrivalId === row.currentArrivalVersionId &&
                row.currentArrivalBookingId === row.bookingId &&
                row.currentArrivalState === "current" &&
                row.currentArrivalAcknowledgedAt,
            );
            const timeZone = resolvePersistedEventServiceTimeZone({
              seriesId: row.event.seriesId,
              seriesTimeZone: row.timezone,
              venueTimeZone: row.venueTimeZone,
            });
            if (!timeZone) return [];
            const roundArrival = (value: Date, direction: "floor" | "ceil") => {
              const rounded = new Date(value);
              const minute = rounded.getUTCMinutes();
              const nextMinute =
                direction === "floor"
                  ? minute < 30
                    ? 0
                    : 30
                  : minute === 0 || minute === 30
                    ? minute
                    : minute < 30
                      ? 30
                      : 60;
              rounded.setUTCMinutes(nextMinute, 0, 0);
              return rounded;
            };
            const displayArrivalStart =
              paidArrivalReady && row.currentArrivalStartAt
                ? includePending
                  ? row.currentArrivalStartAt
                  : roundArrival(row.currentArrivalStartAt, "floor")
                : null;
            const displayArrivalEnd =
              paidArrivalReady && row.currentArrivalEndAt
                ? includePending
                  ? row.currentArrivalEndAt
                  : roundArrival(row.currentArrivalEndAt, "ceil")
                : null;
            const formatTime = (value: Date | null) =>
              value
                ? new Intl.DateTimeFormat("en-US", {
                    timeZone,
                    hour: "2-digit",
                    minute: "2-digit",
                    hourCycle: "h23",
                  }).format(value)
                : null;
            const publicArrivalLabel = [
              row.currentArrivalCity,
              row.currentArrivalStateCode,
            ]
              .filter(Boolean)
              .join(", ");
            return [{
            type: "booking",
            status: row.status,
            createdAt: row.createdAt,
            bookingConfirmedAt: row.bookingConfirmedAt,
            bookingId: row.bookingId,
            slotType: row.slotType,
            ...(includePending
              ? {
                  purchaseId: row.purchaseId,
                  arrivalState: row.arrivalState,
                  currentArrivalVersionId: row.currentArrivalVersionId,
                  pendingArrivalVersionId: row.pendingArrivalVersionId,
                }
              : {}),
            event: {
              id: row.event.id,
              date:
                (displayArrivalStart
                  ? dateKeyInZone(displayArrivalStart, timeZone)
                  : toDateKey(row.event.date, timeZone)) ?? row.event.date,
              startTime: paidAggregate
                ? formatTime(displayArrivalStart)
                : row.event.startTime,
              endTime: paidAggregate
                ? formatTime(displayArrivalEnd)
                : row.event.endTime,
              status: row.event.status,
              hostPriceCents: row.event.hostPriceCents,
              requiresPayment: row.event.requiresPayment,
              lastConfirmedAt: (row.event as any).lastConfirmedAt ?? null,
            },
            host: {
              id: row.host.id,
              businessName: row.host.businessName,
              address: paidAggregate
                ? paidArrivalReady
                  ? includePending
                    ? row.currentArrivalAddress
                    : publicArrivalLabel || null
                  : null
                : row.host.address,
              city: paidAggregate
                ? paidArrivalReady
                  ? row.currentArrivalCity
                  : null
                : (row.host as any).city,
              state: paidAggregate
                ? paidArrivalReady
                  ? row.currentArrivalStateCode
                  : null
                : (row.host as any).state,
              locationType: row.host.locationType,
            },
            }];
          }),
        ...acceptedInterestRows
          .filter(() => includePending)
          .filter(
            (row: (typeof acceptedInterestRows)[number]) =>
              !bookingEventIds.has(row.eventId),
          )
          .flatMap((row: (typeof acceptedInterestRows)[number]) => {
            const timeZone = resolvePersistedEventServiceTimeZone({
              seriesId: row.seriesId,
              seriesTimeZone: row.seriesTimeZone,
              venueTimeZone: row.venueTimeZone,
            });
            if (!timeZone) return [];
            return [{
            type: "accepted_interest",
            status: row.status,
            createdAt: row.createdAt,
            event: {
              id: row.event.id,
              date:
                toDateKey(
                  row.event.date,
                  timeZone,
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
          }];
          }),
      ];

      const manualEntries = await storage.getTruckManualSchedules(truckId);
      const isPublicManualSlot = (entry: (typeof manualEntries)[number]) => {
        return isTruckOperatingPlanRowPublic({
          sourceKind: "manual",
          stopId: entry.id,
          date: entry.date,
          startTime: entry.startTime,
          endTime: entry.endTime,
          sourceStatus: entry.status,
          isPublic: entry.isPublic,
          locationName: entry.locationName,
          address: entry.address,
          city: entry.city,
          state: entry.state,
          timezone: (entry as any).timezone,
          updatedAt: entry.updatedAt,
          lastConfirmedAt: (entry as any).lastConfirmedAt,
          expiresAt: (entry as any).expiresAt,
          sourceType: (entry as any).sourceType,
          sourceConfidence: (entry as any).sourceConfidence,
          ownerSubmittedEquivalent: (entry as any).ownerSubmittedEquivalent,
          notice: entry.notes,
          mapEligible: (entry as any).mapEligible,
          liveFeedEligible: (entry as any).liveFeedEligible,
        });
      };

      const manualSchedule = manualEntries
        .filter(() => includePending || truck.ownerDisabled === false)
        .filter((entry) => entry.isPublic)
        .filter((entry) => (includePending ? true : isPublicManualSlot(entry)))
        .flatMap((entry) => {
          const timeZone = normalizePersistedIanaTimeZone(
            (entry as any).timezone,
          );
          if (!timeZone) return [];
          return [{
          type: "manual",
          status: "manual",
          createdAt: entry.createdAt,
          manual: {
            id: entry.id,
            date:
              toDateKey(
                entry.date,
                timeZone,
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
          }];
        });

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
  app.post(
    "/api/trucks/:truckId/booking-request",
    isAuthenticated,
    async (req: any, res) => {
    try {
      const { truckId } = req.params;
      if (!isInternalTeamUserType(req.user?.userType)) {
        return res.status(403).json({ message: "Staff access required" });
      }

      const schema = z.object({
        name: z.string().trim().min(1).max(120),
        email: z.string().email(),
        phone: z.string().trim().min(5).max(40),
        expectedGuests: z.string().trim().min(1).max(40),
        date: z.string().trim().min(1).max(40),
        startTime: z.string().trim().min(1).max(20),
        endTime: z.string().trim().min(1).max(20),
        location: z.string().trim().min(1).max(240),
        notes: z.string().trim().max(1000).optional(),
      });

      const parsed = schema.parse(req.body);

      const truck = await storage.getRestaurant(truckId);
      const publicTruck =
        truck?.isActive === true && isPublicBusinessVisible(truck)
          ? await toPublicRestaurantListingWithVisibility(truck)
          : null;
      if (
        !truck ||
        resolveStoredFoodBusinessType(truck) !== "food_truck" ||
        !(publicTruck as any)?.id ||
        deriveProfileEvidenceQuarantineVisibility(truck).isQuarantined
      ) {
        return res.status(404).json({ message: "Truck not found" });
      }

      const owner = await storage.getUser(truck.ownerId);
      if (!owner || owner.isDisabled !== false || !owner.email) {
        return res
          .status(400)
          .json({ message: "Truck owner email not available" });
      }

      const subject = `New booking request for ${String(truck.name || "food truck").replace(/[\r\n]+/g, " ")}`;
      const html = `
          <h2>New booking request for ${escapeHtml(truck.name)}</h2>
          <p><strong>Requester:</strong> ${escapeHtml(parsed.name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(parsed.email)}</p>
          <p><strong>Phone:</strong> ${escapeHtml(parsed.phone)}</p>
          <p><strong>Expected Guests:</strong> ${escapeHtml(parsed.expectedGuests)}</p>
          <p><strong>Date:</strong> ${escapeHtml(parsed.date)}</p>
          <p><strong>Time:</strong> ${escapeHtml(parsed.startTime)} - ${escapeHtml(parsed.endTime)}</p>
          <p><strong>Location:</strong> ${escapeHtml(parsed.location)}</p>
          ${parsed.notes ? `<p><strong>Notes:</strong> ${escapeHtml(parsed.notes)}</p>` : ""}
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
    },
  );
}
