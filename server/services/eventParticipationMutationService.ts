import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import {
  eventBookings,
  eventInterests,
  eventParticipationMutationChildren,
  eventParticipationMutations,
  eventSeries,
  events,
  hosts,
  parkingPassArrivalVersions,
  parkingPassCancellationOperations,
  parkingPassPurchases,
  restaurants,
  users,
} from "@shared/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { emailService } from "../emailService";
import { resolveCityTimeZoneStrict } from "./cityTimeZone";
import { buildSlotDateTimes } from "./timeIntent";
import { dateKeyInZone } from "./dateKeys";
import {
  normalizePersistedIanaTimeZone,
  resolvePersistedEventServiceTimeZone,
} from "./persistedServiceTimeZoneRules";
import {
  cancelParkingPassLines,
  correctProtectedParkingPassArrival,
  serializeParkingPassCancellationOperation,
} from "./parkingPassBookingService";
import { parkingPassFinancialDigest } from "./parkingPassFinancialPolicy";
import {
  canCoordinateEvent,
  eventParticipationMutationKeys,
  isSettledPaidParticipation,
} from "./eventParticipationPolicy";

const configuredStripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const staffRoles = new Set([
  "staff",
  "admin",
  "duper_admin",
  "super_admin",
]);

const clean = (value: unknown) => String(value || "").trim();
const stableIds = (values: unknown[]) =>
  Array.from(new Set(values.map(clean).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
const stableDigest = parkingPassFinancialDigest;

export class EventParticipationMutationError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EventParticipationMutationError";
  }
}

type MutationActor = { userId: string };

type MutationRecoveryContext =
  | {
      mode: "system";
      workerId: string;
      reason: string;
    }
  | {
      mode: "takeover";
      actorUserId: string;
      reason: string;
    };

export type EventUpdates = Partial<{
  name: string;
  description: string;
  date: Date;
  startTime: string;
  endTime: string;
  maxTrucks: number;
  hardCapEnabled: boolean;
  hostPriceCents: number;
  breakfastPriceCents: number;
  lunchPriceCents: number;
  dinnerPriceCents: number;
  dailyPriceCents: number;
  weeklyPriceCents: number;
  monthlyPriceCents: number;
  status: "open" | "closed" | "cancelled";
}>;

export type SeriesUpdates = Partial<{
  name: string;
  description: string | null;
  timezone: string;
  recurrenceRule: string | null;
  startDate: Date;
  endDate: Date | null;
  defaultStartTime: string;
  defaultEndTime: string;
  defaultMaxTrucks: number;
  defaultHardCapEnabled: boolean;
  parkingPassDaysOfWeek: number[];
  defaultBreakfastPriceCents: number;
  defaultLunchPriceCents: number;
  defaultDinnerPriceCents: number;
  defaultDailyPriceCents: number;
  defaultWeeklyPriceCents: number;
  defaultMonthlyPriceCents: number;
  defaultHostPriceCents: number;
  publishedAt: Date | null;
  status: "draft" | "published" | "closed";
}>;

export type HostParkingPassDefaults = Partial<{
  spotCount: number;
  parkingPassBreakfastPriceCents: number;
  parkingPassLunchPriceCents: number;
  parkingPassDinnerPriceCents: number;
  parkingPassDailyPriceCents: number;
  parkingPassWeeklyPriceCents: number;
  parkingPassMonthlyPriceCents: number;
  parkingPassStartTime: string | null;
  parkingPassEndTime: string | null;
  parkingPassDaysOfWeek: number[];
}>;

export type EventMutationNotice = {
  mutationId: string;
  childId: string;
  targetUserId: string;
  eventId: string;
  mutationKind: "correction" | "cancellation";
  eventName: string;
  idempotencyKey: string;
};

export type EventMutationNotifier = (
  notice: EventMutationNotice,
) => Promise<{
  sent: boolean;
  providerStatus?: string;
  providerMessageId?: string;
  retrySafe?: boolean;
  deliveryState?: "provider_confirmed" | "not_required";
}>;

type MutationScopeInput =
  | {
      scopeKind: "event";
      scopeId: string;
      updates: EventUpdates;
    }
  | {
      scopeKind: "series";
      scopeId: string;
      updates: SeriesUpdates;
      companionHostDefaults?: HostParkingPassDefaults;
    };

type PreparedChild = {
  id: string;
  eventId: string | null;
  bookingId: string | null;
  purchaseId: string | null;
  childKind:
    | "series_apply"
    | "event_apply"
    | "booking_cancel"
    | "arrival_correct"
    | "notification"
    | "free_participation_cancel"
    | "legacy_paid_action_required";
  actionKey: string;
  targetParticipationVersion: number;
  targetFacts: Record<string, unknown>;
  remedy: string | null;
  providerRequired: boolean;
  notificationTargetUserId: string | null;
  notificationPayload: Record<string, unknown>;
};

function requireRequestId(requestId: string) {
  if (requestId.length < 8) {
    throw new EventParticipationMutationError(
      400,
      "event_mutation_idempotency_required",
      "A stable Idempotency-Key is required for event or series changes.",
    );
  }
}

function normalizedRequestedChanges(
  scopeKind: "event" | "series",
  updates: EventUpdates | SeriesUpdates,
  companionHostDefaults?: HostParkingPassDefaults,
) {
  const entries: Array<[string, unknown]> = Object.entries(updates)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ] as [string, unknown]);
  const hostDefaultEntries = Object.entries(companionHostDefaults || {})
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    scopeKind,
    updates: Object.fromEntries(
      entries.sort(([left], [right]) => left.localeCompare(right)),
    ),
    ...(hostDefaultEntries.length
      ? { companionHostDefaults: Object.fromEntries(hostDefaultEntries) }
      : {}),
  };
}

function hostParkingPassDefaultsFromStored(
  requestedChanges: unknown,
): HostParkingPassDefaults | null {
  const stored =
    requestedChanges && typeof requestedChanges === "object"
      ? (requestedChanges as Record<string, any>)
      : {};
  const values =
    stored.companionHostDefaults &&
    typeof stored.companionHostDefaults === "object"
      ? (stored.companionHostDefaults as Record<string, any>)
      : null;
  if (!values) return null;
  const cents = (value: unknown) => Math.max(0, Math.round(Number(value) || 0));
  const days = Array.isArray(values.parkingPassDaysOfWeek)
    ? Array.from(
        new Set(
          values.parkingPassDaysOfWeek
            .map(Number)
            .filter(
              (day: number) => Number.isInteger(day) && day >= 0 && day <= 6,
            ),
        ),
      ).sort((left, right) => left - right)
    : [];
  return {
    ...(values.spotCount !== undefined
      ? { spotCount: Math.max(1, Math.round(Number(values.spotCount) || 1)) }
      : {}),
    ...(values.parkingPassBreakfastPriceCents !== undefined
      ? {
          parkingPassBreakfastPriceCents: cents(
            values.parkingPassBreakfastPriceCents,
          ),
        }
      : {}),
    ...(values.parkingPassLunchPriceCents !== undefined
      ? { parkingPassLunchPriceCents: cents(values.parkingPassLunchPriceCents) }
      : {}),
    ...(values.parkingPassDinnerPriceCents !== undefined
      ? {
          parkingPassDinnerPriceCents: cents(
            values.parkingPassDinnerPriceCents,
          ),
        }
      : {}),
    ...(values.parkingPassDailyPriceCents !== undefined
      ? { parkingPassDailyPriceCents: cents(values.parkingPassDailyPriceCents) }
      : {}),
    ...(values.parkingPassWeeklyPriceCents !== undefined
      ? {
          parkingPassWeeklyPriceCents: cents(values.parkingPassWeeklyPriceCents),
        }
      : {}),
    ...(values.parkingPassMonthlyPriceCents !== undefined
      ? {
          parkingPassMonthlyPriceCents: cents(
            values.parkingPassMonthlyPriceCents,
          ),
        }
      : {}),
    ...(values.parkingPassStartTime !== undefined
      ? {
          parkingPassStartTime:
            values.parkingPassStartTime === null
              ? null
              : clean(values.parkingPassStartTime),
        }
      : {}),
    ...(values.parkingPassEndTime !== undefined
      ? {
          parkingPassEndTime:
            values.parkingPassEndTime === null
              ? null
              : clean(values.parkingPassEndTime),
        }
      : {}),
    ...(values.parkingPassDaysOfWeek !== undefined
      ? { parkingPassDaysOfWeek: days }
      : {}),
  };
}

