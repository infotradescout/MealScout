import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import {
  eventSeries,
  events,
  parkingPassBlackoutDates,
  type Event,
  type EventSeries,
  hosts,
} from "@shared/schema";
import {
  PARKING_PASS_MEAL_WINDOWS,
  timeToMinutes,
} from "@shared/parkingPassSlots";
import {
  addDaysToDateKey,
  dateKeyInZone,
  utcDateFromDateKey,
  weekdayInZoneForDateKey,
} from "./dateKeys";

const DEFAULT_HORIZON_DAYS = 30;

export const buildParkingPassVirtualId = (seriesId: string, dateKey: string) =>
  `pp:${seriesId}:${dateKey}`;

export const parseParkingPassVirtualId = (value: string) => {
  if (!value.startsWith("pp:")) return null;
  const parts = value.split(":");
  if (parts.length !== 3) return null;
  const [, seriesId, dateKey] = parts;
  if (!seriesId) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  return { seriesId, dateKey };
};

const dayStart = (d: Date) => {
  const next = new Date(d);
  next.setHours(0, 0, 0, 0);
  return next;
};

const addDays = (d: Date, days: number) => {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
};

const normalizeDaysOfWeek = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "number" ? item : Number(item)))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
};

const firstDefined = <T>(...values: Array<T | null | undefined>) => {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
};

const firstFiniteNumber = (
  ...values: Array<number | string | null | undefined>
) => {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const parsed = typeof value === "string" ? Number(value) : value;
    if (Number.isFinite(parsed)) return Number(parsed);
  }
  return null;
};

const ensureValidWindow = (startTime: string, endTime: string) => {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null || end <= start) {
    return {
      startTime: PARKING_PASS_MEAL_WINDOWS.breakfast.start,
      endTime: PARKING_PASS_MEAL_WINDOWS.dinner.end,
    };
  }
  return { startTime, endTime };
};

export type ParkingPassOccurrence = Event & {
  host: typeof hosts.$inferSelect;
  seriesStatus?: string | null;
  seriesPublishedAt?: Date | string | null;
  seriesStartDate?: Date | string | null;
  seriesEndDate?: Date | string | null;
};

const PUBLIC_SERIES_STATUSES = new Set(["published"]);
const DRAFT_SERIES_STATUSES = new Set(["draft"]);
const UNAVAILABLE_OCCURRENCE_STATUSES = new Set([
  "archived",
  "cancelled",
  "canceled",
  "closed",
  "completed",
  "deleted",
  "disabled",
  "draft",
  "expired",
  "inactive",
  "unavailable",
]);

const normalizeStatus = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const dateKeyFromMaybeDate = (
  value: unknown,
  timezone: string,
): string | null => {
  if (!value) return null;
  const parsed = new Date(value as any);
  if (!Number.isFinite(parsed.getTime())) return null;
  return dateKeyInZone(parsed, timezone);
};

