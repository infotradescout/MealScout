import type { Express } from "express";
import { z } from "zod";
import { isAuthenticated } from "../../unifiedAuth";
import { storage } from "../../storage";
import { db } from "../../db";
import { insertHostSchema, hosts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { forwardGeocode } from "../../utils/geocoding";
import { getHostByUserId } from "../../services/hostOwnership";
import {
  buildLocationKey,
  buildGeocodeAddress,
} from "./shared";

export function registerHostProfileRoutes(app: Express) {
  // POST /api/hosts - Create a new host profile
  app.post("/api/hosts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const locationRequestClaimId = String(
        req.body?.locationRequestClaimId || "",
      ).trim();
      // Check if host profile already exists
      const existing = await getHostByUserId(userId);
      if (existing) {
        return res.status(400).json({ message: "Host profile already exists" });
      }

      const parsed = insertHostSchema.parse({
        ...req.body,
        userId,
      });

      const existingHosts = await db
        .select({
          id: hosts.id,
          address: hosts.address,
          city: hosts.city,
          state: hosts.state,
        })
        .from(hosts)
        .where(eq(hosts.userId, userId));

      const newKey = buildLocationKey(
        parsed.address,
        parsed.city ?? null,
        parsed.state ?? null,
      );
      const hasDuplicate = existingHosts.some(
        (host: (typeof existingHosts)[number]) =>
          buildLocationKey(host.address, host.city, host.state) === newKey,
      );
      if (hasDuplicate) {
        return res.status(409).json({
          message:
            "You already have a location for this address. Edit the existing location instead.",
        });
      }

      const rawLat = parsed.latitude ?? null;
      const rawLng = parsed.longitude ?? null;
      const manualLat =
        rawLat === null || rawLat === undefined ? null : Number(rawLat);
      const manualLng =
        rawLng === null || rawLng === undefined ? null : Number(rawLng);
      const hasManualCoords = rawLat !== null || rawLng !== null;
      if (
        hasManualCoords &&
        (!Number.isFinite(manualLat) || !Number.isFinite(manualLng))
      ) {
        return res.status(400).json({ message: "Invalid coordinates" });
      }
      const manualCoords =
        hasManualCoords && manualLat !== null && manualLng !== null
          ? { lat: manualLat, lng: manualLng }
          : null;
      if (
        manualCoords &&
        (manualCoords.lat < -90 ||
          manualCoords.lat > 90 ||
          manualCoords.lng < -180 ||
          manualCoords.lng > 180)
      ) {
        return res.status(400).json({ message: "Invalid coordinates" });
      }

      const geocodeAddress = buildGeocodeAddress(
        parsed.address,
        parsed.city ?? null,
        parsed.state ?? null,
      );
      let coords: { lat: number; lng: number } | null = null;
      if (!manualCoords && geocodeAddress) {
        try {
          coords = await forwardGeocode(geocodeAddress);
        } catch {
          coords = null;
        }
      }

      const host = await storage.createHost({
        ...parsed,
        latitude: manualCoords
          ? manualCoords.lat.toString()
          : coords
            ? coords.lat.toString()
            : null,
        longitude: manualCoords
          ? manualCoords.lng.toString()
          : coords
            ? coords.lng.toString()
            : null,
      });
      const parkingPassSeriesReady = await storage
        .ensureDraftParkingPassForHost(host.id)
        .catch(() => false);

      if (locationRequestClaimId) {
        await storage
          .convertHostLocationClaim(locationRequestClaimId, host.id, userId)
          .catch((error: any) => {
            console.error("Failed to convert host location claim:", error);
          });
      }

      // Hosts should keep their existing user type (typically "customer").
      // We no longer auto-upgrade hosts into restaurant_owner accounts so
      // they don't see restaurant dashboards or deal creation flows.

      res.status(201).json({
        ...host,
        parkingPassSeriesReady,
        locationRequestClaimId: locationRequestClaimId || null,
      });
    } catch (error: any) {
      console.error("Error creating host:", error);
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid host data", errors: error.errors });
      }
      res
        .status(400)
        .json({ message: error.message || "Failed to create host profile" });
    }
  });

  // GET /api/hosts/me - Get the current user's host profile
  app.get("/api/hosts/me", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      let host = await getHostByUserId(userId);
      if (!host) {
        const hostProfiles = await storage.getHostsByUserId(userId);
        host = hostProfiles[0];
      }
      if (!host) {
        return res.status(404).json({ message: "Host profile not found" });
      }
      res.json(host);
    } catch (error: any) {
      console.error("Error fetching host profile:", error);
      res.status(404).json({ message: "Host profile not found" });
    }
  });
}