function eventChangesFromStored(
  scopeKind: "event" | "series",
  requestedChanges: unknown,
): EventUpdates {
  const stored =
    requestedChanges && typeof requestedChanges === "object"
      ? (requestedChanges as Record<string, any>)
      : {};
  const updates =
    stored.updates && typeof stored.updates === "object"
      ? (stored.updates as Record<string, any>)
      : {};
  if (scopeKind === "event") {
    return {
      ...(updates.name !== undefined ? { name: clean(updates.name) } : {}),
      ...(updates.description !== undefined
        ? { description: clean(updates.description) }
        : {}),
      ...(updates.date !== undefined
        ? { date: new Date(String(updates.date)) }
        : {}),
      ...(updates.startTime !== undefined
        ? { startTime: clean(updates.startTime) }
        : {}),
      ...(updates.endTime !== undefined
        ? { endTime: clean(updates.endTime) }
        : {}),
      ...(updates.maxTrucks !== undefined
        ? { maxTrucks: Number(updates.maxTrucks) }
        : {}),
      ...(updates.hardCapEnabled !== undefined
        ? { hardCapEnabled: updates.hardCapEnabled === true }
        : {}),
      ...(updates.hostPriceCents !== undefined
        ? { hostPriceCents: Number(updates.hostPriceCents) }
        : {}),
      ...(updates.breakfastPriceCents !== undefined
        ? { breakfastPriceCents: Number(updates.breakfastPriceCents) }
        : {}),
      ...(updates.lunchPriceCents !== undefined
        ? { lunchPriceCents: Number(updates.lunchPriceCents) }
        : {}),
      ...(updates.dinnerPriceCents !== undefined
        ? { dinnerPriceCents: Number(updates.dinnerPriceCents) }
        : {}),
      ...(updates.dailyPriceCents !== undefined
        ? { dailyPriceCents: Number(updates.dailyPriceCents) }
        : {}),
      ...(updates.weeklyPriceCents !== undefined
        ? { weeklyPriceCents: Number(updates.weeklyPriceCents) }
        : {}),
      ...(updates.monthlyPriceCents !== undefined
        ? { monthlyPriceCents: Number(updates.monthlyPriceCents) }
        : {}),
      ...(updates.status !== undefined
        ? { status: clean(updates.status) as EventUpdates["status"] }
        : {}),
    };
  }
  return {
    ...(updates.defaultStartTime !== undefined
      ? { startTime: clean(updates.defaultStartTime) }
      : {}),
    ...(updates.defaultEndTime !== undefined
      ? { endTime: clean(updates.defaultEndTime) }
      : {}),
    ...(updates.defaultMaxTrucks !== undefined
      ? { maxTrucks: Number(updates.defaultMaxTrucks) }
      : {}),
    ...(updates.defaultHardCapEnabled !== undefined
      ? { hardCapEnabled: updates.defaultHardCapEnabled === true }
      : {}),
    ...(updates.defaultHostPriceCents !== undefined
      ? { hostPriceCents: Number(updates.defaultHostPriceCents) }
      : {}),
    ...(updates.defaultBreakfastPriceCents !== undefined
      ? { breakfastPriceCents: Number(updates.defaultBreakfastPriceCents) }
      : {}),
    ...(updates.defaultLunchPriceCents !== undefined
      ? { lunchPriceCents: Number(updates.defaultLunchPriceCents) }
      : {}),
    ...(updates.defaultDinnerPriceCents !== undefined
      ? { dinnerPriceCents: Number(updates.defaultDinnerPriceCents) }
      : {}),
    ...(updates.defaultDailyPriceCents !== undefined
      ? { dailyPriceCents: Number(updates.defaultDailyPriceCents) }
      : {}),
    ...(updates.defaultWeeklyPriceCents !== undefined
      ? { weeklyPriceCents: Number(updates.defaultWeeklyPriceCents) }
      : {}),
    ...(updates.defaultMonthlyPriceCents !== undefined
      ? { monthlyPriceCents: Number(updates.defaultMonthlyPriceCents) }
      : {}),
    ...(updates.status === "closed"
      ? { status: "cancelled" as const }
      : {}),
  };
}

function seriesChangesFromStored(requestedChanges: unknown): SeriesUpdates {
  const stored =
    requestedChanges && typeof requestedChanges === "object"
      ? (requestedChanges as Record<string, any>)
      : {};
  const updates =
    stored.updates && typeof stored.updates === "object"
      ? (stored.updates as Record<string, any>)
      : {};
  return {
    ...(updates.name !== undefined ? { name: clean(updates.name) } : {}),
    ...(updates.description !== undefined
      ? { description: updates.description === null ? null : clean(updates.description) }
      : {}),
    ...(updates.timezone !== undefined
      ? { timezone: clean(updates.timezone) }
      : {}),
    ...(updates.recurrenceRule !== undefined
      ? {
          recurrenceRule:
            updates.recurrenceRule === null
              ? null
              : clean(updates.recurrenceRule),
        }
      : {}),
    ...(updates.startDate !== undefined
      ? { startDate: new Date(String(updates.startDate)) }
      : {}),
    ...(updates.endDate !== undefined
      ? {
          endDate:
            updates.endDate === null ? null : new Date(String(updates.endDate)),
        }
      : {}),
    ...(updates.defaultStartTime !== undefined
      ? { defaultStartTime: clean(updates.defaultStartTime) }
      : {}),
    ...(updates.defaultEndTime !== undefined
      ? { defaultEndTime: clean(updates.defaultEndTime) }
      : {}),
    ...(updates.defaultMaxTrucks !== undefined
      ? { defaultMaxTrucks: Number(updates.defaultMaxTrucks) }
      : {}),
    ...(updates.defaultHardCapEnabled !== undefined
      ? { defaultHardCapEnabled: updates.defaultHardCapEnabled === true }
      : {}),
    ...(updates.parkingPassDaysOfWeek !== undefined
      ? {
          parkingPassDaysOfWeek: Array.isArray(updates.parkingPassDaysOfWeek)
            ? updates.parkingPassDaysOfWeek.map(Number)
            : [],
        }
      : {}),
    ...(updates.defaultBreakfastPriceCents !== undefined
      ? {
          defaultBreakfastPriceCents: Number(
            updates.defaultBreakfastPriceCents,
          ),
        }
      : {}),
    ...(updates.defaultLunchPriceCents !== undefined
      ? { defaultLunchPriceCents: Number(updates.defaultLunchPriceCents) }
      : {}),
    ...(updates.defaultDinnerPriceCents !== undefined
      ? { defaultDinnerPriceCents: Number(updates.defaultDinnerPriceCents) }
      : {}),
    ...(updates.defaultDailyPriceCents !== undefined
      ? { defaultDailyPriceCents: Number(updates.defaultDailyPriceCents) }
      : {}),
    ...(updates.defaultWeeklyPriceCents !== undefined
      ? { defaultWeeklyPriceCents: Number(updates.defaultWeeklyPriceCents) }
      : {}),
    ...(updates.defaultMonthlyPriceCents !== undefined
      ? { defaultMonthlyPriceCents: Number(updates.defaultMonthlyPriceCents) }
      : {}),
    ...(updates.defaultHostPriceCents !== undefined
      ? { defaultHostPriceCents: Number(updates.defaultHostPriceCents) }
      : {}),
    ...(updates.publishedAt !== undefined
      ? {
          publishedAt:
            updates.publishedAt === null
              ? null
              : new Date(String(updates.publishedAt)),
        }
      : {}),
    ...(updates.status !== undefined
      ? { status: clean(updates.status) as SeriesUpdates["status"] }
      : {}),
  };
}

