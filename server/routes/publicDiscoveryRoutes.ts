import type { Express } from "express";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../db";
import { storage } from "../storage";
import {
  cities,
  events,
  hosts,
  restaurants,
  supplierProducts,
  suppliers,
  videoStories,
} from "@shared/schema";

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const resolvePublicBaseUrl = () =>
  String(
    process.env.PUBLIC_BASE_URL ||
      process.env.SERVICE_URL ||
      "https://www.mealscout.us",
  ).replace(/\/+$/, "");

export function registerPublicDiscoveryRoutes(app: Express) {
  app.get("/api/public/profiles/:entity/:id", async (req, res) => {
    try {
      const entity = String(req.params.entity || "").toLowerCase();
      const id = String(req.params.id || "").trim();
      if (!id) {
        return res.status(400).json({ message: "Profile id is required" });
      }

      const baseUrl = resolvePublicBaseUrl();

      if (entity === "restaurant") {
        const row = await storage.getRestaurant(id);
        if (!row || !row.isActive) {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.ownerId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress = profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        const slug = toSlug(row.name) || row.id;
        const profilePath = `/p/restaurant/${row.id}/${slug}`;
        return res.json({
          entity: "restaurant",
          id: row.id,
          title: row.name,
          subtitle:
            row.cuisineType || (row.isFoodTruck ? "Food Truck" : "Restaurant"),
          description:
            row.description ||
            `${row.name} on MealScout. Local hours, deals, and direct booking visibility.`,
          address: showAddress ? row.address || null : null,
          city: row.city || null,
          state: row.state || null,
          phone: showContact ? row.phone || null : null,
          websiteUrl: row.websiteUrl || null,
          imageUrl: row.coverImageUrl || row.logoUrl || null,
          profilePath,
          canonicalUrl: `${baseUrl}${profilePath}`,
          profileSettings,
          social: {
            instagramUrl: row.instagramUrl || null,
            facebookPageUrl: row.facebookPageUrl || null,
            xUrl: row.xUrl || null,
          },
        });
      }

      if (entity === "host") {
        const row = await storage.getHost(id);
        if (!row) {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.userId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress = profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        const slug = toSlug(row.businessName) || row.id;
        const profilePath = `/p/host/${row.id}/${slug}`;
        return res.json({
          entity: "host",
          id: row.id,
          title: row.businessName,
          subtitle:
            row.locationType === "event_coordinator"
              ? "Event Coordinator"
              : "Host Location",
          description:
            row.notes ||
            `${row.businessName} hosts trucks on MealScout with live event and parking availability.`,
          address: showAddress ? row.address || null : null,
          city: row.city || null,
          state: row.state || null,
          phone: showContact ? row.contactPhone || null : null,
          websiteUrl: null,
          imageUrl: row.spotImageUrl || null,
          profilePath,
          canonicalUrl: `${baseUrl}${profilePath}`,
          profileSettings,
          social: {
            instagramUrl: null,
            facebookPageUrl: null,
            xUrl: null,
          },
        });
      }

      if (entity === "supplier") {
        const [row] = await db
          .select()
          .from(suppliers)
          .where(and(eq(suppliers.id, id), eq(suppliers.isActive, true)))
          .limit(1);
        if (!row) {
          return res.status(404).json({ message: "Profile not found" });
        }
        const ownerUser = await storage.getUser(row.userId);
        const profileSettings = (ownerUser?.publicProfileSettings || {}) as any;
        const showAddress = profileSettings.showAddress !== false;
        const showContact = profileSettings.showContact !== false;
        const [counts] = await db
          .select({
            activeProductCount: sql<number>`count(*)`,
          })
          .from(supplierProducts)
          .where(
            and(
              eq(supplierProducts.supplierId, row.id),
              eq(supplierProducts.isActive, true),
            ),
          );
        const slug = toSlug(row.businessName) || row.id;
        const profilePath = `/p/supplier/${row.id}/${slug}`;
        return res.json({
          entity: "supplier",
          id: row.id,
          title: row.businessName,
          subtitle: "Supplier",
          description:
            row.onlinePaymentsNotes ||
            row.deliveryNotes ||
            `${row.businessName} supplies local trucks and kitchens on MealScout.`,
          address: showAddress ? row.address || null : null,
          city: row.city || null,
          state: row.state || null,
          phone: showContact ? row.contactPhone || null : null,
          websiteUrl: null,
          imageUrl: null,
          profilePath,
          canonicalUrl: `${baseUrl}${profilePath}`,
          profileSettings,
          metrics: {
            activeProductCount: Number(counts?.activeProductCount || 0),
          },
          social: {
            instagramUrl: null,
            facebookPageUrl: null,
            xUrl: null,
          },
        });
      }

      return res.status(400).json({ message: "Unsupported profile entity" });
    } catch (error) {
      console.error("Error fetching public profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.get("/api/cities", async (_req, res) => {
    try {
      const cityRows = await db
        .select({
          id: cities.id,
          name: cities.name,
          slug: cities.slug,
          state: cities.state,
          createdAt: cities.createdAt,
        })
        .from(cities)
        .orderBy(desc(cities.createdAt));

      const restaurantRows = await db
        .select({
          city: restaurants.city,
          cuisineType: restaurants.cuisineType,
          updatedAt: restaurants.updatedAt,
        })
        .from(restaurants)
        .where(eq(restaurants.isActive, true));

      const cuisineByCity = new Map<string, Map<string, number>>();
      for (const row of restaurantRows as any[]) {
        const cityName = String(row.city || "").trim().toLowerCase();
        const cuisine = toSlug(row.cuisineType || "");
        if (!cityName || !cuisine) continue;
        if (!cuisineByCity.has(cityName)) {
          cuisineByCity.set(cityName, new Map());
        }
        const cityMap = cuisineByCity.get(cityName)!;
        cityMap.set(cuisine, (cityMap.get(cuisine) || 0) + 1);
      }

      const payload = cityRows.map((city: any) => {
        const cityCuisineMap =
          cuisineByCity.get(String(city.name || "").toLowerCase()) || new Map();
        const cuisines = Array.from(cityCuisineMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([slug, count]) => ({ slug, count }));
        return {
          id: city.id,
          name: city.name,
          slug: city.slug,
          state: city.state,
          updatedAt: city.createdAt,
          cuisines,
        };
      });

      res.setHeader(
        "Cache-Control",
        "public, max-age=300, s-maxage=600, stale-while-revalidate=1200",
      );
      res.json(payload);
    } catch (error) {
      console.error("Error loading cities index:", error);
      res.status(500).json({ message: "Failed to load cities" });
    }
  });

  app.get("/api/cities/:slug", async (req, res) => {
    try {
      const { slug } = req.params as { slug: string };
      const [city] = await db.select().from(cities).where(eq(cities.slug, slug));
      if (!city) {
        return res.status(404).json({ message: "City not found" });
      }

      const cityRestaurants = await db
        .select()
        .from(restaurants)
        .where(eq(restaurants.city, city.name));
      const trucks = cityRestaurants.filter((row: any) => row.isFoodTruck);
      const restaurantsOnly = cityRestaurants.filter(
        (row: any) => !row.isFoodTruck,
      );

      const hostRows = await db.select().from(hosts).where(eq(hosts.city, city.name));
      const hostIds = hostRows.map((row: any) => row.id);
      let upcomingEvents: any[] = [];
      if (hostIds.length) {
        const now = new Date();
        upcomingEvents = await db.select().from(events).where(eq(events.status, "open"));
        upcomingEvents = upcomingEvents.filter(
          (row: any) => new Date(row.date) >= now && hostIds.includes(row.hostId),
        );
      }

      const restaurantIds = cityRestaurants.map((row: any) => row.id);
      let stories: any[] = [];
      if (restaurantIds.length) {
        stories = await db
          .select()
          .from(videoStories)
          .orderBy(desc(videoStories.createdAt));
        stories = stories
          .filter((row: any) => row.restaurantId && restaurantIds.includes(row.restaurantId))
          .slice(0, 8);
      }

      const cuisineCounts: Record<string, number> = {};
      for (const row of cityRestaurants) {
        if ((row as any).cuisineType) {
          const cuisine = String((row as any).cuisineType).toLowerCase();
          cuisineCounts[cuisine] = (cuisineCounts[cuisine] || 0) + 1;
        }
      }

      res.json({
        city: { name: city.name, slug: city.slug, state: city.state },
        stats: {
          restaurants: restaurantsOnly.length,
          trucks: trucks.length,
          events: upcomingEvents.length,
        },
        restaurants: restaurantsOnly,
        trucks,
        events: upcomingEvents,
        cuisines: Object.entries(cuisineCounts)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 12),
        stories,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error building city page:", error);
      res.status(500).json({ message: "Failed to load city" });
    }
  });
}
