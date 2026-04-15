import type { Express } from "express";
import { isAuthenticated } from "../../unifiedAuth";
import { storage } from "../../storage";
import {
  listParkingPassOccurrences,
  ensureParkingPassEventRow,
} from "../../services/parkingPassVirtual";
import { computeParkingPassQualityFlags } from "../../services/parkingPassQuality";
import { getEventAndHostForUser } from "../../services/hostOwnership";

export function registerHostEventsRoutes(app: Express) {
  const createHostParkingPassListing = async (req: any, res: any) => {
    try {
      // This handler is a delegator - actual implementation remains in hostRoutes
      // for now due to complex dependencies on parking pass virtual services
      return res.status(501).json({ message: "Handler not yet extracted" });
    } catch (error: any) {
      console.error("Error creating parking pass listing:", error);
      res
        .status(500)
        .json({ message: "Failed to create parking pass listing" });
    }
  };

  const listHostParkingPassListings = async (req: any, res: any) => {
    try {
      const userId = req.user.id;
      const hostId = req.query?.hostId;
      if (!hostId) {
        return res.status(400).json({ message: "Host ID required" });
      }
      const host = await storage.getHost(hostId);
      if (!host || host.userId !== userId) {
        return res.status(404).json({ message: "Host profile not found" });
      }

      const { occurrences } = await listParkingPassOccurrences({
        hostIds: [host.id],
        horizonDays: 90,
        includeDraft: true,
      });
      const legacyEvents =
        occurrences.length > 0
          ? []
          : (await storage.getEventsByHost(host.id)).filter(
              (event: any) =>
                event?.eventType === "parking_pass" && event?.requiresPayment,
            );

      const deduped = new Map<string, any>();
      for (const item of [...occurrences, ...legacyEvents]) {
        deduped.set(item.id, {
          ...item,
          qualityFlags: computeParkingPassQualityFlags(item),
        });
      }

      res.json(Array.from(deduped.values()));
    } catch (error: any) {
      console.error("Error fetching parking pass listings:", error);
      res
        .status(500)
        .json({ message: "Failed to fetch parking pass listings" });
    }
  };

  // POST /api/hosts/events - Create parking pass listing (delegated)
  app.post("/api/hosts/events", isAuthenticated, createHostParkingPassListing);

  // GET /api/hosts/events - List parking pass listings
  app.get("/api/hosts/events", isAuthenticated, listHostParkingPassListings);
}
