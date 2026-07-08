export type ScoutEntityKind = string;
export type ScoutActionId = string;
export type ScoutLaneId = string;
export type ScoutFeatureId = string;

export type ScoutCoordinates = {
  lat: number;
  lng: number;
};

export type ScoutEntity = {
  id: string;
  kind: ScoutEntityKind;
  title: string;
  subtitle?: string | null;
  body?: string | null;
  href?: string | null;
  imageUrl?: string | null;
  coordinates?: ScoutCoordinates | null;
  tags?: string[];
  signals?: Record<string, string | number | boolean | null | undefined>;
  payload?: unknown;
};

export type ScoutAction = {
  id: ScoutActionId;
  label: string;
  laneId?: ScoutLaneId;
  kinds?: ScoutEntityKind[];
  queryBoosts?: string[];
  enabledFeatures?: ScoutFeatureId[];
  disabledFeatures?: ScoutFeatureId[];
  mapLayerIds?: string[];
};

export type ScoutLane = {
  id: ScoutLaneId;
  title: string;
  subtitle?: string;
  kinds?: ScoutEntityKind[];
  featureId?: ScoutFeatureId;
  maxItems?: number;
  emptyTitle?: string;
  emptyBody?: string;
};

export type ScoutFeature = {
  id: ScoutFeatureId;
  label: string;
  defaultEnabled?: boolean;
};

export type ScoutMapMarker = {
  id: string;
  entityId: string;
  kind: ScoutEntityKind;
  title: string;
  subtitle?: string | null;
  coordinates: ScoutCoordinates;
  layerId?: string;
  color?: string;
};

export type ScoutSearchState = {
  query: string;
  activeActionId: ScoutActionId | null;
  activeLaneId: ScoutLaneId;
  enabledFeatureIds: ScoutFeatureId[];
};

export type ScoutBlueprintConfig = {
  productName: string;
  defaultLaneId: ScoutLaneId;
  defaultActionId?: ScoutActionId | null;
  actions: ScoutAction[];
  lanes: ScoutLane[];
  features?: ScoutFeature[];
  searchFields?: Array<keyof ScoutEntity>;
  markerForEntity?: (entity: ScoutEntity) => ScoutMapMarker | null;
  rank?: (entity: ScoutEntity, state: ScoutSearchState) => number;
};

export type ScoutDerivedLane = ScoutLane & {
  items: ScoutEntity[];
};

export type ScoutDerivedState = {
  state: ScoutSearchState;
  activeAction: ScoutAction | null;
  activeLane: ScoutLane;
  lanes: ScoutDerivedLane[];
  primaryItems: ScoutEntity[];
  markers: ScoutMapMarker[];
  resultCount: number;
  resetState: ScoutSearchState;
};
