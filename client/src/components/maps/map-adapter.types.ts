export type MapProvider = "legacy" | "google";

export type MapMarkerKind =
  | "user"
  | "truck"
  | "business"
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
  /** Canonical MealScout destination for markers that represent a profile. */
  href?: string | null;
  /** Keeps generic profile pins searchable without pretending they are live. */
  businessType?: string | null;
  /** Describes what the coordinate means so mobile profiles are not treated as live. */
  locationSemantics?: "live" | "business_address" | "profile_area" | null;
  /** Short decision label rendered on the marker, such as a parking price. */
  label?: string;
  /** Keeps the currently selected MealScout result visually tied to its pin. */
  selected?: boolean;
  color?: string;
  imageUrl?: string | null;
  address?: string | null;
  spotImageUrl?: string | null;
  parkingStatus?: "available" | "occupied" | "scheduled" | null;
  parkedTrucks?: Array<{
    id?: string | null;
    name: string;
    href?: string | null;
    source?: "parking_pass" | "event" | "manual_schedule";
    slotLabel?: string | null;
  }>;
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
  color?: string;
  count?: number;
  uniqueActors?: number;
  freshnessMinutes?: number;
}
