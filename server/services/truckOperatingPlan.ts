import { DateTime } from "luxon";
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  eventBookings,
  events,
  eventSeries,
  hosts,
  truckManualSchedules,
  users,
} from "@shared/schema";
import type {
  PublicEventItem,
  PublicTruckScheduleStop,
  PublicTruckScheduleSummary,
} from "@shared/publicProfiles";
import { db } from "../db";
import { resolveCityTimeZoneSync } from "./cityTimeZone";
import {
  buildPublicProfilePath,
  resolvePublicProfileVisibility,
} from "../publicProfiles/publicProfileUtils";
import { buildSlotDateTimes } from "./timeIntent";
import {
  getPublicSlotGateConfigFromEnv,
  isSlotPublic,
} from "./publicSlotGate";
import { isPublicDiscoveryEligibleEntity } from "@shared/publicDiscoveryIntegrity";
import { resolveCoordinatePair } from "@shared/consumerEntity";

export type TruckOperatingPlanRow = {
  restaurantId?: unknown;
  sourceKind: "booking" | "manual";
  stopId?: unknown;
  eventId?: unknown;
  eventTitle?: unknown;
  eventDescription?: unknown;
  eventType?: unknown;
  eventRequiresPayment?: unknown;
  date?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  sourceStatus?: unknown;
  bookingStatus?: unknown;
  isPublic?: unknown;
  locationName?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  hostId?: unknown;
  hostName?: unknown;
  timezone?: unknown;
  updatedAt?: unknown;
  lastConfirmedAt?: unknown;
  expiresAt?: unknown;
  sourceType?: unknown;
  sourceConfidence?: unknown;
  ownerSubmittedEquivalent?: unknown;
  notice?: unknown;
  mapEligible?: unknown;
  liveFeedEligible?: unknown;
  addressVisible?: unknown;
};

const HIDDEN_STATUSES = new Set([
  "cancelled",
  "canceled",
  "refunded",
  "rejected",
  "deleted",
  "expired",
  "draft",
  "pending",
  "moved",
  "sold_out",
  "closed_early",
  "inactive",
  "unavailable",
  "unknown",
  "completed",
]);

