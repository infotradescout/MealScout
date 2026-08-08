import type { Express } from "express";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from "drizzle-orm";

import { db } from "../db";
import {
  cities,
  deals,
  eventBookings,
  events,
  hosts,
  restaurants,
  suppliers,
  truckManualSchedules,
  users,
  videoStories,
} from "@shared/schema";
import { getIndexNowConfig } from "../services/indexNow";
import { isBarBusinessType, isTruckBusinessType } from "@shared/businessTypes";
import { resolveCityTimeZoneSync } from "../services/cityTimeZone";
import { buildSlotDateTimes } from "../services/timeIntent";
import { dateKeyInZone } from "../services/dateKeys";
import { isSlotPublic } from "../services/publicSlotGate";
import {
  assembleTruckOperatingPlan,
  type TruckOperatingPlanRow,
} from "../services/truckOperatingPlan";
import { isPublicDiscoveryEligibleEntity } from "@shared/publicDiscoveryIntegrity";
import {
  applySitemapMembershipCacheHeaders,
  isPublicRestaurantIndexable,
} from "../seo/publicRestaurantIndexability";

const truckBusinessTypeAliases = [
  "food_truck",
  "truck",
  "food-truck",
  "foodtruck",
  "mobile_food_vendor",
];

const hasEligibleConfirmedEventInCity = async (input: {
  cityLike: string;
  windowStart: Date;
  windowEnd: Date;
  now: Date;
}) => {
  const rows = await db
    .select({
      id: eventBookings.id,
      date: events.date,
      startTime: events.startTime,
      endTime: events.endTime,
      hostCity: hosts.city,
      hostState: hosts.state,
      bookingConfirmedAt: eventBookings.bookingConfirmedAt,
    })
    .from(eventBookings)
    .innerJoin(events, eq(eventBookings.eventId, events.id))
    .innerJoin(hosts, eq(events.hostId, hosts.id))
    .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id))
    .where(
      and(
        eq(eventBookings.status, "confirmed"),
        isNotNull(eventBookings.bookingConfirmedAt),
        inArray(events.status, ["open", "booked", "filled"]),
        eq(restaurants.isActive, true),
        or(
          eq(restaurants.isFoodTruck, true),
          inArray(restaurants.businessType, truckBusinessTypeAliases),
        ),
        gte(events.date, input.windowStart),
        lte(events.date, input.windowEnd),
        or(
          ilike(hosts.city, input.cityLike),
          ilike(hosts.address, input.cityLike),
        ),
      ),
    )
    .limit(250);

  return rows.some((row: any) => {
    if (!row.bookingConfirmedAt) return false;
    const timeZone = resolveCityTimeZoneSync({
      city: row.hostCity || null,
      state: row.hostState || null,
    });
    const interval = buildSlotDateTimes({
      timeZone,
      date: row.date,
      startTime: String(row.startTime || ""),
      endTime: String(row.endTime || ""),
    });
    return Boolean(
      interval &&
      isSlotPublic({
        slot: {
          source: "parking_pass_booking",
          status: "confirmed",
          startsAtUtc: interval.startUtc,
          endsAtUtc: interval.endUtc,
          lastConfirmedAtUtc: row.bookingConfirmedAt,
        },
        now: input.now,
        ttlHours: 24 * 365 * 100,
      }),
    );
  });
};

const hasEligibleManualTruckStopInCity = async (input: {
  cityLike: string;
  windowStart: Date;
  windowEnd: Date;
  now: Date;
}) => {
  const rows = await db
    .select({
      stopId: truckManualSchedules.id,
      date: truckManualSchedules.date,
      startTime: truckManualSchedules.startTime,
      endTime: truckManualSchedules.endTime,
      sourceStatus: truckManualSchedules.status,
      isPublic: truckManualSchedules.isPublic,
      locationName: truckManualSchedules.locationName,
      address: truckManualSchedules.address,
      city: truckManualSchedules.city,
      state: truckManualSchedules.state,
      timezone: truckManualSchedules.timezone,
      updatedAt: truckManualSchedules.updatedAt,
      lastConfirmedAt: truckManualSchedules.lastConfirmedAt,
      expiresAt: truckManualSchedules.expiresAt,
      sourceType: truckManualSchedules.sourceType,
      sourceConfidence: truckManualSchedules.sourceConfidence,
      ownerSubmittedEquivalent: truckManualSchedules.ownerSubmittedEquivalent,
      mapEligible: truckManualSchedules.mapEligible,
      liveFeedEligible: truckManualSchedules.liveFeedEligible,
    })
    .from(truckManualSchedules)
    .innerJoin(restaurants, eq(truckManualSchedules.truckId, restaurants.id))
    .where(
      and(
        eq(truckManualSchedules.isPublic, true),
        inArray(truckManualSchedules.status, [
          "open",
          "confirmed",
          "scheduled",
          "booked",
          "filled",
        ]),
        or(
          eq(truckManualSchedules.liveFeedEligible, true),
          isNull(truckManualSchedules.liveFeedEligible),
        ),
        or(
          isNull(truckManualSchedules.expiresAt),
          gte(truckManualSchedules.expiresAt, input.now),
        ),
        isNotNull(truckManualSchedules.lastConfirmedAt),
        eq(restaurants.isActive, true),
        or(
          eq(restaurants.isFoodTruck, true),
          inArray(restaurants.businessType, truckBusinessTypeAliases),
        ),
        gte(truckManualSchedules.date, input.windowStart),
        lte(truckManualSchedules.date, input.windowEnd),
        or(
          ilike(truckManualSchedules.city, input.cityLike),
          ilike(truckManualSchedules.address, input.cityLike),
        ),
      ),
    )
    .limit(250);
  const plan = assembleTruckOperatingPlan({
    rows: rows.map((row: any) => ({
      sourceKind: "manual",
      ...row,
    })) as TruckOperatingPlanRow[],
    now: input.now,
  });
  return Boolean(
    plan.currentStop ||
    plan.todayStop ||
    plan.nextStop ||
    plan.upcomingStops.length > 0,
  );
};

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const buildPublicProfilePath = (input: {
  profileType: "restaurant" | "truck" | "bar" | "location" | "supplier";
  id: string;
  name: string;
}) => {
  const slug = `${toSlug(input.name) || input.id}--${input.id}`;
  if (input.profileType === "location")
    return `/location/${encodeURIComponent(slug)}`;
  if (input.profileType === "supplier")
    return `/supplier/${encodeURIComponent(slug)}`;
  if (input.profileType === "truck")
    return `/truck/${encodeURIComponent(slug)}`;
  if (input.profileType === "bar") return `/bar/${encodeURIComponent(slug)}`;
  return `/restaurant/${encodeURIComponent(slug)}`;
};

