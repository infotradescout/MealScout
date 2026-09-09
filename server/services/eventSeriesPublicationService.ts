import { createHash, randomUUID } from "node:crypto";
import {
  eventBookings,
  events,
  eventSeries,
  eventSeriesPublicationChildren,
  eventSeriesPublicationOperations,
  hosts,
  users,
} from "@shared/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  dateKeyFromUnknown,
  dateKeyInZone,
  utcDateFromDateKey,
} from "./dateKeys";
import {
  filterFutureOccurrences,
  generateOccurrences,
} from "./openCallSeries";
import { normalizePersistedIanaTimeZone } from "./persistedServiceTimeZoneRules";

const clean = (value: unknown) => String(value || "").trim();

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

const digest = (value: unknown) =>
  createHash("sha256").update(stableJson(value)).digest("hex");

export class EventSeriesPublicationError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EventSeriesPublicationError";
  }
}

type FrozenOccurrence = {
  dateKey: string;
  hostId: string;
  coordinatorUserId: string | null;
  seriesId: string;
  name: string;
  description: string | null;
  startTime: string;
  endTime: string;
  maxTrucks: number;
  hardCapEnabled: boolean;
  eventType: "event";
  requiresPayment: false;
};

type PublicationSnapshot = {
  version: "event-series-publication-v2";
  timeZone: string;
  statusBefore: string;
  occurrences: FrozenOccurrence[];
};

function snapshotFromUnknown(value: unknown): PublicationSnapshot {
  const snapshot = value as Partial<PublicationSnapshot> | null;
  if (
    !snapshot ||
    snapshot.version !== "event-series-publication-v2" ||
    !normalizePersistedIanaTimeZone(snapshot.timeZone) ||
    !Array.isArray(snapshot.occurrences)
  ) {
    throw new EventSeriesPublicationError(
      409,
      "event_series_publication_snapshot_invalid",
      "The stored publication scope cannot be recovered safely.",
    );
  }
  return snapshot as PublicationSnapshot;
}

function publicationDigestPart(value: unknown): string {
  if (value === null || value === undefined) return "-1:";
  const normalized = String(value);
  return `${Buffer.byteLength(normalized, "utf8")}:${normalized}`;
}

function publicationEventId(operationId: string, dateKey: string): string {
  const material = [
    "event-series-publication-event-v1",
    operationId,
    dateKey,
  ]
    .map(publicationDigestPart)
    .join("");
  return `event-pub-${createHash("sha256").update(material).digest("hex").slice(0, 48)}`;
}

type PublicationPayload = FrozenOccurrence & {
  operationId: string;
  expectedEventId: string;
};

type PublicationChildFact = FrozenOccurrence & {
  expectedEventId: string;
  payloadDigest: string;
};

