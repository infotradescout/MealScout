export type MapProvider = "legacy" | "google";

export type MapMarkerKind =
  | "user"
  | "truck"
  | "restaurant"
  | "parking"
  | "event"
  | "supplier"
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
  color?: string;
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
  source: "first_party" | "google_places" | "supply_signal";
  count?: number;
  uniqueActors?: number;
  freshnessMinutes?: number;
}
