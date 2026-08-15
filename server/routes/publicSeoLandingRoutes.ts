import type { Express } from "express";
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or } from "drizzle-orm";

import { db } from "../db";
import {
  cities,
  deals,
  eventBookings,
  events,
  hosts,
  restaurants,
} from "@shared/schema";
import { isTruckBusinessType } from "@shared/businessTypes";
import { assertPublicResponseSafe } from "../publicProfiles";
import { resolveCityTimeZoneSync } from "../services/cityTimeZone";
import { buildSlotDateTimes } from "../services/timeIntent";
import { dateKeyInZone } from "../services/dateKeys";
import { isSlotPublic } from "../services/publicSlotGate";

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const safe = <T>(payload: T) => assertPublicResponseSafe(payload);

const banned = /\b(best|top|#1|elite|highest quality)\b/i;
const cleanLabel = (value: string) => value.replace(banned, "").replace(/\s+/g, " ").trim();

const resolveCityBySlug = async (citySlug: string) => {
  const [city] = await db
    .select({ id: cities.id, name: cities.name, slug: cities.slug, state: cities.state })
    .from(cities)
    .where(eq(cities.slug, citySlug))
    .limit(1);
  return city || null;
};

const cityLike = (cityName: string) => `%${String(cityName || "").trim()}%`;

const truckBusinessTypeAliases = [
  "food_truck",
  "truck",
  "food-truck",
  "foodtruck",
  "mobile_food_vendor",
];

const publicTruckSelect = {
  id: restaurants.id,
  name: restaurants.name,
  businessType: restaurants.businessType,
  isFoodTruck: restaurants.isFoodTruck,
  city: restaurants.city,
  state: restaurants.state,
  cuisineType: restaurants.cuisineType,
  coverImageUrl: restaurants.coverImageUrl,
  logoUrl: restaurants.logoUrl,
  updatedAt: restaurants.updatedAt,
};

const loadPublicTruckRows = async (cityName: string) =>
  db
    .select(publicTruckSelect)
    .from(restaurants)
    .where(
      and(
        eq(restaurants.isActive, true),
        or(
          eq(restaurants.isFoodTruck, true),
          inArray(restaurants.businessType, truckBusinessTypeAliases),
        ),
        or(
          ilike(restaurants.city, cityLike(cityName)),
          ilike(restaurants.address, cityLike(cityName)),
        ),
      ),
    )
    .orderBy(desc(restaurants.updatedAt))
    .limit(60);

const buildPublicProfilePath = (input: {
  profileType: "restaurant" | "truck" | "location";
  id: string;
  name: string;
}) => {
  const slug = `${toSlug(input.name) || input.id}--${input.id}`;
  if (input.profileType === "truck") return `/truck/${encodeURIComponent(slug)}`;
  if (input.profileType === "location") return `/location/${encodeURIComponent(slug)}`;
  return `/restaurant/${encodeURIComponent(slug)}`;
};

const buildCard = (row: any) => {
  const profileType = row.isFoodTruck || isTruckBusinessType(row.businessType)
    ? "truck"
    : "restaurant";
  const slug = toSlug(row.name) || String(row.id);
  const profilePath = buildPublicProfilePath({
    profileType,
    id: String(row.id),
    name: String(row.name || ""),
  });
  return {
    id: String(row.id),
    profileType,
    displayName: cleanLabel(String(row.name || "Local business")),
    slug,
    profilePath,
    city: row.city || null,
    state: row.state || null,
    imageUrl: row.coverImageUrl || row.logoUrl || null,
    cuisineTags: row.cuisineType ? [String(row.cuisineType)] : [],
    statusLabel: null,
    summary: null,
    primaryCtaPath: profilePath,
  };
};

const buildSeoPayload = (input: {
  routeKey: string;
  citySlug?: string | null;
  cityName?: string | null;
  cuisineSlug?: string | null;
  cuisineName?: string | null;
  title: string;
  description: string;
  items: any[];
  emptyMessage: string;
}) => {
  const encodedCity = input.citySlug
    ? encodeURIComponent(input.citySlug)
    : "";
  const encodedCuisine = input.cuisineSlug
    ? encodeURIComponent(input.cuisineSlug)
    : "";
  const canonicalPath = (() => {
    switch (input.routeKey) {
      case "city":
        return `/city/${encodedCity}/food`;
      case "food-trucks":
        return `/food-trucks/${encodedCity}`;
      case "cuisine":
        return encodedCity
          ? `/cuisine/${encodedCuisine}/${encodedCity}`
          : `/cuisine/${encodedCuisine}`;
      default: {
        const parts = [input.routeKey, input.citySlug, input.cuisineSlug]
          .filter(Boolean)
          .map((part) => encodeURIComponent(String(part)));
        return `/${parts.join("/")}`;
      }
    }
  })();
  return safe({
    page: {
      routeKey: input.routeKey,
      citySlug: input.citySlug || null,
      cityName: input.cityName || null,
      cuisineSlug: input.cuisineSlug || null,
      cuisineName: input.cuisineName || null,
      canonicalPath,
      title: cleanLabel(input.title),
      description: cleanLabel(input.description),
      ogImage: "/og-default.jpg?v=20260506",
      emptyMessage: cleanLabel(input.emptyMessage),
    },
    items: input.items,
    total: input.items.length,
  });
};

export function registerPublicSeoLandingRoutes(app: Express) {
  app.get("/api/public/seo/food-trucks/:city", async (req, res) => {
    try {
      const citySlug = String(req.params.city || "").trim().toLowerCase();
      const city = await resolveCityBySlug(citySlug);
      if (!city) return res.status(404).json({ message: "City not found" });
      const rows = await loadPublicTruckRows(city.name);

      return res.json(
        buildSeoPayload({
          routeKey: "food-trucks",
          citySlug,
          cityName: city.name,
          title: `Food trucks in ${city.name}`,
          description: `Find food trucks in ${city.name}. Browse profiles, menus, locations, and current local activity.`,
          items: rows.map(buildCard),
          emptyMessage: "No food trucks are listed here yet. Check nearby food or come back soon.",
        }),
      );
    } catch (error) {
      console.error("food-trucks seo failed", error);
      return res.status(500).json({ message: "Failed to load page data" });
    }
  });

  app.get("/api/public/seo/food-trucks-today/:city", async (req, res) => {
    try {
      const citySlug = String(req.params.city || "").trim().toLowerCase();
      const city = await resolveCityBySlug(citySlug);
      if (!city) return res.status(404).json({ message: "City not found" });

      const rows = await loadPublicTruckRows(city.name);

      return res.json(
        buildSeoPayload({
          routeKey: "food-trucks-today",
          citySlug,
          cityName: city.name,
          title: `Food trucks in ${city.name} today`,
          description: `Find local food trucks active today in ${city.name}. Browse menus, locations, and profile details.`,
          items: rows.map(buildCard),
          emptyMessage: "No food trucks listed for today yet. Check nearby food or come back soon.",
        }),
      );
    } catch (error) {
      console.error("food-trucks-today seo failed", error);
      return res.status(500).json({ message: "Failed to load page data" });
    }
  });

  app.get("/api/public/seo/deals-today/:city", async (req, res) => {
    try {
      const citySlug = String(req.params.city || "").trim().toLowerCase();
      const city = await resolveCityBySlug(citySlug);
      if (!city) return res.status(404).json({ message: "City not found" });
      const now = new Date();

      const rows = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          businessType: restaurants.businessType,
          isFoodTruck: restaurants.isFoodTruck,
          city: restaurants.city,
          state: restaurants.state,
          cuisineType: restaurants.cuisineType,
          coverImageUrl: restaurants.coverImageUrl,
          logoUrl: restaurants.logoUrl,
          dealTitle: deals.title,
          dealEndDate: deals.endDate,
          updatedAt: deals.updatedAt,
        })
        .from(deals)
        .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
        .where(
          and(
            eq(restaurants.isActive, true),
            eq(deals.isActive, true),
            lte(deals.startDate, now),
            or(isNull(deals.endDate), gte(deals.endDate, now)),
            or(ilike(restaurants.city, cityLike(city.name)), ilike(restaurants.address, cityLike(city.name))),
          ),
        )
        .orderBy(desc(deals.updatedAt))
        .limit(60);

      const items = rows.map((row: any) => ({
        ...buildCard(row),
        summary: row.dealTitle ? `Deal today: ${cleanLabel(String(row.dealTitle))}` : "Deal available today",
      }));

      return res.json(
        buildSeoPayload({
          routeKey: "deals-today",
          citySlug,
          cityName: city.name,
          title: `Local deals in ${city.name} today`,
          description: `See active food deals today in ${city.name} from local restaurants and trucks.`,
          items,
          emptyMessage: "No local deals listed for today yet. Check nearby food or come back soon.",
        }),
      );
    } catch (error) {
      console.error("deals-today seo failed", error);
      return res.status(500).json({ message: "Failed to load page data" });
    }
  });

  app.get("/api/public/seo/events-today/:city", async (req, res) => {
    try {
      const citySlug = String(req.params.city || "").trim().toLowerCase();
      const city = await resolveCityBySlug(citySlug);
      if (!city) return res.status(404).json({ message: "City not found" });
      const now = new Date();
      const queryStart = new Date(now);
      queryStart.setUTCHours(0, 0, 0, 0);
      queryStart.setUTCDate(queryStart.getUTCDate() - 1);
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const rows = await db
        .selectDistinct({
          eventId: events.id,
          id: restaurants.id,
          name: restaurants.name,
          businessType: restaurants.businessType,
          isFoodTruck: restaurants.isFoodTruck,
          city: restaurants.city,
          state: restaurants.state,
          cuisineType: restaurants.cuisineType,
          coverImageUrl: restaurants.coverImageUrl,
          logoUrl: restaurants.logoUrl,
          eventName: events.name,
          eventDate: events.date,
          eventStartTime: events.startTime,
          eventEndTime: events.endTime,
          bookingConfirmedAt: eventBookings.bookingConfirmedAt,
          hostCity: hosts.city,
          hostState: hosts.state,
          updatedAt: events.updatedAt,
        })
        .from(eventBookings)
        .innerJoin(events, eq(eventBookings.eventId, events.id))
        .innerJoin(hosts, eq(events.hostId, hosts.id))
        .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id))
        .where(
          and(
            eq(eventBookings.status, "confirmed"),
            inArray(events.status, ["open", "booked", "filled"]),
            or(eq(events.requiresPayment, false), isNull(events.requiresPayment)),
            or(
              isNull(events.requiresPayment),
              eq(events.requiresPayment, false),
            ),
            eq(restaurants.isActive, true),
            or(
              eq(restaurants.isFoodTruck, true),
              inArray(restaurants.businessType, truckBusinessTypeAliases),
            ),
            gte(events.date, queryStart),
            lte(events.date, end),
            or(ilike(hosts.city, cityLike(city.name)), ilike(hosts.address, cityLike(city.name))),
          ),
        )
        .orderBy(desc(events.updatedAt))
        .limit(60);

      const items = rows
        .filter((row: any) => {
          const timeZone = resolveCityTimeZoneSync({
            city: row.hostCity || null,
            state: row.hostState || null,
          });
          const interval = buildSlotDateTimes({
            timeZone,
            date: row.eventDate,
            startTime: String(row.eventStartTime || ""),
            endTime: String(row.eventEndTime || ""),
          });
          return Boolean(
            interval &&
              row.bookingConfirmedAt &&
              interval.endUtc.getTime() >= now.getTime() &&
              dateKeyInZone(interval.startUtc, timeZone) ===
                dateKeyInZone(now, timeZone) &&
              isSlotPublic({
                slot: {
                  source: "parking_pass_booking",
                  status: "confirmed",
                  startsAtUtc: interval.startUtc,
                  endsAtUtc: interval.endUtc,
                  lastConfirmedAtUtc: row.bookingConfirmedAt,
                },
                now,
                ttlHours: 24 * 365 * 100,
              }),
          );
        })
        .map((row: any) => ({
          ...buildCard(row),
          summary: row.eventName
            ? `Event today: ${cleanLabel(String(row.eventName))}`
            : "Event happening today",
        }));

      return res.json(
        buildSeoPayload({
          routeKey: "events-today",
          citySlug,
          cityName: city.name,
          title: `Food events in ${city.name} today`,
          description: `Find local food events happening today in ${city.name}.`,
          items,
          emptyMessage: "No food events listed for today yet. Check nearby food or come back soon.",
        }),
      );
    } catch (error) {
      console.error("events-today seo failed", error);
      return res.status(500).json({ message: "Failed to load page data" });
    }
  });

  app.get("/api/public/seo/city/:city/food", async (req, res) => {
    try {
      const citySlug = String(req.params.city || "").trim().toLowerCase();
      const city = await resolveCityBySlug(citySlug);
      if (!city) return res.status(404).json({ message: "City not found" });

      const rows = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          businessType: restaurants.businessType,
          isFoodTruck: restaurants.isFoodTruck,
          city: restaurants.city,
          state: restaurants.state,
          cuisineType: restaurants.cuisineType,
          coverImageUrl: restaurants.coverImageUrl,
          logoUrl: restaurants.logoUrl,
          updatedAt: restaurants.updatedAt,
        })
        .from(restaurants)
        .where(
          and(
            eq(restaurants.isActive, true),
            or(ilike(restaurants.city, cityLike(city.name)), ilike(restaurants.address, cityLike(city.name))),
          ),
        )
        .orderBy(desc(restaurants.updatedAt))
        .limit(80);

      return res.json(
        buildSeoPayload({
          routeKey: "city",
          citySlug,
          cityName: city.name,
          title: `Places to eat in ${city.name}`,
          description: `Browse local restaurants and food trucks in ${city.name}.`,
          items: rows.map(buildCard),
          emptyMessage: "No places to eat are listed here yet. Check nearby food or come back soon.",
        }),
      );
    } catch (error) {
      console.error("city food seo failed", error);
      return res.status(500).json({ message: "Failed to load page data" });
    }
  });

  app.get("/api/public/seo/cuisine/:cuisine/:city?", async (req, res) => {
    try {
      const cuisineSlug = String(req.params.cuisine || "").trim().toLowerCase();
      const citySlug = String(req.params.city || "").trim().toLowerCase();
      const city = citySlug ? await resolveCityBySlug(citySlug) : null;
      const cuisineNeedle = `%${cuisineSlug.replace(/-/g, " ")}%`;
      const cityFilter = city ? or(ilike(restaurants.city, cityLike(city.name)), ilike(restaurants.address, cityLike(city.name))) : undefined;

      const rows = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          businessType: restaurants.businessType,
          isFoodTruck: restaurants.isFoodTruck,
          city: restaurants.city,
          state: restaurants.state,
          cuisineType: restaurants.cuisineType,
          coverImageUrl: restaurants.coverImageUrl,
          logoUrl: restaurants.logoUrl,
          updatedAt: restaurants.updatedAt,
        })
        .from(restaurants)
        .where(
          and(
            eq(restaurants.isActive, true),
            ilike(restaurants.cuisineType, cuisineNeedle),
            ...(cityFilter ? [cityFilter] : []),
          ),
        )
        .orderBy(desc(restaurants.updatedAt))
        .limit(80);

      const cuisineName = cuisineSlug.replace(/-/g, " ");
      const cityLabel = city?.name ? ` in ${city.name}` : "";
      return res.json(
        buildSeoPayload({
          routeKey: "cuisine",
          citySlug: citySlug || null,
          cityName: city?.name || null,
          cuisineSlug,
          cuisineName,
          title: `${cuisineName} food${cityLabel}`,
          description: `Find ${cuisineName} restaurants and trucks${cityLabel}.`,
          items: rows.map(buildCard),
          emptyMessage: `No ${cuisineName} listings are available here yet. Check nearby food or come back soon.`,
        }),
      );
    } catch (error) {
      console.error("cuisine seo failed", error);
      return res.status(500).json({ message: "Failed to load page data" });
    }
  });

  app.get("/api/public/seo/locations-with-trucks/:city", async (req, res) => {
    try {
      const citySlug = String(req.params.city || "").trim().toLowerCase();
      const city = await resolveCityBySlug(citySlug);
      if (!city) return res.status(404).json({ message: "City not found" });
      const now = new Date();
      const queryStart = new Date(now);
      queryStart.setUTCHours(0, 0, 0, 0);
      queryStart.setUTCDate(queryStart.getUTCDate() - 1);
      const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      const hostRows = await db
        .selectDistinct({
          hostId: hosts.id,
          hostName: hosts.businessName,
          hostCity: hosts.city,
          hostState: hosts.state,
          hostAddress: hosts.address,
          hostUpdatedAt: hosts.updatedAt,
          eventId: events.id,
          eventDate: events.date,
          eventStartTime: events.startTime,
          eventEndTime: events.endTime,
          bookingConfirmedAt: eventBookings.bookingConfirmedAt,
          truckId: eventBookings.truckId,
        })
        .from(eventBookings)
        .innerJoin(events, eq(eventBookings.eventId, events.id))
        .innerJoin(hosts, eq(events.hostId, hosts.id))
        .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id))
        .where(
          and(
            eq(eventBookings.status, "confirmed"),
            inArray(events.status, ["open", "booked", "filled"]),
            or(eq(events.requiresPayment, false), isNull(events.requiresPayment)),
            eq(restaurants.isActive, true),
            or(
              eq(restaurants.isFoodTruck, true),
              inArray(restaurants.businessType, truckBusinessTypeAliases),
            ),
            gte(events.date, queryStart),
            lte(events.date, end),
            or(
              ilike(hosts.city, cityLike(city.name)),
              ilike(hosts.address, cityLike(city.name)),
            ),
          ),
        )
        .orderBy(desc(hosts.updatedAt))
        .limit(120);

      const counts = new Map<string, { row: any; stopKeys: Set<string> }>();
      for (const row of hostRows as any[]) {
        const key = String(row.hostId || "");
        if (!key) continue;
        const timeZone = resolveCityTimeZoneSync({
          city: row.hostCity || null,
          state: row.hostState || null,
        });
        const interval = buildSlotDateTimes({
          timeZone,
          date: row.eventDate,
          startTime: String(row.eventStartTime || ""),
          endTime: String(row.eventEndTime || ""),
        });
        if (
          !interval ||
          !row.bookingConfirmedAt ||
          !isSlotPublic({
            slot: {
              source: "parking_pass_booking",
              status: "confirmed",
              startsAtUtc: interval.startUtc,
              endsAtUtc: interval.endUtc,
              lastConfirmedAtUtc: row.bookingConfirmedAt,
            },
            now,
            ttlHours: 24 * 365 * 100,
          })
        ) {
          continue;
        }
        if (!counts.has(key)) counts.set(key, { row, stopKeys: new Set() });
        if (row.eventId && row.truckId) {
          counts
            .get(key)!
            .stopKeys.add(`${String(row.eventId)}:${String(row.truckId)}`);
        }
      }

      const items = Array.from(counts.values())
        .filter((entry) => entry.stopKeys.size > 0)
        .map((entry) => {
          const id = String(entry.row.hostId);
          const slug = toSlug(entry.row.hostName) || id;
          const profilePath = buildPublicProfilePath({
            profileType: "location",
            id,
            name: String(entry.row.hostName || ""),
          });
          return {
            id,
            profileType: "location",
            displayName: cleanLabel(String(entry.row.hostName || "Location")),
            slug,
            profilePath,
            city: entry.row.hostCity || null,
            state: entry.row.hostState || null,
            imageUrl: null,
            cuisineTags: [],
            statusLabel: "Confirmed this week",
            summary: `${entry.stopKeys.size} confirmed truck stop${entry.stopKeys.size === 1 ? "" : "s"}`,
            primaryCtaPath: profilePath,
          };
        });

      return res.json(
        buildSeoPayload({
          routeKey: "locations-with-trucks",
          citySlug,
          cityName: city.name,
          title: `Locations with food trucks in ${city.name}`,
          description: `Find locations with food trucks active this week in ${city.name}.`,
          items,
          emptyMessage: "No locations with trucks are listed yet. Check nearby food or come back soon.",
        }),
      );
    } catch (error) {
      console.error("locations-with-trucks seo failed", error);
      return res.status(500).json({ message: "Failed to load page data" });
    }
  });
}
