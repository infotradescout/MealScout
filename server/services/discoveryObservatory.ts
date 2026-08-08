import crypto from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";

import { requestLogs } from "@shared/schema";
import {
  DISCOVERY_PLATFORM,
  MEALSCOUT_EXPERIMENT_IDS,
  emptyMealScoutFreshnessEvidence,
  normalizeDiscoveryRecord,
  type DiscoveryEntity,
  type DiscoveryEvidenceRecord,
  type DiscoveryLinkStrength,
  type MealScoutFreshnessEvidence,
  type SourceFreshness,
} from "@shared/discoveryObservatory";

import { db } from "../db";

export const DISCOVERY_OBSERVATORY_SURFACE = "discovery_observatory";
export const DISCOVERY_CONTRACT_VERSION = 1;

type DbLike = {
  insert: (table: unknown) => {
    values: (value: unknown) => any;
  };
  select?: (...args: any[]) => any;
  getObservatoryRowById?: (id: string) => Promise<any | null>;
  insertObservatoryRowOnce?: (value: any) => Promise<boolean | void>;
  listExperimentDecisionRows?: (experimentId: string) => Promise<any[]>;
};

const knownSources: Array<[RegExp, string]> = [
  [/chatgpt\.com|openai\.com|oai-searchbot/i, "chatgpt"],
  [/google\./i, "google"],
  [/bing\.com/i, "bing"],
  [/maps\.google\./i, "google_maps"],
  [/facebook\.com|fb\.com/i, "facebook"],
  [/instagram\.com/i, "instagram"],
];

const safeText = (value: unknown, max = 300) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
};

function sourceFromValue(value: unknown): string | null {
  const text = safeText(value, 300);
  if (!text) return null;
  for (const [pattern, source] of knownSources) {
    if (pattern.test(text)) return source;
  }
  return null;
}

export function deriveDiscoverySource(req: any): string {
  const explicit = sourceFromValue(req?.query?.utm_source);
  if (explicit) return explicit;
  return sourceFromValue(req?.get?.("referer")) || "unknown";
}

