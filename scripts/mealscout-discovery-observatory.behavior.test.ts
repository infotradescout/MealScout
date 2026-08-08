import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildDiscoveryFunnel,
  buildLivingDiscoveryQueries,
  buildMealScoutFreshnessCoverage,
  emptyMealScoutFreshnessEvidence,
  findFreshnessFailures,
  normalizeDiscoveryRecord,
  rankMealScoutExperiments,
  validateDiscoveryEvidence,
  type ActiveSupplySnapshot,
  type DiscoveryEvidenceRecord,
} from "../shared/discoveryObservatory";

process.env.NODE_ENV = "development";

const service = await import("../server/services/discoveryObservatory");

const at = (minute: number) => `2026-08-08T12:${String(minute).padStart(2, "0")}:00.000Z`;

function record(
  input: Partial<DiscoveryEvidenceRecord> &
    Pick<DiscoveryEvidenceRecord, "id" | "stage" | "observedAt">,
) {
  return normalizeDiscoveryRecord({
    discoverySource: "google",
    searchSurface: "web_search",
    query: null,
    queryEvidenceState: "unknown",
    locationContext: null,
    deviceContext: null,
    observationPrecision: "instant",
    displayedPage: "/truck/example--truck-1",
    entryPage: "/truck/example--truck-1",
    publicEntity: { type: "truck", id: "truck-1", name: "Example Truck" },
    anonymousJourneyId: "journey-1",
    intendedAction: null,
    completedAction: null,
    merchantReceiptStatus: null,
    merchantReceiptEvidenceRef: null,
    merchantReceiptVerifiedAt: null,
    finalOutcome: null,
    experimentId: null,
    experimentAssignedAt: null,
    experimentDecision: null,
    experimentVariant: null,
    controlledChangeKey: null,
    linkStrength: "direct_server_observed",
    sourceFreshness: {
      state: "current",
      checkedAt: input.observedAt,
      checkedAtPrecision: "instant",
      basis: "Test evidence is explicitly time-bound.",
    },
    freshness: emptyMealScoutFreshnessEvidence(),
    competitors: [],
    outsideSources: [],
    resultCount: null,
    evidenceBoundary: "Only directly recorded test evidence is known.",
    ...input,
  });
}

test("shared meanings keep outside observation separate from entry and outcome", () => {
  const observation = record({
    id: "observation-1",
    stage: "observation",
    observationResult: "observed",
    observedAt: at(0),
    query: "Example Truck menu",
    queryEvidenceState: "known",
    anonymousJourneyId: null,
    displayedPage: "https://www.mealscout.us/truck/example--truck-1?token=secret",
    linkStrength: "unknown_unavailable",
  });
  assert.equal(observation.observationResult, "observed");
  assert.equal(observation.query, "Example Truck menu");
  assert.equal(observation.displayedPage, "https://www.mealscout.us/truck/example--truck-1");
  assert.equal(observation.finalOutcome, null);

  assert.throws(
    () =>
      record({
        id: "entry-with-query",
        stage: "entry",
        observedAt: at(1),
        query: "must never survive on entry",
        queryEvidenceState: "known",
      }),
    /entry record cannot supply/i,
  );
  assert.throws(
    () =>
      record({
        id: "unsafe-observation-query",
        stage: "observation",
        observationResult: "observed",
        observedAt: at(1),
        query: "person@example.com",
        queryEvidenceState: "known",
      }),
    /safe, nonempty query/i,
  );
  assert.throws(
    () =>
      record({
        id: "unknown-with-query",
        stage: "observation",
        observationResult: "unknown",
        observedAt: at(1),
        query: "Example Truck",
        queryEvidenceState: "unknown",
      }),
    /must not include a query/i,
  );
  const entry = record({
    id: "entry-1",
    stage: "entry",
    observedAt: at(1),
    query: null,
    queryEvidenceState: "unknown",
  });
  assert.equal(entry.observationResult, null);
  assert.equal(entry.query, null);
  assert.equal(entry.finalOutcome, null);
});