export async function listParkingPassOccurrences(options?: {
  start?: Date;
  horizonDays?: number;
  hostIds?: string[];
  includeDraft?: boolean;
}) {
  const start = dayStart(options?.start ?? new Date());
  const horizonDays = Math.max(1, options?.horizonDays ?? DEFAULT_HORIZON_DAYS);
  const end = addDays(start, horizonDays);
  const includeDraft = options?.includeDraft ?? false;

  const statusFilter = includeDraft
    ? inArray(eventSeries.status, ["published", "draft"] as any)
    : eq(eventSeries.status, "published");

  const whereSeries = options?.hostIds?.length
    ? and(
        eq(eventSeries.seriesType, "parking_pass"),
        statusFilter as any,
        inArray(eventSeries.hostId, options.hostIds),
      )
    : and(eq(eventSeries.seriesType, "parking_pass"), statusFilter as any);

  let seriesRows: Array<{ series: EventSeries }> = [];
  try {
    seriesRows = await db
      .select({
        series: eventSeries,
      })
      .from(eventSeries)
      .where(whereSeries as any);
  } catch (error) {
    // Production DB schema drift has historically caused Drizzle "select all columns" queries to throw.
    // Fall back to the schema-tolerant storage projection so public feeds degrade gracefully.
    console.warn(
      "listParkingPassOccurrences: falling back to safe event_series projection:",
      error,
    );
    const raw = await storage.getParkingPassSeriesSafe();
    const allowStatuses = includeDraft
      ? new Set(["published", "draft"])
      : new Set(["published"]);
    const allowHostIds = options?.hostIds?.length
      ? new Set(
          options.hostIds.map((id) => String(id || "").trim()).filter(Boolean),
        )
      : null;

    const safeRows = raw.filter((row) => {
      const hostId = String(row.hostId || "").trim();
      if (!hostId) return false;
      if (allowHostIds && !allowHostIds.has(hostId)) return false;
      const status = normalizeStatus(row.status);
      if (status && !allowStatuses.has(status)) return false;
      if (!status && !includeDraft) return false;
      return true;
    });

    seriesRows = safeRows.map((row: any) => ({
      series: {
        id: row.id,
        hostId: row.hostId,
        coordinatorUserId: null,
        name: row.name ?? `Parking Pass - ${row.hostId}`,
        description: row.description ?? null,
        timezone: "America/Chicago",
        recurrenceRule: null,
        startDate: row.startDate ? (new Date(row.startDate) as any) : (start as any),
        endDate: row.endDate ? (new Date(row.endDate) as any) : (end as any),
        defaultStartTime:
          row.defaultStartTime ?? PARKING_PASS_MEAL_WINDOWS.breakfast.start,
        defaultEndTime:
          row.defaultEndTime ?? PARKING_PASS_MEAL_WINDOWS.dinner.end,
        defaultMaxTrucks: row.defaultMaxTrucks ?? 1,
        defaultHardCapEnabled: row.defaultHardCapEnabled ?? false,
        seriesType: "parking_pass",
        parkingPassDaysOfWeek: row.parkingPassDaysOfWeek ?? [],
        defaultBreakfastPriceCents: row.defaultBreakfastPriceCents ?? 0,
        defaultLunchPriceCents: row.defaultLunchPriceCents ?? 0,
        defaultDinnerPriceCents: row.defaultDinnerPriceCents ?? 0,
        defaultDailyPriceCents: row.defaultDailyPriceCents ?? 0,
        defaultWeeklyPriceCents: row.defaultWeeklyPriceCents ?? 0,
        defaultMonthlyPriceCents: row.defaultMonthlyPriceCents ?? 0,
        defaultHostPriceCents: row.defaultHostPriceCents ?? 0,
        status: row.status ?? (includeDraft ? "draft" : "published"),
        publishedAt: row.publishedAt
          ? (new Date(row.publishedAt) as any)
          : null,
        createdAt: null as any,
        updatedAt: row.updatedAt ? (new Date(row.updatedAt) as any) : null,
      } as any,
    }));
  }

  if (seriesRows.length === 0) {
    return { occurrences: [] as ParkingPassOccurrence[], start, end };
  }

  seriesRows = seriesRows.filter((row) => {
    const status = normalizeStatus((row.series as any).status);
    if (includeDraft) {
      return PUBLIC_SERIES_STATUSES.has(status) || DRAFT_SERIES_STATUSES.has(status);
    }
    return PUBLIC_SERIES_STATUSES.has(status);
  });

  if (seriesRows.length === 0) {
    return { occurrences: [] as ParkingPassOccurrence[], start, end };
  }

  const seriesHostIds = Array.from(
    new Set(
      seriesRows
        .map((row) => String(row.series.hostId || "").trim())
        .filter(Boolean),
    ),
  );
  const hostRows = await storage.getHostsByIds(seriesHostIds);
  const hostById = new Map<string, any>(
    (hostRows || []).map((host: any) => [host.id, host]),
  );
  const stubHost = (id: string) =>
    ({
      id,
      userId: "",
      businessName: "Host location",
      address: null,
      city: null,
      state: null,
      latitude: null,
      longitude: null,
      locationType: "other",
      expectedFootTraffic: null,
      amenities: null,
      contactPhone: null,
      notes: null,
      isVerified: false,
      adminCreated: false,
      spotCount: 1,
      stripeConnectAccountId: null,
      stripeConnectStatus: null,
      stripeOnboardingCompleted: false,
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      spotImageUrl: null,
      createdAt: null,
      updatedAt: null,
    }) as any;

  const seriesIds = seriesRows.map((row) => row.series.id);
  const seriesTimezoneById = new Map(
    seriesRows.map((row) => [
      row.series.id,
      String(row.series.timezone || "America/Chicago").trim(),
    ]),
  );
  const overrides = await db
    .select()
    .from(events)
    .where(
      and(
        inArray(events.seriesId, seriesIds),
        eq(events.eventType, "parking_pass"),
        eq(events.requiresPayment, true),
        gte(events.date, start),
        lt(events.date, end),
      ),
    );
  const overrideBySeriesDate = new Map<string, (typeof overrides)[number]>();
  for (const row of overrides) {
    const seriesId = row.seriesId;
    if (!seriesId) continue;
    const key = `${seriesId}:${dateKeyInZone(
      new Date(row.date),
      seriesTimezoneById.get(seriesId) || "America/Chicago",
    )}`;
    overrideBySeriesDate.set(key, row);
  }

  const blackoutRows: Array<{ seriesId: string; date: Date }> = await db
    .select({
      seriesId: parkingPassBlackoutDates.seriesId,
      date: parkingPassBlackoutDates.date,
    })
    .from(parkingPassBlackoutDates)
    .where(
      and(
        inArray(parkingPassBlackoutDates.seriesId, seriesIds),
        gte(parkingPassBlackoutDates.date, start),
        lt(parkingPassBlackoutDates.date, end),
      ),
    );
  const blackoutSet = new Set(
    blackoutRows.map(
      (row) =>
        `${row.seriesId}:${dateKeyInZone(
          new Date(row.date),
          seriesTimezoneById.get(row.seriesId) || "America/Chicago",
        )}`,
    ),
  );

  const occurrences: ParkingPassOccurrence[] = [];
  for (const row of seriesRows) {
    const series = row.series;
    const hostId = String(series.hostId || "").trim();
    const host = hostById.get(hostId) ?? stubHost(hostId);
    if (!hostId || !hostById.has(hostId)) {
      continue;
    }

    const daysOfWeek = normalizeDaysOfWeek(
      series.parkingPassDaysOfWeek as unknown,
    );
    const includeAllDays = daysOfWeek.length === 0;
    const window = ensureValidWindow(
      firstDefined(series.defaultStartTime, host.parkingPassStartTime) ??
        PARKING_PASS_MEAL_WINDOWS.breakfast.start,
      firstDefined(series.defaultEndTime, host.parkingPassEndTime) ??
        PARKING_PASS_MEAL_WINDOWS.dinner.end,
    );

    const seriesTimeZone = String(series.timezone || "America/Chicago").trim();
    const startDateKey = dateKeyInZone(start, seriesTimeZone);
    const seriesStartDateKey = dateKeyFromMaybeDate(
      (series as any).startDate,
      seriesTimeZone,
    );
    const seriesEndDateKey = dateKeyFromMaybeDate(
      (series as any).endDate,
      seriesTimeZone,
    );
    for (let offset = 0; offset < horizonDays; offset += 1) {
      const dateKey = addDaysToDateKey(startDateKey, offset);
      if (seriesStartDateKey && dateKey < seriesStartDateKey) {
        continue;
      }
      if (seriesEndDateKey && dateKey > seriesEndDateKey) {
        continue;
      }
      const dow = weekdayInZoneForDateKey(dateKey, seriesTimeZone);
      if (!includeAllDays && !daysOfWeek.includes(dow)) {
        continue;
      }
      const seriesDateKey = `${series.id}:${dateKey}`;
      if (blackoutSet.has(seriesDateKey)) {
        continue;
      }

      const override = overrideBySeriesDate.get(seriesDateKey);
      const startTime = override?.startTime ?? window.startTime;
      const endTime = override?.endTime ?? window.endTime;

      const id = override?.id ?? buildParkingPassVirtualId(series.id, dateKey);
      const effectiveDate = override?.date ?? utcDateFromDateKey(dateKey);

      const maxTrucks =
        firstFiniteNumber(
          override?.maxTrucks,
          series.defaultMaxTrucks,
          host.spotCount,
        ) ?? 1;
      const hardCapEnabled =
        override?.hardCapEnabled ?? series.defaultHardCapEnabled ?? false;
      const status = override?.status ?? "open";
      if (!includeDraft && UNAVAILABLE_OCCURRENCE_STATUSES.has(normalizeStatus(status))) {
        continue;
      }

      const breakfastPriceCents =
        firstFiniteNumber(
          override?.breakfastPriceCents,
          series.defaultBreakfastPriceCents,
          host.parkingPassBreakfastPriceCents,
        ) ?? 0;
      const lunchPriceCents =
        firstFiniteNumber(
          override?.lunchPriceCents,
          series.defaultLunchPriceCents,
          host.parkingPassLunchPriceCents,
        ) ?? 0;
      const dinnerPriceCents =
        firstFiniteNumber(
          override?.dinnerPriceCents,
          series.defaultDinnerPriceCents,
          host.parkingPassDinnerPriceCents,
        ) ?? 0;
      const dailyPriceCents =
        firstFiniteNumber(
          override?.dailyPriceCents,
          series.defaultDailyPriceCents,
          host.parkingPassDailyPriceCents,
        ) ?? 0;
      const weeklyPriceCents =
        firstFiniteNumber(
          override?.weeklyPriceCents,
          series.defaultWeeklyPriceCents,
          host.parkingPassWeeklyPriceCents,
        ) ?? 0;
      const monthlyPriceCents =
        firstFiniteNumber(
          override?.monthlyPriceCents,
          series.defaultMonthlyPriceCents,
          host.parkingPassMonthlyPriceCents,
        ) ?? 0;
      const hostPriceCents =
        firstFiniteNumber(
          override?.hostPriceCents,
          series.defaultHostPriceCents,
          dailyPriceCents,
        ) ?? 0;

      occurrences.push({
        id,
        hostId: host.id,
        seriesId: series.id,
        seriesStatus: (series as any).status ?? null,
        seriesPublishedAt: (series as any).publishedAt ?? null,
        seriesStartDate: (series as any).startDate ?? null,
        seriesEndDate: (series as any).endDate ?? null,
        name: override?.name ?? series.name,
        description: override?.description ?? series.description,
        eventType: "parking_pass",
        date: effectiveDate as any,
        startTime,
        endTime,
        maxTrucks,
        status,
        bookedRestaurantId: override?.bookedRestaurantId ?? null,
        hardCapEnabled,
        hostPriceCents,
        breakfastPriceCents,
        lunchPriceCents,
        dinnerPriceCents,
        dailyPriceCents,
        weeklyPriceCents,
        monthlyPriceCents,
        requiresPayment: true,
        lastConfirmedAt:
          override?.updatedAt ??
          override?.createdAt ??
          (series as any).publishedAt ??
          (series as any).updatedAt ??
          null,
        stripeProductId: override?.stripeProductId ?? null,
        stripePriceId: override?.stripePriceId ?? null,
        unbookedNotificationSentAt:
          override?.unbookedNotificationSentAt ?? null,
        createdAt: override?.createdAt ?? null,
        updatedAt: override?.updatedAt ?? null,
        host,
      } as ParkingPassOccurrence);
    }
  }

  occurrences.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
  return { occurrences, start, end };
}

