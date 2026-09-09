import type { Express } from "express";

import { storage } from "../storage";
import { isAuthenticated } from "../unifiedAuth";
import { canEmailForTopic } from "../utils/notificationPreferences";
import { deliverInterestStatusEventNotification } from "../services/eventNotificationDeliveryService";
import {
  decideEventInterest,
  EventInterestDecisionError,
} from "../services/eventInterestDecisionService";

type HostInterestRoutesDependencies = {
  getHostByUserId: (userId: string) => Promise<any>;
  getEventAndHostForUser: (
    eventId: string,
    userId: string,
  ) => Promise<{ event: any; host?: any }>;
  userOwnsEvent: (userId: string, host: any, event: any) => boolean;
  computeFillRate: (params: {
    acceptedCount: number;
    maxTrucks: number;
  }) => number;
};

export function registerHostInterestRoutes(
  app: Express,
  {
    getHostByUserId,
    getEventAndHostForUser,
    userOwnsEvent,
    computeFillRate,
  }: HostInterestRoutesDependencies,
) {
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

        const decision = await decideEventInterest({
          interestId,
          status,
          actorUserId: userId,
          actorRole: req.user.userType,
        });
        const interest = decision.interest;
        const event = decision.event;
        const host = decision.host;
        if (decision.replayed) return res.json(interest);

        (async () => {
          try {
            const acceptedCount = decision.acceptedCount;
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
              const owner = await storage.getUser(truck.ownerId);
              if (
                owner &&
                owner.email &&
                canEmailForTopic((owner as any).accountSettings, "nearbyEvents")
              ) {
                await deliverInterestStatusEventNotification({
                  interestId: interest.id,
                  eventId: event.id,
                  eventDate: event.date,
                  seriesId: event.seriesId,
                  hostCity: host?.city,
                  hostState: host?.state,
                  recipientUserId: owner.id,
                  recipientEmail: owner.email,
                  truckName: truck.name,
                  hostName: host.businessName,
                  status: status as "accepted" | "declined",
                });
              }
            }
          } catch (err) {
            console.error("Failed to send status update notification:", err);
          }
        })();

        res.json(interest);
      } catch (error: any) {
        if (error instanceof EventInterestDecisionError) {
          if (error.code === "capacity_reached") {
            await storage.createTelemetryEvent({
              eventName: "interest_accept_blocked",
              userId: req.user.id,
              properties: {
                reason: "capacity_guard_limit_reached",
                ...error.details,
              },
            });
          }
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
        res.status(500).json({ message: "Failed to update status" });
      }
    },
  );

  app.get(
    "/api/hosts/events/:eventId/interests",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const { eventId } = req.params;
        const userId = req.user.id;

        const host = await getHostByUserId(userId);
        if (!host) {
          return res.status(403).json({ message: "Not a host" });
        }

        const { event } = await getEventAndHostForUser(eventId, userId);
        if (!event || !userOwnsEvent(userId, host, event)) {
          return res.status(404).json({ message: "Event not found" });
        }

        const interests = await storage.getEventInterestsByEventId(eventId);
        res.json(interests);
      } catch (error: any) {
        console.error("Error fetching event interests:", error);
        res.status(500).json({ message: "Failed to fetch interests" });
      }
    },
  );
}