test("identical and concurrent observation retries collapse by normalized fingerprint", async () => {
  const rows = new Map<string, any>();
  const memoryDb = {
    insert: () => ({ values: async () => undefined }),
    insertObservatoryRowOnce: async (value: any) => {
      if (rows.has(value.id)) return false;
      rows.set(value.id, value);
      return true;
    },
    getObservatoryRowById: async (id: string) => rows.get(id) || null,
  };
  const draft = record({
    id: "fingerprint-pending",
    stage: "observation",
    observationResult: "observed",
    observedAt: at(0),
    query: "Example Truck menu",
    queryEvidenceState: "known",
    anonymousJourneyId: null,
    locationContext: null,
    deviceContext: null,
  });
  const observation = normalizeDiscoveryRecord({
    ...draft,
    id: service.externalObservationRecordId(draft),
  });
  const [first, retry] = await Promise.all([
    service.persistDiscoveryEvidenceOnce(observation, memoryDb as any),
    service.persistDiscoveryEvidenceOnce(observation, memoryDb as any),
  ]);
  assert.deepEqual(
    [first.inserted, retry.inserted].sort(),
    [false, true],
  );
  assert.equal(rows.size, 1);

  const distinctDrafts = [
    normalizeDiscoveryRecord({
      ...draft,
      id: "different-time",
      observedAt: at(1),
    }),
    normalizeDiscoveryRecord({
      ...draft,
      id: "different-context",
      locationContext: "Hammond, LA",
    }),
    normalizeDiscoveryRecord({
      ...draft,
      id: "different-result",
      observationResult: "not_observed",
    }),
  ];
  const distinctRecords = distinctDrafts.map((row) =>
    normalizeDiscoveryRecord({
      ...row,
      id: service.externalObservationRecordId(row),
    }),
  );
  assert.equal(
    new Set([observation.id, ...distinctRecords.map((row) => row.id)]).size,
    4,
  );
  for (const row of distinctRecords) {
    const persisted = await service.persistDiscoveryEvidenceOnce(
      row,
      memoryDb as any,
    );
    assert.equal(persisted.inserted, true);
  }
  assert.equal(rows.size, 4);
});

test("funnel uses distinct journeys, visible denominators, and unknown outcomes", () => {
  const rows = [
    record({ id: "j1-entry-a", stage: "entry", observedAt: at(1) }),
    record({ id: "j1-entry-b", stage: "entry", observedAt: at(2) }),
    record({ id: "j1-action", stage: "action", observedAt: at(3), intendedAction: "follow" }),
    record({
      id: "j1-outcome",
      stage: "outcome",
      observedAt: at(4),
      merchantReceiptStatus: "received",
      merchantReceiptEvidenceRef: "restaurant_follows:follow-1",
      merchantReceiptVerifiedAt: at(4),
      finalOutcome: "completed",
    }),
    record({
      id: "j2-entry",
      stage: "entry",
      observedAt: at(5),
      anonymousJourneyId: "journey-2",
    }),
    record({
      id: "j2-action",
      stage: "action",
      observedAt: at(6),
      anonymousJourneyId: "journey-2",
      intendedAction: "follow",
    }),
    record({
      id: "j2-outcome",
      stage: "outcome",
      observedAt: at(7),
      anonymousJourneyId: "journey-2",
      merchantReceiptStatus: "unknown",
      finalOutcome: "unknown",
    }),
    record({
      id: "j3-entry",
      stage: "entry",
      observedAt: at(8),
      anonymousJourneyId: "journey-3",
    }),
  ];
  const funnel = buildDiscoveryFunnel(rows);
  assert.deepEqual(
    {
      entries: funnel.entries,
      actions: funnel.actions,
      merchantReceipts: funnel.merchantReceipts,
      completedOutcomes: funnel.completedOutcomes,
      unknownOutcomes: funnel.unknownOutcomes,
    },
    { entries: 3, actions: 2, merchantReceipts: 1, completedOutcomes: 1, unknownOutcomes: 1 },
  );
  assert.deepEqual(funnel.entryToAction, {
    numerator: 2,
    denominator: 3,
    percent: 66.7,
    unknown: 1,
  });
  assert.deepEqual(funnel.actionToCompletedOutcome, {
    numerator: 1,
    denominator: 2,
    percent: 50,
    unknown: 1,
  });
});

