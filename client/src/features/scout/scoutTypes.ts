export type ScoutSceneId =
  | "for_you"
  | "community"
  | "nearby_now"
  | "food_trucks"
  | "restaurants"
  | "deals"
  | "events"
  | "new_menus"
  | "late_night"
  | "worth_discovering";

export type ScoutSceneItemType =
  | "restaurant"
  | "food_truck"
  | "deal"
  | "event"
  | "menu_item"
  | "community";

export type ScoutSceneItem = {
  id: string;
  type: ScoutSceneItemType;
  entityId: string;
  title: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  href?: string | null;
  distanceMiles?: number | null;
  badges?: string[];
  reasons?: string[];
  meta?: Record<string, unknown>;
};

export type ScoutMapPin = {
  id: string;
  type: ScoutSceneItemType | "user";
  lat: number;
  lng: number;
  title?: string;
  subtitle?: string | null;
  entityId?: string;
};

export type ScoutSceneCopy = {
  title: string;
  subtitle: string;
};

export type ScoutSceneLane = {
  id: ScoutSceneId;
  label: string;
  icon: "spark" | "community" | "nearby" | "truck" | "restaurant" | "deal" | "event" | "menu" | "late" | "discover";
  cravingId: string;
};
