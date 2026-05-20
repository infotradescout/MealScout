export type ScoutSurfaceCard = {
  id: string;
  entityType:
    | "truck"
    | "restaurant"
    | "deal"
    | "event"
    | "host_spot"
    | "caterer"
    | "private_chef";
  entityId: string;
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  distanceMiles?: number | null;
  statusLabel?: string | null;
  badges: string[];
  reasons: string[];
  availability:
    | "serving_now"
    | "open_now"
    | "deal_today"
    | "event_today"
    | "upcoming"
    | "nearby"
    | "unknown";
  cta: {
    label: "View details" | "View menu" | "Go now" | "Book spot";
    href: string;
  };
  score: number;
  source:
    | "truck_activity"
    | "restaurant_public"
    | "deal"
    | "event"
    | "host_spot"
    | "recommendation"
    | "community";
  metadata?: Record<string, unknown>;
};

export type ScoutSurfaceSection = {
  id: string;
  title: string;
  subtitle?: string;
  placement: "primary" | "secondary" | "supporting" | "lower";
  layout: "hero_cards" | "horizontal_cards" | "compact_deals" | "vertical_list";
  cards: ScoutSurfaceCard[];
};

export type ScoutSurfaceResponse = {
  generatedAt: string;
  mode: "activity" | "discovery" | "quiet";
  location?: {
    lat?: number;
    lng?: number;
    label?: string;
    radiusMiles?: number;
  };
  map: {
    markers: Array<{
      id: string;
      entityType: ScoutSurfaceCard["entityType"];
      entityId: string;
      lat: number;
      lng: number;
      label?: string;
      status?: string;
      source: ScoutSurfaceCard["source"];
    }>;
  };
  sections: ScoutSurfaceSection[];
};
