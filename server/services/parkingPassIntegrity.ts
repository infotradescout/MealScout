import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { eventSeries, hosts } from "@shared/schema";
import { PARKING_PASS_MEAL_WINDOWS } from "@shared/parkingPassSlots";
import {
  computeParkingPassQualityFlags,
  isParkingPassPublicReady,
} from "./parkingPassQuality";

type IntegrityOptions = {
  dryRun?: boolean;
};

export async function runParkingPassIntegrity(options?: IntegrityOptions) {
  const dryRun = Boolean(options?.dryRun);

  const createdDraftSeries = await storage.ensureDraftParkingPassesForHosts();

  // Detect duplicates (more than one parking-pass series per host).
  const dupHostRows: Array<{ hostId: string; count: number }> = await db
    .select({
      hostId: eventSeries.hostId,
      count: sql<number>`count(*)`,
    })
    .from(eventSeries)
    .where(eq(eventSeries.seriesType, "parking_pass"))
    .groupBy(eventSeries.hostId)
    .having(sql`count(*) > 1`);

  const seriesRows = await db
    .select({ series: eventSeries, host: hosts })
    .from(eventSeries)
    .innerJoin(hosts, eq(hosts.id, eventSeries.hostId))
    .where(eq(eventSeries.seriesType, "parking_pass"));

  let updatedDefaults = 0;
  let updatedStatus = 0;

  const flagCounts = new Map<string, number>();
  const duplicates = dupHostRows.map((row) => ({
    hostId: String(row.hostId),
    count: Number(row.count || 0),
  }));

  for (const row of seriesRows as any[]) {
    const series = row.series;
    const host = row.host;

    const next: Record<string, any> = {};

    const startTime = String(series.defaultStartTime || "").trim();
    const endTime = String(series.defaultEndTime || "").trim();
    if (!startTime) next.defaultStartTime = PARKING_PASS_MEAL_WINDOWS.breakfast.start;
    if (!endTime) next.defaultEndTime = PARKING_PASS_MEAL_WINDOWS.dinner.end;

    const maxTrucks = Number(series.defaultMaxTrucks ?? 0);
    if (!Number.isFinite(maxTrucks) || maxTrucks < 1) {
      const fallback = Number(host.spotCount ?? 1);
      next.defaultMaxTrucks = Number.isFinite(fallback) && fallback > 0 ? fallback : 1;
    }

    const listing = {
      host,
      startTime: next.defaultStartTime ?? series.defaultStartTime,
      endTime: next.defaultEndTime ?? series.defaultEndTime,
      maxTrucks: next.defaultMaxTrucks ?? series.defaultMaxTrucks,
      breakfastPriceCents: series.defaultBreakfastPriceCents,
      lunchPriceCents: series.defaultLunchPriceCents,
      dinnerPriceCents: series.defaultDinnerPriceCents,
      dailyPriceCents: series.defaultDailyPriceCents,
      weeklyPriceCents: series.defaultWeeklyPriceCents,
      monthlyPriceCents: series.defaultMonthlyPriceCents,
    };

    const flags = computeParkingPassQualityFlags(listing as any);
    flags.forEach((flag) =>
      flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1),
    );
    // Diagnostics may include non-blocking operational flags such as a local
    // Stripe configuration being absent. Publication must use the same
    // readiness rule as the public feed so integrity runs cannot silently
    // unpublish otherwise bookable inventory.
    const publicReady = isParkingPassPublicReady(listing as any);
    const nextStatus = publicReady ? "published" : "draft";

    if (String(series.status) !== nextStatus) {
      next.status = nextStatus as any;
      next.publishedAt = publicReady ? (series.publishedAt ?? new Date()) : null;
    }

    if (Object.keys(next).length > 0) {
      next.updatedAt = new Date();
      if (!dryRun) {
        await db.update(eventSeries).set(next).where(eq(eventSeries.id, series.id));
      }
      if ("defaultStartTime" in next || "defaultEndTime" in next || "defaultMaxTrucks" in next) {
        updatedDefaults += 1;
      }
      if ("status" in next) {
        updatedStatus += 1;
      }
    }
  }

  return {
    dryRun,
    createdDraftSeries,
    duplicates,
    updatedDefaults,
    updatedStatus,
    flagCounts: Array.from(flagCounts.entries())
      .map(([flag, count]) => ({ flag, count }))
      .sort((a, b) => b.count - a.count),
  };
}
