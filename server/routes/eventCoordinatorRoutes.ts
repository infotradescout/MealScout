import type { Express } from "express";
import { z } from "zod";
import {
  insertEventSchema,
  insertHostSchema,
  eventInterests,
  events,
  hosts,
  cities,
  restaurants,
  socialPostQueue,
} from "@shared/schema";
import { storage } from "../storage";
import { db } from "../db";
import { and, eq, inArray, desc, sql, ilike, or } from "drizzle-orm";
import { canEmailForTopic } from "../utils/notificationPreferences";
import { deliverInterestStatusEventNotification } from "../services/eventNotificationDeliveryService";
import {
  decideEventInterest,
  EventInterestDecisionError,
} from "../services/eventInterestDecisionService";
import {
  eventDateInputSchema,
  formatEventDateOnly,
} from "../utils/eventDateInput";
import { requireIdempotencyKey } from "../middleware/idempotency";
import {
  cancelCoordinatedEvent,
  cancelCoordinatedSeries,
  EventParticipationMutationError,
  updateCoordinatedEvent,
  updateCoordinatedSeries,
} from "../services/eventParticipationMutationService";
import {
  resolveCityTimeZoneStrict,
  resolveUniquePersistedTimeZoneRows,
} from "../services/cityTimeZone";
import {
  dateKeyFromUnknown,
  dateKeyInZone,
} from "../services/dateKeys";

type EventCoordinatorRouteDependencies = {
  hasCompleteProfileAccess: (userId: string) => Promise<boolean>;
};

function normalizeVenueIdentityPart(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

function citySlug(value: unknown) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9-]+/g, "-");
}

const allowedRoles = new Set([
  "event_coordinator",
  "admin",
  "duper_admin",
  "super_admin",
  "staff",
]);

const isEventCoordinator = (req: any, res: any, next: any) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!allowedRoles.has(req.user?.userType)) {
    return res.status(403).json({ error: "Event coordinator access required" });
  }

  next();
};

