import type {
  ScoutAction,
  ScoutBlueprintConfig,
  ScoutDerivedLane,
  ScoutDerivedState,
  ScoutEntity,
  ScoutSearchState,
} from "./types";

const DEFAULT_SEARCH_FIELDS: Array<keyof ScoutEntity> = [
  "title",
  "subtitle",
  "body",
  "kind",
];

export function createDefaultScoutState(
  config: ScoutBlueprintConfig,
): ScoutSearchState {
  const enabledFeatureIds =
    config.features
      ?.filter((feature) => feature.defaultEnabled !== false)
      .map((feature) => feature.id) ?? [];

  return {
    query: "",
    activeActionId: config.defaultActionId ?? null,
    activeLaneId: config.defaultLaneId,
    enabledFeatureIds,
  };
}

export function applyScoutAction(
  config: ScoutBlueprintConfig,
  state: ScoutSearchState,
  actionId: string | null,
): ScoutSearchState {
  const action = actionId
    ? config.actions.find((candidate) => candidate.id === actionId) ?? null
    : null;

  if (!action) {
    return {
      ...state,
      activeActionId: null,
      activeLaneId: config.defaultLaneId,
    };
  }

  const enabled = new Set(state.enabledFeatureIds);
  action.enabledFeatures?.forEach((featureId) => enabled.add(featureId));
  action.disabledFeatures?.forEach((featureId) => enabled.delete(featureId));

  return {
    ...state,
    activeActionId: action.id,
    activeLaneId: action.laneId ?? state.activeLaneId,
    enabledFeatureIds: Array.from(enabled),
  };
}

export function createScoutController(
  config: ScoutBlueprintConfig,
  entities: ScoutEntity[],
  state: ScoutSearchState,
): ScoutDerivedState {
  const resetState = createDefaultScoutState(config);
  const activeAction = state.activeActionId
    ? config.actions.find((action) => action.id === state.activeActionId) ?? null
    : null;
  const activeLane =
    config.lanes.find((lane) => lane.id === state.activeLaneId) ??
    config.lanes.find((lane) => lane.id === config.defaultLaneId) ??
    config.lanes[0];

  if (!activeLane) {
    throw new Error("ScoutBlueprintConfig requires at least one lane.");
  }

  const filtered = filterEntities(config, entities, state, activeAction);
  const ranked = [...filtered].sort(
    (a, b) =>
      scoreEntity(config, b, state, activeAction) -
      scoreEntity(config, a, state, activeAction),
  );

  const lanes: ScoutDerivedLane[] = config.lanes.map((lane) => {
    const laneItems = ranked.filter((entity) => {
      if (lane.featureId && !state.enabledFeatureIds.includes(lane.featureId)) {
        return false;
      }
      if (lane.kinds?.length && !lane.kinds.includes(entity.kind)) {
        return false;
      }
      return true;
    });

    return {
      ...lane,
      items: lane.maxItems ? laneItems.slice(0, lane.maxItems) : laneItems,
    };
  });

  const primaryItems =
    lanes.find((lane) => lane.id === activeLane.id)?.items ?? ranked;

  return {
    state,
    activeAction,
    activeLane,
    lanes,
    primaryItems,
    markers: ranked
      .map((entity) => config.markerForEntity?.(entity) ?? defaultMarker(entity))
      .filter((marker) => marker !== null),
    resultCount: ranked.length,
    resetState,
  };
}

function filterEntities(
  config: ScoutBlueprintConfig,
  entities: ScoutEntity[],
  state: ScoutSearchState,
  activeAction: ScoutAction | null,
): ScoutEntity[] {
  const terms = tokenize(state.query);
  const fields = config.searchFields ?? DEFAULT_SEARCH_FIELDS;

  return entities.filter((entity) => {
    if (activeAction?.kinds?.length && !activeAction.kinds.includes(entity.kind)) {
      return false;
    }

    if (terms.length === 0) return true;

    const haystack = getSearchHaystack(entity, fields);

    return terms.every((term) => haystack.includes(term));
  });
}

function scoreEntity(
  config: ScoutBlueprintConfig,
  entity: ScoutEntity,
  state: ScoutSearchState,
  activeAction: ScoutAction | null,
): number {
  const baseScore = config.rank?.(entity, state) ?? 0;
  const boostTerms = tokenize((activeAction?.queryBoosts ?? []).join(" "));
  if (boostTerms.length === 0) return baseScore;

  const fields = config.searchFields ?? DEFAULT_SEARCH_FIELDS;
  const haystack = getSearchHaystack(entity, fields);
  const boostScore = boostTerms.reduce(
    (score, term) => score + (haystack.includes(term) ? 5 : 0),
    0,
  );

  return baseScore + boostScore;
}

function getSearchHaystack(
  entity: ScoutEntity,
  fields: Array<keyof ScoutEntity>,
): string {
  return [
    ...fields.map((field) => String(entity[field] ?? "")),
    ...(entity.tags ?? []),
    ...Object.values(entity.signals ?? {}).map((value) => String(value ?? "")),
  ]
    .join(" ")
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function defaultMarker(entity: ScoutEntity) {
  if (!entity.coordinates) return null;
  return {
    id: `marker:${entity.id}`,
    entityId: entity.id,
    kind: entity.kind,
    title: entity.title,
    subtitle: entity.subtitle,
    coordinates: entity.coordinates,
  };
}
