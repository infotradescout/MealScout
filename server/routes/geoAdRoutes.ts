import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { isAdmin } from "../unifiedAuth";
import {
  geoAds,
  geoAdEvents,
  geoLocationPings,
  telemetryEvents,
} from "@shared/schema";

const placementSchema = z.enum(["map", "home", "deals"]);
const statusSchema = z.enum(["draft", "active", "paused", "archived"]);

const isValidUrl = (value: string) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const urlOrPathSchema = z
  .string()
  .min(1)
  .refine((value) => value.startsWith("/") || isValidUrl(value), {
    message: "Invalid URL",
  });

const geoAdSchema = z.object({
  name: z.string().min(1),
  status: statusSchema.optional(),
  placements: z.array(placementSchema).min(1),
  title: z.string().min(1),
  body: z.string().optional().nullable(),
  mediaUrl: urlOrPathSchema.optional().nullable(),
  targetUrl: urlOrPathSchema,
  ctaText: z.string().optional().nullable(),
  pinLat: z.coerce.number().optional().nullable(),
  pinLng: z.coerce.number().optional().nullable(),
  geofenceLat: z.coerce.number(),
  geofenceLng: z.coerce.number(),
  geofenceRadiusM: z.coerce.number().int().min(50).max(200000),
  targetUserTypes: z.array(z.string()).optional().nullable(),
  minDailyFootTraffic: z.coerce.number().int().min(0).optional().nullable(),
  maxDailyFootTraffic: z.coerce.number().int().min(0).optional().nullable(),
  priority: z.coerce.number().int().optional().nullable(),
  startAt: z.string().optional().nullable(),
  endAt: z.string().optional().nullable(),
});

const geoAdUpdateSchema = geoAdSchema.partial();

const adEventSchema = z.object({
  adId: z.string().min(1),
  eventType: z.enum(["impression", "click"]),
  placement: placementSchema,
});

const pingSchema = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  source: placementSchema.optional(),
});

const telemetrySchema = z.object({
  eventName: z.string().min(1).max(120),
  properties: z.record(z.unknown()).optional(),
});

const toDecimalString = (value: number, scale = 8) =>
  Number.isFinite(value) ? value.toFixed(scale) : null;

const haversineKm = (
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
};

const isMissingRelationError = (error: unknown, relationName?: string) => {
  const err = error as { code?: string; message?: string } | null;
  if (!err || err.code !== "42P01") return false;
  if (!relationName) return true;
  return err.message?.includes(`"${relationName}"`) ?? false;
};

const getFootTrafficCount = async (params: {
  lat: number;
  lng: number;
  radiusM: number;
  hours: number;
}) => {
  const { lat, lng, radiusM, hours } = params;
  const radiusKm = radiusM / 1000;
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);

  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const minLat = toDecimalString(lat - latDelta);
  const maxLat = toDecimalString(lat + latDelta);
  const minLng = toDecimalString(lng - lngDelta);
  const maxLng = toDecimalString(lng + lngDelta);
  let rows: Array<{
    lat: string | number | null;
    lng: string | number | null;
    userId: string | null;
    visitorId: string | null;
  }> = [];
  try {
    rows = await db
      .select({
        lat: geoLocationPings.lat,
        lng: geoLocationPings.lng,
        userId: geoLocationPings.userId,
        visitorId: geoLocationPings.visitorId,
      })
      .from(geoLocationPings)
      .where(
        and(
          gte(geoLocationPings.createdAt, since),
          gte(geoLocationPings.lat, minLat ?? "0"),
          lte(geoLocationPings.lat, maxLat ?? "0"),
          gte(geoLocationPings.lng, minLng ?? "0"),
          lte(geoLocationPings.lng, maxLng ?? "0"),
        ),
      );
  } catch (error) {
    if (isMissingRelationError(error, "geo_location_pings")) {
      console.warn(
        "geo_location_pings missing; skipping foot traffic calculation.",
      );
      return 0;
    }
    throw error;
  }

  const unique = new Set<string>();
  for (const row of rows) {
    const rowLat = Number(row.lat);
    const rowLng = Number(row.lng);
    if (!Number.isFinite(rowLat) || !Number.isFinite(rowLng)) continue;
    const distanceKm = haversineKm(lat, lng, rowLat, rowLng);
    if (distanceKm * 1000 > radiusM) continue;
    const key =
      row.userId ||
      row.visitorId ||
      `${rowLat.toFixed(3)}:${rowLng.toFixed(3)}`;
    unique.add(key);
  }
  return unique.size;
};