export function deriveDiscoverySearchSurface(req: any): string | null {
  const medium = safeText(req?.query?.utm_medium, 80);
  if (medium) return medium;
  const referrer = safeText(req?.get?.("referer"), 500);
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function deriveEntryPage(req: any): string | null {
  const referrer = safeText(req?.get?.("referer"), 500);
  if (!referrer) return null;
  try {
    const parsed = new URL(referrer);
    // Long-lived observatory rows retain only the public path, never query tokens.
    return parsed.pathname.slice(0, 500);
  } catch {
    return null;
  }
}

export function deriveAnonymousJourneyId(req: any): string {
  const existingBasis =
    safeText(req?.sessionID, 300) ||
    safeText(req?.headers?.["x-request-id"], 300) ||
    safeText(req?.requestId, 300) ||
    `unlinked:${crypto.randomUUID()}`;
  return `msd_${crypto
    .createHash("sha256")
    .update(existingBasis)
    .digest("hex")
    .slice(0, 24)}`;
}

export function buildRequestSourceFreshness(req: any): SourceFreshness {
  const hasDirectSource = deriveDiscoverySource(req) !== "unknown";
  return {
    state: hasDirectSource ? "current" : "unknown",
    checkedAt: new Date().toISOString(),
    checkedAtPrecision: "instant",
    basis: hasDirectSource
      ? "Source was present in the request referral or explicit campaign source."
      : "No trustworthy external source was present on the request.",
  };
}

export function buildRequestDiscoveryContext(req: any): {
  anonymousJourneyId: string;
  discoverySource: string;
  searchSurface: string | null;
  entryPage: string | null;
  sourceFreshness: SourceFreshness;
} {
  return {
    anonymousJourneyId: deriveAnonymousJourneyId(req),
    discoverySource: deriveDiscoverySource(req),
    searchSurface: deriveDiscoverySearchSurface(req),
    entryPage: deriveEntryPage(req),
    sourceFreshness: buildRequestSourceFreshness(req),
  };
}

export function buildProfileAnalyticsDiscoveryMetadata(input: {
  req: any;
  actionType: string;
  entity: DiscoveryEntity;
  displayedPage: string;
  freshness?: MealScoutFreshnessEvidence;
}) {
  const context = buildRequestDiscoveryContext(input.req);
  const isEntry = input.actionType === "profile_view";
  return {
    discoveryContractVersion: DISCOVERY_CONTRACT_VERSION,
    platform: DISCOVERY_PLATFORM,
    discoveryStage: isEntry ? "entry" : "action",
    discoverySource: context.discoverySource,
    searchSurface: context.searchSurface,
    query: null,
    queryEvidenceState: "unknown",
    locationContext: null,
    deviceContext: null,
    observationPrecision: "instant",
    displayedPage: input.displayedPage,
    entryPage: isEntry ? input.displayedPage : context.entryPage,
    publicEntity: input.entity,
    anonymousJourneyId: context.anonymousJourneyId,
    intendedAction: isEntry ? null : input.actionType,
    completedAction: isEntry ? null : input.actionType,
    merchantReceiptStatus: null,
    merchantReceiptEvidenceRef: null,
    merchantReceiptVerifiedAt: null,
    finalOutcome: null,
    experimentId: null,
    experimentAssignedAt: null,
    experimentDecision: null,
    experimentVariant: null,
    controlledChangeKey: null,
    linkStrength: "client_correlated_unverified" satisfies DiscoveryLinkStrength,
    sourceFreshness: context.sourceFreshness,
    freshness: input.freshness || emptyMealScoutFreshnessEvidence(),
    competitors: [] as string[],
    outsideSources: [] as string[],
    resultCount: null,
    evidenceBoundary: isEntry
      ? "The client reported a real profile landing. Search query, location, device, and external causation remain unknown."
      : "The client reported a deliberate profile action. Merchant receipt and final outcome require separate server evidence.",
  };
}

function deterministicObservatoryId(kind: string, ...parts: string[]) {
  return `msobs_${kind}_${crypto
    .createHash("sha256")
    .update(parts.join("\u001f"))
    .digest("hex")
    .slice(0, 32)}`;
}

export const experimentDecisionRecordId = (
  experimentId: string,
  idempotencyKey: string,
) => deterministicObservatoryId("decision", experimentId, idempotencyKey);

export const experimentAssignmentRecordId = (
  experimentId: string,
  anonymousJourneyId: string,
) => deterministicObservatoryId("assignment", experimentId, anonymousJourneyId);

export function externalObservationRecordId(record: DiscoveryEvidenceRecord) {
  if (record.stage !== "observation") {
    throw new Error("Only observation evidence can use an observation fingerprint.");
  }
  const { id: _discardedId, ...content } = record;
  return deterministicObservatoryId(
    "observation",
    JSON.stringify({
      ...content,
      competitors: [...content.competitors].sort(),
      outsideSources: [...content.outsideSources].sort(),
    }),
  );
}

function discoveryPersistenceRow(record: DiscoveryEvidenceRecord) {
  const path =
    record.entryPage || record.displayedPage || "/admin/discovery-observatory";
  return {
    id: record.id,
    method: "EVENT",
    path,
    statusCode: 202,
    durationMs: 0,
    userId: null,
    sessionId: null,
    anonymousActorId: record.anonymousJourneyId,
    actorType: "internal",
    sourceType: record.discoverySource,
    eventType: `discovery_${record.stage}`,
    surface: DISCOVERY_OBSERVATORY_SURFACE,
    entityId: record.publicEntity.id,
    entityType: record.publicEntity.type,
    // Long-lived observatory evidence is deliberately stripped of request PII.
    ip: null,
    userAgent: null,
    metadata: {
      discoveryContractVersion: DISCOVERY_CONTRACT_VERSION,
      ...record,
    },
    // A day-precision observation has no honest timestamp. Its ingestion time is
    // used for retention while the metadata preserves only YYYY-MM-DD.
    createdAt:
      record.observationPrecision === "instant"
        ? new Date(record.observedAt)
        : new Date(),
  };
}

async function getObservatoryRowById(database: DbLike, id: string) {
  if (database.getObservatoryRowById) {
    return database.getObservatoryRowById(id);
  }
  if (!database.select) {
    throw new Error("Observatory evidence lookup is unavailable.");
  }
  const rows = await database
    .select()
    .from(requestLogs)
    .where(eq(requestLogs.id, id))
    .limit(1);
  return rows[0] || null;
}

export async function persistDiscoveryEvidenceOnce(
  input: DiscoveryEvidenceRecord,
  database: DbLike = db,
) {
  const record = normalizeDiscoveryRecord(input);
  await requirePredeclaredAssignment(record, database);
  const value = discoveryPersistenceRow(record);
  let inserted = false;
  if (database.insertObservatoryRowOnce) {
    inserted = (await database.insertObservatoryRowOnce(value)) === true;
  } else {
    const writer = database.insert(requestLogs).values(value);
    if (!writer?.onConflictDoNothing) {
      throw new Error("Atomic idempotent evidence persistence is unavailable.");
    }
    const insertedRows = await writer
      .onConflictDoNothing({ target: requestLogs.id })
      .returning({ id: requestLogs.id });
    inserted = insertedRows.length > 0;
  }
  const storedRow = await getObservatoryRowById(database, record.id);
  const stored = storedRow ? requestLogToDiscoveryEvidence(storedRow) : null;
  if (!stored || JSON.stringify(stored) !== JSON.stringify(record)) {
    throw new Error("Evidence fingerprint conflicts with an existing record.");
  }
  return { record: stored, inserted };
}

async function getLatestExperimentDecision(
  database: DbLike,
  experimentId: string,
) {
  const rows = database.listExperimentDecisionRows
    ? await database.listExperimentDecisionRows(experimentId)
    : database.select
      ? await database
          .select()
          .from(requestLogs)
          .where(
            and(
              eq(requestLogs.surface, DISCOVERY_OBSERVATORY_SURFACE),
              eq(requestLogs.eventType, "discovery_experiment"),
              sql`${requestLogs.metadata}->>'intendedAction' = 'experiment_decision'`,
              sql`${requestLogs.metadata}->>'experimentId' = ${experimentId}`,
            ),
          )
          .orderBy(desc(requestLogs.createdAt), desc(requestLogs.id))
          .limit(50)
      : (() => {
          throw new Error("Experiment-decision lookup is unavailable.");
        })();
  const decisions = (rows as any[])
    .map((row: any) => requestLogToDiscoveryEvidence(row))
    .filter(
      (record: DiscoveryEvidenceRecord | null): record is DiscoveryEvidenceRecord =>
        Boolean(
          record &&
            record.stage === "experiment" &&
            record.intendedAction === "experiment_decision" &&
            record.experimentId === experimentId,
        ),
    )
    .sort(
      (a: DiscoveryEvidenceRecord, b: DiscoveryEvidenceRecord) =>
        new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime() ||
        b.id.localeCompare(a.id),
    );
  return decisions[0] || null;
}

async function requirePredeclaredAssignment(
  record: DiscoveryEvidenceRecord,
  database: DbLike,
) {
  if (!record.experimentId || record.stage === "experiment") return;
  if (!record.anonymousJourneyId) {
    throw new Error("Experiment-attributed evidence requires a journey ID.");
  }
  const assignmentId = experimentAssignmentRecordId(
    record.experimentId,
    record.anonymousJourneyId,
  );
  const row = await getObservatoryRowById(database, assignmentId);
  const assignment = row ? requestLogToDiscoveryEvidence(row) : null;
  if (
    !assignment ||
    assignment.stage !== "experiment" ||
    assignment.intendedAction !== "experiment_assignment" ||
    assignment.experimentId !== record.experimentId ||
    assignment.anonymousJourneyId !== record.anonymousJourneyId ||
    assignment.experimentDecision !== "approved" ||
    !assignment.experimentVariant ||
    !assignment.controlledChangeKey ||
    !assignment.experimentAssignedAt
  ) {
    throw new Error("Experiment assignment must exist before attributed evidence.");
  }
  if (
    new Date(assignment.experimentAssignedAt).getTime() >
    new Date(record.observedAt).getTime()
  ) {
    throw new Error("Experiment assignment must precede attributed evidence.");
  }
}

export async function persistDiscoveryEvidence(
  input: DiscoveryEvidenceRecord,
  database: DbLike = db,
) {
  const record = normalizeDiscoveryRecord(input);
  await requirePredeclaredAssignment(record, database);
  await database.insert(requestLogs).values(discoveryPersistenceRow(record));
  return record;
}

function assertMealScoutExperimentId(experimentId: string) {
  if (!(MEALSCOUT_EXPERIMENT_IDS as readonly string[]).includes(experimentId)) {
    throw new Error("Unknown MealScout experiment.");
  }
}

function experimentControlRecord(input: {
  id: string;
  experimentId: string;
  observedAt: string;
  anonymousJourneyId: string | null;
  experimentAssignedAt: string | null;
  experimentDecision: "hold" | "approved" | "rejected";
  experimentVariant: string | null;
  controlledChangeKey: string | null;
  intendedAction: string;
  completedAction: string;
  evidenceBoundary: string;
}) {
  return normalizeDiscoveryRecord({
    id: input.id,
    platform: DISCOVERY_PLATFORM,
    stage: "experiment",
    discoverySource: "admin_observatory",
    searchSurface: "admin_discovery_observatory",
    query: null,
    queryEvidenceState: "unavailable",
    locationContext: null,
    deviceContext: null,
    observedAt: input.observedAt,
    observationPrecision: "instant",
    displayedPage: "/admin/discovery-observatory",
    entryPage: null,
    publicEntity: { type: "unknown", id: null, name: null },
    anonymousJourneyId: input.anonymousJourneyId,
    intendedAction: input.intendedAction,
    completedAction: input.completedAction,
    merchantReceiptStatus: null,
    merchantReceiptEvidenceRef: null,
    merchantReceiptVerifiedAt: null,
    finalOutcome: null,
    experimentId: input.experimentId,
    experimentAssignedAt: input.experimentAssignedAt,
    experimentDecision: input.experimentDecision,
    experimentVariant: input.experimentVariant,
    controlledChangeKey: input.controlledChangeKey,
    linkStrength: "direct_server_observed",
    sourceFreshness: {
      state: "current",
      checkedAt: input.observedAt,
      checkedAtPrecision: "instant",
      basis: "The administrator-only observatory directly recorded this control state.",
    },
    freshness: emptyMealScoutFreshnessEvidence(),
    competitors: [] as string[],
    outsideSources: [] as string[],
    resultCount: null,
    evidenceBoundary: input.evidenceBoundary,
  });
}

export async function persistExperimentDecision(input: {
  experimentId: string;
  decision: "hold" | "approved" | "rejected";
  idempotencyKey: string;
  rationale: string;
  database?: DbLike;
  now?: Date;
}) {
  assertMealScoutExperimentId(input.experimentId);
  const database = input.database || db;
  const observedAt = (input.now || new Date()).toISOString();
  const rationale = safeText(input.rationale, 300);
  const idempotencyKey = safeText(input.idempotencyKey, 120);
  if (!rationale) throw new Error("An owner decision rationale is required.");
  if (!idempotencyKey) throw new Error("A decision idempotency key is required.");
  const record = experimentControlRecord({
    id: experimentDecisionRecordId(input.experimentId, idempotencyKey),
    experimentId: input.experimentId,
    observedAt,
    anonymousJourneyId: null,
    experimentAssignedAt: null,
    experimentDecision: input.decision,
    experimentVariant: null,
    controlledChangeKey: null,
    intendedAction: "experiment_decision",
    completedAction: input.decision,
    evidenceBoundary: `${rationale} This records review state only; automatic publication and public rollout remain false.`,
  });
  const value = discoveryPersistenceRow(record);
  if (database.insertObservatoryRowOnce) {
    await database.insertObservatoryRowOnce(value);
  } else {
    const writer = database.insert(requestLogs).values(value);
    if (!writer?.onConflictDoNothing) {
      throw new Error("Atomic append-only decision persistence is unavailable.");
    }
    await writer.onConflictDoNothing({ target: requestLogs.id });
  }
  const storedRow = await getObservatoryRowById(database, record.id);
  const stored = storedRow ? requestLogToDiscoveryEvidence(storedRow) : null;
  if (
    !stored ||
    stored.experimentDecision !== input.decision ||
    stored.evidenceBoundary !== record.evidenceBoundary
  ) {
    throw new Error("Decision idempotency key conflicts with existing evidence.");
  }
  return stored;
}

export async function assignDiscoveryExperiment(input: {
  experimentId: string;
  anonymousJourneyId: string;
  variant: "control" | "treatment";
  controlledChangeKey: string;
  database?: DbLike;
  now?: Date;
}) {
  assertMealScoutExperimentId(input.experimentId);
  const database = input.database || db;
  const decision = await getLatestExperimentDecision(database, input.experimentId);
  if (decision?.experimentDecision !== "approved") {
    throw new Error("Experiment is HOLD until an administrator records approval.");
  }
  const journeyId = safeText(input.anonymousJourneyId, 120);
  const controlledChangeKey = safeText(input.controlledChangeKey, 120);
  if (!journeyId || !controlledChangeKey) {
    throw new Error("Assignment requires a journey ID and one controlled-change key.");
  }
  const assignedAt = (input.now || new Date()).toISOString();
  if (new Date(decision.observedAt).getTime() > new Date(assignedAt).getTime()) {
    throw new Error("Experiment approval must precede assignment.");
  }
  const record = experimentControlRecord({
    id: experimentAssignmentRecordId(input.experimentId, journeyId),
    experimentId: input.experimentId,
    observedAt: assignedAt,
    anonymousJourneyId: journeyId,
    experimentAssignedAt: assignedAt,
    experimentDecision: "approved",
    experimentVariant: input.variant,
    controlledChangeKey,
    intendedAction: "experiment_assignment",
    completedAction: "assigned",
    evidenceBoundary:
      "This idempotent assignment predeclares one controlled change for one anonymous journey. It does not publish or apply the change by itself.",
  });
  const value = discoveryPersistenceRow(record);
  if (database.insertObservatoryRowOnce) {
    await database.insertObservatoryRowOnce(value);
  } else {
    const writer = database.insert(requestLogs).values(value);
    if (!writer?.onConflictDoNothing) {
      throw new Error("Atomic experiment-assignment persistence is unavailable.");
    }
    await writer.onConflictDoNothing({ target: requestLogs.id });
  }
  const storedRow = await getObservatoryRowById(database, record.id);
  const stored = storedRow ? requestLogToDiscoveryEvidence(storedRow) : null;
  if (
    !stored ||
    stored.experimentVariant !== input.variant ||
    stored.controlledChangeKey !== controlledChangeKey
  ) {
    throw new Error(
      "A conflicting assignment already exists for this experiment journey.",
    );
  }
  return stored;
}

export async function recordFollowJourneyOutcome(input: {
  req: any;
  restaurantId: string;
  restaurantName: string;
  entityType: "truck" | "restaurant";
  alreadyExists?: boolean;
  actionObservedAt?: string;
  durableFollowId?: string | null;
  durableFollowVerifiedAt?: string | null;
  database?: DbLike;
}) {
  const context = buildRequestDiscoveryContext(input.req);
  const requestedActionAt = input.actionObservedAt
    ? new Date(input.actionObservedAt)
    : new Date();
  const actionAt = Number.isNaN(requestedActionAt.getTime())
    ? new Date()
    : requestedActionAt;
  const requestedReceiptAt = input.durableFollowVerifiedAt
    ? new Date(input.durableFollowVerifiedAt)
    : null;
  const outcomeAt = new Date(
    Math.max(
      actionAt.getTime() + 1,
      requestedReceiptAt && !Number.isNaN(requestedReceiptAt.getTime())
        ? requestedReceiptAt.getTime()
        : 0,
    ),
  );
  const entity: DiscoveryEntity = {
    type: input.entityType,
    id: input.restaurantId,
    name: input.restaurantName,
  };
  const common = {
    platform: DISCOVERY_PLATFORM,
    discoverySource: context.discoverySource,
    searchSurface: context.searchSurface,
    query: null,
    queryEvidenceState: "unknown",
    locationContext: null,
    deviceContext: null,
    observationPrecision: "instant",
    displayedPage: context.entryPage,
    entryPage: context.entryPage,
    publicEntity: entity,
    anonymousJourneyId: context.anonymousJourneyId,
    intendedAction: "follow",
    experimentId: null,
    experimentAssignedAt: null,
    experimentDecision: null,
    experimentVariant: null,
    controlledChangeKey: null,
    sourceFreshness: context.sourceFreshness,
    freshness: emptyMealScoutFreshnessEvidence(),
    competitors: [] as string[],
    outsideSources: [] as string[],
    resultCount: null,
  } as const;

  const action = normalizeDiscoveryRecord({
    ...common,
    id: crypto.randomUUID(),
    stage: "action",
    observedAt: actionAt.toISOString(),
    completedAction: "follow",
    merchantReceiptStatus: null,
    merchantReceiptEvidenceRef: null,
    merchantReceiptVerifiedAt: null,
    finalOutcome: null,
    linkStrength: "direct_server_observed",
    evidenceBoundary:
      "The authenticated follow attempt completed on the server. Merchant receipt and final outcome are recorded separately.",
  });
  const outcome = normalizeDiscoveryRecord({
    ...common,
    id: crypto.randomUUID(),
    stage: "outcome",
    observedAt: outcomeAt.toISOString(),
    completedAction: "follow",
    merchantReceiptStatus: input.durableFollowId ? "received" : "unknown",
    merchantReceiptEvidenceRef: input.durableFollowId
      ? `restaurant_follows:${input.durableFollowId}`
      : null,
    merchantReceiptVerifiedAt: input.durableFollowId
      ? input.durableFollowVerifiedAt || outcomeAt.toISOString()
      : null,
    finalOutcome: input.durableFollowId ? "completed" : "unknown",
    linkStrength: input.durableFollowId
      ? "direct_server_observed"
      : "unknown_unavailable",
    evidenceBoundary: input.durableFollowId
      ? input.alreadyExists
        ? "The canonical restaurant_follows relationship was separately read by restaurant and user IDs after the duplicate attempt. The same table drives restaurant-targeted follower audiences and follow counts; this proves durable product state, not notification or human awareness."
        : "The canonical restaurant_follows relationship was separately read by restaurant and user IDs after the write. The same table drives restaurant-targeted follower audiences and follow counts; this proves durable product state, not notification or human awareness."
      : "The server observed a follow attempt, but no separate canonical relationship read succeeded. Merchant receipt and completed outcome remain unknown.",
  });

  await persistDiscoveryEvidence(action, input.database || db);
  await persistDiscoveryEvidence(outcome, input.database || db);
  return { action, outcome };
}

export async function recordInternalSearchOutcome(input: {
  req: any;
  query: string;
  resultCount: number;
  database?: DbLike;
}) {
  const context = buildRequestDiscoveryContext(input.req);
  const record = normalizeDiscoveryRecord({
    id: crypto.randomUUID(),
    platform: DISCOVERY_PLATFORM,
    stage: "action",
    discoverySource: "internal_search",
    searchSurface: "scout_search",
    query: input.query,
    queryEvidenceState: "known",
    locationContext: null,
    deviceContext: null,
    observedAt: new Date().toISOString(),
    observationPrecision: "instant",
    displayedPage: null,
    entryPage: context.entryPage,
    publicEntity: { type: "unknown", id: null, name: null },
    anonymousJourneyId: context.anonymousJourneyId,
    intendedAction: "internal_search",
    completedAction: "internal_search",
    merchantReceiptStatus: null,
    merchantReceiptEvidenceRef: null,
    merchantReceiptVerifiedAt: null,
    finalOutcome: "unknown",
    experimentId: null,
    experimentAssignedAt: null,
    experimentDecision: null,
    experimentVariant: null,
    controlledChangeKey: null,
    linkStrength: "direct_server_observed",
    sourceFreshness: {
      state: "current",
      checkedAt: new Date().toISOString(),
      checkedAtPrecision: "instant",
      basis: "Result count was computed by MealScout for this request.",
    },
    freshness: emptyMealScoutFreshnessEvidence(),
    competitors: [],
    outsideSources: [],
    resultCount: input.resultCount,
    evidenceBoundary:
      "The server observed the internal query and result count. External ranking, external citation, and later conversion remain unknown.",
  });
  await persistDiscoveryEvidence(record, input.database || db);
  return record;
}

export function requestLogToDiscoveryEvidence(row: any): DiscoveryEvidenceRecord | null {
  const metadata = row?.metadata;
  if (!metadata || typeof metadata !== "object") return null;
  let stage = safeText(metadata.stage || metadata.discoveryStage, 40);
  if (!stage && row.surface === "public_profile") {
    stage = row.eventType === "profile_view" ? "entry" : "action";
  }
  if (!stage && row.surface === "public_discovery") {
    stage =
      metadata.discoveryEventType === "discovery_page_view" ? "entry" : "action";
  }
  if (!stage) return null;
  const isLegacyAdapter = !metadata.stage && !metadata.discoveryStage;
  try {
    return normalizeDiscoveryRecord({
      ...metadata,
      id: safeText(metadata.id || row.id, 120) || String(row.id),
      stage: stage as DiscoveryEvidenceRecord["stage"],
      observedAt:
        safeText(metadata.observedAt || metadata.timestamp, 80) ||
        new Date(row.createdAt).toISOString(),
      publicEntity:
        metadata.publicEntity || {
          type: row.entityType || "unknown",
          id: row.entityId || null,
          name: null,
        },
      anonymousJourneyId:
        metadata.anonymousJourneyId || row.anonymousActorId || row.sessionId || null,
      sourceFreshness:
        metadata.sourceFreshness || {
          state: "unknown",
          checkedAt: null,
          checkedAtPrecision: null,
          basis: "Legacy discovery event did not record source freshness.",
        },
      discoverySource:
        metadata.discoverySource || metadata.source || row.sourceType || "unknown",
      searchSurface:
        metadata.searchSurface || metadata.sourcePageType || row.surface || null,
      query: metadata.query ?? null,
      queryEvidenceState:
        metadata.queryEvidenceState ||
        (safeText(metadata.query, 200) ? "known" : "unknown"),
      observationResult:
        stage === "observation"
          ? metadata.observationResult || "unknown"
          : null,
      displayedPage:
        metadata.displayedPage || metadata.targetPath || metadata.sourcePath || row.path,
      entryPage:
        metadata.entryPage ||
        (stage === "entry"
          ? metadata.targetPath || metadata.sourcePath || row.path
          : null),
      intendedAction:
        metadata.intendedAction ||
        (stage === "action"
          ? metadata.actionType || metadata.discoveryEventType || row.eventType
          : null),
      completedAction:
        metadata.completedAction ||
        (stage === "action"
          ? metadata.actionType || metadata.discoveryEventType || row.eventType
          : null),
      linkStrength:
        metadata.linkStrength ||
        (isLegacyAdapter
          ? "client_correlated_unverified"
          : "unknown_unavailable"),
      evidenceBoundary:
        metadata.evidenceBoundary ||
        "Adapted from the existing MealScout analytics spine. Entry or action is observed, but external causation and final outcome remain unknown.",
    });
  } catch {
    return null;
  }
}
