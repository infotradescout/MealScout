import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { emailService } from "../emailService";
import { db } from "../db";
import {
  events,
  eventSeries,
  insertEventSeriesSchema,
  type InsertEvent,
} from "@shared/schema";
import { isAuthenticated } from "../unifiedAuth";
import { getHostByUserId, userOwnsSeries } from "../services/hostOwnership";
import {
  assertMaxSpan180Days,
  generateOccurrences,
  filterFutureOccurrences,
} from "../services/openCallSeries";
import { dateKeyInZone } from "../services/dateKeys";
import { eq } from "drizzle-orm";
import { isParkingPassPublicReady } from "../services/parkingPassQuality";
import { notifyNearbyTrucksOfNewSeries } from "../truckEventMatchService";
import { canEmailForTopic } from "../utils/notificationPreferences";

const isEmailChannelEnabled = (accountSettings: unknown) => {
  const settings =
    accountSettings && typeof accountSettings === "object"
      ? (accountSettings as Record<string, any>)
      : null;
  const notifications =
    settings?.notifications && typeof settings.notifications === "object"
      ? (settings.notifications as Record<string, any>)
      : null;
  const channels =
    notifications?.channels && typeof notifications.channels === "object"
      ? (notifications.channels as Record<string, any>)
      : null;
  return typeof channels?.email === "boolean" ? channels.email : true;
};

const isCoordinatorUpdatesTopicEnabled = (accountSettings: unknown) => {
  const settings =
    accountSettings && typeof accountSettings === "object"
      ? (accountSettings as Record<string, any>)
      : null;
  const notifications =
    settings?.notifications && typeof settings.notifications === "object"
      ? (settings.notifications as Record<string, any>)
      : null;
  const topics =
    notifications?.topics && typeof notifications.topics === "object"
      ? (notifications.topics as Record<string, any>)
      : null;
  return typeof topics?.nearbyEvents === "boolean" ? topics.nearbyEvents : true;
};

