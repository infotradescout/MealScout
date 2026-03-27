import type { Express } from "express";
import { z } from "zod";
import { insertEventSchema, insertHostSchema, eventInterests, events, restaurants } from "@shared/schema";
import { storage } from "../storage";
import { db } from "../db";
import { inArray, desc } from "drizzle-orm";
import {
  computeAcceptedCount,
  shouldBlockAcceptance,
  buildCapacityFullError,
} from "../services/interestDecision";

const allowedRoles = new Set([
  "event_coordinator",
  "admin",
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

export function registerEventCoordinatorRoutes(app: Express) {
  // ── GET /api/event-coordinator/events ──────────────────────────────────
  app.get(
    "/api/event-coordinator/events",
    isEventCoordinator,
    async (req: any, res) => {
      try {
        const host = await storage.getHostByUserId(req.user.id);
        if (!host) {
          return res.json([]);
        }

        const eventsData = await storage.getEventsOwnedByUser(req.user.id);

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
          const interests = interestsByEvent[event.id] || [];
          const acceptedCount = interests.filter((i: any) => i.status === "accepted").length;
          const pendingCount = interests.filter((i: any) => i.status === "pending").length;
          const fillRate = event.maxTrucks > 0
            ? Math.round((acceptedCount / event.maxTrucks) * 100)
            : 0;
          return {
            ...event,
            host: {
              businessName: host.businessName,
              address: host.address,
            },
            interestSummary: {
              total: interests.length,
              pending: pendingCount,
              accepted: acceptedCount,
              declined: interests.filter((i: any) => i.status === "declined").length,
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
    }
  );

  // ── GET /api/event-coordinator/events/:eventId/interests ───────────────
  app.get(
    "/api/event-coordinator/events/:eventId/interests",
    isEventCoordinator,
    async (req: any, res) => {
      try {
        const { eventId } = req.params;
        const event = await storage.getEvent(eventId);
        if (!event) {
          return res.status(404).json({ message: "Event not found" });
        }
        const host = await storage.getHostByUserId(req.user.id);
        const ownsEvent =
          (host && event.hostId === host.id) ||
          event.coordinatorUserId === req.user.id ||
          req.user.userType === "admin" ||
          req.user.userType === "super_admin";
        if (!ownsEvent) {
          return res.status(403).json({ message: "Not authorized" });
        }

        const interests = await storage.getEventInterestsByEventId(eventId);
        const truckIds = [...new Set(interests.map((i) => i.truckId))] as string[];
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

        const acceptedCount = enriched.filter((i) => i.status === "accepted").length;
        res.json({
          interests: enriched,
          summary: {
            total: enriched.length,
            pending: enriched.filter((i) => i.status === "pending").length,
            accepted: acceptedCount,
            declined: enriched.filter((i) => i.status === "declined").length,
            maxTrucks: event.maxTrucks,
            fillRate: event.maxTrucks > 0
              ? Math.round((acceptedCount / event.maxTrucks) * 100)
              : 0,
            isFull: event.hardCapEnabled ? acceptedCount >= event.maxTrucks : false,
          },
        });
      } catch (error) {
        console.error("Error fetching event interests:", error);
        res.status(500).json({ message: "Failed to fetch interests" });
      }
    }
  );

  // ── PATCH /api/event-coordinator/interests/:interestId ─────────────────
  app.patch(
    "/api/event-coordinator/interests/:interestId",
    isEventCoordinator,
    async (req: any, res) => {
      try {
        const { interestId } = req.params;
        const { status } = req.body;
        if (!["accepted", "declined"].includes(status)) {
          return res.status(400).json({ message: "Status must be 'accepted' or 'declined'" });
        }
        const interest = await storage.getEventInterest(interestId);
        if (!interest) {
          return res.status(404).json({ message: "Interest not found" });
        }
        const event = await storage.getEvent(interest.eventId);
        if (!event) {
          return res.status(404).json({ message: "Event not found" });
        }
        const host = await storage.getHostByUserId(req.user.id);
        const ownsEvent =
          (host && event.hostId === host.id) ||
          event.coordinatorUserId === req.user.id ||
          req.user.userType === "admin" ||
          req.user.userType === "super_admin";
        if (!ownsEvent) {
          return res.status(403).json({ message: "Not authorized" });
        }
        if (interest.status === status) {
          return res.json({ message: "Status already set", interest });
        }
        if (status === "accepted") {
          const allInterests = await storage.getEventInterestsByEventId(interest.eventId);
          const acceptedCount = computeAcceptedCount(allInterests as any);
          if (shouldBlockAcceptance({ hardCapEnabled: event.hardCapEnabled, acceptedCount, maxTrucks: event.maxTrucks })) {
            return res.status(409).json(buildCapacityFullError());
          }
        }
        const updated = await storage.updateEventInterestStatus(interestId, status);
        res.json({ message: `Interest ${status}`, interest: updated });
      } catch (error: any) {
        console.error("Error updating interest status:", error);
        res.status(500).json({ message: "Failed to update interest status" });
      }
    }
  );

  // ── GET /api/event-coordinator/my-interests (truck's own interests) ────
  app.get(
    "/api/event-coordinator/my-interests",
    async (req: any, res) => {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ error: "Authentication required" });
      }
      try {
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

        const eventIds: string[] = Array.from(new Set(myInterests.map((i: any) => String(i.eventId))));
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
    }
  );

  app.post(
    "/api/event-coordinator/events",
    isEventCoordinator,
    async (req: any, res) => {
      try {
        const schema = z.object({
          businessName: z.string().min(1),
          address: z.string().min(1),
          city: z.string().min(1),
          state: z.string().min(2),
          contactPhone: z.string().min(1),
          name: z.string().min(1),
          description: z.string().optional(),
          date: z.string().min(1),
          startTime: z.string().min(1),
          endTime: z.string().min(1),
          maxTrucks: z.number().int().min(1).max(50),
        });

        const parsed = schema.parse(req.body);

        let host = await storage.getHostByUserId(req.user.id);
        if (!host) {
          const hostData = insertHostSchema.parse({
            userId: req.user.id,
            businessName: parsed.businessName,
            address: parsed.address,
            city: parsed.city,
            state: parsed.state,
            contactPhone: parsed.contactPhone,
            locationType: "event_coordinator",
          });
          host = await storage.createHost(hostData);
        }

        const eventPayload = insertEventSchema.parse({
          hostId: host.id,
          coordinatorUserId: req.user.id,
          name: parsed.name,
          description: parsed.description || null,
          date: parsed.date,
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          maxTrucks: parsed.maxTrucks,
          requiresPayment: false,
        });

        const eventDate = new Date(eventPayload.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (eventDate < today) {
          return res
            .status(400)
            .json({ message: "Event date must be in the future" });
        }

        const [startHour, startMinute] = eventPayload.startTime
          .split(":")
          .map(Number);
        const [endHour, endMinute] = eventPayload.endTime
          .split(":")
          .map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;

        if (endMinutes <= startMinutes) {
          return res
            .status(400)
            .json({ message: "End time must be after start time" });
        }

        const created = await storage.createEvent(eventPayload);
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
        res.status(400).json({
          message: error.message || "Failed to create event",
        });
      }
    }
  );
}
