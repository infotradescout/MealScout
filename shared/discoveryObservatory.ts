export const DISCOVERY_PLATFORM = "mealscout" as const;

export const DISCOVERY_STAGES = [
  "observation",
  "entry",
  "action",
  "outcome",
  "experiment",
] as const;

export type DiscoveryStage = (typeof DISCOVERY_STAGES)[number];
export type EvidenceState = "known" | "unknown" | "unavailable";
export type QueryEvidenceState = EvidenceState;
export type EvidenceTimePrecision = "instant" | "day";
export type FreshnessState = "current" | "stale" | "unknown" | "unavailable";
export type DiscoveryLinkStrength =
  | "direct_server_observed"
  | "client_correlated_unverified"
  | "unknown_unavailable";
export type ObservationResult =
  | "observed"
  | "not_observed"
  | "unknown"
  | "unavailable";

export type EvidenceValue<T> = {
  state: EvidenceState;
  value: T | null;
  observedAt: string | null;
  basis: string | null;
};

export type MealScoutFreshnessEvidence = {
  openStatus: EvidenceValue<boolean>;
  scheduleDate: EvidenceValue<string>;
  stopLocation: EvidenceValue<string>;
  eventDate: EvidenceValue<string>;
  menuAvailability: EvidenceValue<boolean>;
  soldOutState: EvidenceValue<boolean>;
  pickupAvailability: EvidenceValue<boolean>;
  merchantDeliveryAvailability: EvidenceValue<boolean>;
};

export type SourceFreshness = {
  state: FreshnessState;
  checkedAt: string | null;
  checkedAtPrecision: EvidenceTimePrecision | null;
  basis: string | null;
};

export type DiscoveryEntity = {
  type: "truck" | "restaurant" | "event" | "menu" | "host" | "unknown";
  id: string | null;
  name: string | null;
};

export type DiscoveryEvidenceRecord = {
  id: string;
  platform: typeof DISCOVERY_PLATFORM;
  stage: DiscoveryStage;
  observationResult: ObservationResult | null;
  discoverySource: string;
  searchSurface: string | null;
  query: string | null;
  queryEvidenceState: QueryEvidenceState;
  locationContext: string | null;
  deviceContext: string | null;
  observedAt: string;
  observationPrecision: EvidenceTimePrecision;
  displayedPage: string | null;
  entryPage: string | null;
  publicEntity: DiscoveryEntity;
  anonymousJourneyId: string | null;
  intendedAction: string | null;
  completedAction: string | null;
  merchantReceiptStatus: "received" | "unknown" | "unavailable" | null;
  merchantReceiptEvidenceRef: string | null;
  merchantReceiptVerifiedAt: string | null;
  finalOutcome: "completed" | "failed" | "unknown" | "unavailable" | null;
  experimentId: string | null;
  experimentAssignedAt: string | null;
  experimentDecision: "hold" | "approved" | "rejected" | null;
  experimentVariant: string | null;
  controlledChangeKey: string | null;
  linkStrength: DiscoveryLinkStrength;
  sourceFreshness: SourceFreshness;
  freshness: MealScoutFreshnessEvidence;
  competitors: string[];
  outsideSources: string[];
  resultCount: number | null;
  evidenceBoundary: string;
};

export type ActiveBusinessSupply = {
  id: string;
  name: string;
  businessType: string;
  isFoodTruck: boolean;
  city: string | null;
  state: string | null;
  cuisineType: string | null;
  operatingHoursKnown: boolean;
  updatedAt: string | null;
  lastBroadcastAt: string | null;
  liveUntilAt: string | null;
  activeMenuCount: number;
  availableItemCount: number;
  soldOutItemCount: number;
  inventoryTrackedItemCount: number;
  pricedAvailableItemCount: number;
  menuUpdatedAt: string | null;
  merchantDeliveryEnabled: boolean | null;
};

export type ActiveScheduleSupply = {
  id: string;
  truckId: string;
  truckName: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  locationName: string | null;
  city: string | null;
  state: string | null;
  status: string | null;
  isPublic: boolean;
  lastConfirmedAt: string | null;
  updatedAt: string | null;
};

export type ActiveEventSupply = {
  id: string;
  name: string;
  date: string;
  city: string | null;
  state: string | null;
  hostName: string | null;
  status: string | null;
  updatedAt: string | null;
};

export type ActiveMenuItemSupply = {
  id: string;
  restaurantId: string;
  restaurantName: string;
  name: string;
  city: string | null;
  state: string | null;
  isAvailable: boolean;
  updatedAt: string | null;
};

export type InternalSearchEvidence = {
  id: string;
  query: string;
  source: string;
  resultCount: number | null;
  observedAt: string;
};

export type ActiveSupplySnapshot = {
  businesses: ActiveBusinessSupply[];
  schedules: ActiveScheduleSupply[];
  events: ActiveEventSupply[];
  menuItems: ActiveMenuItemSupply[];
  internalSearches: InternalSearchEvidence[];
};

export type LivingDiscoveryQuery = {
  query: string;
  category:
    | "business_name"
    | "food_trucks_near_city"
    | "open_now"
    | "time_intent"
    | "cuisine_location"
    | "food_item_location"
    | "event_food"
    | "pickup"
    | "merchant_delivery"
    | "internal_zero_result";
  market: string | null;
  sourceEntityIds: string[];
  supplyEvidence: string;
  observedAt: string;
};