export function registerEventCoordinatorRoutes(
  app: Express,
  { hasCompleteProfileAccess }: EventCoordinatorRouteDependencies,
) {
  const ensurePaidEventAccess = async (req: any, res: any) => {
    if (
      ["admin", "duper_admin", "super_admin", "staff"].includes(
        req.user?.userType,
      )
    ) {
      return true;
    }

    const hasAccess = await hasCompleteProfileAccess(req.user.id);
    if (!hasAccess) {
      res.status(402).json({
        message: "Profile access could not be verified for event tools.",
      });
      return false;
    }

    return true;
  };

  // ── GET /api/event-coordinator/events ──────────────────────────────────
  app.get(
    "/api/event-coordinator/events",
    isEventCoordinator,
    async (req: any, res) => {
      try {
        if (!(await ensurePaidEventAccess(req, res))) {
          return;
        }

        const host = await storage.getHostByUserId(req.user.id);
        const hostEvents = host
          ? await storage.getEventsOwnedByUser(req.user.id)
          : [];
        const coordinatorEvents = await db
          .select()
          .from(events)
          .where(
            and(
              eq(events.coordinatorUserId, req.user.id),
              sql`${events.eventType} <> 'parking_pass'`,
            ),
          );
        const eventsData = Array.from(
          new Map(
            [...hostEvents, ...coordinatorEvents].map((event: any) => [
              event.id,
              event,
            ]),
          ).values(),
        ) as any[];
        const hostIds = Array.from(
          new Set(eventsData.map((event: any) => String(event.hostId))),
        );
        const eventHosts = await Promise.all(
          hostIds.map((hostId) => storage.getHost(hostId)),
        );
        const hostById = new Map(
          eventHosts
            .filter(Boolean)
            .map((eventHost: any) => [eventHost.id, eventHost]),
        );

        // Enrich each event with interest counts
        const eventIds = eventsData.map((e) => e.id);
        const interestsByEvent: Record<string, any[]> = {};
        if (eventIds.length > 0) {
          const allInterests = await db
            .select({
              id: eventInterests.id,
              eventId: eventInterests.eventId,
              truckId: eventInterests.truckId,
              message: eventInterests.message,
              status: eventInterests.status,
              createdAt: eventInterests.createdAt,
            })
            .from(eventInterests)
            .where(inArray(eventInterests.eventId, eventIds))
            .orderBy(desc(eventInterests.createdAt));

          for (const interest of allInterests) {
            if (!interestsByEvent[interest.eventId]) {
              interestsByEvent[interest.eventId] = [];
            }
            interestsByEvent[interest.eventId].push(interest);
          }
        }

        const payload = eventsData.map((event) => {
          const eventHost = hostById.get(String(event.hostId));
          const interests = interestsByEvent[event.id] || [];
          const acceptedCount = interests.filter(
            (i: any) => i.status === "accepted",
          ).length;
          const pendingCount = interests.filter(
            (i: any) => i.status === "pending",
          ).length;
          const fillRate =
            event.maxTrucks > 0
              ? Math.round((acceptedCount / event.maxTrucks) * 100)
              : 0;
          return {
            ...event,
            host: {
              businessName: eventHost?.businessName || "Event location",
              address: eventHost?.address || null,
            },
            interestSummary: {
              total: interests.length,
              pending: pendingCount,
              accepted: acceptedCount,
              declined: interests.filter((i: any) => i.status === "declined")
                .length,
              fillRate,
              isFull: acceptedCount >= event.maxTrucks,
            },
          };
        });
        res.json(payload);
      } catch (error) {
        console.error("Error fetching event coordinator events:", error);
        res.status(500).json({ message: "Failed to fetch events" });
      }
    },
  );

  // ── GET /api/event-coordinator/events/:eventId/interests ───────────────
  app.get(
    "/api/event-coordinator/events/:eventId/interests",
    isEventCoordinator,
    async (req: any, res) => {
      try {
        if (!(await ensurePaidEventAccess(req, res))) {
          return;
        }

        const { eventId } = req.params;
        const event = await storage.getEvent(eventId);
        if (!event) {
          return res.status(404).json({ message: "Event not found" });
        }
        const host = await storage.getHostByUserId(req.user.id);
        const ownsEvent =
          (host && event.hostId === host.id) ||
          (event.eventType !== "parking_pass" &&
            event.coordinatorUserId === req.user.id) ||
          req.user.userType === "admin" ||
          req.user.userType === "duper_admin" ||
          req.user.userType === "super_admin";
        if (!ownsEvent) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const interests = await storage.getEventInterestsByEventId(eventId);
        const truckIds = [
          ...new Set(interests.map((i) => i.truckId)),
        ] as string[];
        const truckMap: Record<string, any> = {};
        if (truckIds.length > 0) {
          const trucks = await db
            .select({
              id: restaurants.id,
              name: restaurants.name,
              city: restaurants.city,
              state: restaurants.state,
              cuisineType: restaurants.cuisineType,
              phone: restaurants.phone,
              logoUrl: restaurants.logoUrl,
            })
            .from(restaurants)
            .where(inArray(restaurants.id, truckIds));
          for (const truck of trucks) {
            truckMap[truck.id] = truck;
          }
        }

        const enriched = interests.map((interest) => ({
          ...interest,
          truck: truckMap[interest.truckId] || null,
        }));

        const acceptedCount = enriched.filter(
          (i) => i.status === "accepted",
        ).length;
        res.json({
          interests: enriched,
          summary: {
            total: enriched.length,
            pending: enriched.filter((i) => i.status === "pending").length,
            accepted: acceptedCount,
            declined: enriched.filter((i) => i.status === "declined").length,
            maxTrucks: event.maxTrucks,
            fillRate:
              event.maxTrucks > 0
                ? Math.round((acceptedCount / event.maxTrucks) * 100)
                : 0,
            isFull: event.hardCapEnabled
              ? acceptedCount >= event.maxTrucks
              : false,
          },
        });
      } catch (error) {
        console.error("Error fetching event interests:", error);
        res.status(500).json({ message: "Failed to fetch interests" });
      }
    },
  );

  // ── PATCH /api/event-coordinator/interests/:interestId ─────────────────
  app.patch(
    "/api/event-coordinator/interests/:interestId",
    isEventCoordinator,
    async (req: any, res) => {
      try {
        if (!(await ensurePaidEventAccess(req, res))) {
          return;
        }

        const { interestId } = req.params;
        const { status } = req.body;
        if (!["accepted", "declined"].includes(status)) {
          return res
            .status(400)
            .json({ message: "Status must be 'accepted' or 'declined'" });
        }
        const decision = await decideEventInterest({
          interestId,
          status,
          actorUserId: req.user.id,
          actorRole: req.user.userType,
        });
        const interest = decision.interest;
        const event = decision.event;
        const host = decision.host;
        if (decision.replayed) {
          return res.json({ message: "Status already set", interest });
        }

        // A truck applying to an event here previously had no way to learn
        // whether they were accepted or declined except by polling
        // /my-interests -- mirrors the notification hostInterestRoutes.ts
        // already sends for the equivalent host-side accept/decline action.
        (async () => {
          try {
            const truck = await storage.getRestaurant(interest.truckId);
            if (!truck) return;
            const owner = await storage.getUser(truck.ownerId);
            if (
              !owner ||
              !owner.email ||
              !canEmailForTopic((owner as any).accountSettings, "nearbyEvents")
            ) {
              return;
            }
            const hostDisplayName =
              host.businessName || event.name || "the event host";
            await deliverInterestStatusEventNotification({
              interestId: interest.id,
              eventId: event.id,
              eventDate: event.date,
              seriesId: event.seriesId,
              hostCity: host.city,
              hostState: host.state,
              recipientUserId: owner.id,
              recipientEmail: owner.email,
              truckName: truck.name,
              hostName: hostDisplayName,
              status: status as "accepted" | "declined",
            });
          } catch (err) {
            console.error("Failed to send event interest status notification:", err);
          }
        })();

        res.json({ message: `Interest ${status}`, interest });
      } catch (error: any) {
        if (error instanceof EventInterestDecisionError) {
          return res.status(error.statusCode).json({
            message: error.message,
            code:
              error.code === "capacity_reached"
                ? "CAPACITY_REACHED"
                : error.code,
            ...error.details,
          });
        }
        console.error("Error updating interest status:", error);
        res.status(500).json({ message: "Failed to update interest status" });
      }
    },
  );

  // ── GET /api/event-coordinator/my-interests (truck's own interests) ────
  app.get("/api/event-coordinator/my-interests", async (req: any, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: "Authentication required" });
    }
    try {
      if (!(await ensurePaidEventAccess(req, res))) {
        return;
      }

      const myRestaurants = await storage.getRestaurantsByOwner(req.user.id);
      if (!myRestaurants || myRestaurants.length === 0) {
        return res.json([]);
      }
      const truckIds = myRestaurants.map((r: any) => r.id) as string[];
      const myInterests = await db
        .select({
          id: eventInterests.id,
          eventId: eventInterests.eventId,
          truckId: eventInterests.truckId,
          message: eventInterests.message,
          status: eventInterests.status,
          createdAt: eventInterests.createdAt,
        })
        .from(eventInterests)
        .where(inArray(eventInterests.truckId, truckIds))
        .orderBy(desc(eventInterests.createdAt));

      const eventIds: string[] = Array.from(
        new Set(myInterests.map((i: any) => String(i.eventId))),
      );
      const eventMap: Record<string, any> = {};
      if (eventIds.length > 0) {
        const eventRows = await db
          .select()
          .from(events)
          .where(inArray(events.id, eventIds));
        for (const ev of eventRows) {
          eventMap[ev.id] = ev;
        }
      }
      const enriched = myInterests.map((interest: any) => ({
        ...interest,
        event: eventMap[interest.eventId] || null,
      }));
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching my event interests:", error);
      res.status(500).json({ message: "Failed to fetch your interests" });
    }
  });

  app.post(
    "/api/event-coordinator/events",
    isEventCoordinator,
    requireIdempotencyKey({ scope: "event_coordinator_event_create" }),
    async (req: any, res) => {
      try {
        if (!(await ensurePaidEventAccess(req, res))) {
          return;
        }

        const schema = z.object({
          businessName: z.string().min(1),
          address: z.string().min(1),
          city: z.string().min(1),
          state: z.string().min(2),
          contactPhone: z.string().min(1),
          name: z.string().min(1),
          description: z.string().optional(),
          date: eventDateInputSchema,
          startTime: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Start time must be in HH:MM format"),
          endTime: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "End time must be in HH:MM format"),
          maxTrucks: z.number().int().min(1).max(50),
          hardCapEnabled: z.boolean().default(false),
        });

        const parsed = schema.parse(req.body);

        const venueTimeZone = await resolveCityTimeZoneStrict({
          city: parsed.city,
          state: parsed.state,
        });
        if (!venueTimeZone) {
          return res.status(409).json({
            code: "venue_timezone_unavailable",
            message:
              "This event needs one unambiguous persisted city timezone before it can be created.",
          });
        }
        const eventDateKey = dateKeyFromUnknown(parsed.date, "UTC");
        if (
          !eventDateKey ||
          eventDateKey < dateKeyInZone(new Date(), venueTimeZone)
        ) {
          return res
            .status(400)
            .json({ message: "Event date must be in the future" });
        }

        const [startHour, startMinute] = parsed.startTime
          .split(":")
          .map(Number);
        const [endHour, endMinute] = parsed.endTime
          .split(":")
          .map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;

        if (endMinutes <= startMinutes) {
          return res
            .status(400)
            .json({ message: "End time must be after start time" });
        }

        // Lock the exact persisted venue identity and re-resolve its city
        // timezone inside the same transaction that writes the host/event.
        // A coordinator's unrelated host must never silently move an event to
        // another venue or timezone.
        const { host, created } = await db.transaction(async (tx: any) => {
          const normalizedAddress = normalizeVenueIdentityPart(parsed.address);
          const normalizedCity = normalizeVenueIdentityPart(parsed.city);
          const normalizedState = normalizeVenueIdentityPart(parsed.state);
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${`event_coordinator_venue:${req.user.id}:${normalizedAddress}:${normalizedCity}:${normalizedState}`}))`,
          );

          const persistedCityRows = await tx
            .select({ timezone: cities.timezone })
            .from(cities)
            .where(
              and(
                or(
                  ilike(cities.name, parsed.city.trim()),
                  eq(cities.slug, citySlug(parsed.city)),
                ),
                eq(cities.state, parsed.state.trim().toUpperCase()),
              ),
            )
            .for("share");
          const lockedVenueTimeZone = resolveUniquePersistedTimeZoneRows(
            persistedCityRows,
          );
          if (!lockedVenueTimeZone || lockedVenueTimeZone !== venueTimeZone) {
            throw new EventParticipationMutationError(
              409,
              "venue_timezone_unavailable",
              "This event needs one unambiguous persisted city timezone before it can be created.",
            );
          }
          if (eventDateKey < dateKeyInZone(new Date(), lockedVenueTimeZone)) {
            throw new EventParticipationMutationError(
              400,
              "event_date_in_past",
              "Event date must be in the future",
            );
          }

          const coordinatorHosts = await tx
            .select()
            .from(hosts)
            .where(eq(hosts.userId, req.user.id))
            .for("update");
          const exactVenueHosts = coordinatorHosts.filter(
            (candidate: any) =>
              normalizeVenueIdentityPart(candidate.address) === normalizedAddress &&
              normalizeVenueIdentityPart(candidate.city) === normalizedCity &&
              normalizeVenueIdentityPart(candidate.state) === normalizedState,
          );
          if (exactVenueHosts.length > 1) {
            throw new EventParticipationMutationError(
              409,
              "event_venue_ambiguous",
              "Multiple persisted venue records match this event address.",
            );
          }

          let lockedHost = exactVenueHosts[0];
          if (!lockedHost) {
            const hostData = insertHostSchema.parse({
              userId: req.user.id,
              businessName: parsed.businessName.trim(),
              address: parsed.address.trim(),
              city: parsed.city.trim(),
              state: parsed.state.trim().toUpperCase(),
              contactPhone: parsed.contactPhone.trim(),
              locationType: "event_coordinator",
            });
            [lockedHost] = await tx.insert(hosts).values(hostData).returning();
          }

          const eventPayload = insertEventSchema.parse({
            hostId: lockedHost.id,
            coordinatorUserId: req.user.id,
            name: parsed.name,
            description: parsed.description || null,
            date: new Date(`${eventDateKey}T00:00:00.000Z`),
            startTime: parsed.startTime,
            endTime: parsed.endTime,
            maxTrucks: parsed.maxTrucks,
            hardCapEnabled: parsed.hardCapEnabled,
            requiresPayment: false,
          });
          const [lockedEvent] = await tx
            .insert(events)
            .values(eventPayload)
            .returning();
          return { host: lockedHost, created: lockedEvent };
        });

        // Auto-enqueue social post for new event
        db.insert(socialPostQueue)
          .values({
            platform: "facebook",
            target: null,
            message: `🍔 New food truck event in ${parsed.city}, ${parsed.state}: "${parsed.name}" on ${formatEventDateOnly(parsed.date)} from ${parsed.startTime} to ${parsed.endTime}. Up to ${parsed.maxTrucks} trucks welcome!`,
            link: null,
            status: "pending",
            errorMessage: null,
            updatedAt: new Date(),
          })
          .catch(() => {});

        res.status(201).json({
          ...created,
          host: {
            businessName: host.businessName,
            address: host.address,
          },
        });
      } catch (error: any) {
        console.error("Error creating event coordinator event:", error);
        if (error instanceof z.ZodError) {
          return res
            .status(400)
            .json({ message: "Invalid event data", errors: error.errors });
        }
        if (error instanceof EventParticipationMutationError) {
          return res.status(error.statusCode).json({
            code: error.code,
            message: error.message,
            details: error.details,
          });
        }
        res.status(400).json({
          message: error.message || "Failed to create event",
        });
      }
    },
  );

  // ── PATCH /api/event-coordinator/events/:eventId ──────────────────────
  /**
   * Update an event's details (name, description, date, times, maxTrucks).
   * Only the owning coordinator may update.
   */
  app.patch(
    "/api/event-coordinator/events/:eventId",
    requireIdempotencyKey({ scope: "event_coordinator_event_mutation" }),
    isEventCoordinator,
    async (req: any, res) => {
      try {
        if (!(await ensurePaidEventAccess(req, res))) return;
        const { eventId } = req.params;
        const schema = z.object({
          name: z.string().min(1).optional(),
          description: z.string().optional(),
          date: eventDateInputSchema.optional(),
          startTime: z.string().optional(),
          endTime: z.string().optional(),
          maxTrucks: z.number().int().min(1).max(50).optional(),
          hardCapEnabled: z.boolean().optional(),
          status: z.enum(["open", "closed", "cancelled"]).optional(),
        });
        const body = schema.parse(req.body);
        const result = await updateCoordinatedEvent({
          eventId,
          actor: { userId: req.user.id },
          requestId: String(req.headers["idempotency-key"] || "").trim(),
          updates: body,
        });
        res.status(result.fanout.affected > 0 ? 202 : 200).json(result);
      } catch (error: any) {
        console.error("Error updating event:", error);
        if (error instanceof z.ZodError)
          return res
            .status(400)
            .json({ message: error.errors[0]?.message || "Validation error" });
        if (
          error instanceof EventParticipationMutationError ||
          Number(error?.statusCode) >= 400
        ) {
          return res.status(Number(error.statusCode) || 409).json({
            code: error.code,
            message: error.message,
          });
        }
        res
          .status(500)
          .json({ message: error.message || "Failed to update event" });
      }
    },
  );

  // ── DELETE /api/event-coordinator/events/:eventId ─────────────────────
  /**
   * Cancel an event. Sets status to 'cancelled' and notifies interested trucks.
   * Hard-delete is not allowed; coordinators cancel, not delete.
   */
  app.delete(
    "/api/event-coordinator/events/:eventId",
    requireIdempotencyKey({ scope: "event_coordinator_event_cancellation" }),
    isEventCoordinator,
    async (req: any, res) => {
      try {
        if (!(await ensurePaidEventAccess(req, res))) return;
        const { eventId } = req.params;
        const result = await cancelCoordinatedEvent({
          eventId,
          actor: { userId: req.user.id },
          requestId: String(req.headers["idempotency-key"] || "").trim(),
        });
        res.status(result.fanout.affected > 0 ? 202 : 200).json({
          ...result,
          message:
            result.fanout.affected > 0
              ? "Event cancelled; paid participation remedies are recorded with their current provider states."
              : "Event cancelled",
        });
      } catch (error: any) {
        console.error("Error cancelling event:", error);
        if (
          error instanceof EventParticipationMutationError ||
          Number(error?.statusCode) >= 400
        ) {
          return res.status(Number(error.statusCode) || 409).json({
            code: error.code,
            message: error.message,
          });
        }
        res
          .status(500)
          .json({ message: error.message || "Failed to cancel event" });
      }
    },
  );

  app.patch(
    "/api/event-coordinator/series/:seriesId",
    requireIdempotencyKey({ scope: "event_coordinator_series_mutation" }),
    isEventCoordinator,
    async (req: any, res) => {
      try {
        if (!(await ensurePaidEventAccess(req, res))) return;
        const updates = z
          .object({
            name: z.string().min(1).optional(),
            defaultStartTime: z
              .string()
              .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
              .optional(),
            defaultEndTime: z
              .string()
              .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
              .optional(),
            defaultMaxTrucks: z.number().int().min(1).max(50).optional(),
            status: z.enum(["draft", "published", "closed"]).optional(),
          })
          .parse(req.body);
        const result = await updateCoordinatedSeries({
          seriesId: String(req.params.seriesId || "").trim(),
          actor: { userId: req.user.id },
          requestId: String(req.headers["idempotency-key"] || "").trim(),
          updates,
        });
        res.status(result.eventResults.length > 0 ? 202 : 200).json(result);
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: error.errors[0]?.message || "Validation error",
          });
        }
        if (
          error instanceof EventParticipationMutationError ||
          Number(error?.statusCode) >= 400
        ) {
          return res.status(Number(error.statusCode) || 409).json({
            code: error.code,
            message: error.message,
          });
        }
        console.error("Error updating coordinated series:", error);
        return res.status(500).json({ message: "Failed to update series" });
      }
    },
  );

  app.delete(
    "/api/event-coordinator/series/:seriesId",
    requireIdempotencyKey({ scope: "event_coordinator_series_cancellation" }),
    isEventCoordinator,
    async (req: any, res) => {
      try {
        if (!(await ensurePaidEventAccess(req, res))) return;
        const result = await cancelCoordinatedSeries({
          seriesId: String(req.params.seriesId || "").trim(),
          actor: { userId: req.user.id },
          requestId: String(req.headers["idempotency-key"] || "").trim(),
        });
        return res.status(result.eventResults.length > 0 ? 202 : 200).json({
          ...result,
          message:
            "Series closed; future paid participation remedies are recorded with their current provider states.",
        });
      } catch (error: any) {
        if (
          error instanceof EventParticipationMutationError ||
          Number(error?.statusCode) >= 400
        ) {
          return res.status(Number(error.statusCode) || 409).json({
            code: error.code,
            message: error.message,
          });
        }
        console.error("Error cancelling coordinated series:", error);
        return res.status(500).json({ message: "Failed to cancel series" });
      }
    },
  );

  // ── GET /api/event-coordinator/metrics ─────────────────────────────────
  /**
   * Operator metrics: series fill rate, acceptance throughput, cancellation impact.
   * Returns aggregate stats across all events owned by this coordinator.
   */
  app.get(
    "/api/event-coordinator/metrics",
    isEventCoordinator,
    async (req: any, res) => {
      try {
        if (!(await ensurePaidEventAccess(req, res))) return;
        const eventsData = await storage.getEventsOwnedByUser(req.user.id);
        if (eventsData.length === 0) {
          return res.json({
            totalEvents: 0,
            totalCapacity: 0,
            totalAccepted: 0,
            overallFillRate: 0,
            acceptanceRate: 0,
            cancellationRate: 0,
            avgFillRateByEvent: [],
          });
        }
        const eventIds = eventsData.map((e) => e.id);
        const allInterests = await db
          .select({
            eventId: eventInterests.eventId,
            status: eventInterests.status,
          })
          .from(eventInterests)
          .where(inArray(eventInterests.eventId, eventIds));
        const byEvent: Record<
          string,
          {
            pending: number;
            accepted: number;
            declined: number;
            cancelled: number;
          }
        > = {};
        for (const ev of eventsData)
          byEvent[ev.id] = {
            pending: 0,
            accepted: 0,
            declined: 0,
            cancelled: 0,
          };
        for (const i of allInterests) {
          const bucket = byEvent[i.eventId];
          if (!bucket) continue;
          if (i.status === "pending") bucket.pending++;
          else if (i.status === "accepted") bucket.accepted++;
          else if (i.status === "declined") bucket.declined++;
          else if (i.status === "cancelled") bucket.cancelled++;
        }
        const totalCapacity = eventsData.reduce(
          (s, e) => s + (e.maxTrucks || 0),
          0,
        );
        const totalAccepted = Object.values(byEvent).reduce(
          (s, b) => s + b.accepted,
          0,
        );
        const totalInterests = allInterests.length;
        const totalDeclined = Object.values(byEvent).reduce(
          (s, b) => s + b.declined,
          0,
        );
        const totalCancelled = Object.values(byEvent).reduce(
          (s, b) => s + b.cancelled,
          0,
        );
        const overallFillRate =
          totalCapacity > 0
            ? Math.round((totalAccepted / totalCapacity) * 100)
            : 0;
        const acceptanceRate =
          totalInterests > 0
            ? Math.round(
                ((totalAccepted + totalDeclined) / totalInterests) * 100,
              )
            : 0;
        const cancellationRate =
          totalInterests > 0
            ? Math.round((totalCancelled / totalInterests) * 100)
            : 0;
        const avgFillRateByEvent = eventsData
          .map((ev) => {
            const b = byEvent[ev.id];
            const fillRate =
              ev.maxTrucks > 0
                ? Math.round((b.accepted / ev.maxTrucks) * 100)
                : 0;
            return {
              eventId: ev.id,
              eventName: ev.name,
              date: ev.date,
              maxTrucks: ev.maxTrucks,
              accepted: b.accepted,
              pending: b.pending,
              declined: b.declined,
              fillRate,
              isFull: b.accepted >= ev.maxTrucks,
            };
          })
          .sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
          );
        res.json({
          totalEvents: eventsData.length,
          totalCapacity,
          totalAccepted,
          overallFillRate,
          acceptanceRate,
          cancellationRate,
          avgFillRateByEvent,
          generatedAt: new Date().toISOString(),
        });
      } catch (error: any) {
        console.error("Error fetching event coordinator metrics:", error);
        res
          .status(500)
          .json({ message: error.message || "Failed to fetch metrics" });
      }
    },
  );
}