async function currentActor(tx: any, userId: string) {
  const [actor] = await tx
    .select({ userType: users.userType, isDisabled: users.isDisabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .for("update");
  if (!actor || actor.isDisabled !== false) {
    throw new EventParticipationMutationError(
      403,
      "event_authority_revoked",
      "Current event-management authority is required.",
    );
  }
  return actor;
}

async function lockEventAuthority(tx: any, eventId: string, actorId: string) {
  const [row] = await tx
    .select({ event: events, host: hosts })
    .from(events)
    .innerJoin(hosts, eq(hosts.id, events.hostId))
    .where(eq(events.id, eventId))
    .limit(1)
    .for("update");
  if (!row) {
    throw new EventParticipationMutationError(
      404,
      "event_not_found",
      "Event not found.",
    );
  }
  const actor = await currentActor(tx, actorId);
  const [series] = row.event.seriesId
    ? await tx
        .select({
          id: eventSeries.id,
          coordinatorUserId: eventSeries.coordinatorUserId,
          seriesType: eventSeries.seriesType,
          activeParticipationMutationId:
            eventSeries.activeParticipationMutationId,
        })
        .from(eventSeries)
        .where(eq(eventSeries.id, row.event.seriesId))
        .limit(1)
        .for("update")
    : [];
  const staff = staffRoles.has(clean(actor.userType));
  const hostOwner = clean(row.host.userId) === actorId;
  const coordinator = canCoordinateEvent({
    actorUserId: actorId,
    eventType: row.event.eventType,
    eventCoordinatorUserId: row.event.coordinatorUserId,
    seriesCoordinatorUserId: series?.coordinatorUserId,
  });
  if (!staff && !hostOwner && !coordinator) {
    throw new EventParticipationMutationError(
      403,
      "event_authority_forbidden",
      "Only the current host owner, explicit non-Parking-Pass coordinator, or staff may change this event.",
    );
  }
  return {
    ...row,
    series: series || null,
    actorUserType: clean(actor.userType),
    role: staff ? "staff" : hostOwner ? "host_owner" : "coordinator",
    staff,
    hostOwner,
    coordinator,
  };
}

async function lockSeriesAuthority(tx: any, seriesId: string, actorId: string) {
  const [row] = await tx
    .select({ series: eventSeries, host: hosts })
    .from(eventSeries)
    .innerJoin(hosts, eq(hosts.id, eventSeries.hostId))
    .where(eq(eventSeries.id, seriesId))
    .limit(1)
    .for("update");
  if (!row) {
    throw new EventParticipationMutationError(
      404,
      "event_series_not_found",
      "Event series not found.",
    );
  }
  const actor = await currentActor(tx, actorId);
  const staff = staffRoles.has(clean(actor.userType));
  const hostOwner = clean(row.host.userId) === actorId;
  const coordinator = canCoordinateEvent({
    actorUserId: actorId,
    eventType: row.series.seriesType,
    seriesCoordinatorUserId: row.series.coordinatorUserId,
  });
  if (!staff && !hostOwner && !coordinator) {
    throw new EventParticipationMutationError(
      403,
      "event_series_authority_forbidden",
      "Only the current host owner, explicit non-Parking-Pass series coordinator, or staff may change this series.",
    );
  }
  return {
    ...row,
    actorUserType: clean(actor.userType),
    role: staff ? "staff" : hostOwner ? "host_owner" : "coordinator",
    staff,
    hostOwner,
    coordinator,
  };
}

function authoritySnapshot(authority: any, actorId: string) {
  return {
    actorUserId: actorId,
    actorUserType: authority.actorUserType,
    role: authority.role,
    hostId: authority.host.id,
    hostOwnerUserId: authority.host.userId,
    eventCoordinatorUserId: authority.event?.coordinatorUserId || null,
    seriesCoordinatorUserId:
      authority.series?.coordinatorUserId ||
      authority.event?.series?.coordinatorUserId ||
      null,
  };
}

async function lockMutationTargets(
  tx: any,
  targetEventIds: string[],
  targetBookingIds: string[],
) {
  if (targetEventIds.length) {
    await tx
      .select({ id: events.id })
      .from(events)
      .where(inArray(events.id, targetEventIds))
      .orderBy(asc(events.id))
      .for("update");
  }
  if (targetBookingIds.length) {
    await tx
      .select({ id: eventBookings.id })
      .from(eventBookings)
      .where(inArray(eventBookings.id, targetBookingIds))
      .orderBy(asc(eventBookings.id))
      .for("update");
  }
}

async function assertFrozenMutationScopeLocked(
  tx: any,
  parent: typeof eventParticipationMutations.$inferSelect,
) {
  const targetEventIds = stableIds(parent.targetEventIds as unknown[]);
  const targetBookingIds = stableIds(parent.targetBookingIds as unknown[]);
  const lockedEvents = targetEventIds.length
    ? await tx
        .select({
          id: events.id,
          activeMutationId: events.activeParticipationMutationId,
        })
        .from(events)
        .where(inArray(events.id, targetEventIds))
        .orderBy(asc(events.id))
        .for("update")
    : [];
  const lockedBookings = targetBookingIds.length
    ? await tx
        .select({
          id: eventBookings.id,
          eventId: eventBookings.eventId,
          activeMutationId: eventBookings.activeEventMutationId,
        })
        .from(eventBookings)
        .where(inArray(eventBookings.id, targetBookingIds))
        .orderBy(asc(eventBookings.id))
        .for("update")
    : [];
  if (
    lockedEvents.length !== targetEventIds.length ||
    lockedEvents.some((row: any) => clean(row.activeMutationId) !== parent.id) ||
    lockedBookings.length !== targetBookingIds.length ||
    lockedBookings.some(
      (row: any) =>
        clean(row.activeMutationId) !== parent.id ||
        !targetEventIds.includes(clean(row.eventId)),
    )
  ) {
    throw new EventParticipationMutationError(
      409,
      "event_mutation_frozen_scope_changed",
      "The immutable event participation target set no longer owns every active barrier.",
    );
  }
  if (parent.scopeKind === "series") {
    const [series] = await tx
      .select({ activeMutationId: eventSeries.activeParticipationMutationId })
      .from(eventSeries)
      .where(eq(eventSeries.id, clean(parent.seriesId)))
      .limit(1)
      .for("update");
    if (!series || clean(series.activeMutationId) !== parent.id) {
      throw new EventParticipationMutationError(
        409,
        "event_series_mutation_barrier_changed",
        "The immutable series participation barrier changed before recovery.",
      );
    }
  }
  const [childCount] = await tx
    .select({ count: sql<number>`count(*)` })
    .from(eventParticipationMutationChildren)
    .where(eq(eventParticipationMutationChildren.mutationId, parent.id));
  if (Number(childCount?.count || 0) !== Number(parent.expectedChildCount)) {
    throw new EventParticipationMutationError(
      409,
      "event_mutation_child_set_changed",
      "The immutable event participation child set no longer matches its parent.",
    );
  }
}

async function authorizeMutationDriveLocked(
  tx: any,
  parent: typeof eventParticipationMutations.$inferSelect,
  recovery?: MutationRecoveryContext,
) {
  if (!recovery) {
    if (parent.scopeKind === "event") {
      await lockEventAuthority(tx, clean(parent.eventId), parent.actorUserId);
    } else {
      await lockSeriesAuthority(tx, clean(parent.seriesId), parent.actorUserId);
    }
    return;
  }
  if (recovery.mode === "takeover") {
    const actorUserId = clean(recovery.actorUserId);
    if (parent.scopeKind === "event") {
      await lockEventAuthority(tx, clean(parent.eventId), actorUserId);
    } else {
      await lockSeriesAuthority(tx, clean(parent.seriesId), actorUserId);
    }
  }
  await tx
    .update(eventParticipationMutations)
    .set({
      lastRecoveryActorUserId:
        recovery.mode === "takeover" ? clean(recovery.actorUserId) : null,
      lastRecoveryActorType:
        recovery.mode === "takeover" ? "current_authority_takeover" : "system",
      lastRecoveryReason: clean(recovery.reason),
      updatedAt: new Date(),
    })
    .where(eq(eventParticipationMutations.id, parent.id));
}

function assertScheduleAndCapacity(input: {
  event: typeof events.$inferSelect;
  timeZone: string;
  updates: EventUpdates;
  activeBookingCount: number;
  cancelling: boolean;
  now: Date;
}) {
  if (
    !input.cancelling &&
    input.updates.maxTrucks !== undefined &&
    input.updates.maxTrucks < input.activeBookingCount
  ) {
    throw new EventParticipationMutationError(
      409,
      "event_capacity_below_reserved",
      "Capacity cannot be reduced below current pending and confirmed participation.",
    );
  }
  const scheduleChanged =
    (input.updates.date !== undefined &&
      new Date(input.updates.date).getTime() !==
        new Date(input.event.date).getTime()) ||
    (input.updates.startTime !== undefined &&
      clean(input.updates.startTime) !== clean(input.event.startTime)) ||
    (input.updates.endTime !== undefined &&
      clean(input.updates.endTime) !== clean(input.event.endTime));
  if (!scheduleChanged || input.cancelling) return;
  const interval = buildSlotDateTimes({
    timeZone: input.timeZone,
    date: input.updates.date || input.event.date,
    startTime: input.updates.startTime || input.event.startTime,
    endTime: input.updates.endTime || input.event.endTime,
  });
  if (!interval || interval.startUtc.getTime() <= input.now.getTime()) {
    throw new EventParticipationMutationError(
      409,
      "event_schedule_not_future",
      "The corrected participation window must remain in the future.",
    );
  }
}

async function prepareMutation(input: {
  scope: MutationScopeInput;
  actor: MutationActor;
  requestId: string;
}) {
  const actorId = clean(input.actor.userId);
  const requestId = clean(input.requestId);
  const scopeId = clean(input.scope.scopeId);
  requireRequestId(requestId);
  if (!actorId || !scopeId) {
    throw new EventParticipationMutationError(
      400,
      "event_mutation_identity_required",
      "Event/series and actor identity are required.",
    );
  }
  const explicitSeriesTimeZone =
    input.scope.scopeKind === "series" &&
    (input.scope.updates as SeriesUpdates).timezone !== undefined
      ? normalizePersistedIanaTimeZone(
          (input.scope.updates as SeriesUpdates).timezone,
        )
      : null;
  if (
    input.scope.scopeKind === "series" &&
    (input.scope.updates as SeriesUpdates).timezone !== undefined &&
    !explicitSeriesTimeZone
  ) {
    throw new EventParticipationMutationError(
      400,
      "event_series_timezone_invalid",
      "An explicit series timezone change requires a valid IANA timezone.",
    );
  }
  const requestedChanges = normalizedRequestedChanges(
    input.scope.scopeKind,
    input.scope.updates,
    input.scope.scopeKind === "series"
      ? input.scope.companionHostDefaults
      : undefined,
  );
  const mutationKind =
    (input.scope.scopeKind === "event" &&
      (input.scope.updates as EventUpdates).status === "cancelled") ||
    (input.scope.scopeKind === "series" &&
      (input.scope.updates as SeriesUpdates).status === "closed")
      ? "cancellation"
      : "correction";
  const requestDigest = stableDigest({
    version: "event-participation-mutation-v2",
    scopeKind: input.scope.scopeKind,
    scopeId,
    mutationKind,
    actorUserId: actorId,
    requestId,
    requestedChanges,
  });

  return db.transaction(async (tx: any) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`event_participation_mutation:${input.scope.scopeKind}:${scopeId}`}))`,
    );
    const authority =
      input.scope.scopeKind === "event"
        ? await lockEventAuthority(tx, scopeId, actorId)
        : await lockSeriesAuthority(tx, scopeId, actorId);
    const storedScopeSeriesTimeZone =
      input.scope.scopeKind === "series"
        ? normalizePersistedIanaTimeZone((authority as any).series.timezone)
        : null;
    if (input.scope.scopeKind === "series" && !storedScopeSeriesTimeZone) {
      throw new EventParticipationMutationError(
        409,
        "event_series_timezone_unavailable",
        "The current series requires a valid stored timezone before it can be changed or recovered.",
      );
    }
    const [existing] = await tx
      .select()
      .from(eventParticipationMutations)
      .where(
        and(
          eq(eventParticipationMutations.scopeKind, input.scope.scopeKind),
          input.scope.scopeKind === "event"
            ? eq(eventParticipationMutations.eventId, scopeId)
            : eq(eventParticipationMutations.seriesId, scopeId),
          eq(eventParticipationMutations.requestId, requestId),
        ),
      )
      .limit(1)
      .for("update");
    if (existing) {
      if (
        existing.requestDigest !== requestDigest ||
        clean(existing.actorUserId) !== actorId ||
        existing.mutationKind !== mutationKind
      ) {
        throw new EventParticipationMutationError(
          409,
          "event_mutation_idempotency_mismatch",
          "That request ID is bound to different actor, scope, or change facts.",
        );
      }
      await lockMutationTargets(
        tx,
        stableIds(existing.targetEventIds as unknown[]),
        stableIds(existing.targetBookingIds as unknown[]),
      );
      return { mutationId: existing.id, replay: true };
    }

    const activeMutationId =
      input.scope.scopeKind === "event"
        ? clean((authority as any).event.activeParticipationMutationId)
        : clean((authority as any).series.activeParticipationMutationId);
    if (activeMutationId) {
      throw new EventParticipationMutationError(
        409,
        "event_mutation_in_progress",
        "This event or series already has a frozen participation mutation in progress.",
        { mutationId: activeMutationId },
      );
    }

    const now = new Date();
    const today =
      input.scope.scopeKind === "series"
        ? new Date(
            `${dateKeyInZone(now, storedScopeSeriesTimeZone!)}T00:00:00.000Z`,
          )
        : new Date(now);
    const targetEvents =
      input.scope.scopeKind === "event"
        ? [(authority as any).event]
        : await tx
            .select()
            .from(events)
            .where(
              and(
                eq(events.seriesId, scopeId),
                sql`${events.date} >= ${today}`,
              ),
            )
            .orderBy(asc(events.date), asc(events.id))
            .for("update");
    const targetEventIds = stableIds(targetEvents.map((event: any) => event.id));
    const conflictingEvent = targetEvents.find((event: any) =>
      clean(event.activeParticipationMutationId),
    );
    if (conflictingEvent) {
      throw new EventParticipationMutationError(
        409,
        "event_mutation_in_progress",
        "A target occurrence already has a frozen participation mutation in progress.",
        { eventId: conflictingEvent.id },
      );
    }
    const targetBookings = targetEventIds.length
      ? await tx
          .select()
          .from(eventBookings)
          .where(
            and(
              inArray(eventBookings.eventId, targetEventIds),
              inArray(eventBookings.status, ["pending", "confirmed"]),
            ),
          )
          .orderBy(asc(eventBookings.eventId), asc(eventBookings.id))
          .for("update")
      : [];
    const targetBookingIds = stableIds(
      targetBookings.map((booking: any) => booking.id),
    );
    const conflictingBooking = targetBookings.find((booking: any) =>
      clean(booking.activeEventMutationId),
    );
    if (conflictingBooking) {
      throw new EventParticipationMutationError(
        409,
        "event_mutation_in_progress",
        "A target participation line already has a frozen mutation in progress.",
        { bookingId: conflictingBooking.id },
      );
    }
    const purchaseIds = stableIds(
      targetBookings.map((booking: any) => booking.purchaseId),
    );
    const purchases = purchaseIds.length
      ? await tx
          .select()
          .from(parkingPassPurchases)
          .where(inArray(parkingPassPurchases.id, purchaseIds))
          .orderBy(asc(parkingPassPurchases.id))
          .for("update")
      : [];
    const arrivalIds = stableIds(
      targetBookings.map((booking: any) => booking.currentArrivalVersionId),
    );
    const arrivals = arrivalIds.length
      ? await tx
          .select()
          .from(parkingPassArrivalVersions)
          .where(inArray(parkingPassArrivalVersions.id, arrivalIds))
          .orderBy(asc(parkingPassArrivalVersions.id))
          .for("update")
      : [];
    const truckIds = stableIds(
      targetBookings.map((booking: any) => booking.truckId),
    );
    const trucks = truckIds.length
      ? await tx
          .select({ id: restaurants.id, ownerId: restaurants.ownerId })
          .from(restaurants)
          .where(inArray(restaurants.id, truckIds))
          .orderBy(asc(restaurants.id))
          .for("update")
      : [];
    const purchaseById = new Map(purchases.map((row: any) => [row.id, row]));
    const arrivalById = new Map(arrivals.map((row: any) => [row.id, row]));
    const truckOwnerById = new Map(
      trucks.map((row: any) => [row.id, clean(row.ownerId)]),
    );
    const eventById = new Map(targetEvents.map((row: any) => [row.id, row]));
    const host = (authority as any).host as typeof hosts.$inferSelect;
    const eventUpdates = eventChangesFromStored(
      input.scope.scopeKind,
      requestedChanges,
    );
    const cancelling = mutationKind === "cancellation";
    const targetSeriesIds = stableIds(
      targetEvents.map((event: any) => event.seriesId),
    );
    const targetSeries = targetSeriesIds.length
      ? await tx
          .select({ id: eventSeries.id, timezone: eventSeries.timezone })
          .from(eventSeries)
          .where(inArray(eventSeries.id, targetSeriesIds))
          .orderBy(asc(eventSeries.id))
          .for("update")
      : [];
    const seriesTimeZoneById = new Map(
      targetSeries.map((series: any) => [series.id, series.timezone]),
    );
    const persistedVenueTimeZone = targetEvents.some(
      (event: any) => !clean(event.seriesId),
    )
      ? await resolveCityTimeZoneStrict(
          { city: host.city, state: host.state },
          tx,
        )
      : null;
    const frozenTimeZoneByEventId = new Map<
      string,
      {
        serviceTimeZone: string;
        priorServiceTimeZone: string;
        source: "stored_series" | "explicit_series_update" | "persisted_venue";
      }
    >();
    for (const event of targetEvents) {
      const eventSeriesId = clean(event.seriesId);
      const priorServiceTimeZone = resolvePersistedEventServiceTimeZone({
        seriesId: eventSeriesId,
        seriesTimeZone: seriesTimeZoneById.get(eventSeriesId),
        venueTimeZone: persistedVenueTimeZone,
      });
      const serviceTimeZone =
        input.scope.scopeKind === "series" &&
        eventSeriesId === scopeId &&
        explicitSeriesTimeZone
          ? explicitSeriesTimeZone
          : priorServiceTimeZone;
      if (!priorServiceTimeZone || !serviceTimeZone) {
        throw new EventParticipationMutationError(
          409,
          "event_service_timezone_unavailable",
          "Every frozen event target requires a valid stored series timezone or one strict persisted venue timezone.",
          { eventId: event.id, seriesId: eventSeriesId || null },
        );
      }
      frozenTimeZoneByEventId.set(event.id, {
        serviceTimeZone,
        priorServiceTimeZone,
        source:
          explicitSeriesTimeZone && eventSeriesId === scopeId
            ? "explicit_series_update"
            : eventSeriesId
              ? "stored_series"
              : "persisted_venue",
      });
    }
    for (const event of targetEvents) {
      const frozenTimeZone = frozenTimeZoneByEventId.get(event.id)!;
      assertScheduleAndCapacity({
        event,
        timeZone: frozenTimeZone.serviceTimeZone,
        updates: eventUpdates,
        activeBookingCount: targetBookings.filter(
          (booking: any) => booking.eventId === event.id,
        ).length,
        cancelling,
        now,
      });
    }

    const mutationId = randomUUID();
    const children: PreparedChild[] = [];
    if (input.scope.scopeKind === "series") {
      children.push({
        id: randomUUID(),
        eventId: null,
        bookingId: null,
        purchaseId: null,
        childKind: "series_apply",
        actionKey: "series:apply",
        targetParticipationVersion: Number(
          (authority as any).series.participationVersion || 0,
        ),
        targetFacts: {
          seriesId: scopeId,
          status: (authority as any).series.status,
          priorServiceTimeZone: normalizePersistedIanaTimeZone(
            (authority as any).series.timezone,
          ),
          serviceTimeZone:
            explicitSeriesTimeZone ||
            normalizePersistedIanaTimeZone((authority as any).series.timezone),
          serviceTimeZoneSource: explicitSeriesTimeZone
            ? "explicit_series_update"
            : "stored_series",
        },
        remedy: null,
        providerRequired: false,
        notificationTargetUserId: null,
        notificationPayload: {},
      });
    }
    for (const event of targetEvents) {
      const frozenTimeZone = frozenTimeZoneByEventId.get(event.id)!;
      children.push({
        id: randomUUID(),
        eventId: event.id,
        bookingId: null,
        purchaseId: null,
        childKind: "event_apply",
        actionKey: `event:${event.id}:apply`,
        targetParticipationVersion: Number(event.participationVersion || 0),
        targetFacts: {
          eventId: event.id,
          status: event.status,
          requiresPayment: event.requiresPayment === true,
          date: event.date?.toISOString?.() || String(event.date),
          startTime: event.startTime,
          endTime: event.endTime,
          maxTrucks: event.maxTrucks,
          priorServiceTimeZone: frozenTimeZone.priorServiceTimeZone,
          serviceTimeZone: frozenTimeZone.serviceTimeZone,
          serviceTimeZoneSource: frozenTimeZone.source,
        },
        remedy: null,
        providerRequired: false,
        notificationTargetUserId: null,
        notificationPayload: {},
      });
    }
    const scheduleChanged =
      eventUpdates.date !== undefined ||
      eventUpdates.startTime !== undefined ||
      eventUpdates.endTime !== undefined;
    for (const booking of targetBookings) {
      const event = eventById.get(booking.eventId) as any;
      const purchase = purchaseById.get(clean(booking.purchaseId)) as any;
      const arrival = arrivalById.get(
        clean(booking.currentArrivalVersionId),
      ) as any;
      const paid = event?.requiresPayment === true;
      const arrivalStartAt = arrival?.startAt
        ? new Date(arrival.startAt)
        : null;
      const settled = Boolean(
        purchase &&
          isSettledPaidParticipation({
            bookingStatus: booking.status,
            purchaseStatus: purchase.status,
            settlementStatus: purchase.settlementStatus,
          }),
      );
      const targetFacts = {
        eventId: booking.eventId,
        bookingId: booking.id,
        bookingStatus: booking.status,
        eventRequiresPayment: paid,
        eventParticipationVersion: booking.eventParticipationVersion,
        purchaseId: booking.purchaseId || null,
        purchaseStatus: purchase?.status || null,
        settlementStatus: purchase?.settlementStatus || null,
        allocationDigest: booking.allocationDigest || null,
        currentArrivalVersionId: booking.currentArrivalVersionId || null,
        currentArrivalState: arrival?.state || null,
        currentArrivalStartAt: arrival?.startAt?.toISOString?.() || null,
        priorServiceTimeZone: frozenTimeZoneByEventId.get(booking.eventId)!
          .priorServiceTimeZone,
        serviceTimeZone: frozenTimeZoneByEventId.get(booking.eventId)!
          .serviceTimeZone,
        serviceTimeZoneSource: frozenTimeZoneByEventId.get(booking.eventId)!
          .source,
      };
      let actionKind: PreparedChild["childKind"] | null = null;
      let remedy: string | null = null;
      let providerRequired = false;
      if (cancelling) {
        if (!paid) {
          actionKind = "free_participation_cancel";
          remedy = "free_direct_cancel";
        } else if (!purchase) {
          actionKind = "legacy_paid_action_required";
          remedy = "ambiguous_legacy_paid";
        } else {
          actionKind = "booking_cancel";
          remedy =
            booking.status === "pending" ? "pre_capture_release" : "cash_refund";
          providerRequired = true;
        }
      } else if (scheduleChanged && paid) {
        if (!purchase) {
          actionKind = "legacy_paid_action_required";
          remedy = "ambiguous_legacy_paid";
        } else if (booking.status === "pending") {
          actionKind = "booking_cancel";
          remedy = "stale_pending_release";
          providerRequired = true;
        } else if (
          settled &&
          arrival &&
          arrival.state === "current" &&
          arrivalStartAt &&
          Number.isFinite(arrivalStartAt.getTime()) &&
          arrivalStartAt.getTime() > now.getTime()
        ) {
          actionKind = "arrival_correct";
          remedy = "protected_arrival_acknowledgement";
        } else {
          actionKind = "legacy_paid_action_required";
          remedy = "paid_participation_not_correction_ready";
        }
      }
      if (actionKind) {
        children.push({
          id: randomUUID(),
          eventId: booking.eventId,
          bookingId: booking.id,
          purchaseId: booking.purchaseId || null,
          childKind: actionKind,
          actionKey: `booking:${booking.id}:action`,
          targetParticipationVersion: Number(
            booking.eventParticipationVersion || 0,
          ),
          targetFacts,
          remedy,
          providerRequired,
          notificationTargetUserId: null,
          notificationPayload: {},
        });
      }
      const notificationTargetUserId =
        clean(purchase?.purchaserUserId) ||
        clean(truckOwnerById.get(booking.truckId));
      children.push({
        id: randomUUID(),
        eventId: booking.eventId,
        bookingId: booking.id,
        purchaseId: booking.purchaseId || null,
        childKind: "notification",
        actionKey: `booking:${booking.id}:notification`,
        targetParticipationVersion: Number(
          booking.eventParticipationVersion || 0,
        ),
        targetFacts,
        remedy: "participant_notice",
        providerRequired: false,
        notificationTargetUserId: notificationTargetUserId || null,
        notificationPayload: {
          eventName: event?.name || "MealScout event",
          mutationKind,
          protectedDetailsIncluded: false,
          serviceTimeZone: frozenTimeZoneByEventId.get(booking.eventId)!
            .serviceTimeZone,
        },
      });
    }
    const targetSetDigest = stableDigest({
      version: "event-participation-target-set-v2",
      targetEventIds,
      targetBookingIds,
      targets: children.map((child) => ({
        actionKey: child.actionKey,
        eventId: child.eventId,
        bookingId: child.bookingId,
        purchaseId: child.purchaseId,
        childKind: child.childKind,
        targetParticipationVersion: child.targetParticipationVersion,
        targetFacts: child.targetFacts,
      })),
    });
    const snapshot = authoritySnapshot(authority, actorId);
    const suppressionReason =
      mutationKind === "cancellation"
        ? "Participation is suppressed while cancellation remedies and notices converge."
        : "Participation is suppressed while corrected participation facts and notices converge.";
    await tx.insert(eventParticipationMutations).values({
      id: mutationId,
      scopeKind: input.scope.scopeKind,
      eventId: input.scope.scopeKind === "event" ? scopeId : null,
      seriesId: input.scope.scopeKind === "series" ? scopeId : null,
      mutationKind,
      requestId,
      idempotencyKey: `event-participation:${input.scope.scopeKind}:${scopeId}:${requestId}`,
      requestDigest,
      actorUserId: actorId,
      actorType: (authority as any).role,
      authoritySnapshot: snapshot,
      expectedParticipationVersion: Number(
        input.scope.scopeKind === "event"
          ? (authority as any).event.participationVersion || 0
          : (authority as any).series.participationVersion || 0,
      ),
      targetEventIds,
      targetBookingIds,
      targetSetDigest,
      expectedChildCount: children.length,
      providerRequiredCount: children.filter((child) => child.providerRequired)
        .length,
      requestedChanges,
      status: "prepared",
      suppressionReason,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(eventParticipationMutationChildren).values(
      children.map((child) => ({
        ...child,
        mutationId,
        idempotencyKey: `event-participation:${mutationId}:${child.actionKey}`,
        requestDigest: stableDigest({
          version: "event-participation-child-v2",
          parentRequestDigest: requestDigest,
          targetSetDigest,
          actionKey: child.actionKey,
          targetFacts: child.targetFacts,
        }),
        status:
          child.childKind === "legacy_paid_action_required"
            ? "action_required"
            : child.childKind === "notification"
              ? "notification_pending"
              : "prepared",
        createdAt: now,
        updatedAt: now,
      })),
    );
    if (input.scope.scopeKind === "series") {
      await tx
        .update(eventSeries)
        .set({
          activeParticipationMutationId: mutationId,
          participationSuppressedAt: now,
          participationSuppressionReason: suppressionReason,
          updatedAt: now,
        })
        .where(eq(eventSeries.id, scopeId));
    }
    if (targetEventIds.length) {
      await tx
        .update(events)
        .set({
          activeParticipationMutationId: mutationId,
          participationSuppressedAt: now,
          participationSuppressionReason: suppressionReason,
          updatedAt: now,
        })
        .where(inArray(events.id, targetEventIds));
    }
    if (targetBookingIds.length) {
      await tx
        .update(eventBookings)
        .set({
          activeEventMutationId: mutationId,
          participationVisibilityState: "suppressed",
          updatedAt: now,
        })
        .where(inArray(eventBookings.id, targetBookingIds));
    }
    await tx
      .update(eventParticipationMutations)
      .set({
        status: "suppressed",
        recoveryRequestedAt: now,
        startedAt: now,
        updatedAt: now,
      })
      .where(eq(eventParticipationMutations.id, mutationId));
    return { mutationId, replay: false };
  });
}

async function defaultMutationNotifier(notice: EventMutationNotice) {
  const [target] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, notice.targetUserId))
    .limit(1);
  if (!target?.email) {
    return {
      sent: true,
      providerStatus: "no_email_channel",
      retrySafe: true,
      deliveryState: "not_required" as const,
    };
  }
  const baseUrl = String(
    process.env.PUBLIC_BASE_URL || "https://www.mealscout.us",
  ).replace(/\/+$/, "");
  const cancelled = notice.mutationKind === "cancellation";
  const subject = cancelled
    ? `Event cancellation update: ${notice.eventName}`
    : `Event change needs review: ${notice.eventName}`;
  const message = cancelled
    ? "The event operator changed or cancelled this participation. Any required payment remedy remains visibly pending until provider confirmation."
    : "The event operator changed this participation. Public stop, map, ordering, and pickup visibility remains paused until the protected change is safely resolved.";
  const receipt = await emailService.sendBasicEmailWithReceipt(
    target.email,
    subject,
    `<h2>${cancelled ? "Event cancellation" : "Event change"}</h2><p>${message}</p><p>No protected arrival address or exact booked time is included in this email.</p><p><a href="${baseUrl}/parking-pass?setup=schedule">Review in MealScout</a></p>`,
    `${message} No protected arrival address or exact booked time is included. Review: ${baseUrl}/parking-pass?setup=schedule`,
    "account",
    notice.idempotencyKey,
  );
  if (receipt.sent && !clean(receipt.providerMessageId)) {
    return {
      sent: false,
      providerStatus: "provider_accepted_identity_missing",
      retrySafe: false,
    };
  }
  return {
    sent: receipt.sent,
    providerStatus: receipt.providerStatus,
    providerMessageId: receipt.providerMessageId,
    retrySafe: receipt.retrySafe,
    deliveryState: receipt.sent ? ("provider_confirmed" as const) : undefined,
  };
}

async function setChildState(
  childId: string,
  values: Partial<typeof eventParticipationMutationChildren.$inferInsert>,
) {
  const now = new Date();
  await db
    .update(eventParticipationMutationChildren)
    .set({ ...values, updatedAt: now })
    .where(eq(eventParticipationMutationChildren.id, childId));
}

async function processCancellationChild(input: {
  child: typeof eventParticipationMutationChildren.$inferSelect;
  parent: typeof eventParticipationMutations.$inferSelect;
  stripe: Stripe | null;
}) {
  if (!input.child.purchaseId || !input.child.bookingId) {
    throw new EventParticipationMutationError(
      409,
      "event_mutation_purchase_identity_missing",
      "A provider-backed mutation child is missing its purchase identity.",
    );
  }
  await setChildState(input.child.id, {
    status: "processing",
    attemptCount:
      sql`${eventParticipationMutationChildren.attemptCount} + 1` as any,
    lastAttemptAt: new Date(),
    failureCode: null,
    failureMessage: null,
  });
  const keys = eventParticipationMutationKeys(
    input.parent.requestId,
    input.child.bookingId,
  );
  const operation = await cancelParkingPassLines({
    purchaseId: input.child.purchaseId,
    bookingLineIds: [input.child.bookingId],
    requestId: keys.cancellationRequestId,
    reason:
      input.parent.mutationKind === "cancellation"
        ? "Authorized event cancellation before participation convergence"
        : "Pending paid participation became stale during an authorized event correction",
    actor: {
      userId: "",
      userType: "system",
      system: true,
    },
    stripe: input.stripe,
    technicalNonService: true,
  });
  const terminal = [
    "provider_confirmed",
    "credit_issued",
    "released",
    "no_remedy",
  ].includes(operation.status);
  await setChildState(input.child.id, {
    status: terminal ? "converged" : "action_required",
    cancellationOperationId: operation.id,
    providerStatus: operation.status,
    completedAt: terminal ? new Date() : null,
    failureCode: terminal
      ? null
      : operation.providerErrorCode || "provider_pending",
    failureMessage: terminal
      ? null
      : operation.providerErrorMessage ||
        "The provider-backed cancellation has not converged.",
  });
}

async function processFreeCancellationChild(
  child: typeof eventParticipationMutationChildren.$inferSelect,
) {
  if (!child.bookingId || !child.eventId) return;
  await db.transaction(async (tx: any) => {
    const [row] = await tx
      .select({ booking: eventBookings, event: events })
      .from(eventBookings)
      .innerJoin(events, eq(events.id, eventBookings.eventId))
      .where(eq(eventBookings.id, child.bookingId!))
      .limit(1)
      .for("update");
    if (!row || row.booking.eventId !== child.eventId) {
      throw new EventParticipationMutationError(
        409,
        "event_mutation_booking_changed",
        "The frozen free participation target changed.",
      );
    }
    if (row.event.requiresPayment === true || row.booking.purchaseId) {
      throw new EventParticipationMutationError(
        409,
        "event_mutation_paid_direct_cancel_forbidden",
        "Paid or provider-ambiguous participation cannot use a direct local cancellation.",
      );
    }
    const now = new Date();
    if (["pending", "confirmed"].includes(row.booking.status)) {
      await tx
        .update(eventBookings)
        .set({
          status: "cancelled",
          cancelledAt: now,
          cancellationReason: "Authorized free-event cancellation",
          cancellationPolicy: "free_non_provider_event_cancellation",
          participationVisibilityState: "suppressed",
          updatedAt: now,
        })
        .where(eq(eventBookings.id, row.booking.id));
    }
    await tx
      .update(eventParticipationMutationChildren)
      .set({
        status: "converged",
        providerStatus: "free_non_provider",
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(eventParticipationMutationChildren.id, child.id));
  });
}

function correctedInterval(input: {
  event: typeof events.$inferSelect;
  child: typeof eventParticipationMutationChildren.$inferSelect;
  parent: typeof eventParticipationMutations.$inferSelect;
}) {
  const updates = eventChangesFromStored(
    input.parent.scopeKind as "event" | "series",
    input.parent.requestedChanges,
  );
  const targetFacts =
    input.child.targetFacts && typeof input.child.targetFacts === "object"
      ? (input.child.targetFacts as Record<string, unknown>)
      : {};
  const serviceTimeZone = normalizePersistedIanaTimeZone(
    targetFacts.serviceTimeZone,
  );
  if (!serviceTimeZone) {
    throw new EventParticipationMutationError(
      409,
      "event_mutation_timezone_identity_missing",
      "The immutable mutation child is missing its frozen service timezone.",
    );
  }
  const interval = buildSlotDateTimes({
    timeZone: serviceTimeZone,
    date: updates.date || input.event.date,
    startTime: updates.startTime || input.event.startTime,
    endTime: updates.endTime || input.event.endTime,
  });
  if (!interval) {
    throw new EventParticipationMutationError(
      409,
      "event_schedule_invalid",
      "The frozen corrected schedule cannot be resolved safely.",
    );
  }
  return interval;
}

async function processArrivalChild(input: {
  child: typeof eventParticipationMutationChildren.$inferSelect;
  parent: typeof eventParticipationMutations.$inferSelect;
}) {
  if (!input.child.bookingId || !input.child.eventId) return;
  if (input.child.arrivalVersionId) {
    const [state] = await db
      .select({
        version: parkingPassArrivalVersions,
        bookingStatus: eventBookings.status,
        currentArrivalVersionId: eventBookings.currentArrivalVersionId,
      })
      .from(parkingPassArrivalVersions)
      .innerJoin(
        eventBookings,
        eq(eventBookings.id, parkingPassArrivalVersions.bookingId),
      )
      .where(eq(parkingPassArrivalVersions.id, input.child.arrivalVersionId))
      .limit(1);
    const acknowledged =
      state?.version.state === "current" &&
      state.currentArrivalVersionId === state.version.id &&
      Boolean(state.version.acknowledgedAt);
    const participantClosed = ["cancelled", "refunded"].includes(
      clean(state?.bookingStatus),
    );
    if (acknowledged || participantClosed) {
      await setChildState(input.child.id, {
        status: "converged",
        providerStatus: acknowledged
          ? "arrival_acknowledged"
          : "participant_cancelled",
        completedAt: new Date(),
        failureCode: null,
        failureMessage: null,
      });
      return;
    }
    await setChildState(input.child.id, {
      status: "action_required",
      providerStatus:
        state?.version.notificationState || "notification_pending",
      failureCode: "arrival_acknowledgement_pending",
      failureMessage:
        "The protected arrival correction remains suppressed until the truck team acknowledges it or deadline recovery converges.",
    });
    return;
  }
  const [context] = await db
    .select({ event: events })
    .from(events)
    .where(eq(events.id, input.child.eventId))
    .limit(1);
  if (!context) {
    throw new EventParticipationMutationError(
      409,
      "event_mutation_event_missing",
      "The frozen event target is missing.",
    );
  }
  const interval = correctedInterval({
    event: context.event,
    child: input.child,
    parent: input.parent,
  });
  await setChildState(input.child.id, {
    status: "processing",
    attemptCount:
      sql`${eventParticipationMutationChildren.attemptCount} + 1` as any,
    lastAttemptAt: new Date(),
  });
  const keys = eventParticipationMutationKeys(
    input.parent.requestId,
    input.child.bookingId,
  );
  const version = await correctProtectedParkingPassArrival({
    bookingId: input.child.bookingId,
    actor: {
      userId: "",
      userType: "system",
      system: true,
      eventMutationId: input.parent.id,
      eventMutationChildId: input.child.id,
    },
    idempotencyKey: keys.correctionIdempotencyKey,
    reason: "Authorized event schedule correction for confirmed participation",
    patch: { startAt: interval.startUtc, endAt: interval.endUtc },
  });
  const acknowledged =
    version.state === "current" && Boolean(version.acknowledgedAt);
  await setChildState(input.child.id, {
    status: acknowledged ? "converged" : "action_required",
    arrivalVersionId: version.id,
    providerStatus: version.notificationState,
    completedAt: acknowledged ? new Date() : null,
    failureCode: acknowledged ? null : "arrival_acknowledgement_pending",
    failureMessage: acknowledged
      ? null
      : "The protected arrival correction is waiting for truck-team acknowledgment.",
  });
}

async function processNotificationChild(input: {
  child: typeof eventParticipationMutationChildren.$inferSelect;
  parent: typeof eventParticipationMutations.$inferSelect;
  notifier: EventMutationNotifier;
}) {
  if (!input.child.bookingId || !input.child.eventId) return;
  const siblingRows = await db
    .select()
    .from(eventParticipationMutationChildren)
    .where(
      and(
        eq(eventParticipationMutationChildren.mutationId, input.parent.id),
        eq(
          eventParticipationMutationChildren.bookingId,
          input.child.bookingId,
        ),
      ),
    );
  const arrivalSibling = siblingRows.find(
    (row: any) => row.childKind === "arrival_correct",
  );
  if (arrivalSibling?.arrivalVersionId) {
    const [arrival] = await db
      .select({
        notificationState: parkingPassArrivalVersions.notificationState,
      })
      .from(parkingPassArrivalVersions)
      .where(
        eq(parkingPassArrivalVersions.id, arrivalSibling.arrivalVersionId),
      )
      .limit(1);
    if (arrival?.notificationState === "sent") {
      await setChildState(input.child.id, {
        status: "converged",
        notificationDeliveryState: "provider_confirmed",
        providerStatus: "protected_arrival_notice_sent",
        completedAt: new Date(),
        failureCode: null,
        failureMessage: null,
      });
      return;
    }
  }
  if (!input.child.notificationTargetUserId) {
    await setChildState(input.child.id, {
      status: "converged",
      notificationDeliveryState: "not_required",
      providerStatus: "no_notification_identity",
      completedAt: new Date(),
      failureCode: null,
      failureMessage: null,
    });
    return;
  }
  const claimId = randomUUID();
  const claimed = await db.transaction(async (tx: any) => {
    const [locked] = await tx
      .select()
      .from(eventParticipationMutationChildren)
      .where(eq(eventParticipationMutationChildren.id, input.child.id))
      .limit(1)
      .for("update");
    if (!locked) {
      throw new EventParticipationMutationError(
        409,
        "event_mutation_notification_child_missing",
        "The frozen notification child no longer exists.",
      );
    }
    if (
      locked.status === "converged" ||
      ["provider_confirmed", "not_required"].includes(
        clean(locked.notificationDeliveryState),
      )
    ) {
      return null;
    }
    if (
      ["submitted", "ambiguous"].includes(
        clean(locked.notificationDeliveryState),
      )
    ) {
      // Another worker may still own the submitted call, or the provider may
      // have accepted it before a timeout. Never blind-resend that identity.
      return null;
    }
    const now = new Date();
    const [updated] = await tx
      .update(eventParticipationMutationChildren)
      .set({
        status: "notification_pending",
        notificationDeliveryState: "submitted",
        notificationClaimId: claimId,
        notificationClaimedAt: now,
        notificationSubmittedAt: now,
        attemptCount:
          sql`${eventParticipationMutationChildren.attemptCount} + 1` as any,
        lastAttemptAt: now,
        failureCode: null,
        failureMessage: null,
        updatedAt: now,
      })
      .where(eq(eventParticipationMutationChildren.id, locked.id))
      .returning();
    return updated;
  });
  if (!claimed) return;
  const payload =
    claimed.notificationPayload &&
    typeof claimed.notificationPayload === "object"
      ? (claimed.notificationPayload as Record<string, unknown>)
      : {};
  const targetFacts =
    claimed.targetFacts && typeof claimed.targetFacts === "object"
      ? (claimed.targetFacts as Record<string, unknown>)
      : {};
  if (!normalizePersistedIanaTimeZone(targetFacts.serviceTimeZone)) {
    await setChildState(claimed.id, {
      status: "action_required",
      notificationDeliveryState: "ambiguous",
      failureCode: "event_mutation_timezone_identity_missing",
      failureMessage:
        "The immutable participant notice is missing its frozen service timezone and cannot be delivered safely.",
    });
    return;
  }
  let result: Awaited<ReturnType<EventMutationNotifier>>;
  try {
    result = await input.notifier({
      mutationId: input.parent.id,
      childId: claimed.id,
      targetUserId: claimed.notificationTargetUserId!,
      eventId: claimed.eventId!,
      mutationKind: input.parent.mutationKind as "correction" | "cancellation",
      eventName: clean(payload.eventName) || "MealScout event",
      idempotencyKey: claimed.idempotencyKey,
    });
  } catch (error: any) {
    await setChildState(claimed.id, {
      status: "action_required",
      notificationDeliveryState: "ambiguous",
      providerStatus: clean(error?.code) || "provider_accepted_unknown",
      failureCode: "participant_notification_delivery_ambiguous",
      failureMessage:
        "The notification provider may have accepted this exact notice. MealScout will not resend it without provider-confirmed identity.",
    });
    return;
  }
  const delivered = result.sent;
  const retrySafe = !delivered && result.retrySafe === true;
  const deliveryState = delivered
    ? result.deliveryState || "provider_confirmed"
    : retrySafe
      ? "retry_safe"
      : "ambiguous";
  await setChildState(input.child.id, {
    status: delivered ? "converged" : "action_required",
    notificationDeliveryState: deliveryState,
    notificationProviderMessageId:
      clean(result.providerMessageId) || null,
    providerStatus:
      result.providerStatus || (delivered ? "sent" : "failed"),
    completedAt: delivered ? new Date() : null,
    failureCode: delivered
      ? null
      : retrySafe
        ? "participant_notification_failed"
        : "participant_notification_delivery_ambiguous",
    failureMessage: delivered
      ? null
      : retrySafe
        ? "The provider rejected this notification before acceptance; recovery may retry the same immutable notice."
        : "The provider may have accepted this exact notice. MealScout will not resend it without provider-confirmed identity.",
  });
}

async function finalizeMutation(
  parentId: string,
  recovery?: MutationRecoveryContext,
) {
  return db.transaction(async (tx: any) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`event_participation_mutation_finalize:${parentId}`}))`,
    );
    const [parent] = await tx
      .select()
      .from(eventParticipationMutations)
      .where(eq(eventParticipationMutations.id, parentId))
      .limit(1)
      .for("update");
    if (!parent) throw new Error("Event participation mutation disappeared.");
    if (parent.status === "converged") return parent;
    await authorizeMutationDriveLocked(tx, parent, recovery);
    await assertFrozenMutationScopeLocked(tx, parent);
    const children = await tx
      .select()
      .from(eventParticipationMutationChildren)
      .where(eq(eventParticipationMutationChildren.mutationId, parent.id))
      .orderBy(asc(eventParticipationMutationChildren.actionKey))
      .for("update");
    const nonApply = children.filter(
      (child: any) =>
        !["series_apply", "event_apply"].includes(child.childKind),
    );
    if (nonApply.some((child: any) => child.status !== "converged")) {
      throw new EventParticipationMutationError(
        409,
        "event_mutation_not_converged",
        "Participation remedies, acknowledgments, or notices remain unresolved.",
      );
    }
    // Migration 142 accepts material event/series supply changes with live
    // participation only from the exact durable parent being finalized in
    // this transaction. The proof is transaction-local and cannot leak to a
    // later request on the pooled connection.
    await tx.execute(
      sql`SELECT set_config('mealscout.event_participation_mutation_id', ${parent.id}, true)`,
    );
    const targetEventIds = stableIds(parent.targetEventIds as unknown[]);
    const targetBookingIds = stableIds(parent.targetBookingIds as unknown[]);
    const targetEvents = targetEventIds.length
      ? await tx
          .select()
          .from(events)
          .where(inArray(events.id, targetEventIds))
          .orderBy(asc(events.id))
          .for("update")
      : [];
    const eventUpdates = eventChangesFromStored(
      parent.scopeKind as "event" | "series",
      parent.requestedChanges,
    );
    const now = new Date();
    for (const event of targetEvents) {
      if (clean(event.activeParticipationMutationId) !== parent.id) {
        throw new EventParticipationMutationError(
          409,
          "event_mutation_barrier_changed",
          "A frozen event mutation barrier changed before convergence.",
        );
      }
      const nextVersion = Number(event.participationVersion || 0) + 1;
      await tx
        .update(events)
        .set({
          ...eventUpdates,
          participationVersion: nextVersion,
          activeParticipationMutationId: null,
          participationSuppressedAt:
            parent.mutationKind === "cancellation" ? now : null,
          participationSuppressionReason:
            parent.mutationKind === "cancellation"
              ? "Event cancelled after participation remedies converged."
              : null,
          updatedAt: now,
        })
        .where(eq(events.id, event.id));
      const eventBookingIds = targetBookingIds.length
        ? await tx
            .select({ id: eventBookings.id, status: eventBookings.status })
            .from(eventBookings)
            .where(
              and(
                eq(eventBookings.eventId, event.id),
                inArray(eventBookings.id, targetBookingIds),
              ),
            )
            .for("update")
        : [];
      for (const booking of eventBookingIds) {
        await tx
          .update(eventBookings)
          .set({
            eventParticipationVersion: nextVersion,
            activeEventMutationId: null,
            participationVisibilityState: ["pending", "confirmed"].includes(
              booking.status,
            )
              ? "eligible"
              : "suppressed",
            updatedAt: now,
          })
          .where(eq(eventBookings.id, booking.id));
      }
      if (parent.mutationKind === "cancellation") {
        await tx
          .update(eventInterests)
          .set({ status: "declined", updatedAt: now } as any)
          .where(
            and(
              eq(eventInterests.eventId, event.id),
              eq(eventInterests.status, "pending"),
            ),
          );
      }
      await tx
        .update(eventParticipationMutationChildren)
        .set({ status: "converged", completedAt: now, updatedAt: now })
        .where(
          and(
            eq(eventParticipationMutationChildren.mutationId, parent.id),
            eq(eventParticipationMutationChildren.childKind, "event_apply"),
            eq(eventParticipationMutationChildren.eventId, event.id),
          ),
        );
    }
    if (parent.scopeKind === "series") {
      const [series] = await tx
        .select()
        .from(eventSeries)
        .where(eq(eventSeries.id, clean(parent.seriesId)))
        .limit(1)
        .for("update");
      if (!series || clean(series.activeParticipationMutationId) !== parent.id) {
        throw new EventParticipationMutationError(
          409,
          "event_series_mutation_barrier_changed",
          "The frozen series mutation barrier changed before convergence.",
        );
      }
      await tx
        .update(eventSeries)
        .set({
          ...seriesChangesFromStored(parent.requestedChanges),
          participationVersion: Number(series.participationVersion || 0) + 1,
          activeParticipationMutationId: null,
          participationSuppressedAt:
            parent.mutationKind === "cancellation" ? now : null,
          participationSuppressionReason:
            parent.mutationKind === "cancellation"
              ? "Series closed after participation remedies converged."
              : null,
          updatedAt: now,
        })
        .where(eq(eventSeries.id, series.id));
      const companionHostDefaults = hostParkingPassDefaultsFromStored(
        parent.requestedChanges,
      );
      if (companionHostDefaults) {
        if (series.seriesType !== "parking_pass") {
          throw new EventParticipationMutationError(
            409,
            "event_series_companion_host_scope_invalid",
            "Host Parking Pass defaults can only converge with a Parking Pass series.",
          );
        }
        await tx
          .update(hosts)
          .set({ ...companionHostDefaults, updatedAt: now } as any)
          .where(eq(hosts.id, series.hostId));
      }
      await tx
        .update(eventParticipationMutationChildren)
        .set({ status: "converged", completedAt: now, updatedAt: now })
        .where(
          and(
            eq(eventParticipationMutationChildren.mutationId, parent.id),
            eq(eventParticipationMutationChildren.childKind, "series_apply"),
          ),
        );
    }
    const convergedChildCount = Number(
      (
        await tx
          .select({ count: sql<number>`count(*)` })
          .from(eventParticipationMutationChildren)
          .where(
            and(
              eq(eventParticipationMutationChildren.mutationId, parent.id),
              eq(eventParticipationMutationChildren.status, "converged"),
            ),
          )
      )[0]?.count || 0,
    );
    const [completed] = await tx
      .update(eventParticipationMutations)
      .set({
        status: "converged",
        convergedChildCount,
        failureCode: null,
        failureMessage: null,
        recoveryRequestedAt: null,
        recoveryClaimedAt: null,
        recoveryClaimedBy: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(eventParticipationMutations.id, parent.id))
      .returning();
    return completed;
  });
}

