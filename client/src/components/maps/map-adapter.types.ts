export type MapProvider = "legacy" | "google";

export type MapMarkerKind =
  | "user"
  | "truck"
  | "parking"
  | "event"
  | "deal"
  | "geo_ad";

export interface MapAdapterMarker {
  id: string;
  sourceId: string;
  kind: MapMarkerKind;
  lat: number;
  lng: number;
  title?: string;
  subtitle?: string;
}

export interface MapBoundsLike {
  north: number;
  south: number;
  east: number;
  west: number;
  contains(point: [number, number]): boolean;
}

export interface MapTrafficCell {
  id: string;
  lat: number;
  lng: number;
  weight: number;
  source: "first_party" | "google_places";
  count?: number;
  uniqueActors?: number;
  freshnessMinutes?: number;
}