const toDate = (value: unknown) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const toDateKey = (value: unknown) => {
  if (typeof value === "string") {
    const raw = value.trim();
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const date = toDate(value);
  return date
    ? DateTime.fromJSDate(date, { zone: "utc" }).toFormat("yyyy-LL-dd")
    : null;
};

const cleanTime = (value: unknown) => {
  const raw = String(value || "").trim();
  return /^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(raw)
    ? raw.slice(0, 5)
    : null;
};

const resolveTimeZone = (row: TruckOperatingPlanRow) => {
  const supplied = String(row.timezone || "").trim();
  if (supplied) {
    return DateTime.local().setZone(supplied).isValid ? supplied : null;
  }
  const city = String(row.city || "").trim();
  const state = String(row.state || "").trim();
  if (!city || !state) return null;
  return resolveCityTimeZoneSync({
    city,
    state,
  });
};

const normalizeSourceStatus = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase();

const classifyStopStatus = (input: {
  startsAt: Date | null;
  endsAt: Date | null;
  now: Date;
  sourceStatus: string;
}): PublicTruckScheduleStop["status"] => {
  if (input.sourceStatus === "closed") return "closed";
  if (input.sourceStatus.includes("sold_out")) return "sold_out";
  if (input.sourceStatus.includes("closed_early")) return "closed_early";
  if (input.sourceStatus.includes("move")) return "moved";
  if (!input.startsAt || !input.endsAt) return "scheduled";
  if (input.now >= input.startsAt && input.now < input.endsAt) {
    return "here_now";
  }
  if (input.now > input.endsAt) return "completed";
  return "scheduled";
};

const buildHostProfilePath = (hostId: unknown, hostName: unknown) => {
  const id = String(hostId || "").trim();
  if (!id) return null;
  return buildPublicProfilePath({
    entityType: "location",
    name: String(hostName || id),
    id,
  });
};

const buildDirectionsUrl = (input: {
  latitude: number | null;
  longitude: number | null;
  exactAddressPublicLabel: string | null;
}) => {
  if (input.latitude !== null && input.longitude !== null) {
    return `https://maps.google.com/?q=${input.latitude},${input.longitude}`;
  }
  return input.exactAddressPublicLabel
    ? `https://maps.google.com/?q=${encodeURIComponent(input.exactAddressPublicLabel)}`
    : null;
};

type InternalStop = PublicTruckScheduleStop & {
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  updatedAt: Date | null;
  lastConfirmedAt: Date | null;
};

const compactStop = (stop: InternalStop | null): PublicTruckScheduleStop | null =>
  stop
    ? {
        stopId: stop.stopId,
        date: stop.date,
        startTime: stop.startTime,
        endTime: stop.endTime,
        timeWindowLabel: stop.timeWindowLabel,
        locationName: stop.locationName,
        addressPublicLabel: stop.addressPublicLabel,
        city: stop.city,
        state: stop.state,
        latitude: stop.latitude,
        longitude: stop.longitude,
        hostProfilePath: stop.hostProfilePath,
        directionsUrl: stop.directionsUrl,
        notice: stop.notice,
        status: stop.status,
      }
    : null;

export function assembleTruckOperatingPlan(input: {
  rows: TruckOperatingPlanRow[];
  now?: Date;
}): PublicTruckScheduleSummary {
  const now = input.now || new Date();
  const gate = getPublicSlotGateConfigFromEnv();
  const stops = input.rows
    .map((row): InternalStop | null => {
      const sourceStatus = normalizeSourceStatus(row.sourceStatus);
      const bookingStatus = normalizeSourceStatus(row.bookingStatus);
      if (row.sourceKind === "booking" && bookingStatus !== "confirmed") {
        return null;
      }
      if (row.sourceKind === "manual" && row.isPublic !== true) return null;
      if (row.sourceKind === "manual" && row.liveFeedEligible === false) {
        return null;
      }
      if (HIDDEN_STATUSES.has(sourceStatus) || HIDDEN_STATUSES.has(bookingStatus)) {
        return null;
      }
      const expiresAt = toDate(row.expiresAt);
      if (expiresAt && expiresAt <= now) return null;

      const date = toDateKey(row.date);
      if (!date) return null;
      const timezone = resolveTimeZone(row);
      if (!timezone) return null;
      const startTime = cleanTime(row.startTime);
      const endTime = cleanTime(row.endTime);
      const lastConfirmedAt = toDate(row.lastConfirmedAt);
      let startsAt: Date;
      let endsAt: Date;

      if (sourceStatus === "closed") {
        const localDay = DateTime.fromISO(date, { zone: timezone });
        if (!localDay.isValid || !lastConfirmedAt) return null;
        startsAt = localDay.startOf("day").toUTC().toJSDate();
        endsAt = localDay.endOf("day").toUTC().toJSDate();
        const ttlFloor = DateTime.fromJSDate(now)
          .minus({ hours: gate.ttlHours })
          .toJSDate();
        const lookaheadCeiling = DateTime.fromJSDate(now)
          .plus({ hours: gate.lookaheadHours })
          .toJSDate();
        if (
          lastConfirmedAt < ttlFloor ||
          startsAt > lookaheadCeiling ||
          endsAt < now
        ) {
          return null;
        }
      } else {
        if (
          !["open", "confirmed", "scheduled", "filled", "booked"].includes(
            sourceStatus,
          ) ||
          !startTime ||
          !endTime ||
          !lastConfirmedAt ||
          row.liveFeedEligible === false
        ) {
          return null;
        }
        const interval = buildSlotDateTimes({
          timeZone: timezone,
          date,
          startTime,
          endTime,
        });
        if (!interval) return null;
        startsAt = interval.startUtc;
        endsAt = interval.endUtc;
        const durableConfirmation =
          row.sourceKind === "booking" ||
          (row.ownerSubmittedEquivalent === true &&
            normalizeSourceStatus(row.sourceConfidence) === "confirmed" &&
            Boolean(expiresAt));
        if (
          !isSlotPublic({
            slot: {
              source:
                row.sourceKind === "booking"
                  ? "parking_pass_booking"
                  : "manual",
              status: "confirmed",
              startsAtUtc: startsAt,
              endsAtUtc: endsAt,
              lastConfirmedAtUtc: lastConfirmedAt,
            },
            now,
            lookaheadHours: gate.lookaheadHours,
            graceMinutes: gate.graceMinutes,
            ttlHours: durableConfirmation ? 24 * 365 * 100 : gate.ttlHours,
          })
        ) {
          return null;
        }
      }

      const status = classifyStopStatus({
        startsAt,
        endsAt,
        now,
        sourceStatus,
      });
      const addressVisible = row.addressVisible !== false;
      const streetAddress = addressVisible
        ? String(row.address || "").trim()
        : "";
      const city = String(row.city || "").trim();
      const state = String(row.state || "").trim();
      const exactAddressPublicLabel =
        streetAddress && city && state
          ? [streetAddress, city, state].join(", ")
          : null;
      const addressPublicLabel = [
        ...(streetAddress ? [streetAddress] : []),
        city,
        state,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join(", ") || null;
      const coordinates = addressVisible
        ? resolveCoordinatePair(row.latitude, row.longitude)
        : null;
      const latitude = coordinates?.latitude ?? null;
      const longitude = coordinates?.longitude ?? null;
      const actionable =
        (status === "scheduled" || status === "here_now") &&
        row.mapEligible !== false;

      return {
        stopId: String(row.stopId || "").trim() || null,
        date,
        startTime,
        endTime,
        timeWindowLabel:
          startTime && endTime
            ? `${startTime} - ${endTime}`
            : startTime || endTime,
        locationName: String(row.locationName || "").trim() || null,
        addressPublicLabel,
        city: String(row.city || "").trim() || null,
        state: String(row.state || "").trim() || null,
        latitude: actionable && addressVisible ? latitude : null,
        longitude: actionable && addressVisible ? longitude : null,
        hostProfilePath: actionable
          ? buildHostProfilePath(row.hostId, row.hostName)
          : null,
        directionsUrl: actionable && addressVisible
          ? buildDirectionsUrl({
              latitude,
              longitude,
              exactAddressPublicLabel,
            })
          : null,
        notice: String(row.notice || "").trim() || null,
        status,
        startsAt,
        endsAt,
        timezone,
        updatedAt: toDate(row.updatedAt),
        lastConfirmedAt,
      };
    })
    .filter((stop): stop is InternalStop => Boolean(stop))
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());

  const actionableStops = stops.filter(
    (stop) => stop.status === "scheduled" || stop.status === "here_now",
  );
  const closedStops = stops.filter((stop) => stop.status === "closed");
  const isDatedTodayInStopTimeZone = (stop: InternalStop) =>
    stop.date ===
    DateTime.fromJSDate(now, { zone: "utc" })
      .setZone(stop.timezone)
      .toFormat("yyyy-LL-dd");
  const todayClosedStops = closedStops.filter(isDatedTodayInStopTimeZone);
  const currentStop =
    actionableStops.find((stop) => stop.status === "here_now") || null;
  const todayStop =
    actionableStops.find(
      (stop) =>
        stop.status !== "completed" &&
        isDatedTodayInStopTimeZone(stop),
    ) || null;
  const nextStop =
    actionableStops.find((stop) => stop.startsAt.getTime() > now.getTime()) ||
    null;
  const primaryStop = currentStop || todayStop || nextStop;
  const upcomingStops = actionableStops
    .filter((stop) => stop !== primaryStop)
    .slice(0, 8)
    .map((stop) => compactStop(stop) as PublicTruckScheduleStop);
  const compactClosedStops = closedStops.map(
    (stop) => compactStop(stop) as PublicTruckScheduleStop,
  );
  const latestTouch = stops
    .map((stop) => stop.lastConfirmedAt || stop.updatedAt || stop.startsAt)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  const topStatus =
    currentStop?.status ||
    todayStop?.status ||
    nextStop?.status ||
    (todayClosedStops.length > 0 ? "closed" : "unknown");
  const statusLabels: Record<PublicTruckScheduleSummary["status"], string> = {
    scheduled: "Scheduled",
    here_now: "Here now",
    completed: "Completed",
    closed: "Closed",
    canceled: "Canceled",
    moved: "Moved",
    sold_out: "Sold out",
    closed_early: "Closed early",
    unknown: "No schedule posted",
  };

  return {
    status: topStatus,
    statusLabel: statusLabels[topStatus],
    lastUpdatedAt: latestTouch ? latestTouch.toISOString() : null,
    notice: stops.find((stop) => stop.notice)?.notice || null,
    currentStop: compactStop(currentStop),
    todayStop: compactStop(todayStop),
    nextStop: compactStop(nextStop),
    upcomingStops,
    closedStops: compactClosedStops,
    nextWindowLabel:
      nextStop?.timeWindowLabel || todayStop?.timeWindowLabel || null,
    upcomingCount: actionableStops.filter(
      (stop) => stop.startsAt.getTime() > now.getTime(),
    ).length,
    closedCount: compactClosedStops.length,
  };
}

export function isTruckOperatingPlanRowPublic(
  row: TruckOperatingPlanRow,
  now?: Date,
) {
  const plan = assembleTruckOperatingPlan({ rows: [row], now });
  const stopId = String(row.stopId || "").trim();
  return [
    plan.currentStop,
    plan.todayStop,
    plan.nextStop,
    ...plan.upcomingStops,
    ...plan.closedStops,
  ].some((stop) => String(stop?.stopId || "").trim() === stopId);
}

const classifyPublicEventType = (
  eventTypeRaw: unknown,
  titleRaw: unknown,
): PublicEventItem["eventType"] => {
  const direct = String(eventTypeRaw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z_]/g, "_");
  if (
    [
      "live_music",
      "trivia",
      "karaoke",
      "pop_up",
      "food_truck_night",
      "watch_party",
      "holiday",
    ].includes(direct)
  ) {
    return direct as PublicEventItem["eventType"];
  }
  const title = String(titleRaw || "").toLowerCase();
  if (title.includes("music")) return "live_music";
  if (title.includes("trivia")) return "trivia";
  if (title.includes("karaoke")) return "karaoke";
  if (title.includes("pop")) return "pop_up";
  if (title.includes("truck")) return "food_truck_night";
  if (title.includes("watch")) return "watch_party";
  if (title.includes("holiday")) return "holiday";
  return "other";
};