test("funnel excludes orphan, out-of-order, and cross-entity rows", () => {
  const otherEntity = {
    publicEntity: { type: "truck" as const, id: "truck-2", name: "Other Truck" },
  };
  const rows = [
    record({ id: "valid-entry", stage: "entry", observedAt: at(1) }),
    record({
      id: "valid-action",
      stage: "action",
      observedAt: at(2),
      intendedAction: "follow",
    }),
    record({
      id: "valid-outcome",
      stage: "outcome",
      observedAt: at(3),
      merchantReceiptStatus: "received",
      merchantReceiptEvidenceRef: "restaurant_follows:valid",
      merchantReceiptVerifiedAt: at(3),
      finalOutcome: "completed",
    }),
    record({
      id: "orphan-action",
      stage: "action",
      observedAt: at(4),
      anonymousJourneyId: "journey-orphan",
      intendedAction: "follow",
    }),
    record({
      id: "orphan-outcome",
      stage: "outcome",
      observedAt: at(5),
      anonymousJourneyId: "journey-orphan",
      merchantReceiptStatus: "received",
      merchantReceiptEvidenceRef: "restaurant_follows:orphan",
      merchantReceiptVerifiedAt: at(5),
      finalOutcome: "completed",
    }),
    record({
      id: "cross-entry",
      stage: "entry",
      observedAt: at(6),
      anonymousJourneyId: "journey-cross",
    }),
    record({
      id: "cross-action",
      stage: "action",
      observedAt: at(7),
      anonymousJourneyId: "journey-cross",
      intendedAction: "follow",
      ...otherEntity,
    }),
    record({
      id: "late-entry",
      stage: "entry",
      observedAt: at(10),
      anonymousJourneyId: "journey-order",
    }),
    record({
      id: "early-action",
      stage: "action",
      observedAt: at(9),
      anonymousJourneyId: "journey-order",
      intendedAction: "follow",
    }),
    record({
      id: "outcome-order-entry",
      stage: "entry",
      observedAt: at(11),
      anonymousJourneyId: "journey-outcome-order",
    }),
    record({
      id: "outcome-order-action",
      stage: "action",
      observedAt: at(13),
      anonymousJourneyId: "journey-outcome-order",
      intendedAction: "follow",
    }),
    record({
      id: "outcome-too-early",
      stage: "outcome",
      observedAt: at(12),
      anonymousJourneyId: "journey-outcome-order",
      merchantReceiptStatus: "received",
      merchantReceiptEvidenceRef: "restaurant_follows:early",
      merchantReceiptVerifiedAt: at(12),
      finalOutcome: "completed",
    }),
    record({
      id: "outcome-cross-entry",
      stage: "entry",
      observedAt: at(14),
      anonymousJourneyId: "journey-outcome-cross",
    }),
    record({
      id: "outcome-cross-action",
      stage: "action",
      observedAt: at(15),
      anonymousJourneyId: "journey-outcome-cross",
      intendedAction: "follow",
    }),
    record({
      id: "outcome-cross-entity",
      stage: "outcome",
      observedAt: at(16),
      anonymousJourneyId: "journey-outcome-cross",
      merchantReceiptStatus: "received",
      merchantReceiptEvidenceRef: "restaurant_follows:cross",
      merchantReceiptVerifiedAt: at(16),
      finalOutcome: "completed",
      ...otherEntity,
    }),
  ];
  const funnel = buildDiscoveryFunnel(rows);
  assert.equal(funnel.entries, 5);
  assert.equal(funnel.actions, 3);
  assert.equal(funnel.merchantReceipts, 1);
  assert.equal(funnel.completedOutcomes, 1);
  assert.deepEqual(funnel.exclusions, {
    actionWithoutPriorEntry: 1,
    actionBeforeEntry: 1,
    actionEntityMismatchOrUnknown: 1,
    outcomeWithoutPriorAction: 1,
    outcomeBeforeAction: 1,
    outcomeEntityMismatchOrUnknown: 1,
  });
  for (const rate of [
    funnel.entryToAction,
    funnel.actionToMerchantReceipt,
    funnel.actionToCompletedOutcome,
  ]) {
    assert.ok(rate.numerator <= rate.denominator);
    assert.ok(rate.percent == null || rate.percent <= 100);
  }
});

test("integrity enforces grain, time, entity, freshness, and assignment order", () => {
  const assignment = record({
    id: "assignment-1",
    stage: "experiment",
    observedAt: at(0),
    experimentId: "experiment-a",
    experimentAssignedAt: at(0),
  });
  const entry = record({
    id: "assigned-entry",
    stage: "entry",
    observedAt: at(1),
    experimentId: "experiment-a",
  });
  const action = record({
    id: "assigned-action",
    stage: "action",
    observedAt: at(2),
    experimentId: "experiment-a",
  });
  const valid = validateDiscoveryEvidence(
    [assignment, entry, action],
    new Date("2026-08-08T13:00:00.000Z"),
  );
  assert.equal(valid.valid, true);

  const invalid = validateDiscoveryEvidence(
    [
      assignment,
      { ...assignment, id: "assignment-2" },
      { ...action, id: assignment.id },
      { ...action, id: "before-assignment", observedAt: "2026-08-08T11:59:00.000Z" },
      {
        ...action,
        id: "entity-conflict",
        publicEntity: { type: "truck", id: "truck-2", name: "Other Truck" },
      },
      { ...action, id: "future", observedAt: "2026-08-09T00:00:00.000Z" },
      { ...action, id: "missing-freshness", sourceFreshness: undefined as any },
    ],
    new Date("2026-08-08T13:00:00.000Z"),
  );
  assert.ok(invalid.duplicateRecordIds.includes("assignment-1"));
  assert.ok(invalid.journeyEntityConflicts.includes("journey-1"));
  assert.ok(invalid.futureDatedRecordIds.includes("future"));
  assert.ok(
    invalid.duplicateExperimentAssignments.includes("experiment-a:journey-1"),
  );
  assert.ok(invalid.experimentEventsBeforeAssignment.includes("before-assignment"));
  assert.ok(invalid.missingSourceFreshnessRecordIds.includes("missing-freshness"));
  assert.equal(invalid.valid, false);
});