export type FreshnessFailure = {
  entityType: DiscoveryEntity["type"];
  entityId: string;
  entityName: string;
  field: keyof MealScoutFreshnessEvidence;
  state: "stale" | "unknown" | "unavailable";
  observedAt: string;
  detail: string;
};

export type FreshnessCoverageBucket = {
  knownTrue: number;
  knownFalse: number;
  unknown: number;
  denominator: number;
  supportingConfiguration?: number;
};

export type MealScoutFreshnessCoverage = Record<
  keyof MealScoutFreshnessEvidence,
  FreshnessCoverageBucket
>;

export type RateWithDenominator = {
  numerator: number;
  denominator: number;
  percent: number | null;
  unknown: number;
};

export type ExperimentProposal = {
  id: string;
  rank: 1 | 2 | 3;
  evidenceScore: number;
  scoringEvidence: string[];
  question: string;
  baseline: string;
  controlledChange: string;
  target: string;
  intendedAction: string;
  observationPeriod: string;
  successMeasure: string;
  failureCondition: string;
  rollbackCondition: string;
  evidenceBoundary: string;
  requiresOwnerApproval: true;
  automaticPublication: false;
  defaultDecision: "hold";
};

export type ObservatoryIntegrity = {
  duplicateRecordIds: string[];
  journeyEntityConflicts: string[];
  futureDatedRecordIds: string[];
  duplicateExperimentAssignments: string[];
  experimentEventsBeforeAssignment: string[];
  missingSourceFreshnessRecordIds: string[];
  invalidMerchantReceiptRecordIds: string[];
  valid: boolean;
};

export type ObservatoryFunnel = {
  uniqueJourneys: number;
  entries: number;
  actions: number;
  merchantReceipts: number;
  completedOutcomes: number;
  unknownOutcomes: number;
  entryToAction: RateWithDenominator;
  actionToMerchantReceipt: RateWithDenominator;
  actionToCompletedOutcome: RateWithDenominator;
  exclusions: {
    actionWithoutPriorEntry: number;
    actionBeforeEntry: number;
    actionEntityMismatchOrUnknown: number;
    outcomeWithoutPriorAction: number;
    outcomeBeforeAction: number;
    outcomeEntityMismatchOrUnknown: number;
  };
};

const unknownValue = <T>(basis = "No trustworthy evidence is available."): EvidenceValue<T> => ({
  state: "unknown",
  value: null,
  observedAt: null,
  basis,
});

export function emptyMealScoutFreshnessEvidence(): MealScoutFreshnessEvidence {
  return {
    openStatus: unknownValue<boolean>(),
    scheduleDate: unknownValue<string>(),
    stopLocation: unknownValue<string>(),
    eventDate: unknownValue<string>(),
    menuAvailability: unknownValue<boolean>(),
    soldOutState: unknownValue<boolean>(),
    pickupAvailability: unknownValue<boolean>(),
    merchantDeliveryAvailability: unknownValue<boolean>(),
  };
}

function cleanText(value: unknown, max = 240): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function cleanPageEvidence(value: unknown): string | null {
  const text = cleanText(value, 500);
  if (!text) return null;
  try {
    const absolute = /^https?:\/\//i.test(text);
    const url = new URL(text, "https://www.mealscout.us");
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return absolute ? url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "") : url.pathname;
  } catch {
    return text.split(/[?#]/, 1)[0]?.slice(0, 500) || null;
  }
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => cleanText(item, 160)).filter(Boolean) as string[]),
  )
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 25);
}