function publicationPayloadDigest(payload: PublicationPayload): string {
  const material = [
    "event-series-publication-payload-v2",
    payload.operationId,
    payload.expectedEventId,
    payload.hostId,
    payload.coordinatorUserId,
    payload.seriesId,
    payload.dateKey,
    payload.name,
    payload.description,
    payload.startTime,
    payload.endTime,
    payload.maxTrucks,
    payload.hardCapEnabled,
    payload.eventType,
    payload.requiresPayment,
  ]
    .map(publicationDigestPart)
    .join("");
  return createHash("sha256").update(material).digest("hex");
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function publicationChildFactFromRow(
  child: typeof eventSeriesPublicationChildren.$inferSelect,
): PublicationChildFact {
  return {
    dateKey: child.dateKey,
    hostId: child.hostId,
    coordinatorUserId: nullableText(child.coordinatorUserId),
    seriesId: child.seriesId,
    name: child.name,
    description: nullableText(child.description),
    startTime: child.startTime,
    endTime: child.endTime,
    maxTrucks: Number(child.maxTrucks),
    hardCapEnabled: Boolean(child.hardCapEnabled),
    eventType: child.eventType as "event",
    requiresPayment: Boolean(child.requiresPayment) as false,
    expectedEventId: child.expectedEventId,
    payloadDigest: child.payloadDigest,
  };
}

function occurrenceMatchesChild(
  occurrence: FrozenOccurrence,
  child: typeof eventSeriesPublicationChildren.$inferSelect,
) {
  const payload: PublicationPayload = {
    ...occurrence,
    operationId: child.operationId,
    expectedEventId: child.expectedEventId,
  };
  return (
    publicationEventId(child.operationId, child.dateKey) ===
      child.expectedEventId &&
    occurrence.dateKey === child.dateKey &&
    occurrence.hostId === child.hostId &&
    occurrence.coordinatorUserId === nullableText(child.coordinatorUserId) &&
    occurrence.seriesId === child.seriesId &&
    occurrence.name === child.name &&
    occurrence.description === nullableText(child.description) &&
    occurrence.startTime === child.startTime &&
    occurrence.endTime === child.endTime &&
    occurrence.maxTrucks === Number(child.maxTrucks) &&
    occurrence.hardCapEnabled === Boolean(child.hardCapEnabled) &&
    occurrence.eventType === child.eventType &&
    occurrence.requiresPayment === Boolean(child.requiresPayment) &&
    publicationPayloadDigest(payload) === child.payloadDigest
  );
}

function storedEventMatchesChild(
  storedEvent: typeof events.$inferSelect,
  child: typeof eventSeriesPublicationChildren.$inferSelect,
) {
  const dateKey = dateKeyFromUnknown(storedEvent.date, "UTC");
  const payload: PublicationPayload = {
    operationId: child.operationId,
    expectedEventId: child.expectedEventId,
    dateKey: child.dateKey,
    hostId: storedEvent.hostId,
    coordinatorUserId: nullableText(storedEvent.coordinatorUserId),
    seriesId: clean(storedEvent.seriesId),
    name: clean(storedEvent.name),
    description: nullableText(storedEvent.description),
    startTime: clean(storedEvent.startTime),
    endTime: clean(storedEvent.endTime),
    maxTrucks: Number(storedEvent.maxTrucks),
    hardCapEnabled: Boolean(storedEvent.hardCapEnabled),
    eventType: "event",
    requiresPayment: false,
  };
  return (
    storedEvent.id === child.expectedEventId &&
    storedEvent.publicationOperationId === child.operationId &&
    storedEvent.publicationDateKey === child.dateKey &&
    storedEvent.publicationPayloadDigest === child.payloadDigest &&
    dateKey === child.dateKey &&
    storedEvent.hostId === child.hostId &&
    nullableText(storedEvent.coordinatorUserId) ===
      nullableText(child.coordinatorUserId) &&
    clean(storedEvent.seriesId) === child.seriesId &&
    clean(storedEvent.name) === child.name &&
    nullableText(storedEvent.description) === nullableText(child.description) &&
    clean(storedEvent.startTime) === child.startTime &&
    clean(storedEvent.endTime) === child.endTime &&
    Number(storedEvent.maxTrucks) === Number(child.maxTrucks) &&
    Boolean(storedEvent.hardCapEnabled) === Boolean(child.hardCapEnabled) &&
    clean(storedEvent.eventType) === child.eventType &&
    Boolean(storedEvent.requiresPayment) === Boolean(child.requiresPayment) &&
    publicationPayloadDigest(payload) === child.payloadDigest
  );
}

function publicationRequestDigest(input: {
  seriesId: string;
  actorUserId: string;
  requestId: string;
  snapshot: PublicationSnapshot;
  targetSetDigest: string;
}) {
  return digest({
    version: "event-series-publication-request-v1",
    ...input,
  });
}

function assertInitiationAuthority(input: {
  actorUserId: string;
  series: typeof eventSeries.$inferSelect;
  host: typeof hosts.$inferSelect;
}) {
  const hostOwner = clean(input.host.userId) === input.actorUserId;
  const explicitCoordinator =
    input.series.seriesType !== "parking_pass" &&
    clean(input.series.coordinatorUserId) === input.actorUserId;
  if (!hostOwner && !explicitCoordinator) {
    throw new EventSeriesPublicationError(
      403,
      "event_series_publication_forbidden",
      "Current host ownership or explicit non-Parking-Pass coordinator authority is required to publish this series.",
    );
  }
}

function frozenOccurrencesForSeries(
  series: typeof eventSeries.$inferSelect,
  now: Date,
): { timeZone: string; occurrences: FrozenOccurrence[] } {
  const timeZone = normalizePersistedIanaTimeZone(series.timezone);
  const startKey = dateKeyFromUnknown(series.startDate, "UTC");
  const endKey = dateKeyFromUnknown(series.endDate, "UTC");
  if (!timeZone || !startKey || !endKey || endKey < startKey) {
    throw new EventSeriesPublicationError(
      409,
      "event_series_time_authority_unavailable",
      "This series does not have authoritative timezone and date boundaries.",
    );
  }
  const generated = filterFutureOccurrences(
    generateOccurrences({
      startDate: utcDateFromDateKey(startKey),
      endDate: utcDateFromDateKey(endKey),
      recurrenceRule: series.recurrenceRule,
      defaults: {
        hostId: series.hostId,
        coordinatorUserId: series.coordinatorUserId,
        seriesId: series.id,
        name: series.name,
        description: series.description,
        startTime: series.defaultStartTime,
        endTime: series.defaultEndTime,
        maxTrucks: series.defaultMaxTrucks,
        hardCapEnabled: series.defaultHardCapEnabled,
      },
    }),
    now,
    timeZone,
  );
  const occurrences = generated.map((occurrence) => {
    const dateKey = dateKeyFromUnknown(occurrence.date, "UTC");
    if (!dateKey) {
      throw new EventSeriesPublicationError(
        409,
        "event_series_occurrence_date_invalid",
        "A generated occurrence does not have a stable calendar date.",
      );
    }
    return {
      dateKey,
      hostId: clean(occurrence.hostId),
      coordinatorUserId: clean(occurrence.coordinatorUserId) || null,
      seriesId: clean(occurrence.seriesId),
      name: clean(occurrence.name),
      description: occurrence.description ?? null,
      startTime: clean(occurrence.startTime),
      endTime: clean(occurrence.endTime),
      maxTrucks: Number(occurrence.maxTrucks || 1),
      hardCapEnabled: Boolean(occurrence.hardCapEnabled),
      eventType: "event",
      requiresPayment: false,
    } satisfies FrozenOccurrence;
  });
  if (occurrences.length === 0) {
    throw new EventSeriesPublicationError(
      409,
      "event_series_has_no_future_occurrences",
      `This series has no occurrence on or after ${dateKeyInZone(now, timeZone)} in its stored venue timezone.`,
    );
  }
  return { timeZone, occurrences };
}

export async function prepareEventSeriesPublication(input: {
  seriesId: string;
  actorUserId: string;
  requestId: string;
  now?: Date;
}) {
  const seriesId = clean(input.seriesId);
  const actorUserId = clean(input.actorUserId);
  const requestId = clean(input.requestId);
  if (!seriesId || !actorUserId || requestId.length < 8) {
    throw new EventSeriesPublicationError(
      400,
      "event_series_publication_identity_required",
      "Series, current actor, and a stable Idempotency-Key are required.",
    );
  }
  const now = input.now || new Date();
  return db.transaction(async (tx: any) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`event_series_publication:${seriesId}`}))`,
    );
    const [series] = await tx
      .select()
      .from(eventSeries)
      .where(eq(eventSeries.id, seriesId))
      .limit(1)
      .for("update");
    if (!series) {
      throw new EventSeriesPublicationError(
        404,
        "event_series_not_found",
        "Event series not found.",
      );
    }
    const [host] = await tx
      .select()
      .from(hosts)
      .where(eq(hosts.id, series.hostId))
      .limit(1)
      .for("update");
    if (!host) {
      throw new EventSeriesPublicationError(
        409,
        "event_series_host_missing",
        "The series host is unavailable.",
      );
    }
    const [actor] = await tx
      .select({ id: users.id, isDisabled: users.isDisabled })
      .from(users)
      .where(eq(users.id, actorUserId))
      .limit(1)
      .for("update");
    if (!actor || actor.isDisabled === true) {
      throw new EventSeriesPublicationError(
        403,
        "event_series_publication_actor_inactive",
        "A current active owner or coordinator is required to start publication.",
      );
    }
    assertInitiationAuthority({ actorUserId, series, host });

    const existing = await tx
      .select()
      .from(eventSeriesPublicationOperations)
      .where(
        and(
          eq(eventSeriesPublicationOperations.seriesId, seriesId),
          eq(eventSeriesPublicationOperations.requestId, requestId),
        ),
      )
      .limit(1)
      .for("update");
    if (existing[0]) {
      if (clean(existing[0].actorUserId) !== actorUserId) {
        throw new EventSeriesPublicationError(
          409,
          "event_series_publication_idempotency_mismatch",
          "That publication request is bound to a different actor.",
        );
      }
      return { operationId: existing[0].id, replay: true };
    }

    if (series.status === "published") {
      throw new EventSeriesPublicationError(
        409,
        "event_series_already_published",
        "This series is already published.",
      );
    }
    if (series.status !== "draft") {
      throw new EventSeriesPublicationError(
        409,
        "event_series_not_publishable",
        "Only a draft series can begin publication.",
      );
    }
    if (clean(series.activeParticipationMutationId)) {
      throw new EventSeriesPublicationError(
        409,
        "event_series_mutation_in_progress",
        "This series has another material mutation in progress.",
      );
    }
    if (clean(series.activePublicationOperationId)) {
      throw new EventSeriesPublicationError(
        409,
        "event_series_publication_in_progress",
        "This series already has a publication operation in progress.",
        { operationId: series.activePublicationOperationId! },
      );
    }
    const existingOccurrences = await tx
      .select({ id: events.id })
      .from(events)
      .where(eq(events.seriesId, seriesId))
      .limit(1)
      .for("update");
    if (existingOccurrences.length > 0) {
      throw new EventSeriesPublicationError(
        409,
        "event_series_legacy_occurrences_require_reconciliation",
        "Existing unbound occurrences must be reconciled before this series can use durable publication.",
      );
    }
    const participating = await tx
      .select({ id: eventBookings.id })
      .from(eventBookings)
      .innerJoin(events, eq(events.id, eventBookings.eventId))
      .where(eq(events.seriesId, seriesId))
      .limit(1)
      .for("update");
    if (participating.length > 0) {
      throw new EventSeriesPublicationError(
        409,
        "event_series_participation_requires_mutation",
        "A participating series cannot begin a new publication scope.",
      );
    }

    const frozen = frozenOccurrencesForSeries(series, now);
    const snapshot: PublicationSnapshot = {
      version: "event-series-publication-v2",
      timeZone: frozen.timeZone,
      statusBefore: series.status,
      occurrences: frozen.occurrences,
    };
    const operationId = randomUUID();
    const childFacts = frozen.occurrences.map((occurrence) => {
      const expectedEventId = publicationEventId(
        operationId,
        occurrence.dateKey,
      );
      return {
        ...occurrence,
        expectedEventId,
        payloadDigest: publicationPayloadDigest({
          ...occurrence,
          operationId,
          expectedEventId,
        }),
      };
    });
    const targetDateKeys = childFacts.map((child) => child.dateKey);
    const targetSetDigest = digest(childFacts);
    const requestDigest = publicationRequestDigest({
      seriesId,
      actorUserId,
      requestId,
      snapshot,
      targetSetDigest,
    });
    await tx.insert(eventSeriesPublicationOperations).values({
      id: operationId,
      seriesId,
      requestId,
      idempotencyKey: `event-series-publication:${seriesId}:${requestId}`,
      requestDigest,
      actorUserId,
      authoritySnapshot: snapshot,
      expectedParticipationVersion: Number(series.participationVersion || 0),
      targetDateKeys,
      targetSetDigest,
      expectedChildCount: childFacts.length,
      status: "prepared",
      recoveryRequestedAt: now,
      updatedAt: now,
    });
    await tx.insert(eventSeriesPublicationChildren).values(
      childFacts.map((child) => ({
        operationId,
        seriesId,
        expectedEventId: child.expectedEventId,
        dateKey: child.dateKey,
        hostId: child.hostId,
        coordinatorUserId: child.coordinatorUserId,
        name: child.name,
        description: child.description,
        startTime: child.startTime,
        endTime: child.endTime,
        maxTrucks: child.maxTrucks,
        hardCapEnabled: child.hardCapEnabled,
        eventType: child.eventType,
        requiresPayment: child.requiresPayment,
        payloadDigest: child.payloadDigest,
        status: "prepared",
      })),
    );
    await tx
      .update(eventSeries)
      .set({
        activePublicationOperationId: operationId,
        publicationSuppressedAt: now,
        updatedAt: now,
      })
      .where(eq(eventSeries.id, seriesId));
    return { operationId, replay: false };
  });
}

async function convergePublicationChild(input: {
  operationId: string;
  childId: string;
}) {
  return db.transaction(async (tx: any) => {
    const [parent] = await tx
      .select()
      .from(eventSeriesPublicationOperations)
      .where(eq(eventSeriesPublicationOperations.id, input.operationId))
      .limit(1)
      .for("update");
    if (!parent) return false;
    const [child] = await tx
      .select()
      .from(eventSeriesPublicationChildren)
      .where(eq(eventSeriesPublicationChildren.id, input.childId))
      .limit(1)
      .for("update");
    if (!child || child.operationId !== parent.id) return false;
    if (child.status === "converged") return true;
    const snapshot = snapshotFromUnknown(parent.authoritySnapshot);
    const occurrence = snapshot.occurrences.find(
      (candidate) => candidate.dateKey === child.dateKey,
    );
    if (!occurrence || !occurrenceMatchesChild(occurrence, child)) {
      throw new EventSeriesPublicationError(
        409,
        "event_series_publication_child_digest_mismatch",
        "A publication child no longer matches its frozen scope.",
        { childId: child.id },
      );
    }
    const eventId = child.expectedEventId;
    await tx
      .insert(events)
      .values({
        id: eventId,
        hostId: occurrence.hostId,
        coordinatorUserId: occurrence.coordinatorUserId,
        seriesId: occurrence.seriesId,
        publicationOperationId: parent.id,
        publicationDateKey: occurrence.dateKey,
        publicationPayloadDigest: child.payloadDigest,
        name: occurrence.name,
        description: occurrence.description,
        date: utcDateFromDateKey(occurrence.dateKey),
        startTime: occurrence.startTime,
        endTime: occurrence.endTime,
        maxTrucks: occurrence.maxTrucks,
        hardCapEnabled: occurrence.hardCapEnabled,
        eventType: occurrence.eventType,
        requiresPayment: occurrence.requiresPayment,
        status: "draft",
      })
      .onConflictDoNothing({ target: events.id });
    const [storedEvent] = await tx
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1)
      .for("update");
    if (
      !storedEvent ||
      !storedEventMatchesChild(storedEvent, child) ||
      storedEvent.status !== "draft"
    ) {
      throw new EventSeriesPublicationError(
        409,
        "event_series_publication_occurrence_mismatch",
        "A stored occurrence does not match the frozen publication child.",
        { childId: child.id, eventId },
      );
    }
    await tx
      .update(eventSeriesPublicationChildren)
      .set({
        eventId,
        status: "converged",
        attemptCount: sql`${eventSeriesPublicationChildren.attemptCount} + 1` as any,
        failureCode: null,
        failureMessage: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(eventSeriesPublicationChildren.id, child.id));
    return true;
  });
}

async function finalizeEventSeriesPublication(operationId: string) {
  return db.transaction(async (tx: any) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`event_series_publication_finalize:${operationId}`}))`,
    );
    const [parent] = await tx
      .select()
      .from(eventSeriesPublicationOperations)
      .where(eq(eventSeriesPublicationOperations.id, operationId))
      .limit(1)
      .for("update");
    if (!parent) {
      throw new EventSeriesPublicationError(
        404,
        "event_series_publication_not_found",
        "Publication operation not found.",
      );
    }
    if (parent.status === "converged") return parent;
    const [series] = await tx
      .select()
      .from(eventSeries)
      .where(eq(eventSeries.id, parent.seriesId))
      .limit(1)
      .for("update");
    if (
      !series ||
      clean(series.activePublicationOperationId) !== parent.id ||
      Number(series.participationVersion || 0) !==
        Number(parent.expectedParticipationVersion || 0)
    ) {
      throw new EventSeriesPublicationError(
        409,
        "event_series_publication_barrier_mismatch",
        "The series no longer matches the frozen publication barrier.",
      );
    }
    const children = await tx
      .select()
      .from(eventSeriesPublicationChildren)
      .where(eq(eventSeriesPublicationChildren.operationId, parent.id))
      .orderBy(asc(eventSeriesPublicationChildren.dateKey))
      .for("update");
    if (
      children.length !== Number(parent.expectedChildCount) ||
      children.some(
        (child: any) =>
          child.status !== "converged" ||
          !child.eventId ||
          child.eventId !== child.expectedEventId,
      )
    ) {
      return null;
    }
    const snapshot = snapshotFromUnknown(parent.authoritySnapshot);
    const frozenDateKeys = snapshot.occurrences.map(
      (occurrence) => occurrence.dateKey,
    );
    const storedTargetDateKeys = Array.isArray(parent.targetDateKeys)
      ? parent.targetDateKeys.map(clean)
      : [];
    if (
      snapshot.occurrences.length !== children.length ||
      stableJson(frozenDateKeys) !== stableJson(storedTargetDateKeys) ||
      digest(children.map(publicationChildFactFromRow)) !==
        parent.targetSetDigest ||
      children.some((child: any, index: number) =>
        !occurrenceMatchesChild(snapshot.occurrences[index], child),
      )
    ) {
      throw new EventSeriesPublicationError(
        409,
        "event_series_publication_child_digest_mismatch",
        "The complete stored occurrence set no longer matches its frozen scope.",
      );
    }
    const eventIds = children.map((child: any) => clean(child.expectedEventId));
    const occurrenceRows = await tx
      .select()
      .from(events)
      .where(inArray(events.id, eventIds))
      .orderBy(asc(events.publicationDateKey))
      .for("update");
    const occurrenceById = new Map<string, any>(
      occurrenceRows.map((event: any) => [clean(event.id), event]),
    );
    if (
      occurrenceRows.length !== children.length ||
      children.some((child: any) => {
        const occurrence = occurrenceById.get(clean(child.expectedEventId));
        return (
          !occurrence ||
          occurrence.publicationOperationId !== parent.id ||
          occurrence.status !== "draft" ||
          !storedEventMatchesChild(occurrence, child)
        );
      })
    ) {
      throw new EventSeriesPublicationError(
        409,
        "event_series_publication_occurrences_incomplete",
        "The exact private occurrence set has not converged.",
      );
    }
    const now = new Date();
    await tx
      .update(eventSeriesPublicationOperations)
      .set({ status: "finalizing", updatedAt: now })
      .where(eq(eventSeriesPublicationOperations.id, parent.id));
    await tx.execute(
      sql`SELECT set_config('mealscout.event_series_publication_operation_id', ${parent.id}, true)`,
    );
    const publishedRows = await tx
      .update(events)
      .set({ status: "open", updatedAt: now })
      .where(inArray(events.id, eventIds))
      .returning({ id: events.id });
    const publishedIds = new Set(
      publishedRows.map((row: { id: string }) => clean(row.id)),
    );
    if (
      publishedIds.size !== eventIds.length ||
      eventIds.some((eventId: string) => !publishedIds.has(eventId))
    ) {
      throw new EventSeriesPublicationError(
        409,
        "event_series_publication_occurrences_incomplete",
        "The exact private occurrence set did not publish atomically.",
      );
    }
    await tx
      .update(eventSeries)
      .set({
        status: "published",
        publishedAt: now,
        activePublicationOperationId: null,
        publicationSuppressedAt: null,
        updatedAt: now,
      })
      .where(eq(eventSeries.id, parent.seriesId));
    const [completed] = await tx
      .update(eventSeriesPublicationOperations)
      .set({
        status: "converged",
        failureCode: null,
        failureMessage: null,
        recoveryRequestedAt: null,
        recoveryClaimedAt: null,
        recoveryClaimedBy: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(eventSeriesPublicationOperations.id, parent.id))
      .returning();
    return completed;
  });
}