const supply: ActiveSupplySnapshot = {
  businesses: [
    {
      id: "truck-1",
      name: "Example Truck",
      businessType: "food_truck",
      isFoodTruck: true,
      city: "Hammond",
      state: "LA",
      cuisineType: "Cajun",
      operatingHoursKnown: true,
      updatedAt: "2026-08-08T11:00:00.000Z",
      lastBroadcastAt: "2026-08-08T11:30:00.000Z",
      liveUntilAt: "2026-08-08T15:00:00.000Z",
      activeMenuCount: 1,
      availableItemCount: 2,
      soldOutItemCount: 0,
      inventoryTrackedItemCount: 2,
      pricedAvailableItemCount: 2,
      menuUpdatedAt: "2026-08-08T10:00:00.000Z",
      merchantDeliveryEnabled: false,
    },
    {
      id: "restaurant-2",
      name: "Known Empty Menu",
      businessType: "restaurant",
      isFoodTruck: false,
      city: "Hammond",
      state: "LA",
      cuisineType: "Southern",
      operatingHoursKnown: false,
      updatedAt: "2026-08-08T11:00:00.000Z",
      lastBroadcastAt: null,
      liveUntilAt: null,
      activeMenuCount: 0,
      availableItemCount: 0,
      soldOutItemCount: 0,
      inventoryTrackedItemCount: 0,
      pricedAvailableItemCount: 0,
      menuUpdatedAt: null,
      merchantDeliveryEnabled: null,
    },
  ],
  schedules: [
    {
      id: "schedule-1",
      truckId: "truck-1",
      truckName: "Example Truck",
      date: "2026-08-08T18:00:00.000Z",
      startTime: "18:00",
      endTime: "20:00",
      locationName: "Downtown Hammond",
      city: "Hammond",
      state: "LA",
      status: "open",
      isPublic: true,
      lastConfirmedAt: "2026-08-08T11:00:00.000Z",
      updatedAt: "2026-08-08T11:00:00.000Z",
    },
  ],
  events: [
    {
      id: "event-1",
      name: "Hammond Food Night",
      date: "2026-08-09T00:00:00.000Z",
      city: "Hammond",
      state: "LA",
      hostName: "Downtown",
      status: "open",
      updatedAt: "2026-08-08T10:00:00.000Z",
    },
  ],
  menuItems: [
    {
      id: "item-1",
      restaurantId: "truck-1",
      restaurantName: "Example Truck",
      name: "Crawfish Pasta",
      city: "Hammond",
      state: "LA",
      isAvailable: true,
      updatedAt: "2026-08-08T10:00:00.000Z",
    },
  ],
  internalSearches: [
    {
      id: "search-1",
      query: "gumbo tonight",
      source: "internal_search",
      resultCount: 0,
      observedAt: at(10),
    },
  ],
};

test("query collection is grounded in active supply without generating location pages", () => {
  const queries = buildLivingDiscoveryQueries(supply, new Date("2026-08-08T12:00:00.000Z"));
  const categories = new Set(queries.map((row) => row.category));
  for (const category of [
    "business_name",
    "food_trucks_near_city",
    "open_now",
    "time_intent",
    "cuisine_location",
    "food_item_location",
    "event_food",
    "pickup",
    "internal_zero_result",
  ]) {
    assert.ok(categories.has(category as any), `missing ${category}`);
  }
  assert.ok(queries.every((row) => row.sourceEntityIds.length > 0 || row.category === "internal_zero_result"));
  assert.ok(queries.every((row) => !row.query.includes("/")));
});

test("freshness distinguishes authoritative false from unknown", () => {
  const coverage = buildMealScoutFreshnessCoverage(supply);
  assert.deepEqual(coverage.menuAvailability, {
    knownTrue: 1,
    knownFalse: 1,
    unknown: 0,
    denominator: 2,
  });
  assert.deepEqual(coverage.merchantDeliveryAvailability, {
    knownTrue: 0,
    knownFalse: 1,
    unknown: 1,
    denominator: 2,
  });
  assert.deepEqual(coverage.pickupAvailability, {
    knownTrue: 1,
    knownFalse: 1,
    unknown: 0,
    denominator: 2,
  });
  assert.equal(coverage.openStatus.unknown, 2);
  assert.equal(coverage.openStatus.supportingConfiguration, 1);
  const failures = findFreshnessFailures(supply, new Date("2026-08-08T12:00:00.000Z"));
  assert.ok(
    failures.some(
      (row) =>
        row.entityId === "restaurant-2" &&
        row.field === "menuAvailability" &&
        row.state === "unavailable",
    ),
  );
});