const restaurantSitemapSelect = {
  id: restaurants.id,
  name: restaurants.name,
  city: restaurants.city,
  state: restaurants.state,
  address: restaurants.address,
  cuisineType: restaurants.cuisineType,
  description: restaurants.description,
  isFoodTruck: restaurants.isFoodTruck,
  businessType: restaurants.businessType,
  updatedAt: restaurants.updatedAt,
  isActive: restaurants.isActive,
  ownerId: restaurants.ownerId,
  ownerEmail: users.email,
  rawData: restaurants.rawData,
  phone: restaurants.phone,
  websiteUrl: restaurants.websiteUrl,
};

const isIndexableRestaurantRow = (row: {
  name?: unknown;
  isActive?: unknown;
  ownerId?: unknown;
  ownerEmail?: unknown;
  address?: unknown;
  cuisineType?: unknown;
  description?: unknown;
  city?: unknown;
  state?: unknown;
  rawData?: unknown;
  phone?: unknown;
  websiteUrl?: unknown;
}) =>
  isPublicRestaurantIndexable({
    name: row.name,
    isActive: row.isActive !== false,
    ownerId: row.ownerId,
    ownerEmail: row.ownerEmail,
    address: row.address,
    cuisineType: row.cuisineType,
    description: row.description,
    city: row.city,
    state: row.state,
    rawData: row.rawData,
    phone: row.phone,
    websiteUrl: row.websiteUrl,
  });

const resolveSitemapSiteUrl = () => {
  const normalizeCandidate = (raw?: string | null): string | null => {
    const value = String(raw || "").trim();
    if (!value) return null;
    try {
      const withProtocol = /^[a-z]+:\/\//i.test(value)
        ? value
        : `https://${value}`;
      const parsed = new URL(withProtocol);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      const hostname = parsed.hostname.toLowerCase();
      const bareHost = hostname.replace(/^www\./, "");
      if (bareHost !== "mealscout.us") return null;
      return "https://www.mealscout.us";
    } catch {
      return null;
    }
  };

  return (
    normalizeCandidate(process.env.SITEMAP_SITE_URL) ||
    normalizeCandidate(process.env.CLIENT_ORIGIN) ||
    normalizeCandidate(process.env.PUBLIC_BASE_URL) ||
    "https://www.mealscout.us"
  );
};

const toIsoDateOrNull = (value: unknown): string | null => {
  if (!value) return null;
  const dt = new Date(value as any);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.toISOString();
};

