import type { Express } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { isAuthenticated, isStaffOrAdmin } from "../unifiedAuth";
import { eventBookings, parkingRoutePlans, telemetryEvents } from "@shared/schema";
import { getHostByUserId } from "../services/hostOwnership";

const pointSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const hostSnapshotSchema = z.array(z.object({
  locationId: z.string().min(1), hostId: z.string().min(1), name: z.string().min(1),
  priceCents: z.number().int().nonnegative().nullable(), available: z.boolean(),
  latitude: z.number().optional(), longitude: z.number().optional(),
})).max(250);
const scheduleSchema = z.array(z.object({
  locationId: z.string().min(1), hostId: z.string().min(1), name: z.string().min(1),
  serviceMinutes: z.number().int().min(30).max(720), routeProgressMiles: z.number().nonnegative(),
})).max(30);
const planSchema = z.object({
  id: z.string().optional(), name: z.string().trim().min(1).max(160),
  originLabel: z.string().trim().min(1).max(500), destinationLabel: z.string().trim().min(1).max(500),
  origin: pointSchema, destination: pointSchema,
  scope: z.enum(["local", "regional", "nationwide"]), recurring: z.boolean(),
  schedule: scheduleSchema.default([]), hostSnapshot: hostSnapshotSchema.default([]),
});
const eventSchema = z.object({
  eventName: z.enum(["route_planned", "route_saved", "route_alert_generated", "route_stop_selected", "route_booking_started", "route_booking_confirmed"]),
  properties: z.record(z.any()).optional().default({}),
});

const asArray = (value: unknown) => Array.isArray(value) ? value : [];