test("ranked queue contains exactly three review-only experiments including freshness", () => {
  const funnel = buildDiscoveryFunnel([]);
  const proposals = rankMealScoutExperiments({
    funnel,
    freshnessFailures: findFreshnessFailures(
      supply,
      new Date("2026-08-08T12:00:00.000Z"),
    ),
    queryCollection: buildLivingDiscoveryQueries(
      supply,
      new Date("2026-08-08T12:00:00.000Z"),
    ),
    impressionOnlyPageCount: 0,
    activeSupplyCount: 5,
    zeroResultSearchCount: 1,
  });
  assert.deepEqual(proposals.map((row) => row.rank), [1, 2, 3]);
  assert.match(proposals[0].id, /freshness/);
  assert.ok(proposals.every((row) => row.requiresOwnerApproval));
  assert.ok(proposals.every((row) => row.automaticPublication === false));
  assert.ok(proposals.every((row) => row.defaultDecision === "hold"));
  assert.ok(proposals.every((row) => Number.isFinite(row.evidenceScore)));
});

test("experiment ranks respond to observed zero-result and freshness evidence", () => {
  const emptyFunnel = buildDiscoveryFunnel([]);
  const zeroFirst = rankMealScoutExperiments({
    funnel: emptyFunnel,
    freshnessFailures: [],
    queryCollection: [],
    impressionOnlyPageCount: 0,
    activeSupplyCount: 20,
    zeroResultSearchCount: 6,
  });
  assert.equal(zeroFirst[0].id, "mealscout-zero-result-active-supply-v1");
  assert.match(zeroFirst[0].scoringEvidence.join(" "), /6 independently recorded/i);

  const freshnessFirst = rankMealScoutExperiments({
    funnel: emptyFunnel,
    freshnessFailures: findFreshnessFailures(
      supply,
      new Date("2026-08-08T12:00:00.000Z"),
    ),
    queryCollection: [],
    impressionOnlyPageCount: 0,
    activeSupplyCount: 2,
    zeroResultSearchCount: 0,
  });
  assert.equal(freshnessFirst[0].id, "mealscout-freshness-first-schedule-v1");
});

test("owner decisions are append-only and assignments are idempotent and predeclared", async () => {
  const rows = new Map<string, any>();
  const memoryDb = {
    insert: () => ({
      values: async (value: any) => {
        if (rows.has(value.id)) throw new Error("duplicate evidence ID");
        rows.set(value.id, value);
      },
    }),
    insertObservatoryRowOnce: async (value: any) => {
      if (!rows.has(value.id)) rows.set(value.id, value);
    },
    getObservatoryRowById: async (id: string) => rows.get(id) || null,
    listExperimentDecisionRows: async (experimentId: string) =>
      Array.from(rows.values()).filter(
        (row: any) =>
          row.metadata?.experimentId === experimentId &&
          row.metadata?.intendedAction === "experiment_decision",
      ),
  };
  const experimentId = "mealscout-entry-follow-clarity-v1";
  const hold = await service.persistExperimentDecision({
    experimentId,
    decision: "hold",
    idempotencyKey: "owner-review-hold-1",
    rationale: "Awaiting owner review.",
    database: memoryDb as any,
    now: new Date("2026-08-08T10:00:00.000Z"),
  });
  const approval = await service.persistExperimentDecision({
    experimentId,
    decision: "approved",
    idempotencyKey: "owner-review-approve-1",
    rationale: "Owner approved a local control assignment only.",
    database: memoryDb as any,
    now: new Date("2026-08-08T10:01:00.000Z"),
  });
  assert.notEqual(hold.id, approval.id);
  assert.equal(
    (await memoryDb.listExperimentDecisionRows(experimentId)).length,
    2,
    "a later decision must not overwrite prior evidence",
  );
  const approvalRetry = await service.persistExperimentDecision({
    experimentId,
    decision: "approved",
    idempotencyKey: "owner-review-approve-1",
    rationale: "Owner approved a local control assignment only.",
    database: memoryDb as any,
    now: new Date("2026-08-08T10:01:30.000Z"),
  });
  assert.equal(approvalRetry.id, approval.id);
  await assert.rejects(
    service.persistExperimentDecision({
      experimentId,
      decision: "rejected",
      idempotencyKey: "owner-review-approve-1",
      rationale: "Conflicting reuse must fail.",
      database: memoryDb as any,
      now: new Date("2026-08-08T10:01:40.000Z"),
    }),
    /idempotency key conflicts/i,
  );

  const assignmentInput = {
    experimentId,
    anonymousJourneyId: "journey-experiment-1",
    variant: "control" as const,
    controlledChangeKey: "follow-copy-only",
    database: memoryDb as any,
    now: new Date("2026-08-08T10:02:00.000Z"),
  };
  const [assignmentA, assignmentB] = await Promise.all([
    service.assignDiscoveryExperiment(assignmentInput),
    service.assignDiscoveryExperiment(assignmentInput),
  ]);
  assert.equal(assignmentA.id, assignmentB.id);
  assert.equal(assignmentA.experimentAssignedAt, "2026-08-08T10:02:00.000Z");
  await assert.rejects(
    service.assignDiscoveryExperiment({
      ...assignmentInput,
      variant: "treatment",
    }),
    /conflicting assignment/i,
  );

  const beforeAssignment = record({
    id: "experiment-event-too-early",
    stage: "entry",
    observedAt: "2026-08-08T10:01:59.000Z",
    anonymousJourneyId: "journey-experiment-1",
    experimentId,
  });
  await assert.rejects(
    service.persistDiscoveryEvidence(beforeAssignment, memoryDb as any),
    /assignment must precede/i,
  );
  const afterAssignment = record({
    id: "experiment-event-after-assignment",
    stage: "entry",
    observedAt: "2026-08-08T10:03:00.000Z",
    anonymousJourneyId: "journey-experiment-1",
    experimentId,
  });
  await service.persistDiscoveryEvidence(afterAssignment, memoryDb as any);
  const experimentRows = Array.from(rows.values())
    .map((row) => service.requestLogToDiscoveryEvidence(row))
    .filter((row): row is DiscoveryEvidenceRecord => Boolean(row));
  const integrity = validateDiscoveryEvidence(
    experimentRows,
    new Date("2026-08-08T11:00:00.000Z"),
  );
  assert.equal(integrity.duplicateExperimentAssignments.length, 0);
  assert.equal(integrity.experimentEventsBeforeAssignment.length, 0);
});