export function isSafeDiscoveryQuery(value: unknown): boolean {
  const query = cleanText(value, 200);
  if (!query || query.length < 2 || query.length > 160) return false;
  if (query.includes("@")) return false;
  if (/https?:\/\/|www\./i.test(query)) return false;
  if (/\d{7,}/.test(query)) return false;
  return true;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeEvidenceTime(
  value: unknown,
  precision: EvidenceTimePrecision,
): string {
  const text = cleanText(value, 80);
  if (!text) throw new Error("Evidence time is required.");
  if (precision === "day") {
    if (!DATE_ONLY_PATTERN.test(text)) {
      throw new Error("Day-precision evidence must use YYYY-MM-DD.");
    }
    const parsed = new Date(`${text}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
      throw new Error("Day-precision evidence date is invalid.");
    }
    return text;
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error("Evidence timestamp is invalid.");
  return parsed.toISOString();
}

function inferTimePrecision(value: unknown): EvidenceTimePrecision {
  return DATE_ONLY_PATTERN.test(String(value ?? "").trim()) ? "day" : "instant";
}

export function normalizeDiscoveryRecord(
  input: Partial<DiscoveryEvidenceRecord> &
    Pick<DiscoveryEvidenceRecord, "id" | "stage" | "observedAt">,
): DiscoveryEvidenceRecord {
  const stage = DISCOVERY_STAGES.includes(input.stage)
    ? input.stage
    : "observation";
  const rawQuery = cleanText(input.query, 200);
  const queryEvidenceState =
    input.queryEvidenceState || (rawQuery ? "known" : "unknown");
  if (!(["known", "unknown", "unavailable"] as const).includes(queryEvidenceState)) {
    throw new Error("Query evidence state is invalid.");
  }
  if (queryEvidenceState === "known" && !isSafeDiscoveryQuery(rawQuery)) {
    throw new Error("Known query evidence requires a safe, nonempty query.");
  }
  if (queryEvidenceState !== "known" && rawQuery) {
    throw new Error("Unknown or unavailable query evidence must not include a query.");
  }
  if (stage === "entry" && queryEvidenceState === "known") {
    throw new Error("An entry record cannot supply or imply search query evidence.");
  }
  if (
    stage === "observation" &&
    !(["observed", "not_observed", "unknown", "unavailable"] as const).includes(
      input.observationResult as ObservationResult,
    )
  ) {
    throw new Error("Observation-stage evidence requires an explicit result state.");
  }
  const observationPrecision =
    input.observationPrecision || inferTimePrecision(input.observedAt);
  const sourceCheckedAtPrecision = input.sourceFreshness?.checkedAt
    ? input.sourceFreshness.checkedAtPrecision ||
      inferTimePrecision(input.sourceFreshness.checkedAt)
    : null;

  return {
    id: cleanText(input.id, 120) || "missing-id",
    platform: DISCOVERY_PLATFORM,
    stage,
    observationResult:
      stage === "observation" ? input.observationResult || "unknown" : null,
    discoverySource: cleanText(input.discoverySource, 80) || "unknown",
    searchSurface: cleanText(input.searchSurface, 120),
    // Entry URLs never supply a query. Query evidence must be directly observed.
    query: queryEvidenceState === "known" ? cleanText(rawQuery, 160) : null,
    queryEvidenceState,
    locationContext: cleanText(input.locationContext, 160),
    deviceContext: cleanText(input.deviceContext, 80),
    observedAt: normalizeEvidenceTime(input.observedAt, observationPrecision),
    observationPrecision,
    displayedPage: cleanPageEvidence(input.displayedPage),
    entryPage: cleanPageEvidence(input.entryPage),
    publicEntity: {
      type: input.publicEntity?.type || "unknown",
      id: cleanText(input.publicEntity?.id, 120),
      name: cleanText(input.publicEntity?.name, 200),
    },
    anonymousJourneyId: cleanText(input.anonymousJourneyId, 120),
    intendedAction: cleanText(input.intendedAction, 80),
    completedAction: cleanText(input.completedAction, 80),
    merchantReceiptStatus: input.merchantReceiptStatus || null,
    merchantReceiptEvidenceRef: cleanText(input.merchantReceiptEvidenceRef, 160),
    merchantReceiptVerifiedAt: input.merchantReceiptVerifiedAt
      ? normalizeEvidenceTime(input.merchantReceiptVerifiedAt, "instant")
      : null,
    finalOutcome: input.finalOutcome || null,
    experimentId: cleanText(input.experimentId, 120),
    experimentAssignedAt: input.experimentAssignedAt
      ? normalizeEvidenceTime(input.experimentAssignedAt, "instant")
      : null,
    experimentDecision: input.experimentDecision || null,
    experimentVariant: cleanText(input.experimentVariant, 80),
    controlledChangeKey: cleanText(input.controlledChangeKey, 120),
    linkStrength: input.linkStrength || "unknown_unavailable",
    sourceFreshness: {
      state: input.sourceFreshness?.state || "unknown",
      checkedAt: input.sourceFreshness?.checkedAt
        ? normalizeEvidenceTime(
            input.sourceFreshness.checkedAt,
            sourceCheckedAtPrecision || "instant",
          )
        : null,
      checkedAtPrecision: sourceCheckedAtPrecision,
      basis: cleanText(input.sourceFreshness?.basis, 300),
    },
    freshness: input.freshness || emptyMealScoutFreshnessEvidence(),
    competitors: cleanList(input.competitors),
    outsideSources: cleanList(input.outsideSources),
    resultCount:
      typeof input.resultCount === "number" && Number.isFinite(input.resultCount)
        ? Math.max(0, Math.trunc(input.resultCount))
        : null,
    evidenceBoundary:
      cleanText(input.evidenceBoundary, 500) ||
      "Only the fields explicitly present in this record are known.",
  };
}

const marketLabel = (city: string | null, state: string | null) =>
  [cleanText(city, 80), cleanText(state, 40)].filter(Boolean).join(", ") || null;

const dateKey = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

function pushUniqueQuery(
  rows: LivingDiscoveryQuery[],
  seen: Set<string>,
  row: Omit<LivingDiscoveryQuery, "observedAt">,
  observedAt: string,
) {
  const query = cleanText(row.query, 160);
  if (!query || !isSafeDiscoveryQuery(query)) return;
  const key = `${row.category}|${query.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  rows.push({ ...row, query, observedAt });
}

export function buildLivingDiscoveryQueries(
  snapshot: ActiveSupplySnapshot,
  now = new Date(),
): LivingDiscoveryQuery[] {
  const observedAt = now.toISOString();
  const today = observedAt.slice(0, 10);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const rows: LivingDiscoveryQuery[] = [];
  const seen = new Set<string>();

  for (const business of snapshot.businesses) {
    const market = marketLabel(business.city, business.state);
    pushUniqueQuery(
      rows,
      seen,
      {
        query: business.name,
        category: "business_name",
        market,
        sourceEntityIds: [business.id],
        supplyEvidence: "Active public business record.",
      },
      observedAt,
    );
    if (business.operatingHoursKnown) {
      pushUniqueQuery(
        rows,
        seen,
        {
          query: `${business.name} open now`,
          category: "open_now",
          market,
          sourceEntityIds: [business.id],
          supplyEvidence: "The business has explicit operating-hours evidence; current open state is evaluated separately.",
        },
        observedAt,
      );
    }
    if (business.cuisineType && market) {
      pushUniqueQuery(
        rows,
        seen,
        {
          query: `${business.cuisineType} in ${market}`,
          category: "cuisine_location",
          market,
          sourceEntityIds: [business.id],
          supplyEvidence: "Active business with a recorded cuisine and market.",
        },
        observedAt,
      );
    }
    if (business.pricedAvailableItemCount > 0) {
      pushUniqueQuery(
        rows,
        seen,
        {
          query: `${business.name} pickup`,
          category: "pickup",
          market,
          sourceEntityIds: [business.id],
          supplyEvidence: "Active structured menu has at least one priced, available item.",
        },
        observedAt,
      );
    }
    if (business.merchantDeliveryEnabled === true) {
      pushUniqueQuery(
        rows,
        seen,
        {
          query: `${business.name} delivery`,
          category: "merchant_delivery",
          market,
          sourceEntityIds: [business.id],
          supplyEvidence: "Merchant-operated delivery is explicitly enabled.",
        },
        observedAt,
      );
    }
  }

  const trucksByMarket = new Map<string, string[]>();
  for (const business of snapshot.businesses.filter((row) => row.isFoodTruck)) {
    const market = marketLabel(business.city, business.state);
    if (!market) continue;
    const current = trucksByMarket.get(market) || [];
    current.push(business.id);
    trucksByMarket.set(market, current);
  }
  for (const [market, ids] of trucksByMarket) {
    pushUniqueQuery(
      rows,
      seen,
      {
        query: `food trucks near ${market}`,
        category: "food_trucks_near_city",
        market,
        sourceEntityIds: ids,
        supplyEvidence: `${ids.length} active food-truck record${ids.length === 1 ? "" : "s"} in this market.`,
      },
      observedAt,
    );
  }

  for (const schedule of snapshot.schedules) {
    const market = marketLabel(schedule.city, schedule.state);
    const scheduleDay = dateKey(schedule.date);
    if (!market || !scheduleDay || ![today, tomorrow].includes(scheduleDay)) continue;
    const term = scheduleDay === today ? "today" : "tomorrow";
    pushUniqueQuery(
      rows,
      seen,
      {
        query: `${schedule.truckName} ${term}`,
        category: "time_intent",
        market,
        sourceEntityIds: [schedule.truckId, schedule.id],
        supplyEvidence: `Public schedule row dated ${scheduleDay}.`,
      },
      observedAt,
    );
    const startHour = Number.parseInt(String(schedule.startTime || ""), 10);
    if (scheduleDay === today && Number.isFinite(startHour) && startHour >= 16) {
      pushUniqueQuery(
        rows,
        seen,
        {
          query: `food trucks tonight ${market}`,
          category: "time_intent",
          market,
          sourceEntityIds: [schedule.truckId, schedule.id],
          supplyEvidence: `Public same-day schedule row dated ${scheduleDay} with start time ${schedule.startTime}.`,
        },
        observedAt,
      );
    }
  }

  for (const item of snapshot.menuItems.filter((row) => row.isAvailable)) {
    const market = marketLabel(item.city, item.state);
    if (!market) continue;
    pushUniqueQuery(
      rows,
      seen,
      {
        query: `${item.name} ${market}`,
        category: "food_item_location",
        market,
        sourceEntityIds: [item.restaurantId, item.id],
        supplyEvidence: "Available item on an active structured menu.",
      },
      observedAt,
    );
  }

  for (const event of snapshot.events) {
    const market = marketLabel(event.city, event.state);
    pushUniqueQuery(
      rows,
      seen,
      {
        query: `${event.name} food${market ? ` ${market}` : ""}`,
        category: "event_food",
        market,
        sourceEntityIds: [event.id],
        supplyEvidence: `Upcoming event record dated ${dateKey(event.date) || "unknown"}.`,
      },
      observedAt,
    );
  }

  for (const search of snapshot.internalSearches) {
    if (search.resultCount !== 0) continue;
    pushUniqueQuery(
      rows,
      seen,
      {
        query: search.query,
        category: "internal_zero_result",
        market: null,
        sourceEntityIds: [],
        supplyEvidence: `Internal search returned zero results at ${search.observedAt}.`,
      },
      observedAt,
    );
  }

  return rows.slice(0, 500);
}

export function findFreshnessFailures(
  snapshot: ActiveSupplySnapshot,
  now = new Date(),
): FreshnessFailure[] {
  const observedAt = now.toISOString();
  const failures: FreshnessFailure[] = [];
  const staleBusinessMs = 30 * 24 * 60 * 60 * 1000;
  const staleScheduleMs = 72 * 60 * 60 * 1000;

  for (const business of snapshot.businesses) {
    const updatedMs = business.updatedAt ? new Date(business.updatedAt).getTime() : Number.NaN;
    if (!Number.isFinite(updatedMs)) {
      failures.push({
        entityType: business.isFoodTruck ? "truck" : "restaurant",
        entityId: business.id,
        entityName: business.name,
        field: "openStatus",
        state: "unknown",
        observedAt,
        detail: "No trustworthy business freshness timestamp is available.",
      });
    } else if (now.getTime() - updatedMs > staleBusinessMs) {
      failures.push({
        entityType: business.isFoodTruck ? "truck" : "restaurant",
        entityId: business.id,
        entityName: business.name,
        field: "openStatus",
        state: "stale",
        observedAt,
        detail: "Business facts have not been updated in more than 30 days.",
      });
    }
    if (!business.operatingHoursKnown && Number.isFinite(updatedMs)) {
      failures.push({
        entityType: business.isFoodTruck ? "truck" : "restaurant",
        entityId: business.id,
        entityName: business.name,
        field: "openStatus",
        state: "unknown",
        observedAt,
        detail: "No explicit operating-hours configuration supports a current open-state evaluation.",
      });
    }
    if (business.activeMenuCount === 0) {
      failures.push({
        entityType: business.isFoodTruck ? "truck" : "restaurant",
        entityId: business.id,
        entityName: business.name,
        field: "menuAvailability",
        state: "unavailable",
        observedAt,
        detail: "The authoritative active-menu count is zero.",
      });
      failures.push({
        entityType: business.isFoodTruck ? "truck" : "restaurant",
        entityId: business.id,
        entityName: business.name,
        field: "pickupAvailability",
        state: "unavailable",
        observedAt,
        detail: "The authoritative active-menu count is zero, so native pickup is currently unavailable.",
      });
    } else if (business.pricedAvailableItemCount === 0) {
      failures.push({
        entityType: business.isFoodTruck ? "truck" : "restaurant",
        entityId: business.id,
        entityName: business.name,
        field: "pickupAvailability",
        state: "unavailable",
        observedAt,
        detail: "The active structured menu has zero priced, available checkout items.",
      });
    }
    if (business.inventoryTrackedItemCount === 0) {
      failures.push({
        entityType: business.isFoodTruck ? "truck" : "restaurant",
        entityId: business.id,
        entityName: business.name,
        field: "soldOutState",
        state: "unknown",
        observedAt,
        detail: "No inventory-tracked items make sold-out state directly observable.",
      });
    }
    if (business.merchantDeliveryEnabled == null) {
      failures.push({
        entityType: business.isFoodTruck ? "truck" : "restaurant",
        entityId: business.id,
        entityName: business.name,
        field: "merchantDeliveryAvailability",
        state: "unknown",
        observedAt,
        detail: "Merchant-delivery availability is not explicitly recorded.",
      });
    }
  }

  for (const schedule of snapshot.schedules) {
    const confirmedMs = schedule.lastConfirmedAt
      ? new Date(schedule.lastConfirmedAt).getTime()
      : Number.NaN;
    const updatedMs = schedule.updatedAt
      ? new Date(schedule.updatedAt).getTime()
      : Number.NaN;
    const evidenceMs = Number.isFinite(confirmedMs) ? confirmedMs : updatedMs;
    if (!Number.isFinite(evidenceMs)) {
      failures.push({
        entityType: "truck",
        entityId: schedule.truckId,
        entityName: schedule.truckName,
        field: "scheduleDate",
        state: "unknown",
        observedAt,
        detail: "The public stop has no confirmation or update timestamp.",
      });
    } else if (now.getTime() - evidenceMs > staleScheduleMs) {
      failures.push({
        entityType: "truck",
        entityId: schedule.truckId,
        entityName: schedule.truckName,
        field: "scheduleDate",
        state: "stale",
        observedAt,
        detail: "The public stop was not confirmed or updated within 72 hours.",
      });
    }
    if (!schedule.locationName && !schedule.city) {
      failures.push({
        entityType: "truck",
        entityId: schedule.truckId,
        entityName: schedule.truckName,
        field: "stopLocation",
        state: "unknown",
        observedAt,
        detail: "The scheduled stop lacks a public location label.",
      });
    }
  }

  return failures;
}

export function buildMealScoutFreshnessCoverage(
  snapshot: ActiveSupplySnapshot,
): MealScoutFreshnessCoverage {
  const businesses = snapshot.businesses.length;
  const schedules = snapshot.schedules.length;
  const events = snapshot.events.length;
  return {
    openStatus: {
      knownTrue: 0,
      knownFalse: 0,
      unknown: businesses,
      denominator: businesses,
      supportingConfiguration: snapshot.businesses.filter(
        (row) => row.operatingHoursKnown,
      ).length,
    },
    scheduleDate: {
      knownTrue: schedules,
      knownFalse: 0,
      unknown: 0,
      denominator: schedules,
    },
    stopLocation: {
      knownTrue: snapshot.schedules.filter((row) => Boolean(row.locationName || row.city))
        .length,
      knownFalse: 0,
      unknown: snapshot.schedules.filter((row) => !row.locationName && !row.city)
        .length,
      denominator: schedules,
    },
    eventDate: {
      knownTrue: events,
      knownFalse: 0,
      unknown: 0,
      denominator: events,
    },
    menuAvailability: {
      knownTrue: snapshot.businesses.filter((row) => row.activeMenuCount > 0).length,
      knownFalse: snapshot.businesses.filter((row) => row.activeMenuCount === 0).length,
      unknown: 0,
      denominator: businesses,
    },
    soldOutState: {
      knownTrue: snapshot.businesses.filter((row) => row.soldOutItemCount > 0).length,
      knownFalse: snapshot.businesses.filter(
        (row) => row.inventoryTrackedItemCount > 0 && row.soldOutItemCount === 0,
      ).length,
      unknown: snapshot.businesses.filter((row) => row.inventoryTrackedItemCount === 0)
        .length,
      denominator: businesses,
    },
    pickupAvailability: {
      knownTrue: snapshot.businesses.filter((row) => row.pricedAvailableItemCount > 0)
        .length,
      knownFalse: snapshot.businesses.filter(
        (row) => row.pricedAvailableItemCount === 0,
      ).length,
      unknown: 0,
      denominator: businesses,
    },
    merchantDeliveryAvailability: {
      knownTrue: snapshot.businesses.filter(
        (row) => row.merchantDeliveryEnabled === true,
      ).length,
      knownFalse: snapshot.businesses.filter(
        (row) => row.merchantDeliveryEnabled === false,
      ).length,
      unknown: snapshot.businesses.filter(
        (row) => row.merchantDeliveryEnabled == null,
      ).length,
      denominator: businesses,
    },
  };
}

function percent(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

export function validateDiscoveryEvidence(
  records: DiscoveryEvidenceRecord[],
  now = new Date(),
): ObservatoryIntegrity {
  const idCounts = new Map<string, number>();
  const entityByJourney = new Map<string, string>();
  const assignments = new Map<string, string[]>();
  const assignmentTimes = new Map<string, number>();
  const duplicateRecordIds: string[] = [];
  const journeyEntityConflicts = new Set<string>();
  const futureDatedRecordIds: string[] = [];
  const duplicateExperimentAssignments = new Set<string>();
  const experimentEventsBeforeAssignment = new Set<string>();
  const missingSourceFreshnessRecordIds: string[] = [];
  const invalidMerchantReceiptRecordIds: string[] = [];

  for (const record of records) {
    idCounts.set(record.id, (idCounts.get(record.id) || 0) + 1);
    const observedMs = new Date(record.observedAt).getTime();
    if (!Number.isFinite(observedMs) || observedMs > now.getTime() + 60_000) {
      futureDatedRecordIds.push(record.id);
    }
    const sourceCheckedMs = record.sourceFreshness?.checkedAt
      ? new Date(
          record.sourceFreshness.checkedAtPrecision === "day"
            ? `${record.sourceFreshness.checkedAt}T23:59:59.999Z`
            : record.sourceFreshness.checkedAt,
        ).getTime()
      : Number.NaN;
    const requiresSourceAsOf = ["current", "stale"].includes(
      record.sourceFreshness?.state,
    );
    if (
      !record.sourceFreshness?.state ||
      !record.sourceFreshness?.basis ||
      (requiresSourceAsOf && !Number.isFinite(sourceCheckedMs)) ||
      (Number.isFinite(sourceCheckedMs) && sourceCheckedMs > now.getTime() + 60_000)
    ) {
      missingSourceFreshnessRecordIds.push(record.id);
    }
    if (
      record.merchantReceiptStatus === "received" &&
      (!record.merchantReceiptEvidenceRef || !record.merchantReceiptVerifiedAt)
    ) {
      invalidMerchantReceiptRecordIds.push(record.id);
    }

    if (record.anonymousJourneyId && record.publicEntity.id) {
      const entityKey = `${record.publicEntity.type}:${record.publicEntity.id}`;
      const previous = entityByJourney.get(record.anonymousJourneyId);
      if (previous && previous !== entityKey) {
        journeyEntityConflicts.add(record.anonymousJourneyId);
      } else {
        entityByJourney.set(record.anonymousJourneyId, entityKey);
      }
    }

    if (record.experimentId && record.anonymousJourneyId) {
      const assignmentKey = `${record.experimentId}:${record.anonymousJourneyId}`;
      if (record.stage === "experiment") {
        const list = assignments.get(assignmentKey) || [];
        list.push(record.id);
        assignments.set(assignmentKey, list);
        const assignedMs = new Date(
          record.experimentAssignedAt || record.observedAt,
        ).getTime();
        assignmentTimes.set(assignmentKey, assignedMs);
      }
    }
  }

  for (const [id, count] of idCounts) {
    if (count > 1) duplicateRecordIds.push(id);
  }
  for (const [key, rows] of assignments) {
    if (rows.length > 1) duplicateExperimentAssignments.add(key);
  }
  for (const record of records) {
    if (!record.experimentId || !record.anonymousJourneyId || record.stage === "experiment") {
      continue;
    }
    const key = `${record.experimentId}:${record.anonymousJourneyId}`;
    const assignedMs = assignmentTimes.get(key);
    const eventMs = new Date(record.observedAt).getTime();
    if (assignedMs == null || assignedMs > eventMs) {
      experimentEventsBeforeAssignment.add(record.id);
    }
  }

  const integrity = {
    duplicateRecordIds,
    journeyEntityConflicts: Array.from(journeyEntityConflicts),
    futureDatedRecordIds,
    duplicateExperimentAssignments: Array.from(duplicateExperimentAssignments),
    experimentEventsBeforeAssignment: Array.from(experimentEventsBeforeAssignment),
    missingSourceFreshnessRecordIds,
    invalidMerchantReceiptRecordIds,
    valid: false,
  };
  integrity.valid =
    integrity.duplicateRecordIds.length === 0 &&
    integrity.journeyEntityConflicts.length === 0 &&
    integrity.futureDatedRecordIds.length === 0 &&
    integrity.duplicateExperimentAssignments.length === 0 &&
    integrity.experimentEventsBeforeAssignment.length === 0 &&
    integrity.missingSourceFreshnessRecordIds.length === 0 &&
    integrity.invalidMerchantReceiptRecordIds.length === 0;
  return integrity;
}

export function buildDiscoveryFunnel(
  records: DiscoveryEvidenceRecord[],
): ObservatoryFunnel {
  const journeyRows = new Map<string, DiscoveryEvidenceRecord[]>();
  for (const record of records) {
    if (!record.anonymousJourneyId) continue;
    const rows = journeyRows.get(record.anonymousJourneyId) || [];
    rows.push(record);
    journeyRows.set(record.anonymousJourneyId, rows);
  }

  let entries = 0;
  let actions = 0;
  let merchantReceipts = 0;
  let completedOutcomes = 0;
  let unknownOutcomes = 0;
  const exclusions = {
    actionWithoutPriorEntry: 0,
    actionBeforeEntry: 0,
    actionEntityMismatchOrUnknown: 0,
    outcomeWithoutPriorAction: 0,
    outcomeBeforeAction: 0,
    outcomeEntityMismatchOrUnknown: 0,
  };

  const entityKey = (row: DiscoveryEvidenceRecord) =>
    row.publicEntity.id
      ? `${row.publicEntity.type}:${row.publicEntity.id}`
      : null;
  const observedMs = (row: DiscoveryEvidenceRecord) =>
    new Date(row.observedAt).getTime();

  for (const rows of journeyRows.values()) {
    const entryRows = rows.filter((row) => row.stage === "entry");
    const actionRows = rows.filter(
      (row) =>
        row.stage === "action" &&
        Boolean(row.intendedAction || row.completedAction),
    );
    const outcomeRows = rows.filter((row) => row.stage === "outcome");
    if (entryRows.length > 0) entries += 1;

    let linkedAction: DiscoveryEvidenceRecord | null = null;
    for (const action of actionRows.sort((a, b) => observedMs(a) - observedMs(b))) {
      const actionEntity = entityKey(action);
      if (!actionEntity) continue;
      const matchingEntries = entryRows.filter(
        (entry) => entityKey(entry) === actionEntity,
      );
      const eligibleEntries = matchingEntries.filter(
        (entry) => observedMs(entry) <= observedMs(action),
      );
      if (eligibleEntries.length > 0) {
        linkedAction = action;
        break;
      }
    }

    if (!linkedAction && actionRows.length > 0) {
      if (entryRows.length === 0) {
        exclusions.actionWithoutPriorEntry += 1;
      } else {
        const hasSameEntity = actionRows.some((action) =>
          entryRows.some(
            (entry) =>
              entityKey(action) != null && entityKey(action) === entityKey(entry),
          ),
        );
        if (hasSameEntity) exclusions.actionBeforeEntry += 1;
        else exclusions.actionEntityMismatchOrUnknown += 1;
      }
    }

    if (!linkedAction) {
      if (outcomeRows.length > 0) exclusions.outcomeWithoutPriorAction += 1;
      continue;
    }
    actions += 1;

    const linkedEntity = entityKey(linkedAction);
    const matchingOutcomes = outcomeRows.filter(
      (outcome) => entityKey(outcome) === linkedEntity,
    );
    const eligibleOutcomes = matchingOutcomes.filter(
      (outcome) => observedMs(outcome) >= observedMs(linkedAction!),
    );
    if (outcomeRows.length > 0 && eligibleOutcomes.length === 0) {
      if (matchingOutcomes.length > 0) exclusions.outcomeBeforeAction += 1;
      else exclusions.outcomeEntityMismatchOrUnknown += 1;
    }

    const hasReceipt = eligibleOutcomes.some(
      (row) => row.merchantReceiptStatus === "received",
    );
    const hasCompleted = eligibleOutcomes.some(
      (row) => row.finalOutcome === "completed",
    );
    const hasFailed = eligibleOutcomes.some((row) => row.finalOutcome === "failed");
    if (hasReceipt) merchantReceipts += 1;
    if (hasCompleted) completedOutcomes += 1;
    if (!hasCompleted && !hasFailed) unknownOutcomes += 1;
  }

  return {
    uniqueJourneys: journeyRows.size,
    entries,
    actions,
    merchantReceipts,
    completedOutcomes,
    unknownOutcomes,
    entryToAction: {
      numerator: actions,
      denominator: entries,
      percent: percent(actions, entries),
      unknown: Math.max(0, entries - actions),
    },
    actionToMerchantReceipt: {
      numerator: merchantReceipts,
      denominator: actions,
      percent: percent(merchantReceipts, actions),
      unknown: Math.max(0, actions - merchantReceipts),
    },
    actionToCompletedOutcome: {
      numerator: completedOutcomes,
      denominator: actions,
      percent: percent(completedOutcomes, actions),
      unknown: unknownOutcomes,
    },
    exclusions,
  };
}

export const MEALSCOUT_EXPERIMENT_IDS = [
  "mealscout-freshness-first-schedule-v1",
  "mealscout-zero-result-active-supply-v1",
  "mealscout-entry-follow-clarity-v1",
] as const;

export function rankMealScoutExperiments(input: {
  funnel: ObservatoryFunnel;
  freshnessFailures: FreshnessFailure[];
  queryCollection: LivingDiscoveryQuery[];
  impressionOnlyPageCount: number;
  activeSupplyCount?: number;
  zeroResultSearchCount?: number;
}): ExperimentProposal[] {
  const zeroResults =
    input.zeroResultSearchCount ??
    input.queryCollection.filter(
      (query) => query.category === "internal_zero_result",
    ).length;
  const staleCount = input.freshnessFailures.filter((row) => row.state === "stale").length;
  const unknownFreshness = input.freshnessFailures.filter(
    (row) => row.state !== "stale",
  ).length;
  const activeSupplyCount = Math.max(0, input.activeSupplyCount || 0);
  const freshnessRate =
    activeSupplyCount > 0
      ? input.freshnessFailures.length / activeSupplyCount
      : input.freshnessFailures.length > 0
        ? 1
        : 0;
  const entryActionGap = Math.max(0, input.funnel.entries - input.funnel.actions);
  const entryActionGapRate =
    input.funnel.entries > 0 ? entryActionGap / input.funnel.entries : 0;
  const freshnessScore = Math.min(
    100,
    Math.round(
      input.freshnessFailures.length * 9 + staleCount * 8 + freshnessRate * 35,
    ),
  );
  const zeroResultScore = Math.min(100, zeroResults * 18);
  const actionGapScore = Math.min(
    100,
    Math.round(input.impressionOnlyPageCount * 12 + entryActionGapRate * 55),
  );

  const proposals: Array<Omit<ExperimentProposal, "rank">> = [
    {
      id: "mealscout-freshness-first-schedule-v1",
      evidenceScore: freshnessScore,
      scoringEvidence: [
        `${input.freshnessFailures.length} freshness failure(s) across ${activeSupplyCount} active supply row(s).`,
        `${staleCount} stale; ${unknownFreshness} unknown or unavailable.`,
      ],
      question:
        "Does showing the latest confirmed schedule evidence first increase profile-to-follow action without increasing stale-stop failures?",
      baseline: `${staleCount} stale and ${unknownFreshness} unknown freshness finding(s) are visible in the current evidence window.`,
      controlledChange:
        "On one eligible truck profile cohort, move the existing last-confirmed schedule evidence above the follow action; change nothing else.",
      target: "One cohort of claimed food-truck profiles with a current public stop.",
      intendedAction: "Follow",
      observationPeriod: "14 days, compared with the immediately preceding 14-day baseline.",
      successMeasure:
        "Higher distinct-journey entry-to-follow rate with zero increase in stale or wrong-location outcomes.",
      failureCondition:
        "No rate lift, any wrong-location outcome, or a higher share of unknown freshness evidence.",
      rollbackCondition:
        "Restore the prior schedule placement if the failure condition is reached.",
      evidenceBoundary:
        "The test can measure correlated MealScout entries and follows; it cannot claim a search result caused an entry without connected evidence.",
      requiresOwnerApproval: true,
      automaticPublication: false,
      defaultDecision: "hold",
    },
    {
      id: "mealscout-zero-result-active-supply-v1",
      evidenceScore: zeroResultScore,
      scoringEvidence: [
        `${zeroResults} independently recorded internal zero-result search occurrence(s).`,
        "Score uses occurrence count before the living query collection is deduplicated.",
      ],
      question:
        "Can one active-supply suggestion resolve real zero-result searches without creating thin location pages?",
      baseline: `${zeroResults} safe internal zero-result quer${zeroResults === 1 ? "y is" : "ies are"} currently observed.`,
      controlledChange:
        "For one recurring zero-result query only, add one existing active entity or current market suggestion inside Scout.",
      target: "Internal Scout search; no new public URL family.",
      intendedAction: "Open a real truck, restaurant, event, or menu result.",
      observationPeriod: "14 days or 30 qualifying searches, whichever is later.",
      successMeasure:
        "At least 20% of qualifying searches open an active result and freshness failures do not rise.",
      failureCondition:
        "The suggestion is irrelevant, produces no opens, or points at stale supply.",
      rollbackCondition: "Remove only the tested suggestion rule.",
      evidenceBoundary:
        "The test measures internal search behavior only; it does not establish external ranking or citation.",
      requiresOwnerApproval: true,
      automaticPublication: false,
      defaultDecision: "hold",
    },
    {
      id: "mealscout-entry-follow-clarity-v1",
      evidenceScore: actionGapScore,
      scoringEvidence: [
        `${entryActionGap} of ${input.funnel.entries} distinct entry journey(s) have no measured action.`,
        `${input.impressionOnlyPageCount} page(s) have entries but no measured action.`,
      ],
      question:
        "Does clarifying the existing follow action on one useful profile increase completed follows that remain visible to the merchant?",
      baseline: `${input.funnel.actions} action journey(s) from ${input.funnel.entries} entry journey(s); ${input.impressionOnlyPageCount} page(s) have impressions but no measured action.`,
      controlledChange:
        "Change only the follow label and supporting sentence on one eligible profile; keep ranking, inventory, ordering, and layout unchanged.",
      target: "One claimed, current, non-placeholder profile with measured entries.",
      intendedAction: "Follow",
      observationPeriod: "14 days, using distinct journeys and the prior 14 days as baseline.",
      successMeasure:
        "Higher entry-to-follow completion with merchant receipt and no rise in unfollows or unknown outcomes.",
      failureCondition:
        "Completion is flat or lower, merchant receipt becomes unknown, or unfollows rise.",
      rollbackCondition: "Restore the original follow copy.",
      evidenceBoundary:
        "The test can measure MealScout entry, follow persistence, merchant-visible receipt, and completion; outside discovery causation remains unknown unless independently connected.",
      requiresOwnerApproval: true,
      automaticPublication: false,
      defaultDecision: "hold",
    },
  ];

  return proposals
    .sort(
      (a, b) =>
        b.evidenceScore - a.evidenceScore || a.id.localeCompare(b.id),
    )
    .map((proposal, index) => ({
      ...proposal,
      rank: (index + 1) as 1 | 2 | 3,
    }));
}
