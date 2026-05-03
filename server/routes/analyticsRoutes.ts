import type { Express } from "express";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { emailService } from "../emailService";
import { storage } from "../storage";
import { isAuthenticated } from "../unifiedAuth";
import { isPublicBusinessVisible } from "../utils/publicBusinessVisibility";
import {
  insertDealFeedbackSchema,
  restaurants,
  searchQueryEvents,
  supportTickets,
  type User,
} from "@shared/schema";

function normalizeSearchQuery(input: string) {
  return String(input || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function shouldDropSearchQuery(normalized: string) {
  if (!normalized || normalized.length < 2 || normalized.length > 80) {
    return true;
  }
  if (normalized.includes("@")) return true;
  if (normalized.includes("http://") || normalized.includes("https://")) {
    return true;
  }
  if (normalized.includes("www.")) return true;
  if (/\d{7,}/.test(normalized)) return true;
  return false;
}

const TRENDING_ADDRESS_WORD_PATTERN =
  /\b(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|highway|hwy|parkway|pkwy|circle|cir|court|ct|trail|trl|place|pl|way)\b/i;

function shouldDropTrendingQuery(normalized: string) {
  if (shouldDropSearchQuery(normalized)) return true;
  const commaCount = (normalized.match(/,/g) || []).length;
  const hasStreetWord = TRENDING_ADDRESS_WORD_PATTERN.test(normalized);
  const startsWithStreetNumber = /^\d{1,6}\s+\S+/.test(normalized);
  const hasStateOrCountry =
    /\b(usa|united states)\b/.test(normalized) ||
    /,\s*[a-z]{2}\s*(?:,|$)/i.test(normalized);

  if (startsWithStreetNumber) return true;
  if (hasStreetWord && (commaCount > 0 || /\d/.test(normalized))) return true;
  if (commaCount >= 2 && hasStateOrCountry) return true;
  if (normalized.split(/\s+/).length > 10 && hasStreetWord) return true;

  return false;
}

const INTEREST_ALIASES: Record<string, string[]> = {
  asian: ["asian", "chinese", "japanese", "korean", "thai", "sushi", "noodle"],
  breakfast: ["breakfast", "brunch", "coffee", "cafe"],
  burgers: ["burger", "burgers", "sandwich", "american"],
  coffee: ["coffee", "cafe", "latte"],
  dessert: ["dessert", "desserts", "bakery", "cake", "ice cream"],
  healthy: ["healthy", "salad", "smoothie", "vegan", "vegetarian"],
  mexican: ["mexican", "taco", "tacos", "burrito"],
  pizza: ["pizza", "pizzeria", "italian"],
  seafood: ["seafood", "fish", "shrimp"],
};

function normalizeInterest(value: unknown) {
  const normalized = normalizeSearchQuery(String(value || ""));
  if (!normalized || normalized === "all") return "";
  return normalized;
}

function textMatchesInterest(text: string, interest: string) {
  if (!interest) return true;
  const aliases = INTEREST_ALIASES[interest] || [interest];
  return aliases.some((alias) => text.includes(alias));
}

function toSearchCoordinate(value: unknown, maxAbs: number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > maxAbs) return null;
  return parsed;
}

function toFiniteCoordinate(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function getNearbyBusinessTrendRows({
  lat,
  lng,
  radiusKm,
  interest,
  limit,
}: {
  lat: number | null;
  lng: number | null;
  radiusKm: number;
  interest: string;
  limit: number;
}) {
  const hasOrigin = lat !== null && lng !== null;
  if (!hasOrigin && !interest) return [];

  const origin = hasOrigin ? { lat: lat as number, lng: lng as number } : null;
  const predicates: any[] = [eq(restaurants.isActive, true)];
  if (origin) {
    const latDelta = Math.max(0.01, radiusKm / 111);
    const lngDelta = Math.max(
      0.01,
      radiusKm /
        (111 *
          Math.max(0.2, Math.cos(((origin.lat as number) * Math.PI) / 180))),
    );
    predicates.push(isNotNull(restaurants.latitude));
    predicates.push(isNotNull(restaurants.longitude));
    predicates.push(
      sql`${restaurants.latitude} between ${origin.lat - latDelta} and ${origin.lat + latDelta}`,
    );
    predicates.push(
      sql`${restaurants.longitude} between ${origin.lng - lngDelta} and ${origin.lng + lngDelta}`,
    );
  }

  const rows = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      address: restaurants.address,
      city: restaurants.city,
      state: restaurants.state,
      cuisineType: restaurants.cuisineType,
      businessType: restaurants.businessType,
      description: restaurants.description,
      logoUrl: restaurants.logoUrl,
      coverImageUrl: restaurants.coverImageUrl,
      profileSource: restaurants.profileSource,
      isActive: restaurants.isActive,
      isVerified: restaurants.isVerified,
      isFoodTruck: restaurants.isFoodTruck,
      latitude: restaurants.latitude,
      longitude: restaurants.longitude,
    })
    .from(restaurants)
    .where(and(...predicates))
    .limit(origin ? 1000 : 2000);

  return rows
    .map((restaurant: any) => {
      if (!isPublicBusinessVisible(restaurant)) return null;
      const name = String(restaurant.name || "").trim();
      if (!name) return null;

      const haystack = normalizeSearchQuery(
        [
          restaurant.name,
          restaurant.cuisineType,
          restaurant.businessType,
          restaurant.city,
          restaurant.state,
        ]
          .filter(Boolean)
          .join(" "),
      );
      const interestMatch = textMatchesInterest(haystack, interest);
      if (interest && !interestMatch) return null;

      let distanceKm: number | null = null;
      if (origin) {
        const businessLat = toFiniteCoordinate(restaurant.latitude);
        const businessLng = toFiniteCoordinate(restaurant.longitude);
        if (businessLat === null || businessLng === null) return null;
        distanceKm = haversineKm(origin, {
          lat: businessLat,
          lng: businessLng,
        });
        if (distanceKm > radiusKm) return null;
      }

      const score =
        (interestMatch && interest ? 20 : 0) +
        (restaurant.isVerified ? 8 : 0) +
        (restaurant.isFoodTruck ? 4 : 0) +
        (distanceKm === null ? 0 : Math.max(0, 10 - distanceKm));

      return { restaurant, distanceKm, score };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, limit)
    .map((item: any) => {
      const miles =
        typeof item.distanceKm === "number" ? item.distanceKm * 0.621371 : null;
      return {
        query: String(item.restaurant.name || "").trim(),
        count: 0,
        lastSeen: null,
        context:
          miles !== null
            ? `${miles < 0.1 ? "Nearby" : `${miles.toFixed(1)} mi`}`
            : String(item.restaurant.cuisineType || "Recommended").trim(),
        source: "nearby_business",
      };
    });
}

export function registerAnalyticsRoutes(app: Express) {
  app.post("/api/support-tickets", isAuthenticated, async (req: any, res) => {
    try {
      const schema = z.object({
        subject: z.string().trim().min(3).max(160),
        description: z.string().trim().min(10).max(4000),
        category: z
          .enum(["bug", "feature", "payment", "account", "onboarding", "other"])
          .default("other"),
        priority: z
          .enum(["low", "normal", "high", "critical"])
          .default("normal"),
      });
      const parsed = schema.parse(req.body);
      const [ticket] = await db
        .insert(supportTickets)
        .values({
          userId: req.user.id,
          subject: parsed.subject,
          description: parsed.description,
          category: parsed.category,
          priority: parsed.priority,
          status: "open",
        })
        .returning();

      res.status(201).json({ ticket });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid support ticket", errors: error.errors });
      }
      console.error("Error creating support ticket:", error);
      res.status(500).json({ message: "Failed to create support ticket" });
    }
  });

  app.get("/api/support-tickets/my", isAuthenticated, async (req: any, res) => {
    try {
      const rows = await db
        .select()
        .from(supportTickets)
        .where(sql`${supportTickets.userId} = ${req.user.id}`)
        .orderBy(sql`${supportTickets.createdAt} desc`)
        .limit(25);
      res.json(rows);
    } catch (error) {
      console.error("Error fetching support tickets:", error);
      res.status(500).json({ message: "Failed to fetch support tickets" });
    }
  });

  app.get("/api/search/trending", async (req, res) => {
    try {
      const limitRaw = Number(req.query?.limit ?? 8);
      const windowDaysRaw = Number(req.query?.windowDays ?? 7);
      const lat = toSearchCoordinate(req.query?.lat, 90);
      const lng = toSearchCoordinate(req.query?.lng, 180);
      const radiusKmRaw = Number(req.query?.radiusKm ?? 25);
      const interest = normalizeInterest(req.query?.interest);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(20, limitRaw))
        : 8;
      const windowDays = Number.isFinite(windowDaysRaw)
        ? Math.max(1, Math.min(30, windowDaysRaw))
        : 7;
      const radiusKm = Number.isFinite(radiusKmRaw)
        ? Math.max(1, Math.min(80, radiusKmRaw))
        : 25;
      const trackedLimit = Math.max(40, limit * 8);

      const hasLocationScope = lat !== null && lng !== null;
      let nearbyRows = await getNearbyBusinessTrendRows({
        lat,
        lng,
        radiusKm,
        interest,
        limit,
      });
      if (hasLocationScope && interest && nearbyRows.length === 0) {
        nearbyRows = await getNearbyBusinessTrendRows({
          lat,
          lng,
          radiusKm,
          interest: "",
          limit,
        });
      }
      const nearbyNames = new Set(
        nearbyRows.map((row: any) => normalizeSearchQuery(row.query)),
      );

      const result: any = await db.execute(sql`
        select
          lower(trim(query)) as normalized_query,
          (array_agg(query order by created_at desc))[1] as display_query,
          count(*)::int as count,
          max(created_at) as last_seen
        from search_query_events
        where created_at >= (now() - make_interval(days => ${windowDays}))
          and length(trim(query)) between 2 and 80
        group by 1
        order by count desc, last_seen desc
        limit ${trackedLimit}
      `);

      const rows = Array.isArray(result?.rows) ? result.rows : result;
      const trackedRows = (Array.isArray(rows) ? rows : [])
        .map((row: any) => {
          const query = String(
            row.display_query || row.normalized_query || "",
          ).trim();
          const normalized = normalizeSearchQuery(query);
          const localNameMatch = nearbyNames.has(normalized);
          const interestMatch = textMatchesInterest(normalized, interest);
          const score =
            Number(row.count || 0) +
            (localNameMatch ? 30 : 0) +
            (interest && interestMatch ? 10 : 0);

          return {
            query,
            count: Number(row.count || 0),
            lastSeen: row.last_seen
              ? new Date(row.last_seen).toISOString()
              : null,
            context: localNameMatch
              ? "Nearby"
              : interestMatch
                ? "Matches interest"
                : "Trending",
            source: "search_history",
            score,
            hidden:
              shouldDropTrendingQuery(normalized) ||
              (hasLocationScope && !localNameMatch),
          };
        })
        .filter((item: any) => item.query && !item.hidden)
        .sort((a: any, b: any) => b.score - a.score);

      const deduped = new Map<string, any>();
      [...nearbyRows, ...trackedRows].forEach((row: any) => {
        const key = normalizeSearchQuery(row.query);
        if (!key || deduped.has(key)) return;
        deduped.set(key, {
          query: row.query,
          count: Number(row.count || 0),
          lastSeen: row.lastSeen || null,
          context: row.context || null,
          source: row.source || "search_history",
        });
      });

      res.json(Array.from(deduped.values()).slice(0, limit));
    } catch (error) {
      console.error("Error fetching trending searches:", error);
      res.status(500).json({ message: "Failed to fetch trending searches" });
    }
  });

  app.get("/api/search/latest", async (req, res) => {
    try {
      const limitRaw = Number(req.query?.limit ?? 8);
      const windowDaysRaw = Number(req.query?.windowDays ?? 7);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(20, limitRaw))
        : 8;
      const windowDays = Number.isFinite(windowDaysRaw)
        ? Math.max(1, Math.min(30, windowDaysRaw))
        : 7;

      const result: any = await db.execute(sql`
        select
          lower(trim(query)) as normalized_query,
          (array_agg(query order by created_at desc))[1] as display_query,
          max(created_at) as last_seen
        from search_query_events
        where created_at >= (now() - make_interval(days => ${windowDays}))
          and length(trim(query)) between 2 and 80
        group by 1
        order by last_seen desc
        limit ${limit}
      `);

      const rows = Array.isArray(result?.rows) ? result.rows : result;
      const payload = (Array.isArray(rows) ? rows : []).map((row: any) => ({
        query: String(row.display_query || row.normalized_query || "").trim(),
        lastSeen: row.last_seen ? new Date(row.last_seen).toISOString() : null,
      }));
      res.json(payload.filter((item: any) => item.query));
    } catch (error) {
      console.error("Error fetching latest searches:", error);
      res.status(500).json({ message: "Failed to fetch latest searches" });
    }
  });

  app.post("/api/search/track", async (req: any, res) => {
    try {
      const bodySchema = z.object({
        query: z.string().min(1).max(200),
        source: z.string().min(1).max(64).optional(),
      });
      const parsed = bodySchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid request" });
      }

      const rawQuery = String(parsed.data.query || "");
      const compacted = rawQuery.trim().replace(/\s+/g, " ");
      const normalized = normalizeSearchQuery(compacted);
      if (shouldDropSearchQuery(normalized)) {
        return res.status(204).end();
      }

      const source = String(parsed.data.source || "unknown").slice(0, 64);
      const userId = req.user?.id ? String(req.user.id) : null;

      await db.insert(searchQueryEvents).values({
        query: compacted,
        source,
        userId,
      });

      res.status(204).end();
    } catch (error) {
      console.error("Error tracking search query:", error);
      res.status(500).json({ message: "Failed to track search query" });
    }
  });

  app.post("/api/bug-report", async (req: any, res) => {
    try {
      const { screenshot, currentUrl, userAgent } = req.body;

      if (!currentUrl || !userAgent) {
        return res
          .status(400)
          .json({ message: "Missing required bug report data" });
      }

      const user = req.user as User | undefined;
      const userName = user
        ? `${user.firstName || ""} ${user.lastName || ""}`.trim()
        : undefined;
      const userEmail = user?.email || undefined;

      const bugReportData = {
        userEmail,
        userName,
        userAgent,
        currentUrl,
        timestamp: new Date().toLocaleString(),
        screenshotUrl: screenshot || undefined,
      };

      console.log("🐛 Bug Report Received:");
      console.log("   User:", userName || "Anonymous");
      console.log("   Email:", userEmail || "N/A");
      console.log("   URL:", currentUrl);
      console.log("   User Agent:", userAgent);
      console.log("   Time:", bugReportData.timestamp);
      console.log(
        "   Screenshot:",
        screenshot ? `${screenshot.substring(0, 50)}...` : "None",
      );

      const success = await emailService.sendBugReport(bugReportData);

      res.json({
        success: true,
        message: success
          ? "Bug report sent successfully"
          : "Bug report logged (email service not configured)",
      });
    } catch (error) {
      console.error("Error submitting bug report:", error);
      res.status(500).json({ message: "Failed to submit bug report" });
    }
  });

  app.post("/api/deals/:dealId/feedback", async (req: any, res) => {
    try {
      const { dealId } = req.params;
      const validatedData = insertDealFeedbackSchema.parse({
        ...req.body,
        dealId,
        userId: req.user?.id || null,
      });

      const feedback = await storage.createDealFeedback(validatedData);
      res.json(feedback);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Invalid feedback data", errors: error.errors });
      }
      console.error("Error creating deal feedback:", error);
      res.status(500).json({ message: "Failed to submit feedback" });
    }
  });

  app.get("/api/deals/:dealId/feedback", async (req, res) => {
    try {
      const { dealId } = req.params;
      const feedback = await storage.getDealFeedback(dealId);
      res.json(feedback);
    } catch (error) {
      console.error("Error fetching deal feedback:", error);
      res.status(500).json({ message: "Failed to fetch feedback" });
    }
  });

  app.get("/api/deals/:dealId/feedback/stats", async (req, res) => {
    try {
      const { dealId } = req.params;
      const stats = await storage.getDealFeedbackStats(dealId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching feedback stats:", error);
      res.status(500).json({ message: "Failed to fetch feedback stats" });
    }
  });
}