test("disposable organic-style entry to follow is directly observed and privacy-safe", async () => {
  const inserted: any[] = [];
  const durableFollows: Array<{ id: string; restaurantId: string; userId: string }> = [];
  const fakeDb = {
    insert: () => ({
      values: async (value: unknown) => {
        inserted.push(value);
      },
    }),
  };
  const req = {
    sessionID: "disposable-session-secret",
    query: { utm_source: "chatgpt.com" },
    headers: { "x-request-id": "request-1" },
    get: (name: string) =>
      name === "referer"
        ? "https://www.mealscout.us/truck/example--truck-1?private=discarded"
        : "",
  };
  const entryMetadata = service.buildProfileAnalyticsDiscoveryMetadata({
    req,
    actionType: "profile_view",
    entity: { type: "truck", id: "truck-1", name: "Example Truck" },
    displayedPage: "/truck/example--truck-1",
  });
  const entry = normalizeDiscoveryRecord({
    ...(entryMetadata as any),
    id: "disposable-entry",
    stage: "entry",
    observedAt: at(20),
  });
  await service.persistDiscoveryEvidence(entry, fakeDb as any);
  durableFollows.push({
    id: "disposable-follow-1",
    restaurantId: "truck-1",
    userId: "disposable-user-1",
  });
  const durableRead = durableFollows.find(
    (row) =>
      row.restaurantId === "truck-1" && row.userId === "disposable-user-1",
  );
  assert.ok(durableRead, "canonical follow relationship must be read after write");
  const outcome = await service.recordFollowJourneyOutcome({
    req,
    restaurantId: "truck-1",
    restaurantName: "Example Truck",
    entityType: "truck",
    actionObservedAt: at(20),
    durableFollowId: durableRead.id,
    durableFollowVerifiedAt: at(21),
    database: fakeDb as any,
  });

  assert.equal(inserted.length, 3);
  assert.equal(outcome.action.anonymousJourneyId, entry.anonymousJourneyId);
  assert.equal(outcome.outcome.merchantReceiptStatus, "received");
  assert.equal(outcome.outcome.finalOutcome, "completed");
  assert.equal(outcome.outcome.linkStrength, "direct_server_observed");
  assert.equal(
    outcome.outcome.merchantReceiptEvidenceRef,
    "restaurant_follows:disposable-follow-1",
  );
  assert.match(outcome.outcome.evidenceBoundary, /separately read/i);
  for (const row of inserted) {
    assert.equal(row.ip, null);
    assert.equal(row.userAgent, null);
    assert.equal(row.userId, null);
    assert.equal(row.sessionId, null);
    assert.equal(String(row.path).includes("?"), false);
    assert.equal(JSON.stringify(row).includes("disposable-session-secret"), false);
    assert.equal(JSON.stringify(row).includes("private=discarded"), false);
  }
  const journey = inserted
    .map((row) => service.requestLogToDiscoveryEvidence(row))
    .filter(Boolean);
  const funnel = buildDiscoveryFunnel(journey);
  assert.deepEqual(
    [funnel.entries, funnel.actions, funnel.merchantReceipts, funnel.completedOutcomes],
    [1, 1, 1, 1],
  );
  inserted.splice(0, inserted.length);
  durableFollows.splice(0, durableFollows.length);
  assert.equal(inserted.length, 0, "disposable evidence store must be empty after proof");
  assert.equal(durableFollows.length, 0, "disposable product store must be empty after proof");
});