export type TruckOperatingProfileData = {
  truckSchedule: PublicTruckScheduleSummary;
  eventsItems: PublicEventItem[];
  upcomingEventCount: number;
};

export function assembleTruckOperatingProfileData(input: {
  rows: TruckOperatingPlanRow[];
  now?: Date;
}): TruckOperatingProfileData {
  const truckSchedule = assembleTruckOperatingPlan(input);
  const visibleStops = [
    truckSchedule.currentStop,
    truckSchedule.todayStop,
    truckSchedule.nextStop,
    ...truckSchedule.upcomingStops,
  ].filter((stop): stop is PublicTruckScheduleStop => Boolean(stop));
  const stopById = new Map(
    visibleStops
      .filter((stop) => stop.stopId)
      .map((stop) => [String(stop.stopId), stop] as const),
  );
  const seenEventIds = new Set<string>();
  const eventsItems = input.rows
    .filter((row) => row.sourceKind === "booking")
    .map((row): PublicEventItem | null => {
      const bookingId = String(row.stopId || "").trim();
      const stop = stopById.get(bookingId);
      const id = String(row.eventId || "").trim();
      const title = String(row.eventTitle || "").trim();
      if (!stop || !id || !title || seenEventIds.has(id)) return null;
      seenEventIds.add(id);
      const timezone = resolveTimeZone(row);
      const date = toDateKey(row.date);
      const startTime = cleanTime(row.startTime);
      const endTime = cleanTime(row.endTime);
      const interval =
        timezone && date && startTime && endTime
          ? buildSlotDateTimes({
              timeZone: timezone,
              date,
              startTime,
              endTime,
            })
          : null;
      const dateLabel =
        timezone && date
          ? DateTime.fromISO(date, { zone: timezone }).toLocaleString(
              DateTime.DATE_MED,
            )
          : null;
      const actionHref = stop.directionsUrl || `/event/${id}`;
      return {
        id,
        title,
        description: String(row.eventDescription || "").trim() || null,
        eventType: classifyPublicEventType(row.eventType, row.eventTitle),
        startsAt: interval?.startUtc.toISOString() || null,
        endsAt: interval?.endUtc.toISOString() || null,
        dateLabel,
        timeWindowLabel: stop.timeWindowLabel,
        locationName: stop.locationName,
        addressPublicLabel: stop.addressPublicLabel,
        imageUrl: null,
        actionLabel: stop.directionsUrl ? "Get directions" : "View event",
        actionHref,
        actionType: stop.directionsUrl ? "directions" : "internal",
      };
    })
    .filter((item): item is PublicEventItem => Boolean(item))
    .sort((left, right) => {
      const leftTime = left.startsAt ? new Date(left.startsAt).getTime() : 0;
      const rightTime = right.startsAt ? new Date(right.startsAt).getTime() : 0;
      return leftTime - rightTime;
    })
    .slice(0, 8);

  return {
    truckSchedule,
    eventsItems,
    upcomingEventCount: eventsItems.length,
  };
}

