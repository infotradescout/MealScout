import { and, eq, gte, inArray } from "drizzle-orm";

import { db } from "../db";
import { moderationEvents } from "@shared/schema";

type ReportTargetType = "live_location" | "manual_schedule" | "event_schedule";

type ReportRow = {
  reportedResourceId: string | null;
  createdAt: Date | string | null;
};

export const getTruckLocationReportWindowMinutes = () =>
  Math.max(
    10,
    Number(process.env.TRUCK_LOCATION_REPORT_WINDOW_MINUTES || 30) || 30,
  );

export const getTruckLocationReportSuppressScore = () =>
  Math.max(
    2,
    Number(process.env.TRUCK_LOCATION_REPORT_SUPPRESS_SCORE || 2) || 2,
  );

const dayKey = (value: Date | string | null) => {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
};

export function calculateLocationReportHurtScores(reports: ReportRow[]) {
  const daysByResource = new Map<string, Map<string, number>>();
  for (const report of reports) {
    const id = String(report.reportedResourceId || "").trim();
    const key = dayKey(report.createdAt);
    if (!id || !key) continue;
    const days = daysByResource.get(id) || new Map<string, number>();
    days.set(key, (days.get(key) || 0) + 1);
    daysByResource.set(id, days);
  }

  const scores = new Map<string, number>();
  daysByResource.forEach((days, id) => {
    const sortedDays = Array.from(days.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    let score = 0;
    sortedDays.forEach(([, count], dayIndex) => {
      score += Math.pow(2, dayIndex) * Math.min(3, count);
    });
    scores.set(id, score);
  });
  return scores;
}

export async function getSuppressedLocationResourceIds(params: {
  resourceIds: string[];
  targetType: ReportTargetType;
  now?: Date;
}) {
  const ids = Array.from(
    new Set(params.resourceIds.map((id) => String(id || "").trim()).filter(Boolean)),
  );
  if (ids.length === 0) return new Set<string>();

  const now = params.now || new Date();
  const windowMinutes = getTruckLocationReportWindowMinutes();
  const lookbackMs = Math.max(windowMinutes * 60_000, 7 * 24 * 60 * 60_000);
  const reports = await db
    .select({
      reportedResourceId: moderationEvents.reportedResourceId,
      createdAt: moderationEvents.createdAt,
    })
    .from(moderationEvents)
    .where(
      and(
        eq(moderationEvents.eventType, "truck_location_missing_report"),
        eq(moderationEvents.reportedResourceType, params.targetType),
        eq(moderationEvents.status, "open"),
        inArray(moderationEvents.reportedResourceId, ids),
        gte(moderationEvents.createdAt, new Date(now.getTime() - lookbackMs)),
      ),
    )
    .limit(3000)
    .catch(() => []);

  const scores = calculateLocationReportHurtScores(reports as ReportRow[]);
  const suppressScore = getTruckLocationReportSuppressScore();
  return new Set(
    Array.from(scores.entries())
      .filter(([, score]) => score >= suppressScore)
      .map(([id]) => id),
  );
}