test("follow write without canonical read leaves receipt and outcome unknown", async () => {
  const inserted: any[] = [];
  const fakeDb = {
    insert: () => ({ values: async (value: unknown) => inserted.push(value) }),
  };
  const result = await service.recordFollowJourneyOutcome({
    req: { sessionID: "unverified-follow", query: {}, get: () => "" },
    restaurantId: "truck-1",
    restaurantName: "Example Truck",
    entityType: "truck",
    durableFollowId: null,
    database: fakeDb as any,
  });
  assert.equal(result.outcome.merchantReceiptStatus, "unknown");
  assert.equal(result.outcome.finalOutcome, "unknown");
  assert.equal(result.outcome.merchantReceiptEvidenceRef, null);
});

test("internal search result count never becomes a customer outcome", async () => {
  const inserted: any[] = [];
  const fakeDb = {
    insert: () => ({ values: async (value: unknown) => inserted.push(value) }),
  };
  const search = await service.recordInternalSearchOutcome({
    req: { sessionID: "search-session", query: {}, get: () => "" },
    query: "cajun food",
    resultCount: 5,
    database: fakeDb as any,
  });
  assert.equal(search.resultCount, 5);
  assert.equal(search.finalOutcome, "unknown");
  assert.match(search.evidenceBoundary, /later conversion remain unknown/i);
  const adapted = service.requestLogToDiscoveryEvidence(inserted[0]);
  assert.equal(adapted?.query, "cajun food");
  assert.equal(adapted?.queryEvidenceState, "known");
  assert.equal(adapted?.resultCount, 5);
  assert.equal(adapted?.finalOutcome, "unknown");
});

test("admin boundary, explicit observation result, and retention allowlist are wired", () => {
  const routeSource = readFileSync(
    "server/routes/discoveryObservatoryRoutes.ts",
    "utf8",
  );
  const schedulerSource = readFileSync(
    "server/bootstrap/registerSchedulers.ts",
    "utf8",
  );
  const appSource = readFileSync("client/src/App.tsx", "utf8");
  const storageSource = readFileSync("server/storage.ts", "utf8");
  const followerAudienceSource = readFileSync(
    "server/routes/dealRouteDependencies.ts",
    "utf8",
  );

  assert.match(
    routeSource,
    /"\/api\/admin\/discovery-observatory\/observations",\s*isAdmin/,
  );
  assert.match(routeSource, /"\/api\/admin\/discovery-observatory",\s*isAdmin/);
  assert.match(
    routeSource,
    /experiments\/:experimentId\/decision",\s*isAdmin/,
  );
  assert.match(
    routeSource,
    /experiments\/:experimentId\/assignments",\s*isAdmin/,
  );
  assert.match(routeSource, /observationResult:\s*z\.enum/);
  assert.match(routeSource, /queryEvidenceState:\s*z\.enum/);
  assert.match(routeSource, /externalObservationRecordId\(normalizedObservation\)/);
  assert.match(routeSource, /persistDiscoveryEvidenceOnce\(record\)/);
  assert.doesNotMatch(routeSource, /crypto\.randomUUID\(\)/);
  assert.match(routeSource, /decisionAuthority:\s*z\.literal\("owner_review"\)/);
  assert.match(routeSource, /record\.observationResult === "observed"/);
  assert.match(appSource, /path="\/admin\/discovery-observatory"/);
  assert.doesNotMatch(appSource, /path="\/(?:city|locations-with-trucks)\/.*discovery-observatory/);

  assert.match(schedulerSource, /48 \* 60 \* 60 \* 1000/);
  assert.match(schedulerSource, /const sanitizedObservatoryRow/);
  assert.match(schedulerSource, /not \(\$\{sanitizedObservatoryRow\}\)/);
  assert.match(schedulerSource, /requestLogs\.userId\} is null/);
  assert.match(schedulerSource, /requestLogs\.sessionId\} is null/);
  assert.match(schedulerSource, /requestLogs\.ip\} is null/);
  assert.match(schedulerSource, /requestLogs\.userAgent\} is null/);
  assert.match(schedulerSource, /discoveryContractVersion' = '1'/);
  assert.match(schedulerSource, /180 \* 24 \* 60 \* 60 \* 1000/);

  assert.match(
    storageSource,
    /getRestaurantFollowReceipt[\s\S]*?from\(restaurantFollows\)[\s\S]*?restaurantFollows\.restaurantId[\s\S]*?restaurantFollows\.userId/,
  );
  assert.match(
    followerAudienceSource,
    /from\(restaurantFollows\)[\s\S]*?restaurantFollows\.restaurantId/,
  );
});

