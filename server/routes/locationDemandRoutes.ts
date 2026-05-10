import type { Express } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { storage } from "../storage";
import { db } from "../db";
import { emailService } from "../emailService";
import { distributedRateLimit } from "../middleware/distributedRateLimit";
import { isAuthenticated, isRestaurantOwner } from "../unifiedAuth";
import { forwardGeocode } from "../utils/geocoding";
import { sendTruckInterestNotification } from "../emailNotifications";
import { notifyUser } from "../productNotifications";
import { handleHostPartnerLeadRequest } from "../services/hostPartnerLeadMagnet";
import { canEmailForTopic } from "../utils/notificationPreferences";
import {
  insertHostLocationClaimSchema,
  insertHostPartnerLeadSchema,
  insertLocationRequestSchema,
  insertTruckInterestSchema,
  restaurants,
  truckInterests,
  users,
} from "@shared/schema";

export function registerLocationDemandRoutes(app: Express) {
  const hostPartnerBurstLimiter = distributedRateLimit({
    scope: "host-partner:burst",
    limit: 6,
    windowMs: 5 * 60 * 1000,
    key: (req) => {
      const ua = String(req.get("User-Agent") || "").slice(0, 80);
      return `${req.ip}:${ua}`;
    },
  });
  const hostPartnerDailyLimiter = distributedRateLimit({
    scope: "host-partner:daily",
    limit: 40,
    windowMs: 24 * 60 * 60 * 1000,
  });
  const hostPartnerEmailLimiter = distributedRateLimit({
    scope: "host-partner:email",
    limit: 3,
    windowMs: 60 * 60 * 1000,
    key: (req) => {
      const email = String((req as any).body?.email || "")
        .trim()
        .toLowerCase();
      return email || String(req.ip || "unknown");
    },
  });

  app.post(
    "/api/public/host-partner-leads",
    hostPartnerBurstLimiter,
    hostPartnerDailyLimiter,
    hostPartnerEmailLimiter,
    async (req: any, res) => {
      try {
        const parsed = insertHostPartnerLeadSchema.parse(req.body);
        const result = await handleHostPartnerLeadRequest({
          ...parsed,
          ip: String(req.ip || ""),
          userAgent: String(req.get("User-Agent") || ""),
        });

        if (!result.ok && result.code === "disabled") {
          return res.status(503).json({
            ok: false,
            message: "Host partner intake is temporarily unavailable.",
          });
        }

        return res.json({
          ok: true,
          leadId: (result as any).leadId,
          emailed: (result as any).emailed ?? false,
        });
      } catch (error: any) {
        console.error("Error creating host partner lead:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            ok: false,
            message: "Invalid host partner lead data",
            errors: error.errors,
          });
        }
        return res.status(500).json({
          ok: false,
          message: "Unable to save host partner lead right now",
        });
      }
    },
  );

  app.post("/api/location-requests", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const parsed = insertLocationRequestSchema.parse({
        ...req.body,
        postedByUserId: userId,
      });

      let coords: { lat: number; lng: number } | null = null;
      if (parsed.address) {
        const geocodeAddress = [parsed.address, "USA"].join(", ");
        try {
          coords = await forwardGeocode(geocodeAddress);
        } catch {
          coords = null;
        }
      }

      const created = await storage.createLocationRequest({
        ...parsed,
        latitude: coords ? coords.lat.toString() : (parsed.latitude ?? null),
        longitude: coords ? coords.lng.toString() : (parsed.longitude ?? null),
      });
      res
        .status(201)
        .json({ message: "Location request submitted", request: created });
    } catch (error: any) {
      console.error("Error creating location request:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "Invalid location request data",
          errors: error.errors,
        });
      }
      res.status(400).json({
        message: error.message || "Failed to create location request",
      });
    }
  });

  app.get("/api/location-requests/demand", async (req: any, res) => {
    try {
      const limit = Number(req.query?.limit ?? 100) || 100;
      const queue = await storage.getLocationDemandQueue(limit);
      res.json({
        generatedAt: new Date().toISOString(),
        count: queue.length,
        queue: queue.map((row) => ({
          id: row.id,
          businessName: row.businessName,
          address: row.address,
          locationType: row.locationType,
          preferredDates: row.preferredDates,
          expectedFootTraffic: row.expectedFootTraffic,
          minInterestedTrucks: row.minInterestedTrucks,
          demandStatus: row.demandStatus,
          status: row.status,
          thresholdReachedAt: row.thresholdReachedAt,
          interestCount: row.interestCount,
          thresholdRemaining: row.thresholdRemaining,
          latitude: row.latitude,
          longitude: row.longitude,
          createdAt: row.createdAt,
        })),
      });
    } catch (error) {
      console.error("Error loading location demand queue:", error);
      res.status(500).json({ message: "Failed to load location demand queue" });
    }
  });

  app.get(
    "/api/location-requests/demand/me",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const limit = Number(req.query?.limit ?? 100) || 100;
        const queue = await storage.getLocationDemandQueueByUser(
          String(req.user?.id || ""),
          limit,
        );
        res.json({
          generatedAt: new Date().toISOString(),
          count: queue.length,
          queue: queue.map((row) => ({
            id: row.id,
            businessName: row.businessName,
            address: row.address,
            locationType: row.locationType,
            preferredDates: row.preferredDates,
            expectedFootTraffic: row.expectedFootTraffic,
            minInterestedTrucks: row.minInterestedTrucks,
            demandStatus: row.demandStatus,
            status: row.status,
            thresholdReachedAt: row.thresholdReachedAt,
            interestCount: row.interestCount,
            thresholdRemaining: row.thresholdRemaining,
            createdAt: row.createdAt,
          })),
        });
      } catch (error) {
        console.error("Error loading my location demand queue:", error);
        res.status(500).json({ message: "Failed to load my location demand queue" });
      }
    },
  );

  app.get("/api/location-requests/:id/summary", async (req: any, res) => {
    try {
      const requestId = String(req.params?.id || "").trim();
      if (!requestId) {
        return res.status(400).json({ message: "Location request ID required" });
      }

      const locationRequest = await storage.getLocationRequestById(requestId);
      if (!locationRequest) {
        return res.status(404).json({ message: "Location request not found" });
      }

      const queue = await storage.getLocationDemandQueue(250);
      const match = queue.find((row) => String(row.id) === requestId);
      const interestCount = Number(match?.interestCount ?? 0);
      const minInterestedTrucks = Math.max(
        1,
        Number(locationRequest.minInterestedTrucks ?? 3) || 3,
      );

      res.json({
        id: locationRequest.id,
        demandStatus: locationRequest.demandStatus,
        status: locationRequest.status,
        interestCount,
        minInterestedTrucks,
        thresholdRemaining: Math.max(0, minInterestedTrucks - interestCount),
        thresholdReached: interestCount >= minInterestedTrucks,
        thresholdReachedAt: locationRequest.thresholdReachedAt,
        createdAt: locationRequest.createdAt,
      });
    } catch (error) {
      console.error("Error loading location request summary:", error);
      res.status(500).json({ message: "Failed to load location request summary" });
    }
  });

  app.post(
    "/api/location-requests/:id/claim",
    isAuthenticated,
    async (req: any, res) => {
      try {
        const locationRequestId = String(req.params?.id || "").trim();
        if (!locationRequestId) {
          return res.status(400).json({ message: "Location request ID required" });
        }

        const parsed = insertHostLocationClaimSchema.parse({
          ...req.body,
          locationRequestId,
          claimedByUserId: req.user.id,
        });

        const locationRequest =
          await storage.getLocationRequestById(locationRequestId);
        if (!locationRequest) {
          return res.status(404).json({ message: "Location request not found" });
        }
        if (locationRequest.status !== "open") {
          return res.status(400).json({ message: "Location request is closed" });
        }

        const claim = await storage.createHostLocationClaim(parsed);
        res.status(201).json({
          message: "Demand location claimed",
          claimId: claim.id,
          status: claim.status,
        });
      } catch (error: any) {
        console.error("Error creating location request claim:", error);
        if (error instanceof z.ZodError) {
          return res
            .status(400)
            .json({ message: "Invalid claim data", errors: error.errors });
        }
        if (error?.code === "23505") {
          return res.status(409).json({
            message: "You already claimed this location request",
          });
        }
        res.status(500).json({ message: "Failed to claim location request" });
      }
    },
  );

  app.post(
    "/api/location-requests/:id/interests",
    isRestaurantOwner,
    async (req: any, res) => {
      try {
        const { id: locationRequestId } = req.params;
        const { restaurantId, message } = req.body;

        if (!restaurantId) {
          return res.status(400).json({ message: "Restaurant ID is required" });
        }

        const ownsRestaurant = await storage.verifyRestaurantOwnership(
          restaurantId,
          req.user.id,
          "manageParkingPass",
        );
        if (!ownsRestaurant) {
          return res
            .status(403)
            .json({ message: "You can only respond for restaurants you own" });
        }

        const parsed = insertTruckInterestSchema.parse({
          locationRequestId,
          restaurantId,
          message,
        });

        const result = await storage.createTruckInterest(parsed);
        await sendTruckInterestNotification(
          result.locationRequest,
          restaurantId,
          message,
        );
        const locationHostUser = await storage.getUser(
          result.locationRequest.postedByUserId,
        );
        const interestedTruck = await storage.getRestaurant(restaurantId);
        if (locationHostUser && interestedTruck) {
          await notifyUser({
            user: locationHostUser,
            topic: "businessMessages",
            title: `${interestedTruck.name} responded to your location request`,
            body: `${interestedTruck.name} is interested in serving at ${result.locationRequest.businessName}.`,
            actionUrl: "/parking-pass",
            priority: "high",
            sourceType: "truck_location_interest",
            sourceId: result.locationRequest.id,
            actorUserId: req.user.id,
            channels: ["in_app", "sms"],
            smsText: `MealScout: ${interestedTruck.name} responded to your location request. Open Parking Pass to follow up.`,
            metadata: {
              locationRequestId: result.locationRequest.id,
              restaurantId,
              truckOwnerId: req.user.id,
              messageLength: String(message || "").trim().length,
              source: "parking_pass_location_request",
            },
          });
        }

        if (result.thresholdJustReached) {
          if (
            locationHostUser?.email &&
            canEmailForTopic(
              (locationHostUser as any).accountSettings,
              "businessMessages",
            )
          ) {
            const thresholdSubject = `${result.locationRequest.businessName} is now demand-qualified`;
            const thresholdHtml = `
              <p>Your requested location reached its demand threshold.</p>
              <p><strong>Location:</strong> ${result.locationRequest.businessName}</p>
              <p><strong>Address:</strong> ${result.locationRequest.address}</p>
              <p><strong>Interested trucks:</strong> ${result.interestCount}</p>
              <p><strong>Required:</strong> ${result.minInterestedTrucks}</p>
              <p><a href="${(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "")}/customer-signup?role=host">Claim this demand and publish your first paid slot</a></p>
            `;
            await emailService
              .sendBasicEmail(locationHostUser.email, thresholdSubject, thresholdHtml)
              .catch(() => undefined);
          }

          const truckAudience = await db
            .selectDistinct({
              email: users.email,
              accountSettings: users.accountSettings,
            })
            .from(truckInterests)
            .innerJoin(
              restaurants,
              eq(restaurants.id, truckInterests.restaurantId),
            )
            .innerJoin(users, eq(users.id, restaurants.ownerId))
            .where(eq(truckInterests.locationRequestId, locationRequestId));
          const truckEmails = truckAudience
            .filter((row: { accountSettings: unknown }) =>
              canEmailForTopic(row.accountSettings, "nearbyEvents"),
            )
            .map((row: { email: string | null }) => String(row.email || "").trim())
            .filter(Boolean);

          if (truckEmails.length > 0) {
            const baseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
            const truckSubject = `${result.locationRequest.businessName} is opening for booking`;
            const truckHtml = `
              <p>This location request hit its demand threshold and is moving into host onboarding.</p>
              <p><strong>Location:</strong> ${result.locationRequest.businessName}</p>
              <p><strong>Address:</strong> ${result.locationRequest.address}</p>
              <p><strong>Interested trucks:</strong> ${result.interestCount}</p>
              <p><a href="${baseUrl}/parking-pass">Open Parking Pass bookings</a></p>
            `;
            await Promise.all(
              truckEmails.map((email: string) =>
                emailService
                  .sendBasicEmail(email, truckSubject, truckHtml)
                  .catch(() => undefined),
              ),
            );
          }
        }

        res.status(201).json({
          message: "Interest sent to host",
          interestId: result.interestId,
          interestCount: result.interestCount,
          minInterestedTrucks: result.minInterestedTrucks,
          thresholdReached: result.thresholdReached,
        });
      } catch (error: any) {
        console.error("Error expressing truck interest:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Invalid truck interest data",
            errors: error.errors,
          });
        }

        if (error.message === "Location request not found") {
          return res
            .status(404)
            .json({ message: "Location request not found" });
        }
        if (error.message === "Location request is not open") {
          return res.status(400).json({
            message: "Location request is not accepting new interest",
          });
        }
        if (error.message === "Truck already interested") {
          return res.status(409).json({
            message: "This truck has already shown interest in this location",
          });
        }

        res.status(500).json({ message: "Failed to submit interest" });
      }
    },
  );
}
