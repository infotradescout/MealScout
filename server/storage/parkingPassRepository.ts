import {
  eventSeries,
  parkingPassBlackoutDates,
  type Host,
  type ParkingPassBlackoutDate,
  type InsertParkingPassBlackoutDate,
} from "@shared/schema";
import { PARKING_PASS_MEAL_WINDOWS } from "@shared/parkingPassSlots";
import { db, pool } from "../db";
import { eq, and, gte, lt, asc } from "drizzle-orm";
import { isParkingPassPublicReady } from "../services/parkingPassQuality";
import { resolveCityTimeZoneSync } from "../services/cityTimeZone";
import { utcDateFromDateKey } from "../services/dateKeys";

type ParkingPassRepoDeps = {
  getHost: (id: string) => Promise<Host | undefined>;
  getAllHosts: () => Promise<Host[]>;
};

export function createParkingPassRepository(deps: ParkingPassRepoDeps) {
  // Schema-drift tolerant promise cache for event_series columns
  let eventSeriesTableInfoPromise: Promise<{
    schema: string;
    columns: Set<string>;
  }> | null = null;

  async function getEventSeriesTableInfo(): Promise<{
    schema: string;
    columns: Set<string>;
  }> {
    if (eventSeriesTableInfoPromise) return eventSeriesTableInfoPromise;
    eventSeriesTableInfoPromise = (async () => {
      try {
        if (!pool) {
          return { schema: "public", columns: new Set<string>() };
        }

        const schemaRes = await pool.query(
          `
            select table_schema
            from information_schema.tables
            where table_name = 'event_series'
            order by case when table_schema = 'public' then 0 else 1 end
            limit 1
          `,
        );
        const schema =
          String(schemaRes.rows?.[0]?.table_schema || "").trim() || "public";

        const colsRes = await pool.query(
          `
            select column_name
            from information_schema.columns
            where table_schema = $1 and table_name = 'event_series'
          `,
          [schema],
        );
        const columns = new Set<string>(
          (colsRes.rows || [])
            .map((row: any) => String(row.column_name || "").trim())
            .filter(Boolean),
        );
        return { schema, columns };
      } catch (error) {
        console.warn(
          "getEventSeriesTableInfo failed; using safe event_series projection:",
          error,
        );
        return { schema: "public", columns: new Set<string>() };
      }
    })();
    return eventSeriesTableInfoPromise;
  }

  async function selectEventSeriesSafe(
    whereSql: string,
    params: any[],
  ): Promise<any[]> {
    if (!pool) return [];
    const { schema, columns } = await getEventSeriesTableInfo();
    const has = (col: string) => columns.size === 0 || columns.has(col);
    const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

    if (columns.size > 0 && (!columns.has("id") || !columns.has("host_id"))) {
      return [];
    }

    const select = [
      `${q("id")} as "id"`,
      `${q("host_id")} as "hostId"`,
      `${has("series_type") ? `${q("series_type")} as "seriesType"` : `null as "seriesType"`}`,
      `${has("name") ? `${q("name")} as "name"` : `null as "name"`}`,
      `${has("description") ? `${q("description")} as "description"` : `null as "description"`}`,
      `${has("start_date") ? `${q("start_date")} as "startDate"` : `null as "startDate"`}`,
      `${has("end_date") ? `${q("end_date")} as "endDate"` : `null as "endDate"`}`,
      `${has("status") ? `${q("status")} as "status"` : `null as "status"`}`,
      `${has("published_at") ? `${q("published_at")} as "publishedAt"` : `null as "publishedAt"`}`,
      `${has("default_start_time") ? `${q("default_start_time")} as "defaultStartTime"` : `null as "defaultStartTime"`}`,
      `${has("default_end_time") ? `${q("default_end_time")} as "defaultEndTime"` : `null as "defaultEndTime"`}`,
      `${has("default_max_trucks") ? `${q("default_max_trucks")} as "defaultMaxTrucks"` : `null as "defaultMaxTrucks"`}`,
      `${has("default_hard_cap_enabled") ? `${q("default_hard_cap_enabled")} as "defaultHardCapEnabled"` : `null as "defaultHardCapEnabled"`}`,
      `${has("parking_pass_days_of_week") ? `${q("parking_pass_days_of_week")} as "parkingPassDaysOfWeek"` : `null as "parkingPassDaysOfWeek"`}`,
      `${has("default_breakfast_price_cents") ? `${q("default_breakfast_price_cents")} as "defaultBreakfastPriceCents"` : `null as "defaultBreakfastPriceCents"`}`,
      `${has("default_lunch_price_cents") ? `${q("default_lunch_price_cents")} as "defaultLunchPriceCents"` : `null as "defaultLunchPriceCents"`}`,
      `${has("default_dinner_price_cents") ? `${q("default_dinner_price_cents")} as "defaultDinnerPriceCents"` : `null as "defaultDinnerPriceCents"`}`,
      `${has("default_daily_price_cents") ? `${q("default_daily_price_cents")} as "defaultDailyPriceCents"` : `null as "defaultDailyPriceCents"`}`,
      `${has("default_weekly_price_cents") ? `${q("default_weekly_price_cents")} as "defaultWeeklyPriceCents"` : `null as "defaultWeeklyPriceCents"`}`,
      `${has("default_monthly_price_cents") ? `${q("default_monthly_price_cents")} as "defaultMonthlyPriceCents"` : `null as "defaultMonthlyPriceCents"`}`,
      `${has("default_host_price_cents") ? `${q("default_host_price_cents")} as "defaultHostPriceCents"` : `null as "defaultHostPriceCents"`}`,
      `${has("updated_at") ? `${q("updated_at")} as "updatedAt"` : `null as "updatedAt"`}`,
    ];

    const sqlText = `select ${select.join(", ")} from ${q(schema)}.${q("event_series")} ${whereSql}`;
    const result = await pool.query(sqlText, params);
    return result.rows || [];
  }

  async function createDraftParkingPassForHost(host: Host): Promise<boolean> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 30);

    const existing = await db
      .select({ id: eventSeries.id })
      .from(eventSeries)
      .where(
        and(
          eq(eventSeries.hostId, host.id),
          eq(eventSeries.seriesType, "parking_pass"),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      return false;
    }

    const defaultStartTime = PARKING_PASS_MEAL_WINDOWS.breakfast.start;
    const defaultEndTime = PARKING_PASS_MEAL_WINDOWS.dinner.end;
    const spotCount = host.spotCount ?? 1;

    const breakfast =
      Number((host as any).parkingPassBreakfastPriceCents ?? 0) || 0;
    const lunch = Number((host as any).parkingPassLunchPriceCents ?? 0) || 0;
    const dinner = Number((host as any).parkingPassDinnerPriceCents ?? 0) || 0;
    const daily = Number((host as any).parkingPassDailyPriceCents ?? 0) || 0;
    const weekly = Number((host as any).parkingPassWeeklyPriceCents ?? 0) || 0;
    const monthly =
      Number((host as any).parkingPassMonthlyPriceCents ?? 0) || 0;
    const hostPrice = breakfast + lunch + dinner;
    const startTime = String((host as any).parkingPassStartTime || "").trim();
    const endTime = String((host as any).parkingPassEndTime || "").trim();
    const daysOfWeek = (host as any).parkingPassDaysOfWeek ?? [];

    const listing = {
      host,
      startTime: startTime || defaultStartTime,
      endTime: endTime || defaultEndTime,
      maxTrucks: spotCount,
      breakfastPriceCents: breakfast,
      lunchPriceCents: lunch,
      dinnerPriceCents: dinner,
      dailyPriceCents: daily || hostPrice,
      weeklyPriceCents: weekly,
      monthlyPriceCents: monthly,
    };
    const publicReady = isParkingPassPublicReady(listing as any);
    const seriesTimezone = resolveCityTimeZoneSync({
      city: host.city,
      state: host.state,
    });

    const [created] = await db
      .insert(eventSeries)
      .values({
        hostId: host.id,
        name: `Parking Pass - ${host.businessName}`,
        description: host.address,
        timezone: seriesTimezone,
        recurrenceRule: null,
        startDate: today,
        endDate: horizon,
        defaultStartTime: startTime || defaultStartTime,
        defaultEndTime: endTime || defaultEndTime,
        defaultMaxTrucks: spotCount,
        defaultHardCapEnabled: false,
        seriesType: "parking_pass",
        parkingPassDaysOfWeek: Array.isArray(daysOfWeek)
          ? (daysOfWeek as any)
          : [],
        defaultBreakfastPriceCents: breakfast,
        defaultLunchPriceCents: lunch,
        defaultDinnerPriceCents: dinner,
        defaultDailyPriceCents: daily || hostPrice,
        defaultWeeklyPriceCents: weekly,
        defaultMonthlyPriceCents: monthly,
        defaultHostPriceCents: hostPrice,
        status: publicReady ? "published" : "draft",
        publishedAt: publicReady ? new Date() : null,
      })
      .onConflictDoNothing()
      .returning();
    return Boolean(created?.id);
  }

  return {
    async getParkingPassSeriesSafe(): Promise<
      Array<{
        id: string;
        hostId: string;
        name: string | null;
        description: string | null;
        startDate: string | null;
        endDate: string | null;
        status: string | null;
        publishedAt: string | null;
        updatedAt: string | null;
        defaultStartTime: string | null;
        defaultEndTime: string | null;
        defaultMaxTrucks: number | null;
        defaultHardCapEnabled: boolean | null;
        parkingPassDaysOfWeek: unknown | null;
        defaultBreakfastPriceCents: number | null;
        defaultLunchPriceCents: number | null;
        defaultDinnerPriceCents: number | null;
        defaultDailyPriceCents: number | null;
        defaultWeeklyPriceCents: number | null;
        defaultMonthlyPriceCents: number | null;
        defaultHostPriceCents: number | null;
      }>
    > {
      const { columns } = await getEventSeriesTableInfo();
      const hasSeriesType = columns.size === 0 || columns.has("series_type");
      const whereSql = hasSeriesType ? `where "series_type" = $1` : "";
      const params = hasSeriesType ? ["parking_pass"] : [];
      const rows = await selectEventSeriesSafe(whereSql, params);
      return rows.map((row: any) => ({
        id: String(row.id),
        hostId: String(row.hostId),
        name: row.name == null ? null : String(row.name),
        description: row.description == null ? null : String(row.description),
        startDate: row.startDate ? new Date(row.startDate).toISOString() : null,
        endDate: row.endDate ? new Date(row.endDate).toISOString() : null,
        status: row.status == null ? null : String(row.status),
        publishedAt: row.publishedAt
          ? new Date(row.publishedAt).toISOString()
          : null,
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
        defaultStartTime:
          row.defaultStartTime == null ? null : String(row.defaultStartTime),
        defaultEndTime:
          row.defaultEndTime == null ? null : String(row.defaultEndTime),
        defaultMaxTrucks:
          row.defaultMaxTrucks == null ? null : Number(row.defaultMaxTrucks),
        defaultHardCapEnabled:
          row.defaultHardCapEnabled == null
            ? null
            : Boolean(row.defaultHardCapEnabled),
        parkingPassDaysOfWeek: row.parkingPassDaysOfWeek ?? null,
        defaultBreakfastPriceCents:
          row.defaultBreakfastPriceCents == null
            ? null
            : Number(row.defaultBreakfastPriceCents),
        defaultLunchPriceCents:
          row.defaultLunchPriceCents == null
            ? null
            : Number(row.defaultLunchPriceCents),
        defaultDinnerPriceCents:
          row.defaultDinnerPriceCents == null
            ? null
            : Number(row.defaultDinnerPriceCents),
        defaultDailyPriceCents:
          row.defaultDailyPriceCents == null
            ? null
            : Number(row.defaultDailyPriceCents),
        defaultWeeklyPriceCents:
          row.defaultWeeklyPriceCents == null
            ? null
            : Number(row.defaultWeeklyPriceCents),
        defaultMonthlyPriceCents:
          row.defaultMonthlyPriceCents == null
            ? null
            : Number(row.defaultMonthlyPriceCents),
        defaultHostPriceCents:
          row.defaultHostPriceCents == null
            ? null
            : Number(row.defaultHostPriceCents),
      }));
    },

    async syncParkingPassSeriesFromHost(hostId: string): Promise<string | null> {
      const normalizedHostId = String(hostId || "").trim();
      if (!normalizedHostId) return null;
      const host = await deps.getHost(normalizedHostId);
      if (!host) return null;

      await this.ensureDraftParkingPassForHost(host.id).catch(() => false);

      const defaultStartTime = PARKING_PASS_MEAL_WINDOWS.breakfast.start;
      const defaultEndTime = PARKING_PASS_MEAL_WINDOWS.dinner.end;
      const startTime =
        String((host as any).parkingPassStartTime || "").trim() ||
        defaultStartTime;
      const endTime =
        String((host as any).parkingPassEndTime || "").trim() || defaultEndTime;

      const breakfast =
        Number((host as any).parkingPassBreakfastPriceCents ?? 0) || 0;
      const lunch = Number((host as any).parkingPassLunchPriceCents ?? 0) || 0;
      const dinner =
        Number((host as any).parkingPassDinnerPriceCents ?? 0) || 0;
      const daily = Number((host as any).parkingPassDailyPriceCents ?? 0) || 0;
      const weekly =
        Number((host as any).parkingPassWeeklyPriceCents ?? 0) || 0;
      const monthly =
        Number((host as any).parkingPassMonthlyPriceCents ?? 0) || 0;
      const hostPrice = breakfast + lunch + dinner;
      const daysOfWeek = (host as any).parkingPassDaysOfWeek ?? [];
      const spotCount = Number((host as any).spotCount ?? 1) || 1;

      const listing = {
        host,
        startTime,
        endTime,
        maxTrucks: spotCount,
        breakfastPriceCents: breakfast,
        lunchPriceCents: lunch,
        dinnerPriceCents: dinner,
        dailyPriceCents: daily || hostPrice,
        weeklyPriceCents: weekly,
        monthlyPriceCents: monthly,
      };
      const publicReady = isParkingPassPublicReady(listing as any);

      let seriesId: string | null = null;
      try {
        const existing = await db
          .select({ id: eventSeries.id })
          .from(eventSeries)
          .where(
            and(
              eq(eventSeries.hostId, host.id),
              eq(eventSeries.seriesType, "parking_pass"),
            ),
          )
          .limit(1);
        seriesId = existing?.[0]?.id ?? null;
      } catch {
        const safe = await this.getParkingPassSeriesSafe().catch(() => []);
        const match = safe.find(
          (row) => String(row.hostId || "").trim() === host.id,
        );
        seriesId = match?.id ?? null;
      }

      const updates: any = {
        name: `Parking Pass - ${host.businessName}`,
        description: host.address,
        defaultStartTime: startTime,
        defaultEndTime: endTime,
        defaultMaxTrucks: spotCount,
        parkingPassDaysOfWeek: Array.isArray(daysOfWeek) ? daysOfWeek : [],
        defaultBreakfastPriceCents: breakfast,
        defaultLunchPriceCents: lunch,
        defaultDinnerPriceCents: dinner,
        defaultDailyPriceCents: daily || hostPrice,
        defaultWeeklyPriceCents: weekly,
        defaultMonthlyPriceCents: monthly,
        defaultHostPriceCents: hostPrice,
        status: publicReady ? "published" : "draft",
        publishedAt: publicReady ? new Date() : null,
        updatedAt: new Date(),
      };

      try {
        if (seriesId) {
          await db
            .update(eventSeries)
            .set(updates)
            .where(eq(eventSeries.id, seriesId));
          return seriesId;
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const horizon = new Date(today);
        horizon.setDate(horizon.getDate() + 30);
        const [created] = await db
          .insert(eventSeries)
          .values({
            hostId: host.id,
            timezone: resolveCityTimeZoneSync({
              city: host.city,
              state: host.state,
            }),
            recurrenceRule: null,
            startDate: today,
            endDate: horizon,
            defaultHardCapEnabled: false,
            seriesType: "parking_pass",
            ...updates,
          } as any)
          .onConflictDoNothing()
          .returning();
        if (created?.id) return created.id;
        const [existingAfterConflict] = await db
          .select({ id: eventSeries.id })
          .from(eventSeries)
          .where(
            and(
              eq(eventSeries.hostId, host.id),
              eq(eventSeries.seriesType, "parking_pass"),
            ),
          )
          .limit(1);
        return existingAfterConflict?.id ?? null;
      } catch (error) {
        console.warn("syncParkingPassSeriesFromHost failed:", error);
        return seriesId;
      }
    },

    async ensureDraftParkingPassesForHosts(): Promise<number> {
      const hostList = await deps.getAllHosts();
      let created = 0;
      for (const host of hostList) {
        try {
          const didCreate = await createDraftParkingPassForHost(host);
          if (didCreate) created += 1;
        } catch (error) {
          console.warn("ensureDraftParkingPassForHosts failed:", error);
        }
      }
      return created;
    },

    async ensureDraftParkingPassForHost(hostId: string): Promise<boolean> {
      const host = await deps.getHost(hostId);
      if (!host) return false;
      try {
        return await createDraftParkingPassForHost(host);
      } catch (e) {
        console.warn("ensureDraftParkingPassForHost failed:", e);
        return false;
      }
    },

    async getParkingPassBlackoutDates(
      seriesId: string,
    ): Promise<ParkingPassBlackoutDate[]> {
      return await db
        .select()
        .from(parkingPassBlackoutDates)
        .where(eq(parkingPassBlackoutDates.seriesId, seriesId))
        .orderBy(asc(parkingPassBlackoutDates.date));
    },

    async createParkingPassBlackoutDate(
      blackout: InsertParkingPassBlackoutDate,
    ): Promise<ParkingPassBlackoutDate> {
      const rawDate =
        blackout.date instanceof Date
          ? blackout.date
          : new Date(blackout.date as any);
      const dateKey = rawDate.toISOString().split("T")[0];
      const normalizedDate = utcDateFromDateKey(dateKey);
      const [created] = await db
        .insert(parkingPassBlackoutDates)
        .values({
          ...blackout,
          date: normalizedDate,
        })
        .returning();
      return created;
    },

    async deleteParkingPassBlackoutDate(
      seriesId: string,
      date: Date,
    ): Promise<void> {
      const dateKey = date.toISOString().split("T")[0];
      const start = utcDateFromDateKey(dateKey);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      await db
        .delete(parkingPassBlackoutDates)
        .where(
          and(
            eq(parkingPassBlackoutDates.seriesId, seriesId),
            gte(parkingPassBlackoutDates.date, start),
            lt(parkingPassBlackoutDates.date, end),
          ),
        );
    },
  };
}

export type ParkingPassRepository = ReturnType<
  typeof createParkingPassRepository
>;