test("every observatory write and read route installs the real admin middleware", async () => {
  const [{ registerDiscoveryObservatoryRoutes }, { isAdmin }] = await Promise.all([
    import("../server/routes/discoveryObservatoryRoutes"),
    import("../server/unifiedAuth"),
  ]);
  const registrations: Array<{
    method: string;
    path: string;
    handlers: any[];
  }> = [];
  const app = {
    post: (path: string, ...handlers: any[]) =>
      registrations.push({ method: "post", path, handlers }),
    get: (path: string, ...handlers: any[]) =>
      registrations.push({ method: "get", path, handlers }),
  };
  registerDiscoveryObservatoryRoutes(app as any);
  assert.equal(registrations.length, 4);
  assert.ok(
    registrations.every((route) => route.handlers[0] === isAdmin),
    "the real isAdmin middleware must be first on every observatory route",
  );
  assert.ok(
    registrations.every((route) => route.path.startsWith("/api/admin/")),
  );
});

test("real Wave 1 checks remain day-precision, unknown-context, and non-seed", async () => {
  const bundle = JSON.parse(
    readFileSync("evidence/mealscout-wave1-live-checks.json", "utf8"),
  );
  assert.equal(bundle.observedOn, "2026-08-08");
  assert.equal(bundle.observationPrecision, "day");
  assert.equal(bundle.locationContext.state, "unknown");
  assert.equal(bundle.deviceContext.state, "unknown");
  assert.equal(bundle.automaticImport, false);
  assert.equal(bundle.productionMetric, false);
  assert.ok(bundle.checks.some((row: any) => row.httpStatus === 403));
  assert.ok(bundle.checks.some((row: any) => row.httpStatus === 200));
  assert.ok(
    bundle.checks.every(
      (row: any) => !row.observedAt && !row.observedTimestamp,
    ),
    "the bundle must not invent an exact timestamp",
  );

  const captured: any[] = [];
  const first = bundle.checks.find(
    (row: any) => row.id === "wave1-web-query-food-truck-menu",
  );
  const disposableRecord = normalizeDiscoveryRecord({
    id: first.id,
    stage: "observation",
    observationResult: first.observationResult,
    discoverySource: first.source,
    searchSurface: first.searchSurface,
    query: first.query,
    queryEvidenceState: first.queryEvidenceState,
    locationContext: null,
    deviceContext: null,
    observedAt: bundle.observedOn,
    observationPrecision: bundle.observationPrecision,
    displayedPage: first.displayedPage,
    entryPage: null,
    publicEntity: { type: "unknown", id: null, name: null },
    anonymousJourneyId: null,
    intendedAction: null,
    completedAction: null,
    merchantReceiptStatus: null,
    merchantReceiptEvidenceRef: null,
    merchantReceiptVerifiedAt: null,
    finalOutcome: null,
    experimentId: null,
    experimentAssignedAt: null,
    experimentDecision: null,
    experimentVariant: null,
    controlledChangeKey: null,
    linkStrength: "unknown_unavailable",
    sourceFreshness: {
      state: "current",
      checkedAt: bundle.observedOn,
      checkedAtPrecision: "day",
      basis: "Independent permitted web-search check preserved at day precision.",
    },
    freshness: emptyMealScoutFreshnessEvidence(),
    competitors: [],
    outsideSources: [],
    resultCount: null,
    evidenceBoundary: first.evidenceBoundary,
  });
  await service.persistDiscoveryEvidence(disposableRecord, {
    insert: () => ({ values: async (value: any) => captured.push(value) }),
  } as any);
  assert.equal(captured[0].metadata.observedAt, "2026-08-08");
  assert.equal(captured[0].metadata.observationPrecision, "day");
  assert.equal(captured[0].metadata.locationContext, null);
  assert.equal(captured[0].metadata.deviceContext, null);
  captured.splice(0, captured.length);
  assert.equal(captured.length, 0);
});
