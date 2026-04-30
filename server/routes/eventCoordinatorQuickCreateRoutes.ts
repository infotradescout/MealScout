import type { Express } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import {
  events,
  hosts,
  insertEventSchema,
  insertHostSchema,
  socialPostQueue,
} from "@shared/schema";
import { db } from "../db";
import { storage } from "../storage";
import { forwardGeocode } from "../utils/geocoding";
import { notifyNearbyTrucksOfNewEvent } from "../truckEventMatchService";

const allowedRoles = new Set([
  "event_coordinator",
  "admin",
  "super_admin",
  "staff",
]);

const isEventCoordinator = (req: any, res: any, next: any) => {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!allowedRoles.has(req.user?.userType)) {
    return res.status(403).json({ error: "Event coordinator access required" });
  }

  next();
};

const quickEventSchema = z.object({
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
  eventVisibility: z.enum(["public", "private"]).default("public"),
  hardCapEnabled: z.boolean().optional(),
  eventCadence: z.enum(["one_time", "recurring"]).default("one_time"),
  recurringDaysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  recurrenceEndDate: z.string().optional(),
  amenities: z.array(z.string().min(1)).optional(),
  requiresPayment: z.boolean().optional(),
  hostPriceCents: z.number().int().min(0).optional(),
  breakfastPriceCents: z.number().int().min(0).optional(),
  lunchPriceCents: z.number().int().min(0).optional(),
  dinnerPriceCents: z.number().int().min(0).optional(),
  dailyPriceCents: z.number().int().min(0).optional(),
  weeklyPriceCents: z.number().int().min(0).optional(),
  monthlyPriceCents: z.number().int().min(0).optional(),
});

const hasAnyPricing = (parsed: z.infer<typeof quickEventSchema>) =>
  Number(parsed.hostPriceCents ?? 0) > 0 ||
  Number(parsed.breakfastPriceCents ?? 0) > 0 ||
  Number(parsed.lunchPriceCents ?? 0) > 0 ||
  Number(parsed.dinnerPriceCents ?? 0) > 0 ||
  Number(parsed.dailyPriceCents ?? 0) > 0 ||
  Number(parsed.weeklyPriceCents ?? 0) > 0 ||
  Number(parsed.monthlyPriceCents ?? 0) > 0;