async function driveMutation(input: {
  mutationId: string;
  stripe: Stripe | null;
  notifier: EventMutationNotifier;
  recovery?: MutationRecoveryContext;
}) {
  const parent = await db.transaction(async (tx: any) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`event_participation_mutation_drive:${input.mutationId}`}))`,
    );
    const [locked] = await tx
      .select()
      .from(eventParticipationMutations)
      .where(eq(eventParticipationMutations.id, input.mutationId))
      .limit(1)
      .for("update");
    if (!locked) {
      throw new EventParticipationMutationError(
        404,
        "event_mutation_not_found",
        "Event participation mutation not found.",
      );
    }
    if (locked.status === "converged") return locked;
    await authorizeMutationDriveLocked(tx, locked, input.recovery);
    await lockMutationTargets(
      tx,
      stableIds(locked.targetEventIds as unknown[]),
      stableIds(locked.targetBookingIds as unknown[]),
    );
    await assertFrozenMutationScopeLocked(tx, locked);
    await tx
      .update(eventParticipationMutations)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(eventParticipationMutations.id, locked.id));
    return locked;
  });
  if (parent.status === "converged") return parent;

  const children = await db
    .select()
    .from(eventParticipationMutationChildren)
    .where(eq(eventParticipationMutationChildren.mutationId, parent.id))
    .orderBy(asc(eventParticipationMutationChildren.actionKey));
  for (const child of children) {
    if (["converged", "skipped"].includes(child.status)) continue;
    try {
      if (child.childKind === "booking_cancel") {
        await processCancellationChild({
          child,
          parent,
          stripe: input.stripe,
        });
      } else if (child.childKind === "free_participation_cancel") {
        await processFreeCancellationChild(child);
      } else if (child.childKind === "arrival_correct") {
        await processArrivalChild({ child, parent });
      } else if (child.childKind === "notification") {
        await processNotificationChild({
          child,
          parent,
          notifier: input.notifier,
        });
      } else if (child.childKind === "legacy_paid_action_required") {
        await setChildState(child.id, {
          status: "action_required",
          failureCode: "legacy_paid_participation_ambiguous",
          failureMessage:
            "This historical paid participation has no canonical purchase/provider identity and remains suppressed for reconciliation.",
        });
      }
    } catch (error: any) {
      await setChildState(child.id, {
        status: "action_required",
        failureCode: clean(error?.code) || "event_mutation_child_failed",
        failureMessage:
          clean(error?.message) || "Event mutation child work did not converge.",
      });
    }
  }

  const refreshedChildren = await db
    .select()
    .from(eventParticipationMutationChildren)
    .where(eq(eventParticipationMutationChildren.mutationId, parent.id))
    .orderBy(asc(eventParticipationMutationChildren.actionKey));
  const unresolved = refreshedChildren.filter(
    (child: any) =>
      !["series_apply", "event_apply"].includes(child.childKind) &&
      child.status !== "converged",
  );
  if (unresolved.length) {
    const now = new Date();
    const convergedChildCount = refreshedChildren.filter(
      (child: any) => child.status === "converged",
    ).length;
    const [updated] = await db
      .update(eventParticipationMutations)
      .set({
        status: "action_required",
        convergedChildCount,
        failureCode:
          clean(unresolved[0]?.failureCode) || "event_mutation_pending",
        failureMessage:
          clean(unresolved[0]?.failureMessage) ||
          "One or more participation children remain unresolved.",
        recoveryRequestedAt: now,
        updatedAt: now,
      })
      .where(eq(eventParticipationMutations.id, parent.id))
      .returning();
    return updated;
  }
  return finalizeMutation(parent.id, input.recovery);
}

async function serializeMutationResult(mutationId: string) {
  const [mutation] = await db
    .select()
    .from(eventParticipationMutations)
    .where(eq(eventParticipationMutations.id, mutationId))
    .limit(1);
  const children = await db
    .select()
    .from(eventParticipationMutationChildren)
    .where(eq(eventParticipationMutationChildren.mutationId, mutationId))
    .orderBy(asc(eventParticipationMutationChildren.actionKey));
  const cancellationIds = stableIds(
    children.map((child: any) => child.cancellationOperationId),
  );
  const cancellationOperations = cancellationIds.length
    ? await db
        .select()
        .from(parkingPassCancellationOperations)
        .where(inArray(parkingPassCancellationOperations.id, cancellationIds))
    : [];
  return {
    mutation: {
      id: mutation?.id,
      status: mutation?.status,
      mutationKind: mutation?.mutationKind,
      targetEventIds: mutation?.targetEventIds || [],
      targetBookingIds: mutation?.targetBookingIds || [],
      expectedChildCount: mutation?.expectedChildCount || 0,
      convergedChildCount: mutation?.convergedChildCount || 0,
      failureCode: mutation?.failureCode || null,
      failureMessage: mutation?.failureMessage || null,
      completedAt: mutation?.completedAt || null,
    },
    affected: Array.isArray(mutation?.targetBookingIds)
      ? mutation.targetBookingIds.length
      : 0,
    children: children.map((child: any) => ({
      id: child.id,
      eventId: child.eventId,
      bookingId: child.bookingId,
      childKind: child.childKind,
      status: child.status,
      providerStatus: child.providerStatus,
      failureCode: child.failureCode,
      failureMessage: child.failureMessage,
      cancellationOperationId: child.cancellationOperationId,
      arrivalVersionId: child.arrivalVersionId,
    })),
    operations: cancellationOperations.map((operation: any) =>
      serializeParkingPassCancellationOperation(operation),
    ),
    corrections: children
      .filter((child: any) => child.childKind === "arrival_correct")
      .map((child: any) => ({
        bookingId: child.bookingId,
        arrivalVersionId: child.arrivalVersionId,
        status: child.status,
        failureCode: child.failureCode,
      })),
  };
}

async function runMutation(input: {
  scope: MutationScopeInput;
  actor: MutationActor;
  requestId: string;
  stripe?: Stripe | null;
  notifier?: EventMutationNotifier;
}) {
  const prepared = await prepareMutation(input);
  await driveMutation({
    mutationId: prepared.mutationId,
    stripe: input.stripe === undefined ? configuredStripe : input.stripe,
    notifier: input.notifier || defaultMutationNotifier,
  });
  return serializeMutationResult(prepared.mutationId);
}

export async function updateCoordinatedEvent(input: {
  eventId: string;
  actor: MutationActor;
  requestId: string;
  updates: EventUpdates;
  stripe?: Stripe | null;
  notifier?: EventMutationNotifier;
}) {
  const fanout = await runMutation({
    scope: {
      scopeKind: "event",
      scopeId: clean(input.eventId),
      updates: input.updates,
    },
    actor: input.actor,
    requestId: input.requestId,
    stripe: input.stripe,
    notifier: input.notifier,
  });
  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.id, clean(input.eventId)))
    .limit(1);
  return { event, fanout };
}

export async function cancelCoordinatedEvent(input: {
  eventId: string;
  actor: MutationActor;
  requestId: string;
  stripe?: Stripe | null;
  notifier?: EventMutationNotifier;
}) {
  return updateCoordinatedEvent({
    ...input,
    updates: { status: "cancelled" },
  });
}

export async function updateCoordinatedSeries(input: {
  seriesId: string;
  actor: MutationActor;
  requestId: string;
  updates: SeriesUpdates;
  companionHostDefaults?: HostParkingPassDefaults;
  stripe?: Stripe | null;
  notifier?: EventMutationNotifier;
}) {
  const fanout = await runMutation({
    scope: {
      scopeKind: "series",
      scopeId: clean(input.seriesId),
      updates: input.updates,
      companionHostDefaults: input.companionHostDefaults,
    },
    actor: input.actor,
    requestId: input.requestId,
    stripe: input.stripe,
    notifier: input.notifier,
  });
  const [series] = await db
    .select()
    .from(eventSeries)
    .where(eq(eventSeries.id, clean(input.seriesId)))
    .limit(1);
  const targetEventIds = stableIds(
    fanout.mutation.targetEventIds as unknown[],
  );
  const eventResults = targetEventIds.length
    ? await db
        .select()
        .from(events)
        .where(inArray(events.id, targetEventIds))
        .orderBy(asc(events.date), asc(events.id))
    : [];
  return { series, eventResults, fanout, mutation: fanout.mutation };
}

export async function cancelCoordinatedSeries(input: {
  seriesId: string;
  actor: MutationActor;
  requestId: string;
  stripe?: Stripe | null;
  notifier?: EventMutationNotifier;
}) {
  return updateCoordinatedSeries({
    ...input,
    updates: { status: "closed" },
  });
}

export async function resumeEventParticipationMutation(input: {
  mutationId: string;
  actor: MutationActor;
  stripe?: Stripe | null;
  notifier?: EventMutationNotifier;
}) {
  const [mutation] = await db
    .select()
    .from(eventParticipationMutations)
    .where(eq(eventParticipationMutations.id, clean(input.mutationId)))
    .limit(1);
  if (!mutation) {
    throw new EventParticipationMutationError(
      404,
      "event_mutation_not_found",
      "Event participation mutation not found.",
    );
  }
  await driveMutation({
    mutationId: mutation.id,
    stripe: input.stripe === undefined ? configuredStripe : input.stripe,
    notifier: input.notifier || defaultMutationNotifier,
    recovery: {
      mode: "takeover",
      actorUserId: clean(input.actor.userId),
      reason: "audited_current_authority_takeover",
    },
  });
  return serializeMutationResult(mutation.id);
}

/**
 * Claim resumable parents with row locks so multiple server instances can run
 * this safely. Recovery never changes the stored target set, actor snapshot,
 * requested changes, child identities, or provider idempotency keys.
 */
export async function reconcileEventParticipationMutations(input?: {
  limit?: number;
  stripe?: Stripe | null;
  notifier?: EventMutationNotifier;
  workerId?: string;
}) {
  const limit = Math.max(1, Math.min(50, Math.trunc(input?.limit || 10)));
  const workerId = clean(input?.workerId) || `event-mutation-${randomUUID()}`;
  const claimResult = await db.transaction(async (tx: any) =>
    tx.execute(sql`
      WITH candidates AS (
        SELECT parent.id
          FROM event_participation_mutations parent
         WHERE parent.status IN (
           'prepared', 'suppressed', 'processing', 'action_required'
         )
           AND (
             parent.recovery_claimed_at IS NULL
             OR parent.recovery_claimed_at < now() - interval '5 minutes'
           )
           AND (
             parent.recovery_requested_at IS NOT NULL
             OR parent.updated_at <= now() - interval '15 seconds'
           )
         ORDER BY
           parent.recovery_requested_at NULLS LAST,
           parent.updated_at,
           parent.id
         FOR UPDATE SKIP LOCKED
         LIMIT ${limit}
      )
      UPDATE event_participation_mutations parent
         SET recovery_claimed_at = now(),
             recovery_claimed_by = ${workerId},
             recovery_attempt_count = parent.recovery_attempt_count + 1,
             last_recovery_actor_user_id = NULL,
             last_recovery_actor_type = 'system',
             last_recovery_reason = 'recurring_reconciler',
             updated_at = now()
        FROM candidates
       WHERE parent.id = candidates.id
       RETURNING parent.id
    `),
  );
  const mutationIds = ((claimResult as any).rows || [])
    .map((row: any) => clean(row.id))
    .filter(Boolean);
  let converged = 0;
  let pending = 0;
  let failed = 0;
  for (const mutationId of mutationIds) {
    try {
      const result = await driveMutation({
        mutationId,
        stripe: input?.stripe === undefined ? configuredStripe : input.stripe,
        notifier: input?.notifier || defaultMutationNotifier,
        recovery: {
          mode: "system",
          workerId,
          reason: "recurring_reconciler",
        },
      });
      if (result?.status === "converged") converged += 1;
      else pending += 1;
    } catch (error: any) {
      failed += 1;
      await db
        .update(eventParticipationMutations)
        .set({
          status: "action_required",
          failureCode: clean(error?.code) || "event_mutation_recovery_failed",
          failureMessage:
            clean(error?.message) || "Event mutation recovery did not converge.",
          recoveryRequestedAt: null,
          recoveryClaimedAt: null,
          recoveryClaimedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(eventParticipationMutations.id, mutationId));
      continue;
    }
    await db
      .update(eventParticipationMutations)
      .set({
        recoveryRequestedAt: null,
        recoveryClaimedAt: null,
        recoveryClaimedBy: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(eventParticipationMutations.id, mutationId),
          eq(eventParticipationMutations.recoveryClaimedBy, workerId),
        ),
      );
  }
  return {
    examined: mutationIds.length,
    converged,
    pending,
    failed,
    workerId,
  };
}
