import type { Express } from "express";

import { emailService } from "../emailService";
import { storage } from "../storage";
import { isAuthenticated } from "../unifiedAuth";
import { canEmailForTopic } from "../utils/notificationPreferences";

type HostInterestRoutesDependencies = {
  getHostByUserId: (userId: string) => Promise<any>;
  getEventAndHostForUser: (
    eventId: string,
    userId: string,
  ) => Promise<{ event: any; host?: any }>;
  getInterestEventAndHostForUser: (
    interestId: string,
    userId: string,
  ) => Promise<{ interest: any; event: any; host?: any }>;
  userOwnsEvent: (userId: string, host: any, event: any) => boolean;
  computeAcceptedCount: (interests: any[]) => number;
  shouldBlockAcceptance: (params: {
    hardCapEnabled: boolean;
    acceptedCount: number;
    maxTrucks: number;
  }) => boolean;
  buildCapacityFullError: () => Record<string, any>;
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
    getInterestEventAndHostForUser,
    userOwnsEvent,
    computeAcceptedCount,
    shouldBlockAcceptance,
    buildCapacityFullError,
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

        const { interest, event, host } = await getInterestEventAndHostForUser(
          interestId,
          userId,
        );

        if (!interest) {
          return res.status(404).json({ message: "Interest not found" });
        }

        if (!event) {
          return res.status(404).json({ message: "Event not found" });
        }

        if (!userOwnsEvent(userId, host, event)) {
          return res
            .status(403)
            .json({ message: "Not authorized to manage this event" });
        }

        if (interest.status === status) {
          return res.json(interest);
        }

        if (status === "accepted" && event.hardCapEnabled) {
          const currentInterests = await storage.getEventInterestsByEventId(
            event.id,
          );
          const acceptedCount = computeAcceptedCount(currentInterests);

          if (
            shouldBlockAcceptance({
              hardCapEnabled: event.hardCapEnabled,
              acceptedCount,
              maxTrucks: event.maxTrucks,
            })
          ) {
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

            return res.status(400).json(buildCapacityFullError());
          }
        }

        const updatedInterest = await storage.updateEventInterestStatus(
          interestId,
          status,
        );

        (async () => {
          try {
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