const normalizeRestaurantIds = (restaurantIds: string[]) =>
  Array.from(
    new Set(
      restaurantIds
        .map((restaurantId) => String(restaurantId || "").trim())
        .filter(Boolean),
    ),
  );

/**
 * Loads the canonical booking/manual evidence for many trucks with two queries.
 * Both single-profile and batch consumers use this loader so they cannot drift on
 * date windows, statuses, or selected evidence fields.
 */
export async function loadTruckOperatingPlanRowsByRestaurantIds(
  restaurantIds: string[],
  options?: { now?: Date; database?: any },
): Promise<Map<string, TruckOperatingPlanRow[]>> {
  const normalizedIds = normalizeRestaurantIds(restaurantIds);
  const rowsByRestaurantId = new Map<string, TruckOperatingPlanRow[]>(
    normalizedIds.map((restaurantId) => [restaurantId, []]),
  );
  if (normalizedIds.length === 0) return rowsByRestaurantId;

  const now = options?.now || new Date();
  const database = options?.database || db;
  const restaurantId = normalizedIds.length === 1 ? normalizedIds[0] : null;
  const bookingRestaurantScope = restaurantId
    ? eq(eventBookings.truckId, restaurantId)
    : inArray(eventBookings.truckId, normalizedIds);
  const manualRestaurantScope = restaurantId
    ? eq(truckManualSchedules.truckId, restaurantId)
    : inArray(truckManualSchedules.truckId, normalizedIds);
  const queryStart = DateTime.fromJSDate(now, { zone: "utc" })
    .minus({ days: 1 })
    .startOf("day")
    .toJSDate();
  const queryEnd = DateTime.fromJSDate(now, { zone: "utc" })
    .plus({ days: 15 })
    .endOf("day")
    .toJSDate();

  const bookingRows = (await database
    .select({
      restaurantId: eventBookings.truckId,
      sourceKind: sql<"booking">`'booking'`,
      stopId: eventBookings.id,
      eventId: events.id,
      eventTitle: events.name,
      eventDescription: events.description,
      eventType: events.eventType,
      eventRequiresPayment: events.requiresPayment,
      date: events.date,
      startTime: events.startTime,
      endTime: events.endTime,
      sourceStatus: events.status,
      bookingStatus: eventBookings.status,
      isPublic: sql<boolean>`true`,
      locationName: hosts.businessName,
      address: hosts.address,
      city: hosts.city,
      state: hosts.state,
      latitude: hosts.latitude,
      longitude: hosts.longitude,
      hostId: hosts.id,
      hostName: hosts.businessName,
      hostPublicProfileSettings: users.publicProfileSettings,
      timezone: eventSeries.timezone,
      updatedAt: eventBookings.updatedAt,
      lastConfirmedAt: eventBookings.bookingConfirmedAt,
      expiresAt: sql<Date | null>`null`,
      sourceType: sql<string>`'parking_pass_booking'`,
      sourceConfidence: sql<string>`'confirmed'`,
      ownerSubmittedEquivalent: sql<boolean>`true`,
      notice: sql<string | null>`null`,
      mapEligible: sql<boolean>`true`,
      liveFeedEligible: sql<boolean>`true`,
    })
    .from(eventBookings)
    .innerJoin(events, eq(eventBookings.eventId, events.id))
    .innerJoin(hosts, eq(events.hostId, hosts.id))
    .innerJoin(users, eq(hosts.userId, users.id))
    .leftJoin(eventSeries, eq(events.seriesId, eventSeries.id))
    .where(
      and(
        bookingRestaurantScope,
        eq(eventBookings.status, "confirmed"),
        eq(users.isDisabled, false),
        sql`exists (
          select 1
          from restaurants operating_truck
          inner join users operating_truck_owner
            on operating_truck_owner.id = operating_truck.owner_id
          where operating_truck.id = ${eventBookings.truckId}
            and operating_truck.is_active = true
            and operating_truck_owner.is_disabled = false
        )`,
        inArray(events.status, ["open", "booked", "filled"]),
        or(isNull(events.requiresPayment), eq(events.requiresPayment, false)),
        gte(events.date, queryStart),
        lte(events.date, queryEnd),
      ),
    ))
    .map((row: TruckOperatingPlanRow & { hostPublicProfileSettings?: unknown }) => {
      const { showAddress } = resolvePublicProfileVisibility(
        row.hostPublicProfileSettings,
      );
      return {
        ...row,
        address: showAddress ? row.address : null,
        latitude: showAddress ? row.latitude : null,
        longitude: showAddress ? row.longitude : null,
        addressVisible: showAddress,
      };
    })
    .filter(
      (row: TruckOperatingPlanRow) =>
        String(row.eventType || "").trim().toLowerCase() !== "private_event" &&
        !Boolean(row.eventRequiresPayment) &&
        isPublicDiscoveryEligibleEntity({ name: row.eventTitle, isActive: true }) &&
        isPublicDiscoveryEligibleEntity({ name: row.hostName, isActive: true }),
    );

  const manualRows = await database
    .select({
      restaurantId: truckManualSchedules.truckId,
      sourceKind: sql<"manual">`'manual'`,
      stopId: truckManualSchedules.id,
      eventId: sql<string | null>`null`,
      eventTitle: sql<string | null>`null`,
      eventDescription: sql<string | null>`null`,
      eventType: sql<string | null>`null`,
      eventRequiresPayment: sql<boolean | null>`null`,
      date: truckManualSchedules.date,
      startTime: truckManualSchedules.startTime,
      endTime: truckManualSchedules.endTime,
      sourceStatus: truckManualSchedules.status,
      bookingStatus: sql<string | null>`null`,
      isPublic: truckManualSchedules.isPublic,
      locationName: truckManualSchedules.locationName,
      address: truckManualSchedules.address,
      city: truckManualSchedules.city,
      state: truckManualSchedules.state,
      latitude: sql<number | null>`null`,
      longitude: sql<number | null>`null`,
      hostId: sql<string | null>`null`,
      hostName: sql<string | null>`null`,
      timezone: truckManualSchedules.timezone,
      updatedAt: truckManualSchedules.updatedAt,
      lastConfirmedAt: truckManualSchedules.lastConfirmedAt,
      expiresAt: truckManualSchedules.expiresAt,
      sourceType: truckManualSchedules.sourceType,
      sourceConfidence: truckManualSchedules.sourceConfidence,
      ownerSubmittedEquivalent: truckManualSchedules.ownerSubmittedEquivalent,
      notice: truckManualSchedules.notes,
      mapEligible: truckManualSchedules.mapEligible,
      liveFeedEligible: truckManualSchedules.liveFeedEligible,
    })
    .from(truckManualSchedules)
    .where(
      and(
        manualRestaurantScope,
        eq(truckManualSchedules.isPublic, true),
        sql`exists (
          select 1
          from restaurants operating_truck
          inner join users operating_truck_owner
            on operating_truck_owner.id = operating_truck.owner_id
          where operating_truck.id = ${truckManualSchedules.truckId}
            and operating_truck.is_active = true
            and operating_truck_owner.is_disabled = false
        )`,
        gte(truckManualSchedules.date, queryStart),
        lte(truckManualSchedules.date, queryEnd),
      ),
    );

  for (const row of [...bookingRows, ...manualRows] as TruckOperatingPlanRow[]) {
    const restaurantId = String(row.restaurantId || "").trim();
    const bucket = rowsByRestaurantId.get(restaurantId);
    if (bucket) bucket.push(row);
  }

  return rowsByRestaurantId;
}