export async function resumeEventSeriesPublication(input: {
  operationId: string;
  failAfterChildCount?: number;
}) {
  const operationId = clean(input.operationId);
  if (!operationId) {
    throw new EventSeriesPublicationError(
      400,
      "event_series_publication_identity_required",
      "Publication operation identity is required.",
    );
  }
  const [parent] = await db
    .select()
    .from(eventSeriesPublicationOperations)
    .where(eq(eventSeriesPublicationOperations.id, operationId))
    .limit(1);
  if (!parent) {
    throw new EventSeriesPublicationError(
      404,
      "event_series_publication_not_found",
      "Publication operation not found.",
    );
  }
  if (parent.status === "converged") {
    return serializeEventSeriesPublication(operationId);
  }
  await db
    .update(eventSeriesPublicationOperations)
    .set({
      status: "processing",
      attemptCount: sql`${eventSeriesPublicationOperations.attemptCount} + 1` as any,
      failureCode: null,
      failureMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(eventSeriesPublicationOperations.id, operationId));
  const children = await db
    .select()
    .from(eventSeriesPublicationChildren)
    .where(eq(eventSeriesPublicationChildren.operationId, operationId))
    .orderBy(asc(eventSeriesPublicationChildren.dateKey));
  let processed = 0;
  for (const child of children) {
    await convergePublicationChild({ operationId, childId: child.id });
    processed += 1;
    if (
      input.failAfterChildCount !== undefined &&
      processed >= input.failAfterChildCount
    ) {
      await db
        .update(eventSeriesPublicationOperations)
        .set({
          status: "action_required",
          failureCode: "injected_publication_interruption",
          failureMessage: "Injected interruption after a durable private child.",
          recoveryRequestedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(eventSeriesPublicationOperations.id, operationId));
      throw new EventSeriesPublicationError(
        503,
        "event_series_publication_interrupted",
        "Publication remains private and can be resumed safely.",
        { operationId, processed },
      );
    }
  }
  await finalizeEventSeriesPublication(operationId);
  return serializeEventSeriesPublication(operationId);
}

export async function publishEventSeriesDurably(input: {
  seriesId: string;
  actorUserId: string;
  requestId: string;
  now?: Date;
  failAfterChildCount?: number;
}) {
  const prepared = await prepareEventSeriesPublication(input);
  return resumeEventSeriesPublication({
    operationId: prepared.operationId,
    failAfterChildCount: input.failAfterChildCount,
  });
}

export async function serializeEventSeriesPublication(operationId: string) {
  const [operation] = await db
    .select()
    .from(eventSeriesPublicationOperations)
    .where(eq(eventSeriesPublicationOperations.id, clean(operationId)))
    .limit(1);
  if (!operation) return null;
  const children = await db
    .select()
    .from(eventSeriesPublicationChildren)
    .where(eq(eventSeriesPublicationChildren.operationId, operation.id))
    .orderBy(asc(eventSeriesPublicationChildren.dateKey));
  const [series] = await db
    .select()
    .from(eventSeries)
    .where(eq(eventSeries.id, operation.seriesId))
    .limit(1);
  return {
    operation,
    children,
    series: series || null,
    occurrencesGenerated: children.length,
  };
}

export async function reconcileEventSeriesPublications(input?: {
  limit?: number;
  workerId?: string;
}) {
  const limit = Math.max(1, Math.min(50, Math.trunc(input?.limit || 10)));
  const workerId = clean(input?.workerId) || `series-publication-${randomUUID()}`;
  const claimed: any = await db.transaction(async (tx: any) =>
    tx.execute(sql`
      WITH candidates AS (
        SELECT operation.id
          FROM event_series_publication_operations operation
         WHERE operation.status IN ('prepared', 'processing', 'action_required')
           AND (
             operation.recovery_claimed_at IS NULL
             OR operation.recovery_claimed_at < now() - interval '5 minutes'
           )
           AND (
             operation.recovery_requested_at IS NOT NULL
             OR operation.updated_at <= now() - interval '15 seconds'
           )
         ORDER BY operation.recovery_requested_at NULLS LAST,
                  operation.updated_at,
                  operation.id
         FOR UPDATE SKIP LOCKED
         LIMIT ${limit}
      )
      UPDATE event_series_publication_operations operation
         SET recovery_claimed_at = now(),
             recovery_claimed_by = ${workerId},
             attempt_count = operation.attempt_count + 1,
             updated_at = now()
        FROM candidates
       WHERE operation.id = candidates.id
       RETURNING operation.id
    `),
  );
  const ids = ((claimed as any)?.rows || [])
    .map((row: any) => clean(row.id))
    .filter(Boolean);
  let converged = 0;
  let pending = 0;
  let failed = 0;
  for (const operationId of ids) {
    try {
      const result = await resumeEventSeriesPublication({ operationId });
      if (result?.operation.status === "converged") converged += 1;
      else pending += 1;
    } catch (error: any) {
      failed += 1;
      await db
        .update(eventSeriesPublicationOperations)
        .set({
          status: "action_required",
          failureCode:
            clean(error?.code) || "event_series_publication_recovery_failed",
          failureMessage:
            clean(error?.message) || "Publication recovery did not converge.",
          recoveryRequestedAt: null,
          recoveryClaimedAt: null,
          recoveryClaimedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(eventSeriesPublicationOperations.id, operationId));
      continue;
    }
    await db
      .update(eventSeriesPublicationOperations)
      .set({
        recoveryRequestedAt: null,
        recoveryClaimedAt: null,
        recoveryClaimedBy: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(eventSeriesPublicationOperations.id, operationId),
          eq(eventSeriesPublicationOperations.recoveryClaimedBy, workerId),
        ),
      );
  }
  return { examined: ids.length, converged, pending, failed, workerId };
}