export function registerEventCoordinatorQuickCreateRoutes(app: Express) {
  app.post(
    "/api/event-coordinator/events",
    isEventCoordinator,
    async (req: any, res, next) => {
      try {
        const parsed = quickEventSchema.parse(req.body || {});
        const requiresAdvancedFlow =
          parsed.eventCadence === "recurring" ||
          Boolean(parsed.requiresPayment) ||
          hasAnyPricing(parsed);

        // Let the existing full route handle recurring and paid Parking Pass flows.
        if (requiresAdvancedFlow) {
          return next();
        }

        const isPrivateEvent = parsed.eventVisibility === "private";
        const eventDate = new Date(`${parsed.date}T00:00:00`);
        if (Number.isNaN(eventDate.getTime())) {
          return res.status(400).json({ message: "Event date must be valid" });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (eventDate < today) {
          return res
            .status(400)
            .json({ message: "Event date must be in the future" });
        }

        const [startHour, startMinute] = parsed.startTime.split(":").map(Number);
        const [endHour, endMinute] = parsed.endTime.split(":").map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;
        if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
          return res.status(400).json({ message: "Event times must be valid" });
        }
        if (endMinutes <= startMinutes) {
          return res
            .status(400)
            .json({ message: "End time must be after start time" });
        }

        const amenitiesMap =
          Array.isArray(parsed.amenities) && parsed.amenities.length > 0
            ? parsed.amenities.reduce(
                (acc, amenity) => {
                  acc[amenity] = true;
                  return acc;
                },
                {} as Record<string, boolean>,
              )
            : null;

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
            amenities: amenitiesMap,
          });
          host = await storage.createHost(hostData);
        } else {
          const submittedHost = {
            businessName: parsed.businessName,
            address: parsed.address,
            city: parsed.city,
            state: parsed.state,
            contactPhone: parsed.contactPhone,
            locationType: "event_coordinator",
            amenities: amenitiesMap,
          };
          const hasHostDiff =
            String(host.businessName || "") !== submittedHost.businessName ||
            String(host.address || "") !== submittedHost.address ||
            String(host.city || "") !== submittedHost.city ||
            String(host.state || "") !== submittedHost.state ||
            String(host.contactPhone || "") !== submittedHost.contactPhone ||
            String(host.locationType || "") !== submittedHost.locationType ||
            JSON.stringify(host.amenities || null) !==
              JSON.stringify(submittedHost.amenities || null);

          if (hasHostDiff) {
            const [updatedHost] = await db
              .update(hosts)
              .set({ ...submittedHost, updatedAt: new Date() })
              .where(eq(hosts.id, host.id))
              .returning();
            if (updatedHost) host = updatedHost as any;
          }
        }

        if (!host) {
          return res
            .status(500)
            .json({ message: "Failed to prepare host details for event" });
        }

        const fullAddress = [parsed.address, parsed.city, parsed.state, "USA"]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
          .join(", ");
        if (
          fullAddress &&
          (!host.latitude ||
            !host.longitude ||
            String(host.address || "") !== parsed.address ||
            String(host.city || "") !== parsed.city ||
            String(host.state || "") !== parsed.state)
        ) {
          const coords = await forwardGeocode(fullAddress).catch(() => null);
          if (coords) {
            const [updatedHost] = await db
              .update(hosts)
              .set({
                latitude: String(coords.lat),
                longitude: String(coords.lng),
                updatedAt: new Date(),
              })
              .where(eq(hosts.id, host.id))
              .returning();
            if (updatedHost) host = updatedHost as any;
          }
        }

        const eventPayload = insertEventSchema.parse({
          hostId: host.id,
          coordinatorUserId: req.user.id,
          name: parsed.name,
          description: parsed.description || null,
          date: eventDate,
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          maxTrucks: parsed.maxTrucks,
          hardCapEnabled: Boolean(parsed.hardCapEnabled),
          eventType: isPrivateEvent ? "private_event" : "event",
          status: isPrivateEvent ? "open" : "published",
          requiresPayment: false,
          hostPriceCents: null,
          breakfastPriceCents: null,
          lunchPriceCents: null,
          dinnerPriceCents: null,
          dailyPriceCents: null,
          weeklyPriceCents: null,
          monthlyPriceCents: null,
        });

        const created = await storage.createEvent(eventPayload);

        if (!isPrivateEvent) {
          db.insert(socialPostQueue)
            .values({
              platform: "facebook",
              target: null,
              message: `🍔 New food truck event in ${parsed.city}, ${parsed.state}: "${parsed.name}" on ${parsed.date} from ${parsed.startTime} to ${parsed.endTime}. Up to ${parsed.maxTrucks} trucks welcome!`,
              link: null,
              status: "pending",
              errorMessage: null,
              updatedAt: new Date(),
            })
            .catch(() => {});

          void notifyNearbyTrucksOfNewEvent(
            {
              id: created.id,
              name: created.name || parsed.name,
              description: created.description || null,
              date: new Date(created.date),
              startTime: created.startTime,
              endTime: created.endTime,
              requiresPayment: Boolean(created.requiresPayment),
              hostPriceCents: created.hostPriceCents ?? null,
            },
            {
              businessName: host.businessName,
              city: host.city,
              state: host.state,
              address: host.address,
              latitude: host.latitude,
              longitude: host.longitude,
              amenities: (host.amenities as Record<string, boolean> | null) ?? null,
            },
            { radiusMiles: 50 },
          );
        }

        return res.status(201).json({
          ...created,
          eventVisibility: isPrivateEvent ? "private" : "public",
          discoverableByAllUsers: !isPrivateEvent,
          host: {
            businessName: host.businessName,
            address: host.address,
          },
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: error.errors[0]?.message || "Invalid event data",
            errors: error.errors,
          });
        }
        console.error("Error quick-creating event coordinator event:", error);
        return res.status(400).json({
          message: error.message || "Failed to create event",
        });
      }
    },
  );
}