export async function ensureParkingPassEventRow(args: {
  passId: string;
  requireFuture?: boolean;
}) {
  const parsed = parseParkingPassVirtualId(args.passId);
  if (!parsed) {
    const row = await db
      .select()
      .from(events)
      .where(eq(events.id, args.passId))
      .limit(1);
    return row[0] ?? null;
  }

  const { seriesId, dateKey } = parsed;
  const targetDate = utcDateFromDateKey(dateKey);

  const [seriesRow] = await db
    .select({ series: eventSeries, host: hosts })
    .from(eventSeries)
    .innerJoin(hosts, eq(hosts.id, eventSeries.hostId))
    .where(eq(eventSeries.id, seriesId))
    .limit(1);

  if (!seriesRow || seriesRow.series.seriesType !== "parking_pass") {
    return null;
  }
  const seriesTimeZone = String(
    seriesRow.series.timezone || "America/Chicago",
  ).trim();
  if (args.requireFuture) {
    const todayKey = dateKeyInZone(new Date(), seriesTimeZone);
    if (dateKey < todayKey) {
      throw new Error("Cannot book past Parking Pass dates.");
    }
  }

  // Blackout check
  const targetDateEnd = new Date(targetDate);
  targetDateEnd.setUTCDate(targetDateEnd.getUTCDate() + 1);
  const [blackout] = await db
    .select({ id: parkingPassBlackoutDates.id })
    .from(parkingPassBlackoutDates)
    .where(
      and(
        eq(parkingPassBlackoutDates.seriesId, seriesId),
        gte(parkingPassBlackoutDates.date, targetDate),
        lt(parkingPassBlackoutDates.date, targetDateEnd),
      ),
    )
    .limit(1);
  if (blackout) {
    return null;
  }

  // Day-of-week check
  const days = normalizeDaysOfWeek(
    seriesRow.series.parkingPassDaysOfWeek as unknown,
  );
  if (
    days.length > 0 &&
    !days.includes(weekdayInZoneForDateKey(dateKey, seriesTimeZone))
  ) {
    return null;
  }

  const window = ensureValidWindow(
    firstDefined(
      seriesRow.series.defaultStartTime,
      seriesRow.host.parkingPassStartTime,
    ) ?? PARKING_PASS_MEAL_WINDOWS.breakfast.start,
    firstDefined(
      seriesRow.series.defaultEndTime,
      seriesRow.host.parkingPassEndTime,
    ) ?? PARKING_PASS_MEAL_WINDOWS.dinner.end,
  );

  // Upsert-like behavior: if already exists, return it.
  const existing = await db
    .select()
    .from(events)
    .where(eq(events.id, args.passId))
    .limit(1);
  if (existing[0]) {
    return existing[0];
  }

  const insertPayload: typeof events.$inferInsert = {
    id: args.passId,
    hostId: seriesRow.host.id,
    seriesId: seriesRow.series.id,
    name: seriesRow.series.name,
    description: seriesRow.series.description ?? null,
    eventType: "parking_pass",
    date: targetDate,
    startTime: window.startTime,
    endTime: window.endTime,
    maxTrucks:
      firstFiniteNumber(
        seriesRow.series.defaultMaxTrucks,
        seriesRow.host.spotCount,
      ) ?? 1,
    status: "open",
    bookedRestaurantId: null,
    hardCapEnabled: seriesRow.series.defaultHardCapEnabled ?? false,
    hostPriceCents:
      firstFiniteNumber(
        seriesRow.series.defaultHostPriceCents,
        seriesRow.host.parkingPassDailyPriceCents,
      ) ?? 0,
    breakfastPriceCents:
      firstFiniteNumber(
        seriesRow.series.defaultBreakfastPriceCents,
        seriesRow.host.parkingPassBreakfastPriceCents,
      ) ?? 0,
    lunchPriceCents:
      firstFiniteNumber(
        seriesRow.series.defaultLunchPriceCents,
        seriesRow.host.parkingPassLunchPriceCents,
      ) ?? 0,
    dinnerPriceCents:
      firstFiniteNumber(
        seriesRow.series.defaultDinnerPriceCents,
        seriesRow.host.parkingPassDinnerPriceCents,
      ) ?? 0,
    dailyPriceCents:
      firstFiniteNumber(
        seriesRow.series.defaultDailyPriceCents,
        seriesRow.host.parkingPassDailyPriceCents,
      ) ?? 0,
    weeklyPriceCents:
      firstFiniteNumber(
        seriesRow.series.defaultWeeklyPriceCents,
        seriesRow.host.parkingPassWeeklyPriceCents,
      ) ?? 0,
    monthlyPriceCents:
      firstFiniteNumber(
        seriesRow.series.defaultMonthlyPriceCents,
        seriesRow.host.parkingPassMonthlyPriceCents,
      ) ?? 0,
    requiresPayment: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.insert(events).values(insertPayload).onConflictDoNothing();
  const [created] = await db
    .select()
    .from(events)
    .where(eq(events.id, args.passId))
    .limit(1);
  return created ?? null;
}
