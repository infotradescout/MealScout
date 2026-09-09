import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { emailService } from "../emailService";
import { insertEventSeriesSchema } from "@shared/schema";
import { isAuthenticated } from "../unifiedAuth";
import { getHostByUserId, userOwnsSeries } from "../services/hostOwnership";
import { assertMaxSpan180Days } from "../services/openCallSeries";
import {
  dateKeyFromUnknown,
  dateKeyInZone,
  utcDateFromDateKey,
} from "../services/dateKeys";
import { isParkingPassPublicReady } from "../services/parkingPassQuality";
import { notifyNearbyTrucksOfNewSeries } from "../truckEventMatchService";
import { canEmailForTopic } from "../utils/notificationPreferences";
import { requireIdempotencyKey } from "../middleware/idempotency";
import {
  cancelCoordinatedSeries,
  EventParticipationMutationError,
} from "../services/eventParticipationMutationService";
import {
  EventSeriesPublicationError,
  publishEventSeriesDurably,
} from "../services/eventSeriesPublicationService";
import { resolveCityTimeZoneStrict } from "../services/cityTimeZone";
import { normalizePersistedIanaTimeZone } from "../services/persistedServiceTimeZoneRules";

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

        const venueTimeZone = await resolveCityTimeZoneStrict({
          city: host.city,
          state: host.state,
        });
        if (!venueTimeZone) {
          return res.status(409).json({
            code: "venue_timezone_unavailable",
            message:
              "This venue needs one unambiguous persisted city timezone before an event series can be created.",
          });
        }
        const parsed = insertEventSeriesSchema.parse({
          ...req.body,
          hostId: host.id,
          coordinatorUserId: req.user.id,
          // Request-supplied timezone is never authority for a new series.
          timezone: venueTimeZone,
        });

        // Validation: End date must be after start date
        const startDateKey = dateKeyFromUnknown(parsed.startDate, "UTC");
        const endDateKey = dateKeyFromUnknown(parsed.endDate, "UTC");
        if (!startDateKey || !endDateKey || endDateKey <= startDateKey) {
          return res
            .status(400)
            .json({ message: "End date must be after start date" });
        }

        // Validation: Max 180 days recurrence span
        assertMaxSpan180Days(
          utcDateFromDateKey(startDateKey),
          utcDateFromDateKey(endDateKey),
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
    requireIdempotencyKey({ scope: "host_event_series_publication" }),
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

        const seriesTimeZone = normalizePersistedIanaTimeZone(series.timezone);
        const startDateKey = dateKeyFromUnknown(series.startDate, "UTC");
        const endDateKey = dateKeyFromUnknown(series.endDate, "UTC");
        if (!seriesTimeZone || !startDateKey || !endDateKey) {
          return res.status(409).json({
            code: "event_series_time_authority_unavailable",
            message:
              "This series does not have authoritative timezone and date boundaries.",
          });
        }
        const startDate = utcDateFromDateKey(startDateKey);
        const endDate = utcDateFromDateKey(endDateKey);

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

        // Persist the parent and complete frozen child set before any event is
        // inserted. Children remain private drafts through interruption and
        // become visible together in one guarded final transaction.
        const publication = await publishEventSeriesDurably({
          seriesId,
          actorUserId: userId,
          requestId: String(req.headers["idempotency-key"] || "").trim(),
        });
        if (!publication) {
          throw new EventSeriesPublicationError(
            409,
            "event_series_publication_unavailable",
            "The durable publication operation is unavailable.",
          );
        }
        const publishedSeries = publication.series || series;
        const publicationStatus = String(publication.operation.status || "");

        // Telemetry
        await storage.createTelemetryEvent({
          eventName: "event_series_published",
          userId: req.user.id,
          properties: {
            seriesId: publishedSeries.id,
            occurrencesGenerated: publication.occurrencesGenerated,
            publicationOperationId: publication.operation.id,
            publicationStatus,
          },
        });

        // Notify nearby trucks about the new series (fire-and-forget, only for event/open_call types)
        if (
          publicationStatus === "converged" &&
          series.seriesType !== "parking_pass" &&
          host
        ) {
          void notifyNearbyTrucksOfNewSeries(
            {
              id: publishedSeries.id,
              name: series.name,
              description: series.description,
              startDate,
              endDate,
              defaultStartTime: series.defaultStartTime,
              defaultEndTime: series.defaultEndTime,
              timezone: seriesTimeZone,
            },
            {
              businessName: host.businessName,
              city: (host as any).city ?? null,
              state: (host as any).state ?? null,
              address: host.address,
            },
          );
        }

        res
          .status(
            publicationStatus === "converged" ? 200 : 202,
          )
          .json({
            series: publishedSeries,
            occurrencesGenerated: publication.occurrencesGenerated,
            publicationOperation: publication.operation,
            publicationChildren: publication.children,
          });
      } catch (error: any) {
        console.error("Error publishing event series:", error);
        if (error instanceof EventSeriesPublicationError) {
          return res.status(error.statusCode).json({
            message: error.message,
            code: error.code,
            details: error.details,
          });
        }
        if (error instanceof EventParticipationMutationError) {
          return res.status(error.statusCode).json({
            message: error.message,
            code: error.code,
            details: error.details,
          });
        }
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
    requireIdempotencyKey({ scope: "host_event_series_cancellation" }),
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

        const result = await cancelCoordinatedSeries({
          seriesId,
          actor: { userId },
          requestId: String(req.headers["idempotency-key"] || "").trim(),
        });
        const mutationStatus = String(result.fanout.mutation.status || "");
        const notificationChildren = result.fanout.children.filter(
          (child: any) => child.childKind === "notification",
        );
        const futureOccurrencesCancelled = result.eventResults.filter(
          (occurrence: any) => occurrence.status === "cancelled",
        ).length;

        // Telemetry
        await storage.createTelemetryEvent({
          eventName: "series_cancelled",
          userId: req.user.id,
          properties: {
            seriesId,
            mutationId: result.fanout.mutation.id,
            mutationStatus,
            futureOccurrencesCancelled,
            participantNoticesConverged: notificationChildren.filter(
              (child: any) => child.status === "converged",
            ).length,
          },
        });

        res.status(mutationStatus === "converged" ? 200 : 202).json({
          message:
            mutationStatus === "converged"
              ? "Series cancellation converged."
              : "Series cancellation is suppressed and still needs remedy or notification recovery.",
          futureOccurrencesCancelled,
          participantNotices: notificationChildren.length,
          mutation: result.fanout.mutation,
          children: result.fanout.children,
          operations: result.fanout.operations,
        });
      } catch (error: any) {
        console.error("Error cancelling series:", error);
        if (error instanceof EventParticipationMutationError) {
          return res.status(error.statusCode).json({
            message: error.message,
            code: error.code,
            details: error.details,
          });
        }
        res.status(500).json({ message: "Failed to cancel series" });
      }
    },
  );
}