export function registerGeoAdRoutes(app: Express) {
  app.get("/api/geo-ads", async (req: any, res) => {
    const placementParse = placementSchema.safeParse(req.query.placement);
    if (!placementParse.success) {
      return res.status(400).json({ message: "placement is required" });
    }

    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.json([]);
    }

    const limitParam = Number(req.query.limit);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 20)
      : 3;

    const placement = placementParse.data;
    const userType = req.user?.userType || "guest";

    const nowSql = sql`NOW()`;
    const candidates = await db
      .select()
      .from(geoAds)
      .where(
        and(
          eq(geoAds.status, "active"),
          or(isNull(geoAds.startAt), lte(geoAds.startAt, nowSql)),
          or(isNull(geoAds.endAt), gte(geoAds.endAt, nowSql)),
        ),
      )
      .orderBy(desc(geoAds.priority), desc(geoAds.createdAt));

    const results = [];
    for (const ad of candidates) {
      const placements = Array.isArray(ad.placements) ? ad.placements : [];
      if (!placements.includes(placement)) continue;

      const targetUserTypes = Array.isArray(ad.targetUserTypes)
        ? ad.targetUserTypes
        : [];
      if (targetUserTypes.length > 0 && !targetUserTypes.includes(userType)) {
        continue;
      }

      const adLat = Number(ad.geofenceLat);
      const adLng = Number(ad.geofenceLng);
      const radiusM = Number(ad.geofenceRadiusM || 0);
      if (!Number.isFinite(adLat) || !Number.isFinite(adLng) || radiusM <= 0) {
        continue;
      }
      const distanceKm = haversineKm(lat, lng, adLat, adLng);
      if (distanceKm * 1000 > radiusM) continue;

      if (ad.minDailyFootTraffic || ad.maxDailyFootTraffic) {
        const traffic = await getFootTrafficCount({
          lat: adLat,
          lng: adLng,
          radiusM,
          hours: 24,
        });
        if (ad.minDailyFootTraffic && traffic < ad.minDailyFootTraffic) {
          continue;
        }
        if (ad.maxDailyFootTraffic && traffic > ad.maxDailyFootTraffic) {
          continue;
        }
      }

      results.push({
        id: ad.id,
        name: ad.name,
        title: ad.title,
        body: ad.body,
        mediaUrl: ad.mediaUrl,
        targetUrl: ad.targetUrl,
        ctaText: ad.ctaText,
        placements,
        pinLat: Number(ad.pinLat ?? ad.geofenceLat),
        pinLng: Number(ad.pinLng ?? ad.geofenceLng),
        geofenceLat: adLat,
        geofenceLng: adLng,
        geofenceRadiusM: radiusM,
      });

      if (results.length >= limit) break;
    }

    res.json(results);
  });

  app.post("/api/geo-ads/track", async (req: any, res) => {
    const parsed = adEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid event payload" });
    }

    const session = req.session as any;
    const visitorId = req.sessionID || session?.id || null;
    const userId = req.user?.id || null;

    await db.insert(geoAdEvents).values({
      adId: parsed.data.adId,
      eventType: parsed.data.eventType,
      placement: parsed.data.placement,
      userId,
      visitorId,
    });

    res.json({ ok: true });
  });

  app.post("/api/geo/ping", async (req: any, res) => {
    const parsed = pingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid location payload" });
    }

    const session = req.session as any;
    const now = Date.now();
    const lastPing = session?.lastGeoPingAt || 0;
    if (now - lastPing < 2 * 60 * 1000) {
      return res.json({ ok: true, skipped: true });
    }
    session.lastGeoPingAt = now;

    const roundedLat = Math.round(parsed.data.lat * 1000) / 1000;
    const roundedLng = Math.round(parsed.data.lng * 1000) / 1000;

    const visitorId = req.sessionID || session?.id || null;
    const userId = req.user?.id || null;
    const userType = req.user?.userType || "guest";

    void db
      .insert(geoLocationPings)
      .values({
        userId,
        visitorId,
        userType,
        lat: toDecimalString(roundedLat, 3) || "0",
        lng: toDecimalString(roundedLng, 3) || "0",
        source: parsed.data.source || null,
      })
      .catch((error: any) => {
        if (isMissingRelationError(error, "geo_location_pings")) {
          console.warn("geo_location_pings missing; skipping geo ping insert.");
          return;
        }
        console.warn("[geo] Failed to record location ping:", error);
      });

    res.json({ ok: true });
  });

  app.post("/api/telemetry/track", async (req: any, res) => {
    const parsed = telemetrySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid telemetry payload" });
    }

    const session = req.session as any;
    const now = Date.now();
    const eventName = parsed.data.eventName.trim();
    const throttleKey = `telemetry:${eventName}`;
    const lastAt = Number(session?.[throttleKey] || 0);
    if (now - lastAt < 1500) {
      return res.json({ ok: true, skipped: true });
    }
    if (session) {
      session[throttleKey] = now;
    }

    const incomingProperties = (parsed.data.properties || {}) as Record<
      string,
      unknown
    >;
    const hasUser = Boolean(req.user?.id);
    const inferredClientPath =
      typeof incomingProperties.path === "string" &&
      incomingProperties.path.trim().length > 0
        ? incomingProperties.path.trim()
        : (() => {
            try {
              const referer = String(req.get("referer") || "").trim();
              if (!referer) return null;
              const url = new URL(referer);
              return `${url.pathname}${url.search || ""}`;
            } catch {
              return null;
            }
          })();

    await db.insert(telemetryEvents).values({
      eventName,
      userId: req.user?.id || null,
      properties: {
        ...incomingProperties,
        clientPath: inferredClientPath,
        requestPath: req.path,
        anonSessionId: hasUser ? null : String(req.sessionID || ""),
      },
    });

    res.json({ ok: true });
  });

  app.get("/api/admin/geo-ads", isAdmin, async (req, res) => {
    const status = req.query.status as string | undefined;
    const filters = [];
    if (statusSchema.safeParse(status).success) {
      filters.push(eq(geoAds.status, status as string));
    }

    const query = db.select().from(geoAds);
    if (filters.length) {
      query.where(and(...filters));
    }
    const rows = await query.orderBy(desc(geoAds.createdAt));

    res.json(rows);
  });

  app.post("/api/admin/geo-ads", isAdmin, async (req: any, res) => {
    const parsed = geoAdSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid ad payload" });
    }

    const payload = parsed.data;
    const now = new Date();
    const startAt = payload.startAt ? new Date(payload.startAt) : null;
    const endAt = payload.endAt ? new Date(payload.endAt) : null;

    const created = await db
      .insert(geoAds)
      .values({
        name: payload.name.trim(),
        status: payload.status || "draft",
        placements: payload.placements,
        title: payload.title.trim(),
        body: payload.body?.trim() || null,
        mediaUrl: payload.mediaUrl || null,
        targetUrl: payload.targetUrl,
        ctaText: payload.ctaText || "Learn more",
        pinLat: payload.pinLat ? toDecimalString(payload.pinLat) : null,
        pinLng: payload.pinLng ? toDecimalString(payload.pinLng) : null,
        geofenceLat: toDecimalString(payload.geofenceLat) || "0",
        geofenceLng: toDecimalString(payload.geofenceLng) || "0",
        geofenceRadiusM: payload.geofenceRadiusM,
        targetUserTypes: payload.targetUserTypes || [],
        minDailyFootTraffic: payload.minDailyFootTraffic ?? null,
        maxDailyFootTraffic: payload.maxDailyFootTraffic ?? null,
        priority: payload.priority ?? 0,
        startAt: startAt && !Number.isNaN(startAt.valueOf()) ? startAt : null,
        endAt: endAt && !Number.isNaN(endAt.valueOf()) ? endAt : null,
        createdByUserId: req.user?.id || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    res.json(created[0]);
  });

  app.patch("/api/admin/geo-ads/:id", isAdmin, async (req: any, res) => {
    const parsed = geoAdUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid ad payload" });
    }

    const payload = parsed.data;
    const updates: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (payload.name !== undefined) updates.name = payload.name.trim();
    if (payload.status !== undefined) updates.status = payload.status;
    if (payload.placements !== undefined)
      updates.placements = payload.placements;
    if (payload.title !== undefined) updates.title = payload.title.trim();
    if (payload.body !== undefined) updates.body = payload.body?.trim() || null;
    if (payload.mediaUrl !== undefined) updates.mediaUrl = payload.mediaUrl;
    if (payload.targetUrl !== undefined) updates.targetUrl = payload.targetUrl;
    if (payload.ctaText !== undefined) updates.ctaText = payload.ctaText;
    if (payload.pinLat !== undefined)
      updates.pinLat = payload.pinLat ? toDecimalString(payload.pinLat) : null;
    if (payload.pinLng !== undefined)
      updates.pinLng = payload.pinLng ? toDecimalString(payload.pinLng) : null;
    if (payload.geofenceLat !== undefined)
      updates.geofenceLat = toDecimalString(payload.geofenceLat) || "0";
    if (payload.geofenceLng !== undefined)
      updates.geofenceLng = toDecimalString(payload.geofenceLng) || "0";
    if (payload.geofenceRadiusM !== undefined)
      updates.geofenceRadiusM = payload.geofenceRadiusM;
    if (payload.targetUserTypes !== undefined)
      updates.targetUserTypes = payload.targetUserTypes;
    if (payload.minDailyFootTraffic !== undefined)
      updates.minDailyFootTraffic = payload.minDailyFootTraffic;
    if (payload.maxDailyFootTraffic !== undefined)
      updates.maxDailyFootTraffic = payload.maxDailyFootTraffic;
    if (payload.priority !== undefined) updates.priority = payload.priority;
    if (payload.startAt !== undefined) {
      const startAt = payload.startAt ? new Date(payload.startAt) : null;
      updates.startAt =
        startAt && !Number.isNaN(startAt.valueOf()) ? startAt : null;
    }
    if (payload.endAt !== undefined) {
      const endAt = payload.endAt ? new Date(payload.endAt) : null;
      updates.endAt = endAt && !Number.isNaN(endAt.valueOf()) ? endAt : null;
    }

    const updated = await db
      .update(geoAds)
      .set(updates)
      .where(eq(geoAds.id, req.params.id))
      .returning();

    res.json(updated[0] || null);
  });

  app.delete("/api/admin/geo-ads/:id", isAdmin, async (req, res) => {
    const updated = await db
      .update(geoAds)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(geoAds.id, req.params.id))
      .returning();

    res.json(updated[0] || null);
  });

  app.get("/api/admin/geo-ads/:id/metrics", isAdmin, async (req, res) => {
    const days = Number(req.query.days) || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const ad = await db.query.geoAds.findFirst({
      where: eq(geoAds.id, req.params.id),
    });

    if (!ad) {
      return res.status(404).json({ message: "Ad not found" });
    }

    const [impressions] = await db
      .select({ count: sql<number>`count(*)` })
      .from(geoAdEvents)
      .where(
        and(
          eq(geoAdEvents.adId, ad.id),
          eq(geoAdEvents.eventType, "impression"),
          gte(geoAdEvents.createdAt, since),
        ),
      );

    const [clicks] = await db
      .select({ count: sql<number>`count(*)` })
      .from(geoAdEvents)
      .where(
        and(
          eq(geoAdEvents.adId, ad.id),
          eq(geoAdEvents.eventType, "click"),
          gte(geoAdEvents.createdAt, since),
        ),
      );

    const impressionsCount = Number(impressions?.count || 0);
    const clicksCount = Number(clicks?.count || 0);
    const ctr = impressionsCount > 0 ? clicksCount / impressionsCount : 0;

    const adLat = Number(ad.geofenceLat);
    const adLng = Number(ad.geofenceLng);
    const radiusM = Number(ad.geofenceRadiusM || 0);
    const footTraffic24h =
      Number.isFinite(adLat) && Number.isFinite(adLng) && radiusM > 0
        ? await getFootTrafficCount({
            lat: adLat,
            lng: adLng,
            radiusM,
            hours: 24,
          })
        : 0;

    res.json({
      impressions: impressionsCount,
      clicks: clicksCount,
      ctr,
      footTraffic24h,
      windowDays: days,
    });
  });
}