export function registerOpenCallSeriesRoutes(app: Express) {
  // EVENT SERIES (OPEN CALLS) ENDPOINTS

  // Create a new event series (draft)
  app.post(
    "/api/hosts/event-series",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const userId = req.user.id;
        const host = await getHostByUserId(userId);
        if (!host) {
          return res.status(404).json({ message: "Host profile not found" });
        }

        const parsed = insertEventSeriesSchema.parse({
          ...req.body,
          hostId: host.id,
          coordinatorUserId: req.user.id,
        });

        // Validation: End date must be after start date
        if (new Date(parsed.endDate) <= new Date(parsed.startDate)) {
          return res
            .status(400)
            .json({ message: "End date must be after start date" });
        }

        // Validation: Max 180 days recurrence span
        assertMaxSpan180Days(
          new Date(parsed.startDate),
          new Date(parsed.endDate),
        );

        // Validation: End time > Start time
        const [startHour, startMinute] = parsed.defaultStartTime
          .split(":")
          .map(Number);
        const [endHour, endMinute] = parsed.defaultEndTime
          .split(":")
          .map(Number);
        const startMinutes = startHour * 60 + startMinute;
        const endMinutes = endHour * 60 + endMinute;

        if (endMinutes <= startMinutes) {
          return res
            .status(400)
            .json({ message: "End time must be after start time" });
        }

        const series = await storage.createEventSeries(parsed);

        // Telemetry
        await storage.createTelemetryEvent({
          eventName: "event_series_created",
          userId: req.user.id,
          properties: {
            seriesId: series.id,
            startDate: series.startDate,
            endDate: series.endDate,
            recurrenceRule: series.recurrenceRule,
          },
        });

        res.status(201).json(series);
      } catch (error: any) {
        console.error("Error creating event series:", error);
        if (error instanceof z.ZodError) {
          return res
            .status(400)
            .json({ message: "Invalid series data", errors: error.errors });
        }
        res
          .status(400)
          .json({ message: error.message || "Failed to create event series" });
      }
    },
  );

  // Publish an event series (generate occurrences)
  app.post(
    "/api/hosts/event-series/:seriesId/publish",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { seriesId } = req.params;
        const userId = req.user.id;

        const series = await storage.getEventSeries(seriesId);
        if (!series) {
          return res.status(404).json({ message: "Event series not found" });
        }

        const host = await getHostByUserId(userId);
        if (!userOwnsSeries(userId, host, series)) {
          return res
            .status(403)
            .json({ message: "Not authorized to publish this series" });
        }

        if (series.status === "published") {
          return res
            .status(400)
            .json({ message: "Series is already published" });
        }

        const startDate = new Date(series.startDate);
        const endDate = new Date(series.endDate);

        if (series.seriesType === "parking_pass") {
          const publicReady = isParkingPassPublicReady({
            host,
            startTime: series.defaultStartTime,
            endTime: series.defaultEndTime,
            maxTrucks: series.defaultMaxTrucks,
            breakfastPriceCents:
              (series as any).defaultBreakfastPriceCents ?? null,
            lunchPriceCents: (series as any).defaultLunchPriceCents ?? null,
            dinnerPriceCents: (series as any).defaultDinnerPriceCents ?? null,
            dailyPriceCents: (series as any).defaultDailyPriceCents ?? null,
            weeklyPriceCents: (series as any).defaultWeeklyPriceCents ?? null,
            monthlyPriceCents: (series as any).defaultMonthlyPriceCents ?? null,
          });

          if (!publicReady) {
            return res.status(409).json({
              message:
                "Parking Pass can’t go live yet. Fix pricing, address, hours, spots, and payments first.",
            });
          }
        }

        // Generate occurrence events based on recurrence rule
        // For MVP: Support simple weekly recurrence
        const occurrences: InsertEvent[] = generateOccurrences({
          startDate,
          endDate,
          recurrenceRule: series.recurrenceRule,
          defaults: {
            hostId: series.hostId,
            coordinatorUserId: series.coordinatorUserId ?? req.user.id,
            seriesId: series.id,
            name: series.name,
            description: series.description,
            startTime: series.defaultStartTime,
            endTime: series.defaultEndTime,
            maxTrucks: series.defaultMaxTrucks,
            hardCapEnabled: series.defaultHardCapEnabled,
          },
        });

        // Batch insert occurrences
        for (const occurrence of occurrences) {
          await storage.createEvent(occurrence);
        }

        // Mark series as published
        const publishedSeries = await storage.publishEventSeries(seriesId);

        // Telemetry
        await storage.createTelemetryEvent({
          eventName: "event_series_published",
          userId: req.user.id,
          properties: {
            seriesId: publishedSeries.id,
            occurrencesGenerated: occurrences.length,
          },
        });

        // Notify nearby trucks about the new series (fire-and-forget, only for event/open_call types)
        if (series.seriesType !== "parking_pass" && host) {
          void notifyNearbyTrucksOfNewSeries(
            {
              id: publishedSeries.id,
              name: series.name,
              description: series.description,
              startDate: new Date(series.startDate),
              endDate: new Date(series.endDate),
              defaultStartTime: series.defaultStartTime,
              defaultEndTime: series.defaultEndTime,
            },
            {
              businessName: host.businessName,
              city: (host as any).city ?? null,
              state: (host as any).state ?? null,
              address: host.address,
            },
          );
        }

        res.json({
          series: publishedSeries,
          occurrencesGenerated: occurrences.length,
        });
      } catch (error: any) {
        console.error("Error publishing event series:", error);
        res.status(500).json({ message: "Failed to publish event series" });
      }
    },
  );

  // List all event series for a host (supports multi-location: any host profile owned by this user)
  app.get("/api/hosts/event-series", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      // Use getHostsByUserId (plural) so multi-location hosts can see series for all their locations.
      const hostList = await storage.getHostsByUserId(userId);
      if (!hostList || hostList.length === 0) {
        return res.status(404).json({ message: "Host profile not found" });
      }

      const seriesList = await storage.getEventSeriesOwnedByUser(userId);
      res.json(seriesList);
    } catch (error: any) {
      console.error("Error fetching event series:", error);
      res.status(500).json({ message: "Failed to fetch event series" });
    }
  });

  // Get occurrences for a specific series
  app.get(
    "/api/hosts/event-series/:seriesId/occurrences",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { seriesId } = req.params;
        const userId = req.user.id;

        const series = await storage.getEventSeries(seriesId);
        if (!series) {
          return res.status(404).json({ message: "Event series not found" });
        }

        const host = await getHostByUserId(userId);
        if (!userOwnsSeries(userId, host, series)) {
          return res
            .status(403)
            .json({ message: "Not authorized to view this series" });
        }

        const occurrences = await storage.getEventsBySeriesId(seriesId);
        res.json(occurrences);
      } catch (error: any) {
        console.error("Error fetching series occurrences:", error);
        res.status(500).json({ message: "Failed to fetch occurrences" });
      }
    },
  );

  // Cancel an event series (soft-close future occurrences)
  app.post(
    "/api/hosts/event-series/:seriesId/cancel",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { seriesId } = req.params;
        const userId = req.user.id;

        const series = await storage.getEventSeries(seriesId);
        if (!series) {
          return res.status(404).json({ message: "Event series not found" });
        }

        const host = await getHostByUserId(userId);
        if (!userOwnsSeries(userId, host, series)) {
          return res
            .status(403)
            .json({ message: "Not authorized to cancel this series" });
        }

        if (series.status === "closed") {
          return res
            .status(400)
            .json({ message: "Series is already cancelled" });
        }

        // Get all occurrences for this series
        const allOccurrences = await storage.getEventsBySeriesId(seriesId);

        // Filter to future occurrences only
        const futureOccurrences = filterFutureOccurrences(
          allOccurrences,
          new Date(),
        );

        if (futureOccurrences.length === 0) {
          return res
            .status(400)
            .json({ message: "No future occurrences to cancel" });
        }

        // Collect all affected trucks (interested + accepted)
        const affectedTrucks = new Map<
          string,
          { truckId: string; dates: string[] }
        >();

        for (const occurrence of futureOccurrences) {
          const interests = await storage.getEventInterestsByEventId(
            occurrence.id,
          );

          for (const interest of interests) {
            if (
              interest.status === "pending" ||
              interest.status === "accepted"
            ) {
              const key = interest.truckId;
              if (!affectedTrucks.has(key)) {
                affectedTrucks.set(key, {
                  truckId: interest.truckId,
                  dates: [],
                });
              }
              affectedTrucks
                .get(key)!
                .dates.push(
                  dateKeyInZone(
                    occurrence.date,
                    String(series.timezone || "America/Chicago"),
                  ),
                );
            }
          }
        }

        // Cancel all future occurrences
        for (const occurrence of futureOccurrences) {
          await db
            .update(events)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(eq(events.id, occurrence.id));
        }

        // Mark series as closed
        await db
          .update(eventSeries)
          .set({ status: "closed", updatedAt: new Date() })
          .where(eq(eventSeries.id, seriesId));

        // Send notifications (fire and forget)
        (async () => {
          try {
            for (const [, { truckId, dates }] of Array.from(affectedTrucks)) {
              const truck = await storage.getRestaurant(truckId);
              if (truck) {
                const owner = await storage.getUser(truck.ownerId);
                if (
                  owner &&
                  owner.email &&
                  canEmailForTopic((owner as any).accountSettings, "nearbyEvents")
                ) {
                  await emailService.sendSeriesCancellationNotification(
                    owner.email,
                    truck.name,
                    series.name,
                    dates,
                  );
                }
              }
            }

            if (series.coordinatorUserId) {
              const coordinator = await storage.getUser(
                series.coordinatorUserId,
              );
              if (
                coordinator?.email &&
                isEmailChannelEnabled((coordinator as any).accountSettings) &&
                isCoordinatorUpdatesTopicEnabled(
                  (coordinator as any).accountSettings,
                )
              ) {
                const occurrenceCount = futureOccurrences.length;
                await emailService.sendBasicEmail(
                  coordinator.email,
                  `Series update: ${series.name} was cancelled`,
                  `<p>Your event series <strong>${series.name}</strong> was cancelled.</p><p>${occurrenceCount} future occurrence(s) were closed.</p>`,
                  `Your event series "${series.name}" was cancelled. ${occurrenceCount} future occurrence(s) were closed.`,
                  "general",
                );
              }
            }
          } catch (err) {
            console.error("Failed to send cancellation notifications:", err);
          }
        })();

        // Telemetry
        await storage.createTelemetryEvent({
          eventName: "series_cancelled",
          userId: req.user.id,
          properties: {
            seriesId,
            futureOccurrencesCancelled: futureOccurrences.length,
            trucksNotified: affectedTrucks.size,
          },
        });

        res.json({
          message: "Series cancelled successfully",
          futureOccurrencesCancelled: futureOccurrences.length,
          trucksNotified: affectedTrucks.size,
        });
      } catch (error: any) {
        console.error("Error cancelling series:", error);
        res.status(500).json({ message: "Failed to cancel series" });
      }
    },
  );
}
