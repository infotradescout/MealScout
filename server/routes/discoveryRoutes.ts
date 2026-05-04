import type { Express } from "express";
import { db } from "../db";
import {
  cities,
  events,
  hosts,
  restaurants,
  truckManualSchedules,
  users,
} from "@shared/schema";
import { and, eq, gte, ilike, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { buildSlotDateTimes, intervalOverlaps, resolveTimeIntent, type TimeIntent } from "../services/timeIntent";
import { getPublicSlotGateConfigFromEnv, isSlotPublic, type PublicSlot } from "../services/publicSlotGate";
import { resolveCityTimeZone, usStateToTimeZone } from "../services/cityTimeZone";
import { dateKeyInZone } from "../services/dateKeys";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";

type TimeKey = "now" | "breakfast" | "lunch" | "dinner" | "tonight" | "this-weekend";

const TIME_PAGES: TimeKey[] = [
  "now",
  "breakfast",
  "lunch",
  "dinner",
  "tonight",
  "this-weekend",
];

function normalizeSlug(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function toSeoSlug(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);
}

function makeEntitySlug(name: unknown, id: unknown): string {
  const slug = toSeoSlug(name);
  const rawId = String(id || "").trim();
  return slug ? `${slug}--${rawId}` : rawId;
}

function toDateKey(value: unknown, timeZone?: string): string | null {
  if (value instanceof Date) {
    const key = dateKeyInZone(value, timeZone || "America/Chicago");
    return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
  }
  const raw = String(value || "").trim();
  if (!raw) return null;
  const key = raw.includes("T") ? raw.split("T")[0] : raw;
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}


function timeKeyToIntent(value: TimeKey): TimeIntent {
  return value as unknown as TimeIntent;
}

function getFreshnessGateConfig() {
  return getPublicSlotGateConfigFromEnv();
}

export function registerDiscoveryRoutes(app: Express) {
  app.get("/api/public/discovery/city/:citySlug/time/:timeKey", async (req, res) => {
    try {
      const citySlug = normalizeSlug(req.params.citySlug);
      const timeKeyRaw = normalizeSlug(req.params.timeKey) as TimeKey;
      const timeKey = TIME_PAGES.includes(timeKeyRaw) ? timeKeyRaw : null;
      if (!citySlug || !timeKey) {
        return res.status(400).json({ message: "Invalid city or time key" });
      }

      const [city] = await db.select().from(cities).where(eq(cities.slug, citySlug)).limit(1);
      if (!city) return res.status(404).json({ message: "City not found" });

      const timeZone = String(city.timezone || "").trim() || usStateToTimeZone(city.state);
      const now = new Date();
      const intent = timeKeyToIntent(timeKey);
      const window = resolveTimeIntent({ timeZone, intent, now });
      const gate = getFreshnessGateConfig();
      const windowStart = new Date(window.startUtc.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(window.endUtc.getTime() + 24 * 60 * 60 * 1000);
      const cityName = String(city.name || "").trim();
      const cityLike = `%${cityName}%`;
      const stateAbbr = String(city.state || "").trim();

      const hostRows = await db
        .select({
          id: hosts.id,
          businessName: hosts.businessName,
          city: hosts.city,
          state: hosts.state,
          address: hosts.address,
          latitude: hosts.latitude,
          longitude: hosts.longitude,
        })
        .from(hosts)
        .where(
          and(
            or(ilike(hosts.city, cityLike), ilike(hosts.address, cityLike)),
            stateAbbr ? ilike(hosts.state, stateAbbr.toUpperCase()) : undefined,
          ),
        )
        .limit(2000);

      const hostIds = hostRows.map((h: any) => String(h.id));

      const eventRows =
        hostIds.length === 0
          ? []
          : await db
              .select({
                id: events.id,
                hostId: events.hostId,
                date: events.date,
                startTime: events.startTime,
                endTime: events.endTime,
                name: events.name,
                status: events.status,
                lastConfirmedAt: events.lastConfirmedAt,
                updatedAt: events.updatedAt,
                truckId: restaurants.id,
                truckName: restaurants.name,
                cuisineType: restaurants.cuisineType,
                truckCity: restaurants.city,
                truckState: restaurants.state,
                logoUrl: restaurants.logoUrl,
                coverImageUrl: restaurants.coverImageUrl,
              })
              .from(events)
              .innerJoin(restaurants, eq(events.bookedRestaurantId, restaurants.id))
              .where(
                and(
                  inArray(events.hostId, hostIds),
                  isNotNull(events.bookedRestaurantId),
                  ne(events.status, "cancelled"),
                  gte(events.date, windowStart),
                  lte(events.date, windowEnd),
                ),
              )
              .limit(5000);

      const manualRows = await db
        .select({
          id: truckManualSchedules.id,
          truckId: truckManualSchedules.truckId,
          date: truckManualSchedules.date,
          startTime: truckManualSchedules.startTime,
          endTime: truckManualSchedules.endTime,
          locationName: truckManualSchedules.locationName,
          address: truckManualSchedules.address,
          city: truckManualSchedules.city,
          state: truckManualSchedules.state,
          lastConfirmedAt: truckManualSchedules.lastConfirmedAt,
          updatedAt: truckManualSchedules.updatedAt,
          truckName: restaurants.name,
          cuisineType: restaurants.cuisineType,
          truckCity: restaurants.city,
          truckState: restaurants.state,
          logoUrl: restaurants.logoUrl,
          coverImageUrl: restaurants.coverImageUrl,
        })
        .from(truckManualSchedules)
        .innerJoin(restaurants, eq(truckManualSchedules.truckId, restaurants.id))
        .where(
          and(
            eq(truckManualSchedules.isPublic, true),
            or(ilike(truckManualSchedules.city, cityLike), ilike(truckManualSchedules.address, cityLike)),
            gte(truckManualSchedules.date, windowStart),
            lte(truckManualSchedules.date, windowEnd),
          ),
        )
        .limit(5000);

      const hostById = new Map<string, any>(hostRows.map((h: any) => [String(h.id), h]));
      const items: Array<{
        kind: "booking" | "manual";
        truckId: string;
        truckName: string;
        cuisineType: string | null;
        date: Date;
        startTime: string;
        endTime: string;
        lastConfirmedAtUtc: Date;
        locationName: string | null;
        address: string | null;
        hostId?: string | null;
      }> = [];

      for (const row of eventRows as any[]) {
        const host = hostById.get(String(row.hostId));
        items.push({
          kind: "booking",
          truckId: String(row.truckId),
          truckName: String(row.truckName || "Food truck"),
          cuisineType: row.cuisineType ? String(row.cuisineType) : null,
          date: new Date(row.date),
          startTime: String(row.startTime || ""),
          endTime: String(row.endTime || ""),
          lastConfirmedAtUtc: new Date(row.lastConfirmedAt || row.updatedAt || row.date || Date.now()),
          locationName: host?.businessName ? String(host.businessName) : row.name ? String(row.name) : null,
          address: host?.address ? String(host.address) : null,
          hostId: String(row.hostId || ""),
        });
      }

      for (const row of manualRows as any[]) {
        items.push({
          kind: "manual",
          truckId: String(row.truckId),
          truckName: String(row.truckName || "Food truck"),
          cuisineType: row.cuisineType ? String(row.cuisineType) : null,
          date: new Date(row.date),
          startTime: String(row.startTime || ""),
          endTime: String(row.endTime || ""),
          lastConfirmedAtUtc: new Date(row.lastConfirmedAt || row.updatedAt || row.date || Date.now()),
          locationName: row.locationName ? String(row.locationName) : null,
          address: row.address ? String(row.address) : null,
        });
      }

      const filtered = items.filter((item) => {
        const dt = buildSlotDateTimes({
          timeZone,
          date: item.date,
          startTime: item.startTime,
          endTime: item.endTime,
        });
        if (!dt) return false;

        const slot: PublicSlot = {
          source: item.kind === "booking" ? "parking_pass_booking" : "manual",
          status: "confirmed",
          startsAtUtc: dt.startUtc,
          endsAtUtc: dt.endUtc,
          lastConfirmedAtUtc: item.lastConfirmedAtUtc,
        };

        if (!isSlotPublic({ slot, now, ...gate })) return false;

        return intervalOverlaps({
          startUtc: dt.startUtc,
          endUtc: dt.endUtc,
          otherStartUtc: window.startUtc,
          otherEndUtc: window.endUtc,
        });
      });

      const byTruck = new Map<
        string,
        {
          id: string;
          name: string;
          cuisineType: string | null;
          truckPath: string;
          schedules: Array<{
            kind: "booking" | "manual";
            date: string;
            startTime: string;
            endTime: string;
            lastConfirmedAt: string;
            locationName: string | null;
            address: string | null;
            locationPath: string | null;
          }>;
        }
      >();

      for (const row of filtered) {
        const id = row.truckId;
        const existing = byTruck.get(id);
        const truckPath = `/truck/${encodeURIComponent(makeEntitySlug(row.truckName, row.truckId))}`;
        const locationPath =
          row.hostId && row.kind === "booking"
            ? `/location/${encodeURIComponent(
                makeEntitySlug(
                  hostById.get(String(row.hostId))?.businessName || row.locationName || "location",
                  row.hostId,
                ),
              )}`
            : null;
        const schedule = {
          kind: row.kind,
          date:
            toDateKey(row.date, timeZone) ??
            dateKeyInZone(new Date(row.date), timeZone),
          startTime: row.startTime,
          endTime: row.endTime,
          lastConfirmedAt: row.lastConfirmedAtUtc.toISOString(),
          locationName: row.locationName,
          address: row.address,
          locationPath,
        };

        if (!existing) {
          byTruck.set(id, {
            id,
            name: row.truckName,
            cuisineType: row.cuisineType,
            truckPath,
            schedules: [schedule],
          });
          continue;
        }
        existing.schedules.push(schedule);
      }

      const trucks = Array.from(byTruck.values()).sort((a, b) => a.name.localeCompare(b.name));

      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({
        city: { name: city.name, slug: city.slug, state: city.state || null },
        timeKey,
        timeZone,
        intentWindowUtc: { start: window.startUtc.toISOString(), end: window.endUtc.toISOString() },
        freshnessGate: gate,
        generatedAt: new Date().toISOString(),
        totalTrucks: trucks.length,
        trucks,
      });
    } catch (error) {
      console.error("[discovery] city time error:", error);
      res.status(500).json({ message: "Unable to load discovery feed" });
    }
  });

  app.get("/api/public/discovery/location/:hostId/time/:timeKey", async (req, res) => {
    try {
      const hostId = String(req.params.hostId || "").trim();
      const timeKeyRaw = normalizeSlug(req.params.timeKey) as TimeKey;
      const timeKey = TIME_PAGES.includes(timeKeyRaw) ? timeKeyRaw : null;
      if (!hostId || !timeKey) {
        return res.status(400).json({ message: "Invalid location or time key" });
      }

      const [host] = await db
        .select({
          id: hosts.id,
          businessName: hosts.businessName,
          address: hosts.address,
          city: hosts.city,
          state: hosts.state,
          latitude: hosts.latitude,
          longitude: hosts.longitude,
          updatedAt: hosts.updatedAt,
        })
        .from(hosts)
        .where(eq(hosts.id, hostId))
        .limit(1);

      if (!host) return res.status(404).json({ message: "Location not found" });

      const timeZone = await resolveCityTimeZone({ city: host.city, state: host.state });
      const now = new Date();
      const intent = timeKeyToIntent(timeKey);
      const window = resolveTimeIntent({ timeZone, intent, now });
      const gate = getFreshnessGateConfig();

      const cutoff = new Date(now.getTime() - gate.ttlHours * 60 * 60 * 1000);
      const windowStart = new Date(window.startUtc.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(window.endUtc.getTime() + 24 * 60 * 60 * 1000);

      const rows = await db
        .select({
          id: events.id,
          date: events.date,
          startTime: events.startTime,
          endTime: events.endTime,
          name: events.name,
          status: events.status,
          lastConfirmedAt: events.lastConfirmedAt,
          updatedAt: events.updatedAt,
          truckId: restaurants.id,
          truckName: restaurants.name,
          cuisineType: restaurants.cuisineType,
        })
        .from(events)
        .innerJoin(restaurants, eq(events.bookedRestaurantId, restaurants.id))
        .where(
          and(
            eq(events.hostId, hostId),
            isNotNull(events.bookedRestaurantId),
            ne(events.status, "cancelled"),
            gte(events.date, windowStart),
            lte(events.date, windowEnd),
            gte(
              sql`COALESCE(${events.lastConfirmedAt}, ${events.updatedAt}, ${events.date}::timestamp)`,
              cutoff,
            ),
          ),
        )
        .limit(5000);

      const byTruck = new Map<
        string,
        {
          id: string;
          name: string;
          cuisineType: string | null;
          truckPath: string;
          schedules: Array<{
            kind: "booking";
            date: string;
            startTime: string;
            endTime: string;
            lastConfirmedAt: string;
            eventPath: string;
          }>;
        }
      >();

      for (const row of rows as any[]) {
        const dt = buildSlotDateTimes({
          timeZone,
          date: new Date(row.date),
          startTime: String(row.startTime || ""),
          endTime: String(row.endTime || ""),
        });
        if (!dt) continue;

        const slot: PublicSlot = {
          source: "parking_pass_booking",
          status: "confirmed",
          startsAtUtc: dt.startUtc,
          endsAtUtc: dt.endUtc,
          lastConfirmedAtUtc: new Date(row.lastConfirmedAt || row.updatedAt || row.date || Date.now()),
        };
        if (!isSlotPublic({ slot, now, ...gate })) continue;
        if (
          !intervalOverlaps({
            startUtc: dt.startUtc,
            endUtc: dt.endUtc,
            otherStartUtc: window.startUtc,
            otherEndUtc: window.endUtc,
          })
        ) {
          continue;
        }

        const truckId = String(row.truckId);
        const truckName = String(row.truckName || "Food truck");
        const existing = byTruck.get(truckId);
        const truckPath = `/truck/${encodeURIComponent(makeEntitySlug(truckName, truckId))}`;
        const schedule = {
          kind: "booking" as const,
          date:
            toDateKey(row.date, timeZone) ??
            dateKeyInZone(new Date(row.date), timeZone),
          startTime: String(row.startTime || ""),
          endTime: String(row.endTime || ""),
          lastConfirmedAt: slot.lastConfirmedAtUtc.toISOString(),
          eventPath: `/event/${encodeURIComponent(`${toSeoSlug(row.name || host.businessName || row.id)}--${row.id}`)}`,
        };

        if (!existing) {
          byTruck.set(truckId, {
            id: truckId,
            name: truckName,
            cuisineType: row.cuisineType ? String(row.cuisineType) : null,
            truckPath,
            schedules: [schedule],
          });
        } else {
          existing.schedules.push(schedule);
        }
      }

      const trucks = Array.from(byTruck.values()).sort((a, b) => a.name.localeCompare(b.name));

      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({
        location: {
          id: host.id,
          name: host.businessName,
          address: host.address,
          city: host.city,
          state: host.state,
          latitude: host.latitude ?? null,
          longitude: host.longitude ?? null,
          locationPath: `/location/${encodeURIComponent(makeEntitySlug(host.businessName, host.id))}`,
        },
        timeKey,
        timeZone,
        intentWindowUtc: { start: window.startUtc.toISOString(), end: window.endUtc.toISOString() },
        freshnessGate: gate,
        generatedAt: new Date().toISOString(),
        totalTrucks: trucks.length,
        trucks,
      });
    } catch (error) {
      console.error("[discovery] location time error:", error);
      res.status(500).json({ message: "Unable to load location discovery feed" });
    }
  });

  app.get("/api/public/discovery/city/:citySlug/cuisine/:cuisineSlug", async (req, res) => {
    try {
      const citySlug = normalizeSlug(req.params.citySlug);
      const cuisineSlug = normalizeSlug(req.params.cuisineSlug);
      if (!citySlug || !cuisineSlug) {
        return res.status(400).json({ message: "Invalid city or cuisine" });
      }

      const [city] = await db.select().from(cities).where(eq(cities.slug, citySlug)).limit(1);
      if (!city) return res.status(404).json({ message: "City not found" });

      const cityName = String(city.name || "").trim();
      const cityLike = `%${cityName}%`;
      const cuisineLike = `%${cuisineSlug.replace(/-/g, " ")}%`;

      const rows = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          cuisineType: restaurants.cuisineType,
          businessType: restaurants.businessType,
          address: restaurants.address,
          city: restaurants.city,
          state: restaurants.state,
          description: restaurants.description,
          logoUrl: restaurants.logoUrl,
          coverImageUrl: restaurants.coverImageUrl,
          profileSource: restaurants.profileSource,
          googleBusinessStatus: restaurants.googleBusinessStatus,
          ownerEmail: users.email,
          updatedAt: restaurants.updatedAt,
        })
        .from(restaurants)
        .leftJoin(users, eq(restaurants.ownerId, users.id))
        .where(
          and(
            eq(restaurants.isActive, true),
            or(eq(restaurants.isFoodTruck, true), eq(restaurants.businessType, "food_truck")),
            or(ilike(restaurants.city, cityLike), ilike(restaurants.address, cityLike)),
            or(ilike(restaurants.cuisineType, cuisineLike), ilike(restaurants.name, cuisineLike)),
          ),
        )
        .limit(2000);

      const trucks = rows
        .filter((row: any) => isPublicBusinessVisible(row))
        .map((row: any) => ({
          id: row.id,
          name: row.name,
          cuisineType: row.cuisineType || null,
          city: row.city || null,
          state: row.state || null,
          truckPath: `/truck/${encodeURIComponent(makeEntitySlug(row.name, row.id))}`,
          updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
        }))
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

      res.setHeader("Cache-Control", "public, max-age=300");
      res.json({
        city: { name: city.name, slug: city.slug, state: city.state || null },
        cuisine: { slug: cuisineSlug, label: cuisineSlug.replace(/-/g, " ") },
        generatedAt: new Date().toISOString(),
        totalTrucks: trucks.length,
        trucks,
      });
    } catch (error) {
      console.error("[discovery] city cuisine error:", error);
      res.status(500).json({ message: "Unable to load cuisine feed" });
    }
  });
}
