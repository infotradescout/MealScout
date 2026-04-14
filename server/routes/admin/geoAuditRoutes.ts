import type { Express } from "express";
import { eq, and, inArray, or, sql, isNull } from "drizzle-orm";
import { db } from "../../db";
import { storage } from "../../storage";
import { isAuthenticated, isStaffOrAdmin } from "../../unifiedAuth";
import { forwardGeocode } from "../../utils/geocoding";
import {
  hosts,
  users,
  userAddresses,
  locationRequests,
} from "@shared/schema";

// ── Helpers ────────────────────────────────────────────────────────────────

const retryGeocodeAddress = async (rawAddress: string) => {
  const base = (rawAddress || "").trim();
  if (!base) return null;
  const candidates = Array.from(new Set([base, `${base}, USA`]));
  for (const candidate of candidates) {
    const coords = await forwardGeocode(candidate, { force: true }).catch(
      () => null,
    );
    if (coords) {
      return { coords, attempted: candidate };
    }
  }
  return null;
};

// ── Route registrar ────────────────────────────────────────────────────────

export function registerGeoAuditRoutes(app: Express) {
  // GET /api/admin/map-pin-audit
  app.get(
    "/api/admin/map-pin-audit",
    isAuthenticated,
    isStaffOrAdmin,
    async (_req: any, res) => {
      try {
        const normalize = (value?: string | null) =>
          (value || "").trim().toLowerCase();
        const keyFor = (
          address?: string | null,
          city?: string | null,
          state?: string | null,
        ) => `${normalize(address)}|${normalize(city)}|${normalize(state)}`;
        const hasCoords = (
          lat?: string | number | null,
          lng?: string | number | null,
        ) =>
          lat !== null &&
          lat !== undefined &&
          lng !== null &&
          lng !== undefined &&
          Number.isFinite(Number(lat)) &&
          Number.isFinite(Number(lng));

        const openLocations = await storage.getOpenLocationRequests();
        // Don't select `hosts.*` because older deployments may be missing newer columns
        const hostProfiles: Array<{
          id: string;
          userId: string;
          address: string;
          city: string | null;
          state: string | null;
          latitude: string | null;
          longitude: string | null;
          isVerified: boolean | null;
        }> = (await db
          .select({
            id: hosts.id,
            userId: hosts.userId,
            address: hosts.address,
            city: hosts.city,
            state: hosts.state,
            latitude: hosts.latitude,
            longitude: hosts.longitude,
            isVerified: hosts.isVerified,
          })
          .from(hosts)
          .innerJoin(users, eq(hosts.userId, users.id))
          .where(
            and(
              sql`${hosts.address} IS NOT NULL`,
              or(eq(users.isDisabled, false), isNull(users.isDisabled)),
            ),
          )) as any;

        const hostByUserId = new Map<
          string,
          (typeof hostProfiles)[number]
        >();
        hostProfiles.forEach((host) => {
          const existing = hostByUserId.get(host.userId);
          if (!existing) {
            hostByUserId.set(host.userId, host);
            return;
          }
          if (!existing.isVerified && host.isVerified) {
            hostByUserId.set(host.userId, host);
          }
        });

        const hostUserIds = Array.from(hostByUserId.keys());
        let additionalAddressRows: Array<{
          id: string;
          userId: string;
          address: string;
          city: string;
          state: string | null;
          latitude: string | null;
          longitude: string | null;
        }> = [];
        if (hostUserIds.length) {
          additionalAddressRows = (await db
            .select({
              id: userAddresses.id,
              userId: userAddresses.userId,
              address: userAddresses.address,
              city: userAddresses.city,
              state: userAddresses.state,
              latitude: userAddresses.latitude,
              longitude: userAddresses.longitude,
            })
            .from(userAddresses)
            .innerJoin(users, eq(userAddresses.userId, users.id))
            .where(
              and(
                inArray(userAddresses.userId, hostUserIds),
                sql`${userAddresses.address} IS NOT NULL`,
                or(eq(users.isDisabled, false), isNull(users.isDisabled)),
              ),
            )) as any;
        }

        const primaryHostLocations = hostProfiles.map((host) => ({
          id: host.id,
          address: host.address,
          city: host.city,
          state: host.state,
          mappable: hasCoords(host.latitude, host.longitude),
        }));

        const openHostLocations = openLocations.map(
          (loc: {
            id: string;
            address: string | null;
            latitude?: string | number | null;
            longitude?: string | number | null;
          }) => ({
            id: loc.id,
            address: loc.address,
            city: null as string | null,
            state: null as string | null,
            mappable: hasCoords(loc.latitude, loc.longitude),
          }),
        );

        const seenKeys = new Set<string>();
        primaryHostLocations.forEach((loc) => {
          seenKeys.add(keyFor(loc.address, loc.city, loc.state));
        });
        openHostLocations.forEach((loc) => {
          seenKeys.add(keyFor(loc.address, null, null));
        });

        let additionalIncluded = 0;
        let additionalSkippedDuplicates = 0;
        const additionalIncludedLocations: Array<{
          id: string;
          address: string;
          city?: string | null;
          state?: string | null;
          mappable: boolean;
        }> = [];

        additionalAddressRows.forEach((address) => {
          const key = keyFor(address.address, address.city, address.state);
          if (!key || seenKeys.has(key)) {
            additionalSkippedDuplicates += 1;
            return;
          }
          seenKeys.add(key);
          additionalIncluded += 1;
          additionalIncludedLocations.push({
            id: address.id,
            address: address.address,
            city: address.city,
            state: address.state,
            mappable: hasCoords(address.latitude, address.longitude),
          });
        });

        const renderedCandidates = [
          ...openHostLocations.map((loc) => ({ ...loc, source: "open_request" })),
          ...primaryHostLocations.map((loc) => ({ ...loc, source: "host_profile" })),
          ...additionalIncludedLocations.map((loc) => ({ ...loc, source: "host_address" })),
        ];

        const renderedMappable = renderedCandidates.filter((loc) => loc.mappable);
        const renderedMissing = renderedCandidates.filter((loc) => !loc.mappable);

        res.json({
          openLocationRequests: {
            total: openHostLocations.length,
            mappable: openHostLocations.filter((loc) => loc.mappable).length,
            missingCoords: openHostLocations.filter((loc) => !loc.mappable).length,
          },
          primaryHostProfiles: {
            total: primaryHostLocations.length,
            mappable: primaryHostLocations.filter((loc) => loc.mappable).length,
            missingCoords: primaryHostLocations.filter((loc) => !loc.mappable).length,
          },
          additionalHostAddresses: {
            total: additionalAddressRows.length,
            included: additionalIncluded,
            skippedDuplicates: additionalSkippedDuplicates,
            mappable: additionalIncludedLocations.filter((loc) => loc.mappable).length,
            missingCoords: additionalIncludedLocations.filter((loc) => !loc.mappable).length,
          },
          renderedHostLocationCandidates: {
            total: renderedCandidates.length,
            mappable: renderedMappable.length,
            missingCoords: renderedMissing.length,
          },
          sampleMissing: renderedMissing.slice(0, 20),
        });
      } catch (error) {
        console.error("Error building map pin audit:", error);
        res.status(500).json({ message: "Failed to build map pin audit" });
      }
    },
  );

  // POST /api/admin/map-pin-audit/retry-geocode (bulk)
  app.post(
    "/api/admin/map-pin-audit/retry-geocode",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const normalize = (value?: string | null) =>
          (value || "").trim().toLowerCase();
        const keyFor = (
          address?: string | null,
          city?: string | null,
          state?: string | null,
        ) => `${normalize(address)}|${normalize(city)}|${normalize(state)}`;
        const hasCoords = (
          lat?: string | number | null,
          lng?: string | number | null,
        ) =>
          lat !== null &&
          lat !== undefined &&
          lng !== null &&
          lng !== undefined &&
          Number.isFinite(Number(lat)) &&
          Number.isFinite(Number(lng));

        const requestedLimit = Number(req.body?.limit ?? 30);
        const limit = Number.isFinite(requestedLimit)
          ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
          : 30;

        const hostProfiles: Array<{
          id: string;
          userId: string;
          address: string;
          city: string | null;
          state: string | null;
          latitude: string | null;
          longitude: string | null;
          isVerified: boolean | null;
        }> = (await db
          .select({
            id: hosts.id,
            userId: hosts.userId,
            address: hosts.address,
            city: hosts.city,
            state: hosts.state,
            latitude: hosts.latitude,
            longitude: hosts.longitude,
            isVerified: hosts.isVerified,
          })
          .from(hosts)
          .innerJoin(users, eq(hosts.userId, users.id))
          .where(
            and(
              sql`${hosts.address} IS NOT NULL`,
              eq(hosts.isVerified, true),
              or(eq(users.isDisabled, false), isNull(users.isDisabled)),
            ),
          )) as any;

        const hostByUserId = new Map<string, (typeof hostProfiles)[number]>();
        hostProfiles.forEach((host) => {
          const existing = hostByUserId.get(host.userId);
          if (!existing) {
            hostByUserId.set(host.userId, host);
            return;
          }
          if (!existing.isVerified && host.isVerified) {
            hostByUserId.set(host.userId, host);
          }
        });

        const hostUserIds = Array.from(hostByUserId.keys());
        let additionalAddressRows: Array<{
          id: string;
          userId: string;
          address: string;
          city: string;
          state: string | null;
          latitude: string | null;
          longitude: string | null;
        }> = [];
        if (hostUserIds.length) {
          additionalAddressRows = (await db
            .select({
              id: userAddresses.id,
              userId: userAddresses.userId,
              address: userAddresses.address,
              city: userAddresses.city,
              state: userAddresses.state,
              latitude: userAddresses.latitude,
              longitude: userAddresses.longitude,
            })
            .from(userAddresses)
            .innerJoin(users, eq(userAddresses.userId, users.id))
            .where(
              and(
                inArray(userAddresses.userId, hostUserIds),
                sql`${userAddresses.address} IS NOT NULL`,
                or(eq(users.isDisabled, false), isNull(users.isDisabled)),
              ),
            )) as any;
        }

        const seenKeys = new Set<string>();
        hostProfiles.forEach((host) => {
          seenKeys.add(keyFor(host.address, host.city, host.state));
        });

        const failures: Array<{ source: string; id: string; address: string }> = [];
        let primaryUpdated = 0;
        let additionalUpdated = 0;
        let attempted = 0;

        const primaryQueue = hostProfiles.filter(
          (host) =>
            !hasCoords(host.latitude, host.longitude) &&
            Boolean((host.address || "").trim()),
        );

        for (const host of primaryQueue) {
          if (attempted >= limit) break;
          const address = [host.address, host.city, host.state]
            .map((part) => (part || "").trim())
            .filter(Boolean)
            .join(", ");
          if (!address) continue;
          attempted += 1;
          const geocode = await retryGeocodeAddress(address);
          if (!geocode) {
            failures.push({ source: "host_profile", id: host.id, address });
            continue;
          }
          await db
            .update(hosts)
            .set({
              latitude: geocode.coords.lat.toString(),
              longitude: geocode.coords.lng.toString(),
              updatedAt: new Date(),
            })
            .where(eq(hosts.id, host.id));
          primaryUpdated += 1;
        }

        const additionalQueue = additionalAddressRows.filter((address) => {
          if (hasCoords(address.latitude, address.longitude)) return false;
          const key = keyFor(address.address, address.city, address.state);
          if (!key) return false;
          if (seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        });

        for (const addressRow of additionalQueue) {
          if (attempted >= limit) break;
          const address = [addressRow.address, addressRow.city, addressRow.state]
            .map((part) => (part || "").trim())
            .filter(Boolean)
            .join(", ");
          if (!address) continue;
          attempted += 1;
          const geocode = await retryGeocodeAddress(address);
          if (!geocode) {
            failures.push({ source: "host_address", id: addressRow.id, address });
            continue;
          }
          await db
            .update(userAddresses)
            .set({
              latitude: geocode.coords.lat.toString(),
              longitude: geocode.coords.lng.toString(),
              updatedAt: new Date(),
            })
            .where(eq(userAddresses.id, addressRow.id));
          additionalUpdated += 1;
        }

        res.json({
          attempted,
          updated: {
            primaryHostProfiles: primaryUpdated,
            additionalHostAddresses: additionalUpdated,
            total: primaryUpdated + additionalUpdated,
          },
          failures: {
            total: failures.length,
            sample: failures.slice(0, 20),
          },
        });
      } catch (error) {
        console.error("Error retrying admin map geocode:", error);
        res.status(500).json({ message: "Failed to retry geocoding" });
      }
    },
  );

  // POST /api/admin/map-pin-audit/retry-geocode-item (single item)
  app.post(
    "/api/admin/map-pin-audit/retry-geocode-item",
    isAuthenticated,
    isStaffOrAdmin,
    async (req: any, res) => {
      try {
        const source = String(req.body?.source || "");
        const id = String(req.body?.id || "");
        if (!source || !id) {
          return res.status(400).json({ message: "source and id are required" });
        }

        if (source === "host_profile") {
          const rows = await db
            .select({
              id: hosts.id,
              address: hosts.address,
              city: hosts.city,
              state: hosts.state,
            })
            .from(hosts)
            .where(eq(hosts.id, id))
            .limit(1);
          const host = rows[0];
          if (!host) return res.status(404).json({ message: "Host not found" });
          const address = [host.address, host.city, host.state]
            .map((part) => (part || "").trim())
            .filter(Boolean)
            .join(", ");
          if (!address) {
            return res.status(400).json({ message: "Host address is empty" });
          }
          const geocode = await retryGeocodeAddress(address);
          if (!geocode) {
            return res.status(422).json({ message: "Unable to geocode host address", address });
          }
          await db
            .update(hosts)
            .set({
              latitude: geocode.coords.lat.toString(),
              longitude: geocode.coords.lng.toString(),
              updatedAt: new Date(),
            })
            .where(eq(hosts.id, id));
          return res.json({ ok: true, source, id, address, attempted: geocode.attempted, coords: geocode.coords });
        }

        if (source === "host_address") {
          const rows = await db
            .select({
              id: userAddresses.id,
              address: userAddresses.address,
              city: userAddresses.city,
              state: userAddresses.state,
            })
            .from(userAddresses)
            .where(eq(userAddresses.id, id))
            .limit(1);
          const addressRow = rows[0];
          if (!addressRow) {
            return res.status(404).json({ message: "Host address not found" });
          }
          const address = [addressRow.address, addressRow.city, addressRow.state]
            .map((part) => (part || "").trim())
            .filter(Boolean)
            .join(", ");
          if (!address) {
            return res.status(400).json({ message: "Address is empty" });
          }
          const geocode = await retryGeocodeAddress(address);
          if (!geocode) {
            return res.status(422).json({ message: "Unable to geocode host address", address });
          }
          await db
            .update(userAddresses)
            .set({
              latitude: geocode.coords.lat.toString(),
              longitude: geocode.coords.lng.toString(),
              updatedAt: new Date(),
            })
            .where(eq(userAddresses.id, id));
          return res.json({ ok: true, source, id, address, attempted: geocode.attempted, coords: geocode.coords });
        }

        if (source === "open_request") {
          const rows = await db
            .select({
              id: locationRequests.id,
              address: locationRequests.address,
            })
            .from(locationRequests)
            .where(eq(locationRequests.id, id))
            .limit(1);
          const requestRow = rows[0];
          if (!requestRow) {
            return res.status(404).json({ message: "Open request not found" });
          }
          const address = (requestRow.address || "").trim();
          if (!address) {
            return res.status(400).json({ message: "Open request address is empty" });
          }
          const geocode = await retryGeocodeAddress(address);
          if (!geocode) {
            return res.status(422).json({ message: "Unable to geocode open request address", address });
          }
          await db
            .update(locationRequests)
            .set({
              latitude: geocode.coords.lat.toString(),
              longitude: geocode.coords.lng.toString(),
            })
            .where(eq(locationRequests.id, id));
          return res.json({ ok: true, source, id, address, attempted: geocode.attempted, coords: geocode.coords });
        }

        return res.status(400).json({ message: "Unsupported source type" });
      } catch (error) {
        console.error("Error retrying map geocode item:", error);
        res.status(500).json({ message: "Failed to retry geocode item" });
      }
    },
  );
}