const sendUrlsetXml = (
  res: any,
  params: { entries: Array<{ loc: string; lastmod?: unknown }> },
) => {
  const lastmodByLoc = new Map<string, string | null>();
  const normalizeSitemapLoc = (loc: string): string | null => {
    const value = String(loc || "").trim();
    if (!value) return null;
    try {
      const parsed = new URL(value);
      const bareHost = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (bareHost !== "mealscout.us") return null;
      parsed.protocol = "https:";
      parsed.hostname = "www.mealscout.us";
      parsed.hash = "";
      parsed.search = "";
      return parsed.toString();
    } catch {
      return null;
    }
  };

  const mergeUrl = (loc: string, lastmod?: unknown) => {
    const normalized = normalizeSitemapLoc(loc);
    if (!normalized) return;
    const next = toIsoDateOrNull(lastmod);
    const existing = lastmodByLoc.get(normalized) || null;
    if (!existing) {
      lastmodByLoc.set(normalized, next);
      return;
    }
    if (!next) return;
    if (new Date(next).getTime() > new Date(existing).getTime()) {
      lastmodByLoc.set(normalized, next);
    }
  };

  for (const entry of params.entries) {
    mergeUrl(entry.loc, entry.lastmod);
  }

  const urls = Array.from(lastmodByLoc.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([loc, lastmod]) => ({ loc, lastmod }));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(
      (entry) =>
        `  <url><loc>${entry.loc}</loc>${entry.lastmod ? `<lastmod>${entry.lastmod}</lastmod>` : ""}</url>`,
    )
    .join("\n")}\n</urlset>`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  applySitemapMembershipCacheHeaders(res);
  res.send(xml);
};

export function registerSeoRoutes(app: Express) {
  const indexNowConfig = getIndexNowConfig();
  if (indexNowConfig.enabled && indexNowConfig.key) {
    const keyPath = `/${indexNowConfig.key}.txt`;
    app.get(keyPath, async (_req, res) => {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=1800");
      res.send(indexNowConfig.key);
    });
  }

  app.get("/sitemap.xml", async (_req, res) => {
    try {
      const cityRows = await db
        .select()
        .from(cities)
        .orderBy(desc(cities.createdAt));
      const allRestaurantRows = await db
        .select(restaurantSitemapSelect)
        .from(restaurants)
        .innerJoin(users, eq(restaurants.ownerId, users.id))
        .where(eq(restaurants.isActive, true))
        .orderBy(desc(restaurants.updatedAt));
      const allHostRows = await db
        .select({
          id: hosts.id,
          name: hosts.businessName,
          updatedAt: hosts.updatedAt,
        })
        .from(hosts)
        .orderBy(desc(hosts.updatedAt));
      const allSupplierRows = await db
        .select({
          id: suppliers.id,
          name: suppliers.businessName,
          updatedAt: suppliers.updatedAt,
        })
        .from(suppliers)
        .where(eq(suppliers.isActive, true))
        .orderBy(desc(suppliers.updatedAt));
      const restaurantRows = allRestaurantRows.filter((row: any) =>
        isIndexableRestaurantRow(row),
      );
      const hostRows = allHostRows.filter((row: any) =>
        isPublicDiscoveryEligibleEntity({
          name: row.name,
          isActive: true,
        }),
      );
      const supplierRows = allSupplierRows.filter((row: any) =>
        isPublicDiscoveryEligibleEntity({
          name: row.name,
          isActive: true,
        }),
      );

      const baseUrl = resolveSitemapSiteUrl();
      const lastmodByLoc = new Map<string, string | null>();
      const mergeUrl = (loc: string, lastmod?: unknown) => {
        const parsedLoc = toIsoDateOrNull(lastmod);
        const normalized = String(loc || "").trim();
        if (!normalized) return;
        const existing = lastmodByLoc.get(normalized) || null;
        if (!existing) {
          lastmodByLoc.set(normalized, parsedLoc);
          return;
        }
        if (!parsedLoc) return;
        if (new Date(parsedLoc).getTime() > new Date(existing).getTime()) {
          lastmodByLoc.set(normalized, parsedLoc);
        }
      };

      [
        "/",
        "/for-hosts",
        "/host-location-partner",
        "/for-restaurants",
        "/for-bars",
        "/for-events",
        "/restaurant-signup",
        "/host-signup",
        "/search",
        "/scout",
        "/parking-pass",
        "/deals",
        "/deals/featured",
        "/video",
        "/suppliers",
        "/events/public",
        "/about",
        "/faq",
        "/how-it-works",
        "/contact",
        "/install",
        "/terms-of-service",
        "/privacy-policy",
        "/sitemap",
        "/status",
      ].forEach((path) => mergeUrl(`${baseUrl}${path}`));

      const latestCityBySlug = new Map<string, any>();
      for (const city of cityRows as any[]) {
        const slug = String(city?.slug || "")
          .trim()
          .toLowerCase();
        if (!slug) continue;
        const existing = latestCityBySlug.get(slug);
        if (!existing) {
          latestCityBySlug.set(slug, city);
          continue;
        }
        const existingTs = new Date(
          existing.updatedAt || existing.createdAt || 0,
        ).getTime();
        const nextTs = new Date(
          city.updatedAt || city.createdAt || 0,
        ).getTime();
        if (nextTs >= existingTs) {
          latestCityBySlug.set(slug, city);
        }
      }
      const uniqueCityRows = Array.from(latestCityBySlug.values());

      const anyRestaurantCity = new Set(
        restaurantRows
          .map((row: any) =>
            String(row.city || "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),
      );
      const truckRestaurantCity = new Set(
        restaurantRows
          .filter(
            (row: any) =>
              Boolean(row.isFoodTruck) || isTruckBusinessType(row.businessType),
          )
          .map((row: any) =>
            String(row.city || "")
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean),
      );

      uniqueCityRows.forEach((city: any) => {
        const cityName = String(city?.name || "")
          .trim()
          .toLowerCase();
        if (!cityName) return;
        if (truckRestaurantCity.has(cityName)) {
          mergeUrl(
            `${baseUrl}/food-trucks/${encodeURIComponent(city.slug)}`,
            city.updatedAt || city.createdAt,
          );
          mergeUrl(
            `${baseUrl}/food-trucks-today/${encodeURIComponent(city.slug)}`,
            city.updatedAt || city.createdAt,
          );
        }
        if (anyRestaurantCity.has(cityName)) {
          mergeUrl(
            `${baseUrl}/city/${encodeURIComponent(city.slug)}/food`,
            city.updatedAt || city.createdAt,
          );
        }
      });

      restaurantRows.forEach((row: any) => {
        const isTruck =
          Boolean(row.isFoodTruck) || isTruckBusinessType(row.businessType);
        const isBar = isBarBusinessType(row.businessType);
        // Trucks/bars have dedicated sitemaps; never emit noncanonical /restaurant/ locs.
        if (isTruck || isBar) return;
        mergeUrl(
          `${baseUrl}${buildPublicProfilePath({
            profileType: "restaurant",
            id: String(row.id),
            name: String(row.name || ""),
          })}`,
          row.updatedAt,
        );
      });

      hostRows.forEach((row: any) => {
        mergeUrl(
          `${baseUrl}${buildPublicProfilePath({
            profileType: "location",
            id: String(row.id),
            name: String(row.name || ""),
          })}`,
          row.updatedAt,
        );
      });

      supplierRows.forEach((row: any) => {
        mergeUrl(
          `${baseUrl}${buildPublicProfilePath({
            profileType: "supplier",
            id: String(row.id),
            name: String(row.name || ""),
          })}`,
          row.updatedAt,
        );
      });

      const citySlugByName = new Map<string, string>();
      uniqueCityRows.forEach((city: any) => {
        const key = String(city?.name || "")
          .trim()
          .toLowerCase();
        const slug = String(city?.slug || "").trim();
        if (!key || !slug || citySlugByName.has(key)) return;
        citySlugByName.set(key, slug);
      });

      const cuisineLastmodByCity = new Map<string, string | null>();
      for (const row of restaurantRows as any[]) {
        const cityName = String(row.city || "")
          .trim()
          .toLowerCase();
        const citySlug = citySlugByName.get(cityName);
        const cuisineSlug = toSlug(row.cuisineType || "");
        if (!citySlug || !cuisineSlug) continue;
        const key = `${citySlug}:${cuisineSlug}`;
        const existing = cuisineLastmodByCity.get(key) || null;
        const next = toIsoDateOrNull(row.updatedAt);
        if (!existing) {
          cuisineLastmodByCity.set(key, next);
          continue;
        }
        if (!next) continue;
        if (new Date(next).getTime() > new Date(existing).getTime()) {
          cuisineLastmodByCity.set(key, next);
        }
      }

      cuisineLastmodByCity.forEach((lastmod, key) => {
        const [citySlug, cuisineSlug] = key.split(":");
        if (!citySlug || !cuisineSlug) return;
        mergeUrl(
          `${baseUrl}/food-trucks/${encodeURIComponent(citySlug)}/${encodeURIComponent(cuisineSlug)}`,
          lastmod || undefined,
        );
        mergeUrl(
          `${baseUrl}/cuisine/${encodeURIComponent(cuisineSlug)}/${encodeURIComponent(citySlug)}`,
          lastmod || undefined,
        );
      });

      // Deal-city pages: /deals/:citySlug for cities with at least one active deal
      try {
        const now = new Date();
        const activeDealRows = await db
          .select({
            cityName: restaurants.city,
            updatedAt: deals.updatedAt,
          })
          .from(deals)
          .innerJoin(restaurants, eq(deals.restaurantId, restaurants.id))
          .where(
            and(
              eq(deals.isActive, true),
              or(isNull(deals.endDate), gte(deals.endDate, now)),
              isNotNull(restaurants.city),
            ),
          );

        const dealCityLastmod = new Map<string, string | null>();
        for (const row of activeDealRows) {
          const cityName = String(row.cityName || "")
            .trim()
            .toLowerCase();
          const slug = citySlugByName.get(cityName);
          if (!slug) continue;
          const next = toIsoDateOrNull(row.updatedAt);
          const existing = dealCityLastmod.get(slug) || null;
          if (
            !existing ||
            (next && new Date(next).getTime() > new Date(existing).getTime())
          ) {
            dealCityLastmod.set(slug, next);
          }
        }

        dealCityLastmod.forEach((lastmod, slug) => {
          mergeUrl(
            `${baseUrl}/deals/${encodeURIComponent(slug)}`,
            lastmod || undefined,
          );
          mergeUrl(
            `${baseUrl}/deals-today/${encodeURIComponent(slug)}`,
            lastmod || undefined,
          );
        });
      } catch (dealCityErr) {
        console.error("[sitemap] deal-city section failed:", dealCityErr);
      }

      // Event city pages: /events-today/:citySlug where upcoming public events exist.
      try {
        const now = new Date();
        const queryStart = new Date(now);
        queryStart.setUTCHours(0, 0, 0, 0);
        queryStart.setUTCDate(queryStart.getUTCDate() - 1);
        const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const eventCityRows = await db
          .selectDistinct({
            cityName: hosts.city,
            hostState: hosts.state,
            eventDate: events.date,
            eventStartTime: events.startTime,
            eventEndTime: events.endTime,
            bookingConfirmedAt: eventBookings.bookingConfirmedAt,
            updatedAt: events.updatedAt,
          })
          .from(eventBookings)
          .innerJoin(events, eq(eventBookings.eventId, events.id))
          .innerJoin(hosts, eq(events.hostId, hosts.id))
          .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id))
          .where(
            and(
              eq(eventBookings.status, "confirmed"),
              isNotNull(eventBookings.bookingConfirmedAt),
              inArray(events.status, ["open", "booked", "filled"]),
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
              lte(events.date, windowEnd),
              isNotNull(hosts.city),
            ),
          );

        const eventCityLastmod = new Map<string, string | null>();
        for (const row of eventCityRows) {
          const timeZone = resolveCityTimeZoneSync({
            city: row.cityName || null,
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
            interval.endUtc.getTime() < now.getTime() ||
            dateKeyInZone(interval.startUtc, timeZone) !==
              dateKeyInZone(now, timeZone) ||
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
          const cityName = String(row.cityName || "")
            .trim()
            .toLowerCase();
          const slug = citySlugByName.get(cityName);
          if (!slug) continue;
          const next = toIsoDateOrNull(row.updatedAt);
          const existing = eventCityLastmod.get(slug) || null;
          if (
            !existing ||
            (next && new Date(next).getTime() > new Date(existing).getTime())
          ) {
            eventCityLastmod.set(slug, next);
          }
        }

        eventCityLastmod.forEach((lastmod, slug) => {
          mergeUrl(
            `${baseUrl}/events-today/${encodeURIComponent(slug)}`,
            lastmod || undefined,
          );
          mergeUrl(
            `${baseUrl}/locations-with-trucks/${encodeURIComponent(slug)}`,
            lastmod || undefined,
          );
        });
      } catch (eventCityErr) {
        console.error("[sitemap] event-city section failed:", eventCityErr);
      }

      sendUrlsetXml(res, {
        entries: Array.from(lastmodByLoc.entries()).map(([loc, lastmod]) => ({
          loc,
          lastmod,
        })),
      });
    } catch (e) {
      console.error("sitemap failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-trucks.xml", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const rows = await db
        .select(restaurantSitemapSelect)
        .from(restaurants)
        .innerJoin(users, eq(restaurants.ownerId, users.id))
        .where(eq(restaurants.isActive, true))
        .orderBy(desc(restaurants.updatedAt))
        .limit(50000);

      const entries = rows
        .filter(
          (row: any) =>
            (Boolean(row.isFoodTruck) ||
              isTruckBusinessType(row.businessType)) &&
            isIndexableRestaurantRow(row),
        )
        .map((row: any) => ({
          loc: `${baseUrl}${buildPublicProfilePath({
            profileType: "truck",
            id: String(row.id),
            name: String(row.name || ""),
          })}`,
          lastmod: row.updatedAt,
        }));

      sendUrlsetXml(res, { entries });
    } catch (e) {
      console.error("sitemap-trucks failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-bars.xml", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const rows = await db
        .select(restaurantSitemapSelect)
        .from(restaurants)
        .innerJoin(users, eq(restaurants.ownerId, users.id))
        .where(eq(restaurants.isActive, true))
        .orderBy(desc(restaurants.updatedAt))
        .limit(50000);

      const entries = rows
        .filter(
          (row: any) =>
            isBarBusinessType(row.businessType) &&
            isIndexableRestaurantRow(row),
        )
        .map((row: any) => ({
          loc: `${baseUrl}${buildPublicProfilePath({
            profileType: "bar",
            id: String(row.id),
            name: String(row.name || ""),
          })}`,
          lastmod: row.updatedAt,
        }));

      sendUrlsetXml(res, { entries });
    } catch (e) {
      console.error("sitemap-bars failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-locations.xml", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const lookaheadHoursRaw = Number(
        process.env.PUBLIC_SLOT_LOOKAHEAD_HOURS ?? 24 * 7,
      );
      const lookaheadHours = Number.isFinite(lookaheadHoursRaw)
        ? Math.max(1, Math.min(lookaheadHoursRaw, 24 * 30))
        : 24 * 7;
      const now = new Date();
      const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(
        now.getTime() + lookaheadHours * 60 * 60 * 1000,
      );

      const candidateRows = await db
        .select({
          hostId: events.hostId,
          eventDate: events.date,
          eventStartTime: events.startTime,
          eventEndTime: events.endTime,
          hostCity: hosts.city,
          hostState: hosts.state,
          bookingConfirmedAt: eventBookings.bookingConfirmedAt,
        })
        .from(eventBookings)
        .innerJoin(events, eq(eventBookings.eventId, events.id))
        .innerJoin(hosts, eq(events.hostId, hosts.id))
        .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id))
        .where(
          and(
            eq(eventBookings.status, "confirmed"),
            isNotNull(eventBookings.bookingConfirmedAt),
            inArray(events.status, ["open", "booked", "filled"]),
            eq(restaurants.isActive, true),
            or(
              eq(restaurants.isFoodTruck, true),
              inArray(restaurants.businessType, truckBusinessTypeAliases),
            ),
            gte(events.date, windowStart),
            lte(events.date, windowEnd),
          ),
        )
        .limit(50000);

      const eligibleHostIds = Array.from(
        new Set<string>(
          candidateRows.flatMap((row: (typeof candidateRows)[number]) => {
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
                lookaheadHours,
                ttlHours: 24 * 365 * 100,
              })
            ) {
              return [];
            }
            return [String(row.hostId)];
          }),
        ),
      );

      const rows =
        eligibleHostIds.length === 0
          ? []
          : await db
              .select({
                id: hosts.id,
                name: hosts.businessName,
                updatedAt: hosts.updatedAt,
              })
              .from(hosts)
              .where(inArray(hosts.id, eligibleHostIds))
              .orderBy(desc(hosts.updatedAt))
              .limit(50000);

      sendUrlsetXml(res, {
        entries: rows.map((row: any) => ({
          loc: `${baseUrl}/location/${encodeURIComponent(`${toSlug(row.name) || row.id}--${row.id}`)}`,
          lastmod: row.updatedAt,
        })),
      });
    } catch (e) {
      console.error("sitemap-locations failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-cities.xml", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const rows = await db
        .select()
        .from(cities)
        .orderBy(desc(cities.createdAt));
      const lookaheadHoursRaw = Number(
        process.env.PUBLIC_SLOT_LOOKAHEAD_HOURS ?? 24 * 7,
      );
      const lookaheadHours = Number.isFinite(lookaheadHoursRaw)
        ? Math.max(1, Math.min(lookaheadHoursRaw, 24 * 30))
        : 24 * 7;
      const now = new Date();
      const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(
        now.getTime() + lookaheadHours * 60 * 60 * 1000,
      );

      const entries: Array<{ loc: string; lastmod?: unknown }> = [];
      for (const row of rows as any[]) {
        const slug = String(row.slug || "").trim();
        const cityName = String(row.name || "").trim();
        if (!slug || !cityName) continue;
        const cityLike = `%${cityName}%`;

        const hasTruck = await db
          .select({ id: restaurants.id })
          .from(restaurants)
          .where(
            and(
              eq(restaurants.isActive, true),
              or(
                eq(restaurants.isFoodTruck, true),
                inArray(restaurants.businessType, truckBusinessTypeAliases),
              ),
              or(
                ilike(restaurants.city, cityLike),
                ilike(restaurants.address, cityLike),
              ),
            ),
          )
          .limit(1);

        const [hasEvent, hasManual] = await Promise.all([
          hasEligibleConfirmedEventInCity({
            cityLike,
            windowStart,
            windowEnd,
            now,
          }),
          hasEligibleManualTruckStopInCity({
            cityLike,
            windowStart,
            windowEnd,
            now,
          }),
        ]);

        if (hasTruck.length === 0 && !hasEvent && !hasManual) {
          continue;
        }

        entries.push({
          loc: `${baseUrl}/city/${encodeURIComponent(slug)}`,
          lastmod: row.createdAt,
        });
      }

      sendUrlsetXml(res, { entries });
    } catch (e) {
      console.error("sitemap-cities failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-cuisines.xml", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const rows = await db
        .select({
          cuisineType: restaurants.cuisineType,
          updatedAt: restaurants.updatedAt,
        })
        .from(restaurants)
        .where(eq(restaurants.isActive, true))
        .orderBy(desc(restaurants.updatedAt))
        .limit(50000);

      const lastmodByCuisine = new Map<string, string | null>();
      for (const row of rows as any[]) {
        const slug = toSlug(row.cuisineType || "");
        if (!slug) continue;
        const next = toIsoDateOrNull(row.updatedAt);
        const existing = lastmodByCuisine.get(slug) || null;
        if (!existing) {
          lastmodByCuisine.set(slug, next);
          continue;
        }
        if (!next) continue;
        if (new Date(next).getTime() > new Date(existing).getTime()) {
          lastmodByCuisine.set(slug, next);
        }
      }

      sendUrlsetXml(res, {
        entries: Array.from(lastmodByCuisine.entries()).map(
          ([slug, lastmod]) => ({
            loc: `${baseUrl}/cuisine/${encodeURIComponent(slug)}`,
            lastmod,
          }),
        ),
      });
    } catch (e) {
      console.error("sitemap-cuisines failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-time-pages.xml", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const rows = await db
        .select()
        .from(cities)
        .orderBy(desc(cities.createdAt));
      const modes = [
        "food-trucks-now",
        "food-trucks-breakfast",
        "food-trucks-lunch",
        "food-trucks-dinner",
        "food-trucks-tonight",
        "food-trucks-this-weekend",
      ];
      const lookaheadHoursRaw = Number(
        process.env.PUBLIC_SLOT_LOOKAHEAD_HOURS ?? 24 * 7,
      );
      const lookaheadHours = Number.isFinite(lookaheadHoursRaw)
        ? Math.max(1, Math.min(lookaheadHoursRaw, 24 * 30))
        : 24 * 7;
      const now = new Date();
      const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(
        now.getTime() + lookaheadHours * 60 * 60 * 1000,
      );

      const entries: Array<{ loc: string; lastmod?: unknown }> = [];
      for (const row of rows as any[]) {
        const slug = String(row.slug || "").trim();
        const cityName = String(row.name || "").trim();
        if (!slug || !cityName) continue;
        const cityLike = `%${cityName}%`;

        const [hasEvent, hasManual] = await Promise.all([
          hasEligibleConfirmedEventInCity({
            cityLike,
            windowStart,
            windowEnd,
            now,
          }),
          hasEligibleManualTruckStopInCity({
            cityLike,
            windowStart,
            windowEnd,
            now,
          }),
        ]);

        if (!hasEvent && !hasManual) continue;
        for (const mode of modes) {
          entries.push({
            loc: `${baseUrl}/city/${encodeURIComponent(slug)}/${encodeURIComponent(mode)}`,
            lastmod: row.createdAt,
          });
        }
      }

      sendUrlsetXml(res, { entries });
    } catch (e) {
      console.error("sitemap-time-pages failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-events.xml", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const lookaheadHoursRaw = Number(
        process.env.PUBLIC_SLOT_LOOKAHEAD_HOURS ?? 24 * 7,
      );
      const lookaheadHours = Number.isFinite(lookaheadHoursRaw)
        ? Math.max(1, Math.min(lookaheadHoursRaw, 24 * 30))
        : 24 * 7;
      const now = new Date();
      const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(
        now.getTime() + lookaheadHours * 60 * 60 * 1000,
      );

      const rows = await db
        .selectDistinct({
          id: events.id,
          name: events.name,
          hostName: hosts.businessName,
          eventDate: events.date,
          eventStartTime: events.startTime,
          eventEndTime: events.endTime,
          hostCity: hosts.city,
          hostState: hosts.state,
          bookingConfirmedAt: eventBookings.bookingConfirmedAt,
          updatedAt: events.updatedAt,
        })
        .from(eventBookings)
        .innerJoin(events, eq(eventBookings.eventId, events.id))
        .innerJoin(hosts, eq(events.hostId, hosts.id))
        .innerJoin(restaurants, eq(eventBookings.truckId, restaurants.id))
        .where(
          and(
            eq(eventBookings.status, "confirmed"),
            isNotNull(eventBookings.bookingConfirmedAt),
            inArray(events.status, ["open", "booked", "filled"]),
            or(
              isNull(events.requiresPayment),
              eq(events.requiresPayment, false),
            ),
            eq(restaurants.isActive, true),
            or(
              eq(restaurants.isFoodTruck, true),
              inArray(restaurants.businessType, truckBusinessTypeAliases),
            ),
            gte(events.date, windowStart),
            lte(events.date, windowEnd),
          ),
        )
        .orderBy(desc(events.updatedAt))
        .limit(50000);

      const eligibleRows = rows.filter((row: any) => {
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
          isSlotPublic({
            slot: {
              source: "parking_pass_booking",
              status: "confirmed",
              startsAtUtc: interval.startUtc,
              endsAtUtc: interval.endUtc,
              lastConfirmedAtUtc: row.bookingConfirmedAt,
            },
            now,
            lookaheadHours,
            ttlHours: 24 * 365 * 100,
          }),
        );
      });
      const uniqueEligibleRows = Array.from(
        new Map(
          eligibleRows.map((row: any) => [String(row.id), row] as const),
        ).values(),
      );

      sendUrlsetXml(res, {
        entries: uniqueEligibleRows.map((row: any) => {
          const title = row.name || row.hostName || row.id;
          return {
            loc: `${baseUrl}/event/${encodeURIComponent(`${toSlug(title) || row.id}--${row.id}`)}`,
            lastmod: row.updatedAt,
          };
        }),
      });
    } catch (e) {
      console.error("sitemap-events failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-deals.xml", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const now = new Date();
      const rows = await db
        .select({
          id: deals.id,
          title: deals.title,
          updatedAt: deals.updatedAt,
        })
        .from(deals)
        .where(
          and(
            eq(deals.isActive, true),
            lte(deals.startDate, now),
            or(isNull(deals.endDate), gte(deals.endDate, now)),
          ),
        )
        .orderBy(desc(deals.updatedAt))
        .limit(50000);

      sendUrlsetXml(res, {
        entries: rows.map((row: any) => ({
          loc: `${baseUrl}/deal/${encodeURIComponent(`${toSlug(row.title) || row.id}--${row.id}`)}`,
          lastmod: row.updatedAt,
        })),
      });
    } catch (e) {
      console.error("sitemap-deals failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-suppliers.xml", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const rows = await db
        .select({
          id: suppliers.id,
          name: suppliers.businessName,
          updatedAt: suppliers.updatedAt,
        })
        .from(suppliers)
        .where(eq(suppliers.isActive, true))
        .orderBy(desc(suppliers.updatedAt))
        .limit(50000);

      sendUrlsetXml(res, {
        entries: rows
          .filter((row: any) =>
            isPublicDiscoveryEligibleEntity({
              name: row.name,
              isActive: true,
            }),
          )
          .map((row: any) => ({
            loc: `${baseUrl}/supplier/${encodeURIComponent(`${toSlug(row.name) || row.id}--${row.id}`)}`,
            lastmod: row.updatedAt,
          })),
      });
    } catch (e) {
      console.error("sitemap-suppliers failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/sitemap-videos.xml", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const now = new Date();
      const rows = await db
        .select({
          id: videoStories.id,
          title: videoStories.title,
          createdAt: videoStories.createdAt,
        })
        .from(videoStories)
        .where(
          and(
            eq(videoStories.status, "ready"),
            eq(videoStories.isApproved, true),
            isNull(videoStories.deletedAt),
            gte(videoStories.expiresAt, now),
            isNotNull(videoStories.transcriptSource),
          ),
        )
        .orderBy(desc(videoStories.createdAt))
        .limit(50000);

      sendUrlsetXml(res, {
        entries: rows.map((row: any) => ({
          loc: `${baseUrl}/video/${encodeURIComponent(`${toSlug(row.title) || row.id}--${row.id}`)}`,
          lastmod: row.createdAt,
        })),
      });
    } catch (e) {
      console.error("sitemap-videos failed", e);
      res.status(500).send("<error>failed</error>");
    }
  });

  app.get("/llms.txt", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const lines = [
        "# MealScout",
        "",
        "MealScout is a local food discovery platform. It helps diners find food trucks, restaurants, and bars near them. It helps food truck owners get booked at host locations and events. It helps restaurant and bar owners publish specials and stay visible locally. It helps host-location partners list parking spots for food trucks.",
        "",
        "## What MealScout Does",
        "- Food truck discovery: live map, city/cuisine pages, booking",
        "- Restaurant & bar discovery: local specials, deals, profiles",
        "- Host locations: bookable parking spots for food trucks",
        "- Events & open calls: food truck event coordination",
        "- Online ordering: pickup menus with Stripe payments",
        "- Supply Scout: ingredient price tracking for operators",
        "",
        "## Priority Pages",
        `${baseUrl}/`,
        `${baseUrl}/for-restaurants`,
        `${baseUrl}/for-bars`,
        `${baseUrl}/for-events`,
        `${baseUrl}/scout`,
        `${baseUrl}/restaurant-signup`,
        `${baseUrl}/claim-business`,
        `${baseUrl}/for-hosts`,
        `${baseUrl}/host-location-partner`,
        `${baseUrl}/map`,
        `${baseUrl}/search`,
        `${baseUrl}/events/public`,
        `${baseUrl}/deals/featured`,
        `${baseUrl}/about`,
        `${baseUrl}/faq`,
        `${baseUrl}/how-it-works`,
        `${baseUrl}/sitemap`,
        `${baseUrl}/sitemap.xml`,
        "",
        "## City & Cuisine Discovery Pages",
        "Pattern: /food-trucks/{city-slug}",
        "Pattern: /food-trucks/{city-slug}/{cuisine-slug}",
        "Example: /food-trucks/pensacola-fl",
        "Example: /food-trucks/pensacola-fl/bbq",
        "",
        "## Business Profile Pages",
        "Pattern: /restaurant/{slug}--{id}",
        "Pattern: /location/{slug}--{id}",
        "Pattern: /supplier/{slug}--{id}",
        "",
        "## Policies",
        "Public marketing, discovery, and profile pages may be indexed and summarized.",
        "Private account, admin, and dashboard pages are not for indexing.",
        "",
        "## Contact",
        "Email: info.mealscout@gmail.com",
        "Website: https://www.mealscout.us",
      ].join("\n");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=1800");
      res.send(lines);
    } catch (e) {
      console.error("llms.txt failed", e);
      res.status(500).send("MealScout");
    }
  });

  app.get("/ai.txt", async (_req, res) => {
    try {
      const baseUrl = resolveSitemapSiteUrl();
      const lines = ["MealScout", `${baseUrl}/llms.txt`].join("\n");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=1800");
      res.send(lines);
    } catch (e) {
      console.error("ai.txt failed", e);
      res.status(500).send("MealScout");
    }
  });

  app.get("/robots.txt", async (_req, res) => {
    try {
      if (process.env.MEALSCOUT_PREVIEW_NOINDEX === "true") {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
        return res.send(["User-agent: *", "Disallow: /", ""].join("\n"));
      }

      const baseUrl = resolveSitemapSiteUrl();
      const robots = [
        "User-agent: *",
        "Allow: /robots.txt",
        "Allow: /llms.txt",
        "Allow: /ai.txt",
        "Allow: /sitemap.xml",
        "Allow: /sitemap-*.xml",
        "Allow: /truck/",
        "Allow: /location/",
        "Allow: /city/",
        "Allow: /event/",
        "Allow: /cuisine/",
        "Allow: /deal/",
        "Allow: /bar/",
        "Allow: /supplier/",
        "Allow: /video/",
        "Allow: /food-trucks/",
        "Allow: /p/",
        "Allow: /api/public/",
        "Allow: /api/trucks/live",
        "Allow: /api/truck-claims/public-search",
        "",
        "Disallow: /dashboard",
        "Disallow: /admin",
        "Disallow: /api",
        "Disallow: /vendor-dashboard",
        "Disallow: /supplier-portal",
        "",
        `Sitemap: ${baseUrl}/sitemap.xml`,
        `Sitemap: ${baseUrl}/sitemap-trucks.xml`,
        `Sitemap: ${baseUrl}/sitemap-bars.xml`,
        `Sitemap: ${baseUrl}/sitemap-locations.xml`,
        `Sitemap: ${baseUrl}/sitemap-cities.xml`,
        `Sitemap: ${baseUrl}/sitemap-cuisines.xml`,
        `Sitemap: ${baseUrl}/sitemap-events.xml`,
        `Sitemap: ${baseUrl}/sitemap-deals.xml`,
        `Sitemap: ${baseUrl}/sitemap-suppliers.xml`,
        `Sitemap: ${baseUrl}/sitemap-videos.xml`,
        `Sitemap: ${baseUrl}/sitemap-time-pages.xml`,
        "",
        `AI: ${baseUrl}/llms.txt`,
        ...(indexNowConfig.enabled &&
        indexNowConfig.key &&
        indexNowConfig.keyLocation
          ? [`IndexNow: ${indexNowConfig.keyLocation}`]
          : []),
        "",
      ].join("\n");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=1800");
      res.send(robots);
    } catch (e) {
      console.error("robots failed", e);
      res.status(500).send("User-agent: *\nAllow: /\n");
    }
  });
}