export async function buildPublicTruckOperatingPlans(
  restaurantIds: string[],
  options?: { now?: Date; database?: any },
): Promise<Map<string, TruckOperatingProfileData>> {
  const normalizedIds = normalizeRestaurantIds(restaurantIds);
  const now = options?.now || new Date();
  const rowsByRestaurantId = await loadTruckOperatingPlanRowsByRestaurantIds(
    normalizedIds,
    { now, database: options?.database },
  );
  return new Map(
    normalizedIds.map((restaurantId) => [
      restaurantId,
      assembleTruckOperatingProfileData({
        rows: rowsByRestaurantId.get(restaurantId) || [],
        now,
      }),
    ]),
  );
}

export async function buildPublicTruckOperatingPlan(
  restaurantId: string,
  options?: { now?: Date; database?: any },
): Promise<TruckOperatingProfileData> {
  const normalizedId = String(restaurantId || "").trim();
  const now = options?.now || new Date();
  if (!normalizedId) {
    return assembleTruckOperatingProfileData({ rows: [], now });
  }
  const plans = await buildPublicTruckOperatingPlans([normalizedId], {
    now,
    database: options?.database,
  });
  return (
    plans.get(normalizedId) ||
    assembleTruckOperatingProfileData({ rows: [], now })
  );
}
