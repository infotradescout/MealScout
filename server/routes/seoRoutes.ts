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
  ne,
  or,
} from "drizzle-orm";

import { db } from "../db";
import {
  cities,
  deals,
  events,
  hosts,
  restaurants,
  suppliers,
  truckManualSchedules,
  videoStories,
} from "@shared/schema";
import { getIndexNowConfig } from "../services/indexNow";

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

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
  res.setHeader(
    "Cache-Control",
    "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
  );
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
      const restaurantRows = await db
        .select({
          id: restaurants.id,
          name: restaurants.name,
          city: restaurants.city,
          cuisineType: restaurants.cuisineType,
          isFoodTruck: restaurants.isFoodTruck,
          updatedAt: restaurants.updatedAt,
        })
        .from(restaurants)
        .where(eq(restaurants.isActive, true))
        .orderBy(desc(restaurants.updatedAt));
      const hostRows = await db
        .select({
          id: hosts.id,
          name: hosts.businessName,
          updatedAt: hosts.updatedAt,
        })
        .from(hosts)
        .orderBy(desc(hosts.updatedAt));
      const supplierRows = await db
        .select({
          id: suppliers.id,
          name: suppliers.businessName,
          updatedAt: suppliers.updatedAt,
        })
        .from(suppliers)
        .where(eq(suppliers.isActive, true))
        .orderBy(desc(suppliers.updatedAt));

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
        "/truck-landing",
        "/for-hosts",
        "/host-location-partner",
        "/for-restaurants",
        "/for-bars",
        "/for-events",
        "/find-food",
        "/restaurant-signup",
        "/host-signup",
        "/events",
        "/search",
        "/map",
        "/parking-pass",
        "/deals",
        "/deals/featured",
        "/video",
        "/suppliers",
        "/events",
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

      uniqueCityRows.forEach((city: any) => {
        mergeUrl(
          `${baseUrl}/food-trucks/${encodeURIComponent(city.slug)}`,
          city.updatedAt || city.createdAt,
        );
      });

      restaurantRows.forEach((row: any) => {
        mergeUrl(
          `${baseUrl}/restaurant/${encodeURIComponent(row.id)}/${encodeURIComponent(
            toSlug(row.name) || row.id,
          )}`,
          row.updatedAt,
        );
      });

      hostRows.forEach((row: any) => {
        mergeUrl(
          `${baseUrl}/location/${encodeURIComponent(`${toSlug(row.name) || row.id}--${row.id}`)}`,
          row.updatedAt,
        );
      });

      supplierRows.forEach((row: any) => {
        mergeUrl(
          `${baseUrl}/supplier/${encodeURIComponent(`${toSlug(row.name) || row.id}--${row.id}`)}`,
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
        });
      } catch (dealCityErr) {
        console.error("[sitemap] deal-city section failed:", dealCityErr);
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
        .select({
          id: restaurants.id,
          name: restaurants.name,
          updatedAt: restaurants.updatedAt,
          isFoodTruck: restaurants.isFoodTruck,
          businessType: restaurants.businessType,
        })
        .from(restaurants)
        .where(eq(restaurants.isActive, true))
        .orderBy(desc(restaurants.updatedAt))
        .limit(50000);

      const entries = rows
        .filter(
          (row: any) =>
            Boolean(row.isFoodTruck) || row.businessType === "food_truck",
        )
        .map((row: any) => ({
          loc: `${baseUrl}/truck/${encodeURIComponent(`${toSlug(row.name) || row.id}--${row.id}`)}`,
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
        .select({
          id: restaurants.id,
          name: restaurants.name,
          updatedAt: restaurants.updatedAt,
          businessType: restaurants.businessType,
        })
        .from(restaurants)
        .where(eq(restaurants.isActive, true))
        .orderBy(desc(restaurants.updatedAt))
        .limit(50000);

      const entries = rows
        .filter((row: any) => row.businessType === "bar")
        .map((row: any) => ({
          loc: `${baseUrl}/bar/${encodeURIComponent(`${toSlug(row.name) || row.id}--${row.id}`)}`,
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
      const ttlHoursRaw = Number(process.env.PUBLIC_SLOT_TTL_HOURS ?? 72);
      const lookaheadHoursRaw = Number(
        process.env.PUBLIC_SLOT_LOOKAHEAD_HOURS ?? 24 * 7,
      );
      const ttlHours = Number.isFinite(ttlHoursRaw)
        ? Math.max(1, Math.min(ttlHoursRaw, 24 * 30))
        : 72;
      const lookaheadHours = Number.isFinite(lookaheadHoursRaw)
        ? Math.max(1, Math.min(lookaheadHoursRaw, 24 * 30))
        : 24 * 7;
      const now = new Date();
      const cutoff = new Date(now.getTime() - ttlHours * 60 * 60 * 1000);
      const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(
        now.getTime() + lookaheadHours * 60 * 60 * 1000,
      );

      const eligibleHostIds = await db
        .select({ hostId: events.hostId })
        .from(events)
        .where(
          and(
            isNotNull(events.bookedRestaurantId),
            ne(events.status, "cancelled"),
            gte(events.date, windowStart),
            lte(events.date, windowEnd),
            gte(events.lastConfirmedAt, cutoff),
          ),
        )
        .groupBy(events.hostId)
        .limit(50000)
        .then((rows: any[]) => rows.map((row) => String(row.hostId)));

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
      const ttlHoursRaw = Number(process.env.PUBLIC_SLOT_TTL_HOURS ?? 72);
      const lookaheadHoursRaw = Number(
        process.env.PUBLIC_SLOT_LOOKAHEAD_HOURS ?? 24 * 7,
      );
      const ttlHours = Number.isFinite(ttlHoursRaw)
        ? Math.max(1, Math.min(ttlHoursRaw, 24 * 30))
        : 72;
      const lookaheadHours = Number.isFinite(lookaheadHoursRaw)
        ? Math.max(1, Math.min(lookaheadHoursRaw, 24 * 30))
        : 24 * 7;
      const now = new Date();
      const cutoff = new Date(now.getTime() - ttlHours * 60 * 60 * 1000);
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
                eq(restaurants.businessType, "food_truck"),
              ),
              or(
                ilike(restaurants.city, cityLike),
                ilike(restaurants.address, cityLike),
              ),
            ),
          )
          .limit(1);

        const hasEvent = await db
          .select({ id: events.id })
          .from(events)
          .innerJoin(hosts, eq(events.hostId, hosts.id))
          .where(
            and(
              isNotNull(events.bookedRestaurantId),
              ne(events.status, "cancelled"),
              gte(events.date, windowStart),
              lte(events.date, windowEnd),
              gte(events.lastConfirmedAt, cutoff),
              or(ilike(hosts.city, cityLike), ilike(hosts.address, cityLike)),
            ),
          )
          .limit(1);

        const hasManual = await db
          .select({ id: truckManualSchedules.id })
          .from(truckManualSchedules)
          .where(
            and(
              eq(truckManualSchedules.isPublic, true),
              gte(truckManualSchedules.date, windowStart),
              lte(truckManualSchedules.date, windowEnd),
              gte(truckManualSchedules.lastConfirmedAt, cutoff),
              or(
                ilike(truckManualSchedules.city, cityLike),
                ilike(truckManualSchedules.address, cityLike),
              ),
            ),
          )
          .limit(1);

        if (
          hasTruck.length === 0 &&
          hasEvent.length === 0 &&
          hasManual.length === 0
        ) {
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
      const ttlHoursRaw = Number(process.env.PUBLIC_SLOT_TTL_HOURS ?? 72);
      const lookaheadHoursRaw = Number(
        process.env.PUBLIC_SLOT_LOOKAHEAD_HOURS ?? 24 * 7,
      );
      const ttlHours = Number.isFinite(ttlHoursRaw)
        ? Math.max(1, Math.min(ttlHoursRaw, 24 * 30))
        : 72;
      const lookaheadHours = Number.isFinite(lookaheadHoursRaw)
        ? Math.max(1, Math.min(lookaheadHoursRaw, 24 * 30))
        : 24 * 7;
      const now = new Date();
      const cutoff = new Date(now.getTime() - ttlHours * 60 * 60 * 1000);
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

        const hasEvent = await db
          .select({ id: events.id })
          .from(events)
          .innerJoin(hosts, eq(events.hostId, hosts.id))
          .where(
            and(
              isNotNull(events.bookedRestaurantId),
              ne(events.status, "cancelled"),
              gte(events.date, windowStart),
              lte(events.date, windowEnd),
              gte(events.lastConfirmedAt, cutoff),
              or(ilike(hosts.city, cityLike), ilike(hosts.address, cityLike)),
            ),
          )
          .limit(1);

        const hasManual = await db
          .select({ id: truckManualSchedules.id })
          .from(truckManualSchedules)
          .where(
            and(
              eq(truckManualSchedules.isPublic, true),
              gte(truckManualSchedules.date, windowStart),
              lte(truckManualSchedules.date, windowEnd),
              gte(truckManualSchedules.lastConfirmedAt, cutoff),
              or(
                ilike(truckManualSchedules.city, cityLike),
                ilike(truckManualSchedules.address, cityLike),
              ),
            ),
          )
          .limit(1);

        if (hasEvent.length === 0 && hasManual.length === 0) continue;
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
      const ttlHoursRaw = Number(process.env.PUBLIC_SLOT_TTL_HOURS ?? 72);
      const lookaheadHoursRaw = Number(
        process.env.PUBLIC_SLOT_LOOKAHEAD_HOURS ?? 24 * 7,
      );
      const ttlHours = Number.isFinite(ttlHoursRaw)
        ? Math.max(1, Math.min(ttlHoursRaw, 24 * 30))
        : 72;
      const lookaheadHours = Number.isFinite(lookaheadHoursRaw)
        ? Math.max(1, Math.min(lookaheadHoursRaw, 24 * 30))
        : 24 * 7;
      const now = new Date();
      const cutoff = new Date(now.getTime() - ttlHours * 60 * 60 * 1000);
      const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(
        now.getTime() + lookaheadHours * 60 * 60 * 1000,
      );

      const rows = await db
        .select({
          id: events.id,
          name: events.name,
          hostName: hosts.businessName,
          updatedAt: events.updatedAt,
        })
        .from(events)
        .innerJoin(hosts, eq(events.hostId, hosts.id))
        .where(
          and(
            isNotNull(events.bookedRestaurantId),
            ne(events.status, "cancelled"),
            gte(events.date, windowStart),
            lte(events.date, windowEnd),
            gte(events.lastConfirmedAt, cutoff),
          ),
        )
        .orderBy(desc(events.updatedAt))
        .limit(50000);

      sendUrlsetXml(res, {
        entries: rows.map((row: any) => {
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
        entries: rows.map((row: any) => ({
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
        `${baseUrl}/find-food`,
        `${baseUrl}/restaurant-signup`,
        `${baseUrl}/claim-truck`,
        `${baseUrl}/truck-landing`,
        `${baseUrl}/for-hosts`,
        `${baseUrl}/host-location-partner`,
        `${baseUrl}/map`,
        `${baseUrl}/search`,
        `${baseUrl}/events`,
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
        "Pattern: /restaurant/{id}/{slug}",
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
      const lines = [
        "MealScout",
        `${baseUrl}/llms.txt`,
      ].join("\n");
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