export function registerParkingRoutePlanningRoutes(app: Express) {
  app.get("/api/parking-pass/routes", isAuthenticated, async (req: any, res) => {
    const rows = await db.select().from(parkingRoutePlans)
      .where(eq(parkingRoutePlans.userId, String(req.user.id)))
      .orderBy(desc(parkingRoutePlans.updatedAt));
    res.json({ routes: rows });
  });

  app.post("/api/parking-pass/routes", isAuthenticated, async (req: any, res) => {
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid route plan", issues: parsed.error.issues });
    const userId = String(req.user.id);
    const input = parsed.data;
    let previous: any = null;
    if (input.id) {
      [previous] = await db.select().from(parkingRoutePlans).where(and(
        eq(parkingRoutePlans.id, input.id), eq(parkingRoutePlans.userId, userId),
      )).limit(1);
    }
    const previousHosts = new Map(asArray(previous?.hostSnapshot).map((host: any) => [String(host.locationId), host]));
    const alerts = input.hostSnapshot.flatMap((host) => {
      const old: any = previousHosts.get(host.locationId);
      if (!old) return previous ? [{ type: "new_host", host }] : [];
      const changes: any[] = [];
      if (old.available !== host.available) changes.push({ type: "availability_changed", host, previous: old.available });
      if (old.priceCents !== host.priceCents) changes.push({ type: "price_changed", host, previous: old.priceCents });
      return changes;
    });
    const values = {
      userId, name: input.name, originLabel: input.originLabel, destinationLabel: input.destinationLabel,
      origin: input.origin, destination: input.destination, scope: input.scope, recurring: input.recurring,
      schedule: input.schedule, hostSnapshot: input.hostSnapshot, lastCheckedAt: new Date(), updatedAt: new Date(),
    };
    let route: any;
    if (previous) {
      [route] = await db.update(parkingRoutePlans).set(values).where(eq(parkingRoutePlans.id, previous.id)).returning();
    } else {
      [route] = await db.insert(parkingRoutePlans).values(values).returning();
    }
    await db.insert(telemetryEvents).values({
      eventName: previous ? "route_planned" : "route_saved", userId,
      properties: { routeId: route.id, hostCount: input.hostSnapshot.length, stopCount: input.schedule.length, scope: input.scope },
    });
    if (alerts.length) await db.insert(telemetryEvents).values({ eventName: "route_alert_generated", userId, properties: { routeId: route.id, count: alerts.length } });
    res.status(previous ? 200 : 201).json({ route, alerts });
  });

  app.delete("/api/parking-pass/routes/:routeId", isAuthenticated, async (req: any, res) => {
    await db.delete(parkingRoutePlans).where(and(eq(parkingRoutePlans.id, String(req.params.routeId)), eq(parkingRoutePlans.userId, String(req.user.id))));
    res.status(204).end();
  });

  app.post("/api/parking-pass/routes/events", isAuthenticated, async (req: any, res) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid planning event" });
    await db.insert(telemetryEvents).values({ eventName: parsed.data.eventName, userId: String(req.user.id), properties: parsed.data.properties });
    res.status(202).json({ accepted: true });
  });

  app.get("/api/parking-pass/host-route-demand", isAuthenticated, async (req: any, res) => {
    const host = await getHostByUserId(String(req.user.id));
    if (!host) return res.status(404).json({ message: "Host profile required" });
    const rows = await db.select({ id: parkingRoutePlans.id, name: parkingRoutePlans.name, schedule: parkingRoutePlans.schedule, hostSnapshot: parkingRoutePlans.hostSnapshot, updatedAt: parkingRoutePlans.updatedAt }).from(parkingRoutePlans);
    const matching = rows.filter((row: any) => asArray(row.hostSnapshot).some((item: any) => String(item.hostId) === String(host.id)));
    const scheduled = rows.filter((row: any) => asArray(row.schedule).some((item: any) => String(item.hostId) === String(host.id)));
    res.json({ hostId: host.id, routesNearby: matching.length, scheduledStops: scheduled.length, recentRoutes: matching.slice(0, 10) });
  });

  app.get("/api/admin/parking-pass/route-demand-heatmap", isAuthenticated, isStaffOrAdmin, async (_req, res) => {
    const rows = await db.select().from(parkingRoutePlans).orderBy(desc(parkingRoutePlans.updatedAt));
    const cells = new Map<string, any>();
    rows.forEach((row: any) => {
      const points = [row.origin, row.destination].filter(Boolean);
      points.forEach((point: any) => {
        const lat = Math.round(Number(point.lat) * 10) / 10, lng = Math.round(Number(point.lng) * 10) / 10;
        const key = `${lat}:${lng}`;
        const current = cells.get(key) || { lat, lng, routeCount: 0, scheduledStops: 0, hostOpportunities: 0 };
        current.routeCount += 1; current.scheduledStops += asArray(row.schedule).length; current.hostOpportunities += asArray(row.hostSnapshot).length;
        cells.set(key, current);
      });
    });
    res.json({ generatedAt: new Date().toISOString(), cells: Array.from(cells.values()).sort((a, b) => b.routeCount - a.routeCount) });
  });

  app.get("/api/admin/parking-pass/route-funnel", isAuthenticated, isStaffOrAdmin, async (_req, res) => {
    const names = ["route_planned", "route_saved", "route_alert_generated", "route_stop_selected", "route_booking_started", "route_booking_confirmed"];
    const rows = await db.select({ eventName: telemetryEvents.eventName, count: sql<number>`count(*)::int` }).from(telemetryEvents)
      .where(inArray(telemetryEvents.eventName, names)).groupBy(telemetryEvents.eventName);
    const counts = Object.fromEntries(names.map((name) => [name, 0]));
    rows.forEach((row: any) => { counts[row.eventName] = Number(row.count); });
    const [fees] = await db.select({
      platformFeeCents: sql<number>`coalesce(sum(${eventBookings.platformFeeCents}), 0)::int`,
    }).from(eventBookings).where(eq(eventBookings.status, "confirmed"));
    res.json({ generatedAt: new Date().toISOString(), counts, platformFeeCents: Number(fees?.platformFeeCents || 0) });
  });
}
