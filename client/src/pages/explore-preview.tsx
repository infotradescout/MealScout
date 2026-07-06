import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
  type ReactNode,
} from "react";
import { Link, useLocation as useWouterLocation } from "wouter";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Bookmark,
  CalendarDays,
  ChevronRight,
  Compass,
  Flame,
  Heart,
  MapPin,
  Maximize2,
  MessageCircle,
  Minimize2,
  Navigation2,
  Star,
  Tag,
  TrendingUp,
  Truck as TruckIcon,
  Users,
  Utensils,
  User as UserIcon,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import ShareButton from "@/components/share-button";
import { useAuth } from "@/hooks/useAuth";
import {
  useEffectiveLocationContext,
  type EffectiveLocationContext,
} from "@/hooks/useEffectiveLocationContext";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import { SEOHead } from "@/components/seo-head";
import { ScoutMapHero } from "@/components/scout/ScoutMapHero";
import { ActiveScenePanel } from "@/components/scout/ActiveScenePanel";
import {
  ScoutSearchDock,
  type ScoutSearchFilterId,
} from "@/components/scout/ScoutSearchDock";
import { ScoutEmptyState as ScoutSceneEmptyState } from "@/components/scout/ScoutEmptyState";
import {
  GoogleMapSurface,
  preloadGoogleMapsScript,
} from "@/components/maps/google-map-surface";
import { MapErrorBoundary } from "@/components/maps/map-error-boundary";
import { GOOGLE_MAPS_WEB_API_KEY } from "@/lib/mapProvider";
import { apiUrl } from "@/lib/api";
import { toast } from "@/hooks/use-toast";
import { buildPublicProfilePath } from "@/lib/public-profile-path";
import type {
  MapAdapterMarker,
  MapBoundsLike,
} from "@/components/maps/map-adapter.types";
import mealScoutIcon from "@assets/meal-scout-icon.png";
import {
  SCOUT_HORIZONTAL_ROW_REGISTRY,
  assignScoutBusinessCardsBySection,
  getScoutBusinessKey,
  normalizeScoutBusinessKind,
  type ScoutHorizontalRowId,
  type ScoutNormalizedCardKind,
} from "@/features/scout/scoutDiscoveryModel";
import type { ScoutSceneLane, ScoutSceneId } from "@/features/scout/scoutTypes";

const ThemedScoutMap = lazy(() => import("@/components/maps/themed-scout-map"));

/**
 * Atmospheric page background.
 * `/atmospheric/foodpark-night-hero.jpg` is the originally approved
 * Atmospheric UI reference (commit 4011a0b7). Swap this constant to point
 * at a different asset under `client/public/atmospheric/` if a new approved
 * background is provided. Known alternates already shipped:
 *   - /atmospheric/mealscout-welcome-map-night.png (welcome map-pin scene)
 */
const SCOUT_BACKGROUND_IMAGE = "/atmospheric/foodpark-night-hero.jpg";
const PENSACOLA_LAUNCH_MARKET = {
  label: "Pensacola, FL",
  lat: 30.4213,
  lng: -87.2169,
  marketKey: "pensacola-fl",
} as const;

function formatScoutMarketLabel({
  city,
  state,
  marketKey,
  fallbackLabel,
}: {
  city?: string | null;
  state?: string | null;
  marketKey?: string | null;
  fallbackLabel?: string;
}): string {
  const normalizedCity = String(city || "").trim();
  const normalizedState = String(state || "").trim();
  if (normalizedCity && normalizedState)
    return `${normalizedCity}, ${normalizedState}`;
  if (normalizedCity) return normalizedCity;
  if (normalizedState) return normalizedState;

  const normalizedMarketKey = String(marketKey || "")
    .trim()
    .toLowerCase();
  if (normalizedMarketKey) {
    const parts = normalizedMarketKey
      .split("-")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) {
      const stateCandidate = parts[parts.length - 1];
      const cityLabel = parts
        .slice(0, -1)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      const stateLabel =
        stateCandidate.length <= 3
          ? stateCandidate.toUpperCase()
          : stateCandidate.charAt(0).toUpperCase() + stateCandidate.slice(1);
      return cityLabel ? `${cityLabel}, ${stateLabel}` : stateLabel;
    }
  }

  return fallbackLabel || "Your market";
}

type MapRuntimeResponse = {
  hasGoogleMapsKey: boolean;
  googleMapsApiKey?: string | null;
  hasGoogleMapsMapId?: boolean;
  googleMapsMapId?: string | null;
};

/**
 * /scout — The canonical MealScout food discovery page.
 * Legacy explore routes redirect here from App.tsx.
 *
 * Goals (from Thomas):
 *  1. Live interactive Google Map REPLACES the food-park hero photo.
 *  2. The user's location is centered such that their pin renders in the
 *     RIGHT QUADRANT of the visible hero map. (The hero text on the left
 *     visually balances the layout.)
 *  3. No "Explore the Map" CTA — the map IS the page.
 *  4. Section order under the hero: Live Now first, Explore by Craving
 *     second, then restored discovery sections (Deals, Events, Favorites).
 *  5. Pull DOWN on the page → map full-screens. A floating "Collapse"
 *     button (top-right of map) returns to default sheet position.
 *  6. Bottom nav drops "Scout" (it conflicted with Explore + the search
 *     button in the top bar). Four items: Explore / Saved / Alerts / Profile.
 */

/* ============================================================
   TYPES
   ============================================================ */

interface LiveTruckSummary {
  id: string;
  name: string;
  cuisineType?: string | null;
  imageUrl?: string | null;
  heroImageUrl?: string | null;
  coverImageUrl?: string | null;
  logoUrl?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
  distance?: number | null;
  distanceMiles?: number | null;
  waitMinutes?: number | null;
  estimatedWaitMinutes?: number | null;
  vibe?: string | null;
  crowdLevel?: string | null;
  mobileOnline?: boolean;
  lastBroadcastAt?: string | null;
  liveUntilAt?: string | null;
  liveBroadcasting?: boolean | null;
  location_state?: "green" | "amber" | "hidden" | null;
  locationState?: "green" | "amber" | "hidden" | null;
  serviceStatus?: string | null;
  status?: string | null;
  operatingStatus?: string | null;
  activeDealCount?: number | null;
}

type LiveTrucksResponse =
  | { trucks?: LiveTruckSummary[] }
  | LiveTruckSummary[]
  | null;

interface DealSummary {
  id: string;
  title?: string | null;
  description?: string | null;
  restaurantName?: string | null;
  imageUrl?: string | null;
  discountText?: string | null;
}

type DealsResponse = { deals?: DealSummary[] } | DealSummary[] | null;

interface EventSummary {
  id: string;
  title?: string | null;
  name?: string | null;
  startsAt?: string | null;
  startTime?: string | null;
  venueName?: string | null;
  locationName?: string | null;
  imageUrl?: string | null;
  heroImageUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
  venueLat?: number | null;
  venueLng?: number | null;
}

type EventsResponse = { events?: EventSummary[] } | EventSummary[] | null;

interface ScoutHostLocation {
  id?: string | null;
  hostId?: string | null;
  businessName?: string | null;
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  spotImageUrl?: string | null;
  locationType?: string | null;
  updatedAt?: string | null;
  lastUpdatedAt?: string | null;
  confirmedAt?: string | null;
  lastConfirmedAt?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

interface ScoutMapEventLocation {
  id?: string | null;
  type?: "event" | "truck_manual_schedule" | string | null;
  name?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  hostId?: string | null;
  hostName?: string | null;
  hostAddress?: string | null;
  hostCity?: string | null;
  hostState?: string | null;
  hostLatitude?: number | string | null;
  hostLongitude?: number | string | null;
  truckId?: string | null;
  bookedRestaurantId?: string | null;
  truckName?: string | null;
  manualScheduleId?: string | null;
  lastConfirmedAt?: string | null;
}

interface ScoutParkingPassListing {
  id?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  status?: string | null;
  host?: ScoutHostLocation | null;
  bookings?: Array<{
    truckId?: string | null;
    truckName?: string | null;
    slotType?: string | null;
    spotNumber?: number | null;
  }> | null;
}

type MapLocationsResponse = {
  hostLocations?: ScoutHostLocation[];
  eventLocations?: ScoutMapEventLocation[];
  supplierLocations?: unknown[];
} | null;

interface RestaurantSummary {
  id: string;
  businessName?: string | null;
  name?: string | null;
  slug?: string | null;
  cuisineType?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  heroImageUrl?: string | null;
  imageUrl?: string | null;
  city?: string | null;
  state?: string | null;
  neighborhood?: string | null;
  address?: string | null;
  activeDealsCount?: number;
  activeDealCount?: number;
  favoriteCount?: number | null;
  followCount?: number | null;
  recommendationCount?: number | null;
  videoRecommendationCount?: number | null;
  communityActivityCount?: number | null;
  homeRankingScore?: number | null;
  homeRankingReason?: string | null;
  distanceMiles?: number | null;
  distance?: number | null;
  description?: string | null;
  businessType?: string | null;
  entityType?: string | null;
  profileType?: string | null;
  isFoodTruck?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
}

interface MenuPreviewItem {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  priceCents?: number | null;
}

interface LocalMenuItemFeedItem extends MenuPreviewItem {
  restaurantId: string;
  restaurantName?: string | null;
  restaurantCity?: string | null;
  restaurantState?: string | null;
  restaurantLogoUrl?: string | null;
  restaurantCoverImageUrl?: string | null;
  cuisineType?: string | null;
  businessType?: string | null;
  isFoodTruck?: boolean | null;
  distanceMiles?: number | null;
  dietaryTags?: string[] | null;
  discoveryReasons?: string[] | null;
  discoveryScore?: number | null;
  updatedAt?: string | null;
}

interface TrendingPlaceSummary {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  cuisineType?: string | null;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  businessType?: string | null;
  isFoodTruck?: boolean | null;
  clicks?: number | null;
  events?: number | null;
  videoRecommendations?: number | null;
  trendScore?: number | null;
}

interface TrendingDishSummary {
  id: string;
  name: string;
  description?: string | null;
  priceCents?: number | null;
  imageUrl?: string | null;
  restaurantId: string;
  restaurantName?: string | null;
  restaurantCity?: string | null;
  restaurantState?: string | null;
  restaurantLogoUrl?: string | null;
  restaurantCoverImageUrl?: string | null;
  cuisineType?: string | null;
  clicks?: number | null;
  impressions?: number | null;
  trendScore?: number | null;
  businessType?: string | null;
  isFoodTruck?: boolean | null;
}

type ScoutTrendingResponse = {
  generatedAt: string;
  windowDays: number;
  items: TrendingDishSummary[];
  places: TrendingPlaceSummary[];
};

interface RestaurantRelationshipSnapshot {
  favoriteIds: Set<string>;
  followIds: Set<string>;
  recommendationIds: Set<string>;
}

type CravingCategory = {
  id: string;
  label: string;
  query: string;
  helper: string;
  keywords: string[];
  image: string;
};

type ScoutSceneLaneId = ScoutSceneId;

const SCOUT_SCENE_LANES: ScoutSceneLane[] = [
  {
    id: "for_you",
    label: "For You",
    icon: "spark",
    cravingId: "something-new",
  },
  {
    id: "community",
    label: "Community",
    icon: "community",
    cravingId: "something-new",
  },
  { id: "nearby_now", label: "Nearby", icon: "nearby", cravingId: "open-now" },
  {
    id: "food_trucks",
    label: "Food Trucks",
    icon: "truck",
    cravingId: "food-truck",
  },
  {
    id: "restaurants",
    label: "Restaurants",
    icon: "restaurant",
    cravingId: "sit-down",
  },
  { id: "deals", label: "Deals", icon: "deal", cravingId: "deals-today" },
  { id: "events", label: "Events", icon: "event", cravingId: "today" },
  {
    id: "new_menus",
    label: "New Menus",
    icon: "menu",
    cravingId: "something-new",
  },
  {
    id: "late_night",
    label: "Late Night",
    icon: "late",
    cravingId: "open-now",
  },
  {
    id: "worth_discovering",
    label: "Worth Discovering",
    icon: "discover",
    cravingId: "something-new",
  },
];

function getSceneOptionIcon(icon: ScoutSceneLane["icon"]) {
  if (icon === "spark")
    return <Compass className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "community")
    return <Users className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "nearby")
    return <Navigation2 className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "truck")
    return <Flame className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "restaurant")
    return <Utensils className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "deal")
    return <Tag className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "event")
    return <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "menu")
    return <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "late")
    return <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />;
  return <Heart className="h-3.5 w-3.5" aria-hidden="true" />;
}

type Daypart = "morning" | "lunch" | "afternoon" | "dinner" | "late";

function getDaypart(date = new Date()): Daypart {
  const hour = date.getHours();
  if (hour >= 5 && hour < 10) return "morning";
  if (hour >= 10 && hour < 14) return "lunch";
  if (hour >= 14 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "dinner";
  return "late";
}

const DAYPART_DEFAULT_INTENT: Record<Daypart, string> = {
  morning: "coffee-breakfast",
  lunch: "quick-bite",
  afternoon: "snack-coffee",
  dinner: "sit-down",
  late: "open-now",
};

const DAYPART_SEARCH_COPY: Record<Daypart, { title: string; body: string }> = {
  morning: {
    title: "Start your day local.",
    body: "Coffee, breakfast, bakeries, and quick bites near you.",
  },
  lunch: {
    title: "Lunch without the scroll.",
    body: "Fast local options, food trucks, and solid deals near you.",
  },
  afternoon: {
    title: "Need a reset?",
    body: "Coffee, snacks, sweets, and low-effort local stops.",
  },
  dinner: {
    title: "Make dinner easier.",
    body: "Local food, deals, trucks, and events worth checking out.",
  },
  late: {
    title: "Still hungry?",
    body: "Open spots, late bites, and local food still open.",
  },
};

const SCOUT_SEARCH_OPTIONS: CravingCategory[] = [
  {
    id: "open-now",
    label: "Open now",
    query: "open now",
    helper: "Food you can actually get right now",
    keywords: ["open", "serving", "available", "pickup", "late"],
    image: "/atmospheric/craving-burgers.jpg",
  },
  {
    id: "quick-bite",
    label: "Quick bite",
    query: "quick bite",
    helper: "Fast, low-friction food nearby",
    keywords: [
      "quick",
      "fast",
      "lunch",
      "pickup",
      "sandwich",
      "taco",
      "burger",
      "truck",
    ],
    image: "/atmospheric/craving-burgers.jpg",
  },
  {
    id: "deals-today",
    label: "Deals today",
    query: "deals",
    helper: "Local value without digging",
    keywords: ["deal", "special", "discount", "offer", "value", "happy hour"],
    image: "/atmospheric/craving-pizza.jpg",
  },
  {
    id: "today",
    label: "Today",
    query: "happening today",
    helper: "Food activity happening today",
    keywords: ["today", "event", "pop-up", "deal", "menu", "serving", "open"],
    image: "/atmospheric/craving-tacos.jpg",
  },
  {
    id: "food-truck",
    label: "Food truck",
    query: "food truck",
    helper: "Mobile kitchens nearby",
    keywords: ["truck", "mobile", "pop-up", "street", "serving"],
    image: "/atmospheric/craving-tacos.jpg",
  },
  {
    id: "coffee-breakfast",
    label: "Coffee & breakfast",
    query: "coffee breakfast",
    helper: "Start the day local",
    keywords: [
      "coffee",
      "breakfast",
      "bakery",
      "biscuit",
      "bagel",
      "pastry",
      "brunch",
      "taco",
    ],
    image: "/atmospheric/craving-dessert.jpg",
  },
  {
    id: "snack-coffee",
    label: "Snack & coffee",
    query: "coffee snack dessert",
    helper: "A useful reset between meals",
    keywords: [
      "coffee",
      "snack",
      "dessert",
      "sweet",
      "bakery",
      "pastry",
      "tea",
    ],
    image: "/atmospheric/craving-dessert.jpg",
  },
  {
    id: "something-new",
    label: "Something new",
    query: "new menu items",
    helper: "Fresh menu drops and new local finds",
    keywords: ["new", "fresh", "menu", "drop", "special", "limited", "popular"],
    image: "/atmospheric/craving-ramen.jpg",
  },
  {
    id: "sit-down",
    label: "Sit-down",
    query: "sit down dinner",
    helper: "A real meal, not just a snack",
    keywords: [
      "dinner",
      "restaurant",
      "table",
      "plate",
      "meal",
      "group",
      "date",
    ],
    image: "/atmospheric/craving-pizza.jpg",
  },
  {
    id: "sweet-tooth",
    label: "Sweet tooth",
    query: "dessert bakery sweets",
    helper: "Dessert, bakeries, and treats",
    keywords: [
      "dessert",
      "ice cream",
      "cake",
      "pastry",
      "sweet",
      "chocolate",
      "bakery",
    ],
    image: "/atmospheric/craving-dessert.jpg",
  },
  {
    id: "tacos",
    label: "Tacos",
    query: "tacos",
    helper: "Quick, bold, easy to share",
    keywords: ["taco", "mexican", "carne", "al pastor", "barbacoa", "salsa"],
    image: "/atmospheric/craving-tacos.jpg",
  },
  {
    id: "burgers",
    label: "Burgers",
    query: "burgers",
    helper: "Comfort food, no fuss",
    keywords: ["burger", "smash", "cheese", "patty", "fries", "comfort"],
    image: "/atmospheric/craving-burgers.jpg",
  },
  {
    id: "ramen",
    label: "Ramen",
    query: "ramen",
    helper: "Warm bowl, slow sip",
    keywords: ["ramen", "noodle", "broth", "tonkotsu", "miso", "asian"],
    image: "/atmospheric/craving-ramen.jpg",
  },
  {
    id: "pizza",
    label: "Pizza",
    query: "pizza",
    helper: "Easy win for the table",
    keywords: ["pizza", "slice", "pepperoni", "italian", "wood", "neapolitan"],
    image: "/atmospheric/craving-pizza.jpg",
  },
  {
    id: "drinks",
    label: "Drinks",
    query: "drinks",
    helper: "Bar energy, sip and stay",
    keywords: ["bar", "cocktail", "wine", "beer", "drink", "lounge", "spritz"],
    image: "/atmospheric/craving-drinks.jpg",
  },
  {
    id: "dessert",
    label: "Dessert",
    query: "dessert",
    helper: "Sweet finish, any time",
    keywords: ["dessert", "ice cream", "cake", "pastry", "sweet", "chocolate"],
    image: "/atmospheric/craving-dessert.jpg",
  },
];

type CravingBoardItem = {
  id: string;
  kind: "Menu" | "Place" | "Truck" | "Deal" | "Event";
  title: string;
  subtitle: string;
  href: string;
  restaurantId?: string | null;
  truckId?: string | null;
  dealId?: string | null;
  imageUrl?: string | null;
  meta?: string | null;
  reason?: string | null;
  freshnessMeta?: FreshnessMeta;
  score: number;
};

type LocalActivityItem = {
  id: string;
  type: "menu_update" | "deal" | "truck" | "event" | "host" | "open" | "update";
  title: string;
  subtitle: string;
  href: string;
  entityId: string;
  timeLabel?: string | null;
  sourceLabel?: string | null;
  freshnessMeta: FreshnessMeta;
};

type ScoutActivityMode = "high_activity" | "medium_activity" | "low_activity";

type ScoutActivityInputs = {
  servingTruckCount: number;
  openRestaurantCount: number;
  dealCount: number;
  eventCount: number;
  menuUpdateCount: number;
  activityItemCount: number;
  mapMarkerCount: number;
};

type DiscoveryLayerId =
  | "localBoard"
  | "cravings"
  | "trending"
  | "menuItems"
  | "foodTrucks"
  | "restaurants"
  | "deals"
  | "events";

const DISCOVERY_LAYERS: Record<
  DiscoveryLayerId,
  { title: string; href: string; subtitle?: string }
> = {
  localBoard: {
    title: "Community Picks",
    href: "/scout",
    subtitle: "Saved, shared, and revisited local spots nearby.",
  },
  cravings: {
    title: "Search by Craving",
    href: "/search",
    subtitle: "Search dishes, trucks, places, and events by what sounds good.",
  },
  trending: {
    title: "Popular Nearby",
    href: "/search",
    subtitle: "Fresh finds and active trucks near you right now.",
  },
  menuItems: {
    title: "Popular Dishes",
    href: "/search",
    subtitle: "Dishes and menu items from restaurants and trucks near you.",
  },
  foodTrucks: {
    title: "Food Trucks Today",
    href: "/search?q=food%20truck",
    subtitle: "Food trucks currently serving or active nearby today.",
  },
  restaurants: {
    title: "Nearby Restaurants",
    href: "/search",
    subtitle: "Open restaurants and local spots close to you.",
  },
  deals: {
    title: "Hot Deals",
    href: "/deals/featured",
    subtitle: "Active offers from nearby restaurants, bars, and food trucks.",
  },
  events: {
    title: "Events & Pop-Ups",
    href: "/events",
    subtitle: "Events, pop-ups, and local food moments near you.",
  },
};

function getMetaDistance(meta: string): string | null {
  const match = meta.match(/(\d+(?:\.\d+)?)\s*mi\b/i);
  if (!match) return null;
  const value = match[1];
  return `${value} mi`;
}

type FreshnessState = "fresh" | "aging" | "needs_update" | "unknown";

type FreshnessMeta = {
  kind?:
    | CravingBoardItem["kind"]
    | "event"
    | "host"
    | "restaurant"
    | "truck"
    | "deal"
    | "menu";
  meta?: string | null;
  reason?: string | null;
  startsAt?: string | null;
  startTime?: string | null;
  updatedAt?: string | null;
  lastUpdatedAt?: string | null;
  confirmedAt?: string | null;
  lastConfirmedAt?: string | null;
  hasDeal?: boolean;
  hasMenu?: boolean;
  hasCommunityUpdate?: boolean;
  hasDistance?: boolean;
  isOpen?: boolean;
  closesSoon?: boolean;
};

type MapLayerId = "openNow" | "foodTrucks" | "deals" | "happeningToday";

type MapLayerState = Record<MapLayerId, boolean>;
type ScoutSourceStatusKey =
  | "trucks"
  | "restaurants"
  | "mapLocations"
  | "deals"
  | "events"
  | "menus";

function readStringField(source: unknown, fields: string[]): string | null {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function readBooleanField(source: unknown, fields: string[]): boolean | null {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "open", "serving", "available", "yes"].includes(normalized))
        return true;
      if (
        ["false", "closed", "not_open", "unavailable", "no"].includes(
          normalized,
        )
      )
        return false;
    }
  }
  return null;
}

function parseTimestampMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function getRestaurantEntityType(
  source: Pick<
    RestaurantSummary,
    "businessType" | "entityType" | "profileType" | "isFoodTruck"
  >,
): "restaurant" | "truck" | "bar" | "unknown" {
  const normalizedKind = normalizeScoutBusinessKind(source, "restaurant");
  if (normalizedKind === "food_truck") return "truck";
  if (
    String(source.entityType || source.profileType || source.businessType || "")
      .trim()
      .toLowerCase() === "bar"
  ) {
    return "bar";
  }
  if (normalizedKind === "restaurant") return "restaurant";
  return "unknown";
}

function getRestaurantProfilePath(restaurant: RestaurantSummary): string {
  const entityType = getRestaurantEntityType(restaurant);
  return (
    buildPublicProfilePath({
      entityType: entityType === "unknown" ? "restaurant" : entityType,
      id: restaurant.id,
      slug: restaurant.slug,
      name: restaurant.businessName || restaurant.name,
    }) || `/restaurant/${encodeURIComponent(String(restaurant.id))}`
  );
}

function getScoutRestaurantLikeKind(
  source: RestaurantSummary | TrendingPlaceSummary,
): ScoutNormalizedCardKind {
  return normalizeScoutBusinessKind(source, "restaurant");
}

function getScoutBusinessCardKey(
  source: RestaurantSummary | LiveTruckSummary | TrendingPlaceSummary,
  route?: string | null,
): string | null {
  return getScoutBusinessKey(source, route);
}

function getTruckProfilePath(truck: LiveTruckSummary): string {
  return (
    buildPublicProfilePath({
      entityType: "truck",
      id: truck.id,
      name: truck.name,
    }) || `/truck/${encodeURIComponent(String(truck.id))}`
  );
}

function getMenuItemProfilePath(item: LocalMenuItemFeedItem): string {
  const ownerKind = normalizeScoutBusinessKind(item, "restaurant");
  return (
    buildPublicProfilePath({
      entityType: ownerKind === "food_truck" ? "truck" : "restaurant",
      id: item.restaurantId,
      name: item.restaurantName,
    }) || `/restaurant/${encodeURIComponent(String(item.restaurantId))}`
  );
}

function getTrendingPlaceProfilePath(place: TrendingPlaceSummary): string {
  const placeKind = getScoutRestaurantLikeKind(place);
  const explicitType = String(place.businessType || "")
    .trim()
    .toLowerCase();
  return (
    buildPublicProfilePath({
      entityType:
        placeKind === "food_truck"
          ? "truck"
          : explicitType === "bar"
            ? "bar"
            : "restaurant",
      id: place.id,
      name: place.name,
    }) || `/restaurant/${encodeURIComponent(String(place.id))}`
  );
}

function getCurrentUserId(user: unknown): string | null {
  return readStringField(user, ["id", "userId"]);
}

function isFoodOperator(user: unknown): boolean {
  const userType = readStringField(user, ["userType", "role", "primaryRole"]);
  return userType === "restaurant_owner" || userType === "food_truck";
}

function isOwnedByCurrentUser(
  entity: unknown,
  currentUserId?: string | null,
): boolean {
  if (!currentUserId) return false;
  const ownerId = readStringField(entity, [
    "ownerId",
    "ownerUserId",
    "userId",
    "vendorUserId",
    "restaurantOwnerId",
    "truckOwnerId",
    "businessOwnerId",
    "coordinatorUserId",
  ]);
  return ownerId === currentUserId;
}

function isTruckServingNow(truck: LiveTruckSummary): boolean {
  const explicit = readBooleanField(truck, [
    "isServing",
    "servingNow",
    "availableNow",
    "liveNow",
  ]);
  if (explicit !== null) return explicit;

  const locationState = readStringField(truck, [
    "location_state",
    "locationState",
  ]);
  if (locationState) {
    const normalized = locationState.toLowerCase();
    if (normalized === "green") return true;
    return false;
  }

  if (truck.mobileOnline !== true) return false;

  const liveUntilMs = parseTimestampMs(
    readStringField(truck, ["liveUntilAt", "live_until_at"]),
  );
  if (liveUntilMs !== null) return liveUntilMs > Date.now();

  const lastBroadcastMs = parseTimestampMs(
    readStringField(truck, ["lastBroadcastAt", "last_broadcast_at"]),
  );
  if (lastBroadcastMs !== null) {
    return Date.now() - lastBroadcastMs < 4 * 60 * 60 * 1000;
  }

  return truck.liveBroadcasting === true;
}

function getRestaurantOpenState(
  restaurant: RestaurantSummary,
): "open" | "closed" | "unknown" {
  const explicit = readBooleanField(restaurant, [
    "isOpen",
    "openNow",
    "currentlyOpen",
    "isCurrentlyOpen",
  ]);
  if (explicit === true) return "open";
  if (explicit === false) return "closed";
  const status = readStringField(restaurant, [
    "openStatus",
    "status",
    "hoursStatus",
    "businessStatus",
  ]);
  if (status) {
    const normalized = status.toLowerCase();
    if (normalized.includes("open")) return "open";
    if (normalized.includes("closed") || normalized.includes("not open"))
      return "closed";
  }
  return "unknown";
}

function getKnownTimestamp(
  meta: FreshnessMeta,
): { value: string; type: "updated" | "confirmed" } | null {
  const updated = meta.updatedAt || meta.lastUpdatedAt;
  if (updated) return { value: updated, type: "updated" };
  const confirmed = meta.confirmedAt || meta.lastConfirmedAt;
  if (confirmed) return { value: confirmed, type: "confirmed" };
  return null;
}

function formatFreshnessTime(
  timestamp: string,
): { state: FreshnessState; label: string } | null {
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return null;

  const now = Date.now();
  const ageMinutes = Math.max(0, Math.floor((now - time) / 60000));
  const eventDate = new Date(time);
  const today = new Date();
  const isToday =
    eventDate.getFullYear() === today.getFullYear() &&
    eventDate.getMonth() === today.getMonth() &&
    eventDate.getDate() === today.getDate();

  if (ageMinutes < 60) {
    return {
      state: "fresh",
      label: "Updated today",
    };
  }
  if (isToday) return { state: "fresh", label: "Updated today" };
  if (ageMinutes < 60 * 24 * 3) return { state: "aging", label: "" };
  return { state: "needs_update", label: "" };
}

function isTodayDate(value?: string | null): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  const date = new Date(time);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function getFreshnessState(entityOrMeta: FreshnessMeta): FreshnessState {
  const timestamp = getKnownTimestamp(entityOrMeta);
  if (timestamp)
    return formatFreshnessTime(timestamp.value)?.state ?? "unknown";
  if (
    entityOrMeta.isOpen ||
    entityOrMeta.hasDeal ||
    entityOrMeta.hasMenu ||
    isTodayDate(entityOrMeta.startsAt || entityOrMeta.startTime)
  ) {
    return "fresh";
  }
  if (entityOrMeta.hasDistance || entityOrMeta.hasCommunityUpdate)
    return "unknown";
  return "unknown";
}

function getFreshnessLabel(entityOrMeta: FreshnessMeta): string {
  const timestamp = getKnownTimestamp(entityOrMeta);
  if (timestamp) {
    const formatted = formatFreshnessTime(timestamp.value);
    if (formatted) {
      if (timestamp.type === "confirmed" && formatted.label === "Updated today")
        return "Confirmed today";
      if (
        timestamp.type === "confirmed" &&
        formatted.label.startsWith("Updated ")
      ) {
        return formatted.label.replace("Updated", "Confirmed");
      }
      return formatted.label;
    }
  }

  if (
    entityOrMeta.hasMenu ||
    entityOrMeta.kind === "Menu" ||
    entityOrMeta.kind === "menu"
  )
    return "Menu updated";
  if (
    entityOrMeta.hasDeal ||
    entityOrMeta.kind === "Deal" ||
    entityOrMeta.kind === "deal"
  )
    return "Deal today";
  if (
    (entityOrMeta.kind === "Truck" || entityOrMeta.kind === "truck") &&
    entityOrMeta.isOpen
  )
    return "Live now";
  if (isTodayDate(entityOrMeta.startsAt || entityOrMeta.startTime))
    return "Happening today";
  if (entityOrMeta.isOpen) return "Open now";
  if (entityOrMeta.hasDistance) return "Nearby now";
  return "Open near you";
}

function getSourceLabel(entityOrMeta: FreshnessMeta): string | null {
  if (entityOrMeta.hasCommunityUpdate) return "Community update";
  if (entityOrMeta.hasMenu) return "Menu updated";
  if (entityOrMeta.hasDeal) return "Deal today";
  return null;
}

function getOperationalBadges(entityOrMeta: FreshnessMeta): string[] {
  const labels = new Set<string>();
  const freshnessLabel = getFreshnessLabel(entityOrMeta);
  if (freshnessLabel) labels.add(freshnessLabel);
  const sourceLabel = getSourceLabel(entityOrMeta);
  if (sourceLabel) labels.add(sourceLabel);
  if (entityOrMeta.closesSoon) labels.add("Closes soon");
  if (entityOrMeta.kind === "Truck" || entityOrMeta.kind === "truck")
    labels.add("Food truck");
  if (
    entityOrMeta.hasDeal ||
    entityOrMeta.kind === "Deal" ||
    entityOrMeta.kind === "deal"
  )
    labels.add("Deal today");
  if (entityOrMeta.isOpen)
    labels.add(
      entityOrMeta.kind === "Truck" || entityOrMeta.kind === "truck"
        ? "Live now"
        : "Open now",
    );
  if (entityOrMeta.hasDistance) labels.add("Nearby");
  if (isTodayDate(entityOrMeta.startsAt || entityOrMeta.startTime))
    labels.add("Happening today");
  // "Menu updated" is deliberately excluded here - it's metadata about when
  // an owner last edited the menu, not something a diner cares about, and it
  // was making cards feel like database records rather than food.
  const allowedLabels = new Set([
    "Open now",
    "Live now",
    "Updated today",
    "Confirmed today",
    "Deal today",
    "Food truck",
  ]);
  return [...labels].filter((label) => allowedLabels.has(label));
}

function getFreshnessBadgeClass(meta: FreshnessMeta, label: string): string {
  const base =
    "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1";
  if (getFreshnessState(meta) === "needs_update") {
    return `${base} bg-amber-300/14 text-amber-100 ring-amber-200/20`;
  }
  if (getFreshnessState(meta) === "aging") {
    return `${base} bg-white/8 text-orange-100/78 ring-white/10`;
  }
  return `${base} bg-emerald-300/12 text-emerald-100 ring-emerald-200/20`;
}

function getRestaurantUpdateHref(
  restaurantId: string,
  setup: "status" | "location" | "menu" | "deal",
): string {
  if (setup === "menu") {
    return `/menu-builder?src=scout&restaurantId=${encodeURIComponent(restaurantId)}`;
  }
  if (setup === "deal") {
    return `/deal-creation?src=scout&restaurantId=${encodeURIComponent(restaurantId)}`;
  }
  return `/restaurant-owner-dashboard?src=scout&setup=${setup}&restaurantId=${encodeURIComponent(restaurantId)}`;
}

function getTruckUpdateHref(
  truckId: string,
  setup: "status" | "location" | "menu" | "deal",
): string {
  return getRestaurantUpdateHref(truckId, setup);
}

function getMapMarkerColor(meta: FreshnessMeta): string {
  if (meta.kind === "Truck" || meta.kind === "truck") return "#ff6f3c";
  if (meta.hasDeal || meta.kind === "Deal" || meta.kind === "deal")
    return "#22c55e";
  if (meta.kind === "event") return "#f59e0b";
  if (getFreshnessState(meta) === "fresh") return "#14b8a6";
  return "#f97316";
}

function getMapMarkerSubtitle(
  base: string | null | undefined,
  meta: FreshnessMeta,
): string | undefined {
  const status = getOperationalBadges(meta)
    .filter((label) => label !== "Open near you")
    .slice(0, 2)
    .join(" · ");
  return [status, base].filter(Boolean).join(" · ") || undefined;
}

function getScoutActivityMode({
  servingTruckCount,
  openRestaurantCount,
  dealCount,
  eventCount,
  menuUpdateCount,
  activityItemCount,
  mapMarkerCount,
}: ScoutActivityInputs): ScoutActivityMode {
  const activityScore =
    servingTruckCount * 3 +
    openRestaurantCount * 2 +
    dealCount * 2 +
    eventCount * 2 +
    menuUpdateCount +
    activityItemCount;

  if (
    activityScore >= 12 ||
    mapMarkerCount >= 10 ||
    (servingTruckCount >= 2 &&
      dealCount + eventCount + openRestaurantCount >= 3)
  ) {
    return "high_activity";
  }

  if (
    activityScore >= 3 ||
    servingTruckCount > 0 ||
    openRestaurantCount > 0 ||
    dealCount > 0 ||
    eventCount > 0
  ) {
    return "medium_activity";
  }

  return "low_activity";
}

function getActivityRailTitle(mode: ScoutActivityMode): string {
  if (mode === "high_activity") return "Happening right now nearby";
  if (mode === "medium_activity") return "Open Near You";
  return "Worth checking out nearby";
}

function getActivityRailSubtitle(mode: ScoutActivityMode): string {
  if (mode === "high_activity") {
    return "Food trucks, open places, deals, events, and menu updates near you.";
  }
  if (mode === "medium_activity") {
    return "Open places, food trucks, deals, and updates close to you.";
  }
  return "Local places and upcoming food activity around you.";
}

function getRestaurantIdFromActivity(item: LocalActivityItem): string | null {
  const hrefMatch = item.href.match(/^\/restaurant\/([^/?#]+)/);
  return hrefMatch?.[1] ? decodeURIComponent(hrefMatch[1]) : null;
}

/* ============================================================
   FORMATTERS
   ============================================================ */

function formatDistance(truck: LiveTruckSummary): string | null {
  const miles = truck.distanceMiles;
  if (typeof miles === "number" && Number.isFinite(miles)) {
    return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
  }
  const km = truck.distance;
  if (typeof km === "number" && Number.isFinite(km)) {
    const asMiles = km * 0.621371;
    return `${asMiles.toFixed(asMiles < 10 ? 1 : 0)} mi`;
  }
  return null;
}

function formatMiles(value?: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${value.toFixed(value < 10 ? 1 : 0)} mi`;
}

function readNumberField(source: unknown, fields: string[]): number | null {
  if (!source || typeof source !== "object") return null;
  const record = source as Record<string, unknown>;
  for (const field of fields) {
    const value = record[field];
    const parsed = typeof value === "string" ? Number(value) : value;
    if (typeof parsed === "number" && Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getBoundsForScoutLocation(
  location: { lat: number; lng: number },
  radiusKm: number,
) {
  const latDelta = radiusKm / 111.32;
  const lngDelta =
    radiusKm /
    (111.32 * Math.max(Math.cos((location.lat * Math.PI) / 180), 0.2));
  return {
    north: location.lat + latDelta,
    south: location.lat - latDelta,
    east: location.lng + lngDelta,
    west: location.lng - lngDelta,
  };
}

function getDistanceMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const hav =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMiles * Math.asin(Math.min(1, Math.sqrt(hav)));
}

function getScoutHostMarkerKey(host: ScoutHostLocation): string {
  const id = String(host.hostId || host.id || "").trim();
  if (id) return id;
  const lat = readNumberField(host, ["latitude", "lat"]);
  const lng = readNumberField(host, ["longitude", "lng"]);
  if (lat !== null && lng !== null)
    return `${lat.toFixed(5)}:${lng.toFixed(5)}`;
  return (
    normalizeScoutLocationAddress(host.address, host.city, host.state) ||
    "host-location"
  );
}

function normalizeScoutLocationAddress(
  address?: string | null,
  city?: string | null,
  state?: string | null,
): string {
  return [address, city, state]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(usa|united states)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function timeStringToMinutes(value?: string | null): number | null {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function isScoutMapWindowActiveNow(row: {
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}): boolean {
  if (row.date && !isTodayDate(row.date)) return false;
  const start = timeStringToMinutes(row.startTime);
  const end = timeStringToMinutes(row.endTime);
  if (start === null || end === null) return true;
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (end < start) return nowMinutes >= start || nowMinutes <= end;
  return nowMinutes >= start && nowMinutes <= end;
}

function getRestaurantName(restaurant: RestaurantSummary): string {
  return restaurant.businessName || restaurant.name || "Local spot";
}

function getRestaurantDistance(restaurant: RestaurantSummary): string | null {
  if (typeof restaurant.distanceMiles === "number") {
    return formatMiles(restaurant.distanceMiles);
  }
  if (typeof restaurant.distance === "number") {
    return formatMiles(restaurant.distance * 0.621371);
  }
  return null;
}

function formatScoutCount(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatScoutResultSummary(count: number): string {
  if (count <= 0) return "Try search, the map, or a wider area";
  return `${count} ${count === 1 ? "spot" : "spots"} nearby`;
}

function getRestaurantArea(restaurant: RestaurantSummary): string | null {
  return restaurant.neighborhood || restaurant.city || null;
}

function getTruckArea(truck: LiveTruckSummary): string | null {
  return truck.city || truck.address || null;
}

function buildDirectionsUrl(source: {
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
}): string | null {
  const lat = source.latitude ?? source.lat;
  const lng = source.longitude ?? source.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

function scoreTextForCraving(text: string, craving: CravingCategory): number {
  const haystack = text.toLowerCase();
  return craving.keywords.reduce(
    (score, keyword) => score + (haystack.includes(keyword) ? 1 : 0),
    0,
  );
}

function getRestaurantCravingScore(
  restaurant: RestaurantSummary,
  craving: CravingCategory,
): number {
  const text = `${getRestaurantName(restaurant)} ${restaurant.cuisineType || ""} ${restaurant.description || ""}`;
  return scoreTextForCraving(text, craving);
}

function getTruckCravingScore(
  truck: LiveTruckSummary,
  craving: CravingCategory,
): number {
  const text = `${truck.name} ${truck.cuisineType || ""} ${truck.vibe || ""}`;
  return scoreTextForCraving(text, craving);
}

function getMenuItemCravingScore(
  item: LocalMenuItemFeedItem,
  craving: CravingCategory,
): number {
  const text = `${item.name} ${item.description || ""} ${item.cuisineType || ""} ${(item.discoveryReasons || []).join(" ")}`;
  return scoreTextForCraving(text, craving);
}

function getDealCravingScore(
  deal: DealSummary,
  craving: CravingCategory,
): number {
  const text = `${deal.title || ""} ${deal.description || ""} ${deal.restaurantName || ""}`;
  return scoreTextForCraving(text, craving);
}

function getRestaurantDiscoveryReason(restaurant: RestaurantSummary): string {
  const reasons = [
    Number(restaurant.favoriteCount || 0) > 0 ? "saved by locals" : null,
    Number(restaurant.videoRecommendationCount || 0) > 0
      ? "recent video updates"
      : null,
    Number(restaurant.recommendationCount || 0) > 0
      ? "community updates"
      : null,
    Number(restaurant.activeDealsCount || restaurant.activeDealCount || 0) > 0
      ? "active deal"
      : null,
  ].filter(Boolean);
  return reasons.length > 0
    ? `${reasons.slice(0, 2).join(" + ")}`
    : "Open and nearby today.";
}

function getRestaurantCommunityScore(restaurant: RestaurantSummary): number {
  return (
    Number(restaurant.favoriteCount || 0) * 3 +
    Number(restaurant.followCount || 0) * 2 +
    Number(restaurant.recommendationCount || 0) * 4 +
    Number(restaurant.videoRecommendationCount || 0) * 5 +
    Number(restaurant.communityActivityCount || 0) * 4 +
    Number(restaurant.activeDealsCount || restaurant.activeDealCount || 0) * 2
  );
}

function getMenuItemSearchReason(item: LocalMenuItemFeedItem): string {
  if (item.discoveryReasons?.[0]) return "Menu updated";
  if (typeof item.discoveryScore === "number" && item.discoveryScore > 0) {
    return "Menu updated";
  }
  if (Array.isArray(item.dietaryTags) && item.dietaryTags.length > 0) {
    return item.dietaryTags.slice(0, 2).join(" + ");
  }
  return "Menu option";
}

function getRestaurantSearchReason(restaurant: RestaurantSummary): string {
  return getRestaurantDiscoveryReason(restaurant);
}

function getRestaurantImage(restaurant: RestaurantSummary): string | null {
  return (
    restaurant.coverImageUrl ||
    restaurant.heroImageUrl ||
    restaurant.imageUrl ||
    restaurant.logoUrl ||
    null
  );
}

function getTruckImage(truck: LiveTruckSummary): string | null {
  return (
    truck.heroImageUrl ||
    truck.coverImageUrl ||
    truck.imageUrl ||
    truck.logoUrl ||
    null
  );
}

function buildCravingBoardItems({
  craving,
  liveTrucks,
  restaurants,
  menuItems,
  deals,
  events,
}: {
  craving: CravingCategory;
  liveTrucks: LiveTruckSummary[];
  restaurants: RestaurantSummary[];
  menuItems: LocalMenuItemFeedItem[];
  deals: DealSummary[];
  events: EventSummary[];
}): CravingBoardItem[] {
  const used = new Set<string>();
  const addPick = (
    items: CravingBoardItem[],
    pick: CravingBoardItem | null,
  ) => {
    if (!pick || used.has(pick.id)) return;
    used.add(pick.id);
    items.push(pick);
  };

  const rankedMenuItems = menuItems
    .map((item) => ({ item, score: getMenuItemCravingScore(item, craving) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.item.discoveryScore ?? 0) - (a.item.discoveryScore ?? 0) ||
        (a.item.distanceMiles ?? 999) - (b.item.distanceMiles ?? 999),
    );

  const rankedRestaurants = restaurants
    .map((restaurant) => ({
      restaurant,
      score: getRestaurantCravingScore(restaurant, craving),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.restaurant.homeRankingScore ?? 0) -
          (a.restaurant.homeRankingScore ?? 0) ||
        (a.restaurant.distanceMiles ?? 999) -
          (b.restaurant.distanceMiles ?? 999),
    );

  const rankedTrucks = liveTrucks
    .map((truck) => ({ truck, score: getTruckCravingScore(truck, craving) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.truck.distanceMiles ?? 999) - (b.truck.distanceMiles ?? 999),
    );

  const rankedDeals = deals
    .map((deal) => ({ deal, score: getDealCravingScore(deal, craving) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  const rankedEvents = events
    .map((event) => {
      const title = event.title || event.name || "";
      const subtitle = [event.venueName, event.locationName]
        .filter(Boolean)
        .join(" ");
      const score = scoreTextForCraving(`${title} ${subtitle}`, craving);
      return { event, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  const items: CravingBoardItem[] = [];

  for (const { item, score } of rankedMenuItems.slice(0, 4)) {
    addPick(items, {
      id: `menu-${item.id}`,
      kind: "Menu",
      title: item.name,
      subtitle: item.restaurantName || item.cuisineType || "Local menu item",
      href: getMenuItemProfilePath(item),
      restaurantId: String(item.restaurantId),
      imageUrl: item.imageUrl,
      meta: formatMiles(item.distanceMiles) || item.cuisineType || "Menu",
      reason: getMenuItemSearchReason(item),
      freshnessMeta: {
        kind: "menu",
        updatedAt: readStringField(item, ["updatedAt", "lastUpdatedAt"]),
        confirmedAt: readStringField(item, ["confirmedAt", "lastConfirmedAt"]),
        hasMenu: true,
        hasDistance: typeof item.distanceMiles === "number",
      },
      score,
    });
  }

  for (const { restaurant, score } of rankedRestaurants.slice(0, 4)) {
    addPick(items, {
      id: `restaurant-${restaurant.id}`,
      kind: "Place",
      title: getRestaurantName(restaurant),
      subtitle:
        restaurant.cuisineType || restaurant.description || "Local restaurant",
      href: getRestaurantProfilePath(restaurant),
      restaurantId: String(restaurant.id),
      imageUrl: getRestaurantImage(restaurant),
      meta: getRestaurantDistance(restaurant) || "Place",
      reason: getRestaurantSearchReason(restaurant),
      freshnessMeta: {
        kind: "restaurant",
        updatedAt: readStringField(restaurant, ["updatedAt", "lastUpdatedAt"]),
        confirmedAt: readStringField(restaurant, [
          "confirmedAt",
          "lastConfirmedAt",
        ]),
        hasDeal:
          Number(
            restaurant.activeDealsCount || restaurant.activeDealCount || 0,
          ) > 0,
        hasCommunityUpdate:
          Number(restaurant.communityActivityCount || 0) > 0 ||
          Number(restaurant.recommendationCount || 0) > 0 ||
          Number(restaurant.videoRecommendationCount || 0) > 0,
        hasDistance: Boolean(getRestaurantDistance(restaurant)),
        isOpen: true,
      },
      score,
    });
  }

  for (const { truck, score } of rankedTrucks.slice(0, 3)) {
    addPick(items, {
      id: `truck-${truck.id}`,
      kind: "Truck",
      title: truck.name,
      subtitle: truck.cuisineType || "Food truck",
      href: getTruckProfilePath(truck),
      truckId: String(truck.id),
      imageUrl: getTruckImage(truck),
      meta:
        [formatDistance(truck), formatWait(truck)]
          .filter(Boolean)
          .join(" / ") || "Live now",
      reason: "Live now",
      freshnessMeta: {
        kind: "truck",
        updatedAt: readStringField(truck, ["updatedAt", "lastUpdatedAt"]),
        confirmedAt: readStringField(truck, ["confirmedAt", "lastConfirmedAt"]),
        hasDeal: Boolean(truck.activeDealCount && truck.activeDealCount > 0),
        hasDistance: Boolean(formatDistance(truck)),
        isOpen: true,
      },
      score,
    });
  }

  for (const { deal, score } of rankedDeals.slice(0, 2)) {
    addPick(items, {
      id: `deal-${deal.id}`,
      kind: "Deal",
      title: deal.title || "Nearby deal",
      subtitle: deal.restaurantName || deal.description || "Local offer",
      href: `/deal/${deal.id}`,
      dealId: String(deal.id),
      imageUrl: deal.imageUrl,
      meta: deal.discountText || "Deal",
      reason: "Deal today",
      freshnessMeta: {
        kind: "deal",
        updatedAt: readStringField(deal, ["updatedAt", "lastUpdatedAt"]),
        confirmedAt: readStringField(deal, ["confirmedAt", "lastConfirmedAt"]),
        hasDeal: true,
      },
      score,
    });
  }

  for (const { event, score } of rankedEvents.slice(0, 2)) {
    addPick(items, {
      id: `event-${event.id}`,
      kind: "Event",
      title: event.title || event.name || "Nearby event",
      subtitle: [
        event.venueName || event.locationName,
        formatEventStartLabel(event),
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/events/${event.id}`,
      imageUrl: event.imageUrl || event.heroImageUrl || null,
      meta: formatEventStartLabel(event) || "Event",
      reason: "Happening today",
      freshnessMeta: {
        kind: "event",
        startsAt: event.startsAt,
        startTime: event.startTime,
        updatedAt: readStringField(event, ["updatedAt", "lastUpdatedAt"]),
      },
      score,
    });
  }

  return items
    .sort((a, b) => {
      const kindRank = { Menu: 5, Place: 4, Truck: 3, Deal: 2, Event: 1 };
      return b.score - a.score || kindRank[b.kind] - kindRank[a.kind];
    })
    .slice(0, 8);
}

function getFreshnessTimeLabel(meta: FreshnessMeta): string | null {
  const timestamp = getKnownTimestamp(meta);
  return timestamp ? getFreshnessLabel(meta) : null;
}

function formatEventStartLabel(event: EventSummary): string | null {
  const raw = event.startsAt || event.startTime;
  if (!raw) return null;
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildLocalActivityItems({
  menuItems,
  deals,
  liveTrucks,
  events,
  hosts,
  restaurants,
}: {
  menuItems: LocalMenuItemFeedItem[];
  deals: DealSummary[];
  liveTrucks: LiveTruckSummary[];
  events: EventSummary[];
  hosts: ScoutHostLocation[];
  restaurants: RestaurantSummary[];
}): LocalActivityItem[] {
  const items: LocalActivityItem[] = [];

  for (const item of menuItems.slice(0, 4)) {
    const distance = formatMiles(item.distanceMiles);
    const freshnessMeta: FreshnessMeta = {
      kind: "menu",
      updatedAt: readStringField(item, ["updatedAt", "lastUpdatedAt"]),
      confirmedAt: readStringField(item, ["confirmedAt", "lastConfirmedAt"]),
      hasMenu: true,
      hasDistance: Boolean(distance),
    };
    items.push({
      id: `menu-${item.id}`,
      type: "menu_update",
      title: "Menu updated",
      subtitle: [item.name, item.restaurantName, distance]
        .filter(Boolean)
        .join(" · "),
      href: `/restaurant/${item.restaurantId}?tab=menu`,
      entityId: String(item.id),
      timeLabel: getFreshnessTimeLabel(freshnessMeta),
      sourceLabel: getSourceLabel(freshnessMeta),
      freshnessMeta,
    });
  }

  for (const deal of deals.slice(0, 4)) {
    const freshnessMeta: FreshnessMeta = {
      kind: "deal",
      updatedAt: readStringField(deal, ["updatedAt", "lastUpdatedAt"]),
      confirmedAt: readStringField(deal, ["confirmedAt", "lastConfirmedAt"]),
      hasDeal: true,
    };
    items.push({
      id: `deal-${deal.id}`,
      type: "deal",
      title: "Deal posted",
      subtitle: [deal.title, deal.restaurantName || deal.discountText]
        .filter(Boolean)
        .join(" · "),
      href: `/deal/${deal.id}`,
      entityId: String(deal.id),
      timeLabel: getFreshnessTimeLabel(freshnessMeta),
      sourceLabel: getSourceLabel(freshnessMeta),
      freshnessMeta,
    });
  }

  for (const truck of liveTrucks.slice(0, 4)) {
    const distance = formatDistance(truck);
    const freshnessMeta: FreshnessMeta = {
      kind: "truck",
      updatedAt: readStringField(truck, ["updatedAt", "lastUpdatedAt"]),
      confirmedAt: readStringField(truck, ["confirmedAt", "lastConfirmedAt"]),
      hasDeal: Boolean(truck.activeDealCount && truck.activeDealCount > 0),
      hasDistance: Boolean(distance),
      isOpen: true,
    };
    items.push({
      id: `truck-${truck.id}`,
      type: "truck",
      title: "Live now",
      subtitle: [truck.name, truck.cuisineType, distance]
        .filter(Boolean)
        .join(" · "),
      href: getTruckProfilePath(truck),
      entityId: String(truck.id),
      timeLabel: getFreshnessTimeLabel(freshnessMeta),
      sourceLabel: getSourceLabel(freshnessMeta),
      freshnessMeta,
    });
  }

  for (const event of events.slice(0, 4)) {
    const freshnessMeta: FreshnessMeta = {
      kind: "event",
      startsAt: event.startsAt,
      startTime: event.startTime,
      updatedAt: readStringField(event, ["updatedAt", "lastUpdatedAt"]),
      confirmedAt: readStringField(event, ["confirmedAt", "lastConfirmedAt"]),
    };
    items.push({
      id: `event-${event.id}`,
      type: "event",
      title: "Event today",
      subtitle: [
        event.title || event.name,
        event.venueName || event.locationName,
        formatEventStartLabel(event),
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/event/${event.id}`,
      entityId: String(event.id),
      timeLabel: getFreshnessTimeLabel(freshnessMeta),
      sourceLabel: getSourceLabel(freshnessMeta),
      freshnessMeta,
    });
  }

  for (const host of hosts.slice(0, 4)) {
    const hostName = host.businessName || host.name || "Host location";
    const area =
      [host.city, host.state].filter(Boolean).join(", ") ||
      host.address ||
      "Nearby location";
    const hostId = String(host.hostId || host.id || "").trim();
    const freshnessMeta: FreshnessMeta = {
      kind: "host",
      updatedAt: readStringField(host, ["updatedAt", "lastUpdatedAt"]),
      confirmedAt: readStringField(host, ["confirmedAt", "lastConfirmedAt"]),
    };
    items.push({
      id: `host-${hostId || hostName}`,
      type: "host",
      title: "Host location",
      subtitle: [hostName, area].filter(Boolean).join(" · "),
      href: hostId ? `/events?hostId=${encodeURIComponent(hostId)}` : "/events",
      entityId: hostId || hostName,
      timeLabel: getFreshnessTimeLabel(freshnessMeta),
      sourceLabel: getSourceLabel(freshnessMeta),
      freshnessMeta,
    });
  }

  for (const restaurant of restaurants.slice(0, 4)) {
    const distance = getRestaurantDistance(restaurant);
    const freshnessMeta: FreshnessMeta = {
      kind: "restaurant",
      updatedAt: readStringField(restaurant, ["updatedAt", "lastUpdatedAt"]),
      confirmedAt: readStringField(restaurant, [
        "confirmedAt",
        "lastConfirmedAt",
      ]),
      hasDeal:
        Number(restaurant.activeDealsCount || restaurant.activeDealCount || 0) >
        0,
      hasCommunityUpdate:
        Number(restaurant.communityActivityCount || 0) > 0 ||
        Number(restaurant.recommendationCount || 0) > 0 ||
        Number(restaurant.videoRecommendationCount || 0) > 0,
      hasDistance: Boolean(distance),
      isOpen: true,
    };
    const timestamp = getKnownTimestamp(freshnessMeta);
    const hasUpdateToday = Boolean(timestamp && isTodayDate(timestamp.value));
    items.push({
      id: `restaurant-${restaurant.id}`,
      type: hasUpdateToday ? "update" : "open",
      title: hasUpdateToday ? "Updated today" : "Open now",
      subtitle: [
        getRestaurantName(restaurant),
        restaurant.cuisineType,
        distance,
      ]
        .filter(Boolean)
        .join(" · "),
      href: getRestaurantProfilePath(restaurant),
      entityId: String(restaurant.id),
      timeLabel: getFreshnessTimeLabel(freshnessMeta),
      sourceLabel: getSourceLabel(freshnessMeta),
      freshnessMeta,
    });
  }

  return items
    .filter((item) => item.subtitle.trim().length > 0)
    .sort((a, b) => {
      const order: Record<LocalActivityItem["type"], number> = {
        truck: 6,
        open: 5,
        deal: 4,
        event: 3,
        host: 3,
        menu_update: 2,
        update: 1,
      };
      return order[b.type] - order[a.type];
    })
    .slice(0, 10);
}

function formatWait(truck: LiveTruckSummary): string | null {
  const wait = truck.waitMinutes ?? truck.estimatedWaitMinutes;
  if (typeof wait === "number" && Number.isFinite(wait) && wait > 0) {
    return `${Math.round(wait)} min wait`;
  }
  return null;
}

function getCrowdVibe(truck: LiveTruckSummary): { label: string } {
  const raw = (truck.crowdLevel || truck.vibe || "").toLowerCase();
  if (raw.includes("hot") || raw.includes("packed"))
    return { label: "Crowd is Hot" };
  if (raw.includes("busy")) return { label: "Busy Right Now" };
  return { label: "Live nearby" };
}

type TruckCardTone = "live" | "scheduled" | "claimed" | "neutral";

function getTruckCardTone(truck: LiveTruckSummary): {
  label: string;
  tone: TruckCardTone;
} {
  if (isTruckServingNow(truck)) return { label: "Live now", tone: "live" };

  const status = readStringField(truck, [
    "serviceStatus",
    "status",
    "operatingStatus",
  ]);
  if (status) {
    const normalized = status.toLowerCase();
    if (normalized.includes("scheduled"))
      return { label: "Scheduled", tone: "scheduled" };
    if (normalized.includes("claim"))
      return { label: "Claimed", tone: "claimed" };
  }

  return { label: "Food truck", tone: "neutral" };
}

function getTruckToneClass(tone: TruckCardTone): string {
  if (tone === "live")
    return "bg-emerald-500/95 text-white ring-emerald-200/40";
  if (tone === "scheduled")
    return "bg-amber-400/92 text-[#1a0d08] ring-amber-100/40";
  if (tone === "claimed") return "bg-white/14 text-white ring-white/20";
  return "bg-[#120805]/72 text-white/86 ring-white/10";
}

function getTruckToneDotClass(tone: TruckCardTone): string {
  if (tone === "live") return "bg-white animate-pulse";
  if (tone === "scheduled") return "bg-[#1a0d08]/80";
  return "bg-white/70";
}

function getTruckCoords(
  truck: LiveTruckSummary,
): { lat: number; lng: number } | null {
  const lat = truck.latitude ?? truck.lat;
  const lng = truck.longitude ?? truck.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng };
}

function formatTruckPlace(truck: LiveTruckSummary): string {
  return (
    [truck.address, truck.city, truck.state].filter(Boolean).join(", ") ||
    "Nearby location"
  );
}

function buildTruckDirectionsUrl(
  truck: LiveTruckSummary,
  origin?: { lat: number; lng: number } | null,
): string {
  const truckCoords = getTruckCoords(truck);
  const destination = truckCoords
    ? `${truckCoords.lat},${truckCoords.lng}`
    : encodeURIComponent(formatTruckPlace(truck));
  const originParam = origin ? `&origin=${origin.lat},${origin.lng}` : "";
  return `https://www.google.com/maps/dir/?api=1${originParam}&destination=${destination}&travelmode=driving`;
}

function getGreetingTime(): "morning" | "afternoon" | "evening" {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

const DISCOVERY_RADIUS_STORAGE_KEY = "mealscout:discovery-radius-km";
const DEFAULT_DISCOVERY_RADIUS_KM = 12; // about 7.5 miles
const MIN_DISCOVERY_RADIUS_KM = 3;
const MAX_DISCOVERY_RADIUS_KM = 40;

function clampDiscoveryRadiusKm(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DISCOVERY_RADIUS_KM;
  return Math.max(
    MIN_DISCOVERY_RADIUS_KM,
    Math.min(MAX_DISCOVERY_RADIUS_KM, value),
  );
}

function readDiscoveryRadiusKm(): number {
  if (typeof window === "undefined") return DEFAULT_DISCOVERY_RADIUS_KM;
  const stored = Number(
    window.localStorage.getItem(DISCOVERY_RADIUS_STORAGE_KEY),
  );
  if (!Number.isFinite(stored)) return DEFAULT_DISCOVERY_RADIUS_KM;
  return clampDiscoveryRadiusKm(stored);
}

type ScoutCoords = { lat: number; lng: number };

function toScoutNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function distanceKmBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function isWithinScoutRadius(
  origin: ScoutCoords | null,
  latValue: unknown,
  lngValue: unknown,
  radiusKm: number,
  fallbackDistanceKm?: number | null,
): boolean {
  if (!origin) return false;
  const lat = toScoutNumber(latValue);
  const lng = toScoutNumber(lngValue);
  if (lat !== null && lng !== null) {
    return distanceKmBetween(origin.lat, origin.lng, lat, lng) <= radiusKm;
  }
  if (
    typeof fallbackDistanceKm === "number" &&
    Number.isFinite(fallbackDistanceKm)
  ) {
    return fallbackDistanceKm <= radiusKm;
  }
  return false;
}

type ScoutSearchIntent =
  | "all"
  | "now"
  | "trucks"
  | "restaurants"
  | "dishes"
  | "deals"
  | "happy_hour"
  | "events"
  | "community"
  | "new"
  | "best";

function normalizeScoutSearchText(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function tokenizeScoutSearch(value: string): string[] {
  return normalizeScoutSearchText(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function inferScoutSearchIntent(
  query: string,
  filter: ScoutSearchFilterId | null,
): ScoutSearchIntent {
  if (filter === "happy_hour") return "happy_hour";
  if (filter) return filter === "community" ? "community" : filter;
  const normalized = normalizeScoutSearchText(query);
  if (!normalized) return "all";
  if (/\b(truck|trucks|food truck|foodtruck)\b/.test(normalized))
    return "trucks";
  if (/\b(restaurant|restaurants|dine|dining|place|places)\b/.test(normalized))
    return "restaurants";
  if (
    /\b(dish|dishes|menu|menus|taco|tacos|burger|pizza|bbq|wings|bowl|bowls)\b/.test(
      normalized,
    )
  )
    return "dishes";
  if (/\b(happy hour|happy-hour)\b/.test(normalized)) return "happy_hour";
  if (/\b(deal|deals|discount|special|specials)\b/.test(normalized))
    return "deals";
  if (/\b(event|events|pop.?up|popup|popups)\b/.test(normalized))
    return "events";
  if (/\b(community|favorite|favorites|pick|picks|saved)\b/.test(normalized))
    return "community";
  if (/\b(new|newest|fresh|recent|latest)\b/.test(normalized)) return "new";
  if (/\b(best|top|hot|trending|popular)\b/.test(normalized)) return "best";
  if (/\b(now|open|serving|live)\b/.test(normalized)) return "now";
  return "all";
}

function scoutRecordSearchText(record: unknown): string {
  if (!record || typeof record !== "object") return "";
  const source = record as Record<string, unknown>;
  const values = [
    source.name,
    source.businessName,
    source.restaurantName,
    source.title,
    source.description,
    source.cuisineType,
    source.businessType,
    source.profileType,
    source.entityType,
    source.city,
    source.state,
    source.neighborhood,
    source.address,
    source.addressPublicLabel,
    source.discountText,
    source.locationName,
    source.venueName,
    ...(Array.isArray(source.tags) ? source.tags : []),
    ...(Array.isArray(source.dietaryTags) ? source.dietaryTags : []),
    ...(Array.isArray(source.discoveryReasons) ? source.discoveryReasons : []),
  ];
  return values
    .map((value) => String(value || ""))
    .join(" ")
    .toLowerCase();
}

function matchesScoutSearchText(record: unknown, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = scoutRecordSearchText(record);
  return terms.every((term) => haystack.includes(term));
}

function hasCommunitySignal(record: unknown): boolean {
  if (!record || typeof record !== "object") return false;
  const source = record as Record<string, unknown>;
  return [
    source.favoriteCount,
    source.followCount,
    source.recommendationCount,
    source.videoRecommendationCount,
    source.communityActivityCount,
  ].some((value) => Number(value || 0) > 0);
}

function hasNewListingSignal(record: unknown): boolean {
  if (!record || typeof record !== "object") return false;
  const source = record as Record<string, unknown>;
  const raw =
    source.createdAt || source.addedAt || source.publishedAt || source.listedAt;
  const time = raw ? new Date(String(raw)).getTime() : NaN;
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= 45 * 24 * 60 * 60 * 1000;
}

function matchesScoutIntent(
  record: unknown,
  intent: ScoutSearchIntent,
  kindHint?: string,
): boolean {
  const kind = normalizeScoutSearchText(
    kindHint ||
      (record as any)?.kind ||
      (record as any)?.profileType ||
      (record as any)?.businessType,
  );
  if (intent === "all") return true;
  if (intent === "trucks")
    return (
      kind.includes("truck") ||
      normalizeScoutSearchText((record as any)?.isFoodTruck) === "true"
    );
  if (intent === "restaurants")
    return (
      kind.includes("restaurant") ||
      kind.includes("bar") ||
      kind.includes("cafe")
    );
  if (intent === "dishes")
    return Boolean(
      (record as any)?.priceCents ||
      (record as any)?.priceLabel ||
      kind.includes("menu"),
    );
  if (intent === "deals")
    return (
      kind.includes("deal") ||
      Number(
        (record as any)?.activeDealCount ||
          (record as any)?.activeDealsCount ||
          0,
      ) > 0
    );
  if (intent === "happy_hour")
    return scoutRecordSearchText(record).includes("happy hour");
  if (intent === "events")
    return (
      kind.includes("event") ||
      Boolean((record as any)?.startsAt || (record as any)?.startTime)
    );
  if (intent === "community") return hasCommunitySignal(record);
  if (intent === "new") return hasNewListingSignal(record);
  if (intent === "best")
    return (
      hasCommunitySignal(record) ||
      Number((record as any)?.discoveryScore || 0) > 0
    );
  if (intent === "now")
    return (
      kind.includes("truck") ||
      /open|serving|live/i.test(scoutRecordSearchText(record))
    );
  return true;
}

function filterScoutSearchRows<T>(
  rows: T[],
  searchMode: boolean,
  query: string,
  intent: ScoutSearchIntent,
  kindHint?: string,
): T[] {
  if (!searchMode) return rows;
  const terms = tokenizeScoutSearch(query);
  return rows.filter(
    (row) =>
      matchesScoutSearchText(row, terms) &&
      matchesScoutIntent(row, intent, kindHint),
  );
}

/* ============================================================
   MAP CENTER OFFSET
   ----
   To place the user's pin in the RIGHT QUADRANT of the visible
   hero map, we shift the *map center* WEST of the user by ~1/4
   of the visible longitude span at the current zoom. The user
   coordinate then renders at roughly x = 75% across the viewport.
   ============================================================ */

function shiftCenterForRightQuadrant(
  lat: number,
  lng: number,
  zoom: number,
): { lat: number; lng: number } {
  // Rough longitude span at a given zoom level for a ~430px-wide viewport.
  // 360 deg / 2^zoom ~= world span per 256px tile, scaled for viewport.
  const tilesAcross = 430 / 256;
  const lngSpan = (360 / Math.pow(2, zoom)) * tilesAcross;
  // Shift center ~25% west so user pin lands in the right ~75% column.
  const lngOffset = lngSpan * 0.25;
  return { lat, lng: lng - lngOffset };
}

/* ============================================================
   PAGE
   ============================================================ */

export default function ExplorePreview() {
  const { user } = useAuth();
  const authEffectiveLocationContext = useMemo(
    () =>
      ((
        user as {
          effectiveLocationContext?: EffectiveLocationContext | null;
        } | null
      )?.effectiveLocationContext ?? null) as EffectiveLocationContext | null,
    [user],
  );
  const { effectiveLocationContext: fetchedLocationContext } =
    useEffectiveLocationContext(
      Boolean(user?.id) && !authEffectiveLocationContext,
    );
  const effectiveLocationContext =
    authEffectiveLocationContext ?? fetchedLocationContext;
  const [location, navigate] = useWouterLocation();

  const firstName =
    typeof user?.name === "string" && user.name.trim().length > 0
      ? user.name.trim().split(" ")[0]
      : null;

  /* --------- location --------- */

  const [deviceCoords, setDeviceCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [discoveryRadiusKm, setDiscoveryRadiusKm] = useState<number>(() =>
    readDiscoveryRadiusKm(),
  );
  const [deviceLocationName, setDeviceLocationName] =
    useState<string>("Your area");
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "requesting" | "ready" | "denied"
  >("idle");
  const [currentDaypart] = useState<Daypart>(() => getDaypart());
  const [selectedCravingId, setSelectedCravingId] = useState<string>(
    () => DAYPART_DEFAULT_INTENT[getDaypart()],
  );
  const [activeSceneLaneId, setActiveSceneLaneId] =
    useState<ScoutSceneLaneId>("for_you");
  const [scoutSearchMode, setScoutSearchMode] = useState(false);
  const [scoutSearchQuery, setScoutSearchQuery] = useState("");
  const [scoutSearchFilter, setScoutSearchFilter] =
    useState<ScoutSearchFilterId | null>(null);
  const [scoutSourceStatuses, setScoutSourceStatuses] = useState<
    Record<ScoutSourceStatusKey, number | null>
  >({
    trucks: null,
    restaurants: null,
    mapLocations: null,
    deals: null,
    events: null,
    menus: null,
  });
  const recordScoutSourceStatus = useCallback(
    (key: ScoutSourceStatusKey, status: number) => {
      setScoutSourceStatuses((current) =>
        current[key] === status ? current : { ...current, [key]: status },
      );
    },
    [],
  );
  const userType = String((user as any)?.userType || "").toLowerCase();
  const normalizedUserType = String(userType || "")
    .trim()
    .toLowerCase();
  const userRoles = useMemo(() => {
    const roles = new Set<string>();
    const rawRoles = (user as { roles?: unknown } | null | undefined)?.roles;
    if (Array.isArray(rawRoles)) {
      rawRoles.forEach((role) => {
        const normalized = String(role || "")
          .trim()
          .toLowerCase();
        if (normalized) roles.add(normalized);
      });
    }
    if (normalizedUserType) roles.add(normalizedUserType);
    return roles;
  }, [normalizedUserType, user]);
  const isScoutPreviewEligible =
    userRoles.has("super_admin") ||
    userRoles.has("admin") ||
    userRoles.has("duper_admin");
  const isAdminFamilyUser =
    userRoles.has("super_admin") ||
    userRoles.has("admin") ||
    userRoles.has("duper_admin") ||
    userRoles.has("staff");
  const isTruckVendorUser =
    userRoles.has("food_truck") || userRoles.has("restaurant_owner");
  const scoutPreviewCity = useMemo(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return (params.get("scoutPreview") || params.get("previewCity") || "")
      .trim()
      .toLowerCase();
  }, [location]);
  const isPensacolaScoutPreview =
    isScoutPreviewEligible && scoutPreviewCity === "pensacola";
  const previewLocation = useMemo(
    () =>
      isPensacolaScoutPreview
        ? {
            label: PENSACOLA_LAUNCH_MARKET.label,
            lat: PENSACOLA_LAUNCH_MARKET.lat,
            lng: PENSACOLA_LAUNCH_MARKET.lng,
            source: "admin_preview" as const,
          }
        : null,
    [isPensacolaScoutPreview],
  );
  const manualSelectedLocation = null;
  const savedLocation = useMemo(() => {
    if (!effectiveLocationContext) return null;
    const lat = Number(effectiveLocationContext?.latitude);
    const lng = Number(effectiveLocationContext?.longitude);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
    const city = String(effectiveLocationContext.city || "").trim();
    const state = String(effectiveLocationContext.state || "").trim();
    const marketKey = String(effectiveLocationContext.marketKey || "")
      .trim()
      .toLowerCase();
    const isPensacolaDefault =
      effectiveLocationContext.source === "super_admin_default" ||
      marketKey === PENSACOLA_LAUNCH_MARKET.marketKey ||
      (city.toLowerCase() === "pensacola" && state.toLowerCase() === "fl");
    if (!hasCoords && !isPensacolaDefault) return null;
    const label = isPensacolaDefault
      ? PENSACOLA_LAUNCH_MARKET.label
      : formatScoutMarketLabel({
          city,
          state,
          marketKey,
          fallbackLabel: "Your market",
        });
    return {
      label,
      lat: hasCoords ? lat : PENSACOLA_LAUNCH_MARKET.lat,
      lng: hasCoords ? lng : PENSACOLA_LAUNCH_MARKET.lng,
      source: isPensacolaDefault
        ? ("super_admin_default" as const)
        : ("saved" as const),
    };
  }, [effectiveLocationContext]);
  const fallbackLocation = useMemo(
    () => ({
      label: PENSACOLA_LAUNCH_MARKET.label,
      lat: PENSACOLA_LAUNCH_MARKET.lat,
      lng: PENSACOLA_LAUNCH_MARKET.lng,
      source: "launch_market_default" as const,
    }),
    [],
  );
  const resolvedScoutLocation = useMemo(() => {
    if (previewLocation) return previewLocation;
    if (manualSelectedLocation) return manualSelectedLocation;
    if (savedLocation) return savedLocation;
    if (deviceCoords) {
      return {
        label: deviceLocationName || "Your area",
        lat: deviceCoords.lat,
        lng: deviceCoords.lng,
        source: "device" as const,
      };
    }
    return fallbackLocation;
  }, [deviceCoords, deviceLocationName, previewLocation, savedLocation]);
  const resolvedScoutCoords = useMemo(
    () =>
      resolvedScoutLocation
        ? { lat: resolvedScoutLocation.lat, lng: resolvedScoutLocation.lng }
        : null,
    [resolvedScoutLocation],
  );
  const showScoutPreviewDebug =
    isScoutPreviewEligible && scoutPreviewCity.length > 0;

  useEffect(() => {
    if (!showScoutPreviewDebug) return;
    console.info("[scout-preview-debug]", {
      isScoutPreviewEligible,
      scoutPreviewCity,
      isPensacolaScoutPreview,
      resolvedScoutLocation,
    });
  }, [
    isPensacolaScoutPreview,
    isScoutPreviewEligible,
    resolvedScoutLocation,
    scoutPreviewCity,
    showScoutPreviewDebug,
  ]);

  const scoutSearchIntent = useMemo(
    () => inferScoutSearchIntent(scoutSearchQuery, scoutSearchFilter),
    [scoutSearchFilter, scoutSearchQuery],
  );

  const closeScoutSearch = useCallback(() => {
    setScoutSearchMode(false);
    setScoutSearchQuery("");
    setScoutSearchFilter(null);
  }, []);

  useEffect(() => {
    if (!location.startsWith("/scout") && !location.startsWith("/map")) {
      closeScoutSearch();
    }
  }, [closeScoutSearch, location]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const requestedPreview = (
      params.get("scoutPreview") ||
      params.get("previewCity") ||
      ""
    )
      .trim()
      .toLowerCase();
    if (
      requestedPreview === "pensacola" &&
      isScoutPreviewEligible &&
      !isPensacolaScoutPreview
    ) {
      console.warn("[scout-preview-warning] pensacola requested but inactive", {
        requestedPreview,
        isScoutPreviewEligible,
        userType: normalizedUserType,
      });
    }
  }, [
    isPensacolaScoutPreview,
    isScoutPreviewEligible,
    location,
    normalizedUserType,
  ]);

  useEffect(() => {
    if (savedLocation?.source === "super_admin_default") {
      setLocationStatus("ready");
    }
    if (!isPensacolaScoutPreview || !previewLocation) return;
    setLocationStatus("ready");
    setMapCenter({ lat: previewLocation.lat, lng: previewLocation.lng });
  }, [isPensacolaScoutPreview, previewLocation, savedLocation?.source]);

  const requestLocation = useCallback(() => {
    if (isPensacolaScoutPreview && previewLocation) {
      setLocationStatus("ready");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationStatus("denied");
      return;
    }
    setLocationStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if (isPensacolaScoutPreview) return;
        setDeviceCoords({ lat: latitude, lng: longitude });
        setLocationStatus("ready");
        if (user?.id) {
          const marketKeyFallback = [
            String(effectiveLocationContext?.city || "")
              .trim()
              .toLowerCase(),
            String(effectiveLocationContext?.state || "")
              .trim()
              .toLowerCase(),
          ]
            .filter(Boolean)
            .join("-");
          const marketKey = marketKeyFallback || "device-market";
          fetch(apiUrl("/api/location/context"), {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "device",
              location: {
                marketKey,
                city: effectiveLocationContext?.city || undefined,
                state: effectiveLocationContext?.state || undefined,
                latitude,
                longitude,
              },
            }),
          }).catch(() => {});
        }
        getReverseGeocodedLocationName(latitude, longitude, (name) => {
          if (name && !isPensacolaScoutPreview) setDeviceLocationName(name);
        }).catch(() => {});
      },
      () => {
        setLocationStatus("denied");
      },
      { timeout: 10000, maximumAge: 0 },
    );
  }, [
    effectiveLocationContext,
    isPensacolaScoutPreview,
    previewLocation,
    user?.id,
  ]);

  // Auto-request on mount
  useEffect(() => {
    if (savedLocation?.source === "super_admin_default") return;
    requestLocation();
  }, [requestLocation, savedLocation?.source]);

  const updateDiscoveryRadiusKm = useCallback((value: number) => {
    const nextRadius = clampDiscoveryRadiusKm(value);
    setDiscoveryRadiusKm(nextRadius);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        DISCOVERY_RADIUS_STORAGE_KEY,
        String(nextRadius),
      );
    }
  }, []);

  const shortLocation = useMemo(() => {
    if (!resolvedScoutLocation?.label) return "Your area";
    return (
      resolvedScoutLocation.label.split(",")[0] || resolvedScoutLocation.label
    );
  }, [resolvedScoutLocation]);

  const hasResolvedLocation = useMemo(() => {
    const trimmed = (resolvedScoutLocation?.label || "").trim();
    return trimmed.length > 0 && trimmed.toLowerCase() !== "your area";
  }, [resolvedScoutLocation]);
  const isPensacolaOperatorMarket = useMemo(() => {
    const label = String(resolvedScoutLocation?.label || "")
      .trim()
      .toLowerCase();
    return (
      resolvedScoutLocation?.source === "super_admin_default" ||
      resolvedScoutLocation?.source === "admin_preview" ||
      label === PENSACOLA_LAUNCH_MARKET.label.toLowerCase() ||
      label === "pensacola"
    );
  }, [resolvedScoutLocation]);
  const scoutMarketEyebrow = isPensacolaOperatorMarket
    ? "Food around Pensacola"
    : resolvedScoutLocation?.source === "device"
      ? "Your live location"
      : hasResolvedLocation
        ? "Open near you"
        : "Nearby food";

  /* --------- trucks --------- */

  const {
    data: liveTrucksData,
    isLoading: liveTrucksLoading,
    isError: liveTrucksError,
  } = useQuery<LiveTrucksResponse>({
    queryKey: resolvedScoutLocation
      ? [
          "/api/trucks/live",
          resolvedScoutLocation.lat,
          resolvedScoutLocation.lng,
          discoveryRadiusKm,
        ]
      : ["/api/trucks/live", "no-location"],
    enabled: !!resolvedScoutLocation,
    queryFn: async () => {
      if (!resolvedScoutLocation) return { trucks: [] };
      const response = await fetch(
        `/api/trucks/live?lat=${resolvedScoutLocation.lat}&lng=${resolvedScoutLocation.lng}&radiusKm=${discoveryRadiusKm}`,
        { credentials: "include" },
      );
      recordScoutSourceStatus("trucks", response.status);
      if (!response.ok) throw new Error("Failed to load trucks");
      return response.json();
    },
    staleTime: 15_000,
    refetchInterval: 20_000,
  });

  const liveTrucks = useMemo<LiveTruckSummary[]>(() => {
    if (!liveTrucksData) return [];
    const raw = Array.isArray(liveTrucksData)
      ? liveTrucksData
      : Array.isArray(liveTrucksData.trucks)
        ? liveTrucksData.trucks
        : [];
    return raw.filter((truck) => {
      const fallbackKm =
        typeof truck.distanceMiles === "number"
          ? truck.distanceMiles * 1.609344
          : typeof truck.distance === "number"
            ? truck.distance
            : null;
      return isWithinScoutRadius(
        resolvedScoutCoords,
        truck.latitude ?? truck.lat,
        truck.longitude ?? truck.lng,
        discoveryRadiusKm,
        fallbackKm,
      );
    });
  }, [resolvedScoutCoords, discoveryRadiusKm, liveTrucksData]);

  /* --------- featured deals --------- */

  const { data: dealsData } = useQuery<DealsResponse>({
    queryKey: ["/api/deals/featured"],
    queryFn: async () => {
      const response = await fetch(`/api/deals/featured`, {
        credentials: "include",
      });
      if (!response.ok) return { deals: [] };
      return response.json();
    },
    staleTime: 60_000,
  });

  const deals = useMemo<DealSummary[]>(() => {
    if (!dealsData) return [];
    if (Array.isArray(dealsData)) return dealsData;
    if (Array.isArray(dealsData.deals)) return dealsData.deals;
    return [];
  }, [dealsData]);

  /* --------- events --------- */

  const { data: eventsData } = useQuery<EventsResponse>({
    queryKey: ["/api/events/public"],
    enabled: !!resolvedScoutLocation,
    queryFn: async () => {
      const response = await fetch(`/api/events/public`, {
        credentials: "include",
      });
      recordScoutSourceStatus("events", response.status);
      if (!response.ok) return { events: [] };
      return response.json();
    },
    staleTime: 60_000,
  });

  const events = useMemo<EventSummary[]>(() => {
    if (!eventsData) return [];
    if (Array.isArray(eventsData)) return eventsData;
    if (Array.isArray(eventsData.events)) return eventsData.events;
    return [];
  }, [eventsData]);

  const visibleEvents = useMemo<EventSummary[]>(() => {
    return events.filter((event) =>
      isWithinScoutRadius(
        resolvedScoutCoords,
        event.latitude ?? event.lat ?? event.venueLat,
        event.longitude ?? event.lng ?? event.venueLng,
        discoveryRadiusKm,
      ),
    );
  }, [resolvedScoutCoords, discoveryRadiusKm, events]);

  const mapBoundsForScout = useMemo(
    () =>
      resolvedScoutLocation
        ? getBoundsForScoutLocation(resolvedScoutLocation, discoveryRadiusKm)
        : null,
    [resolvedScoutLocation, discoveryRadiusKm],
  );

  const { data: mapLocationsData } = useQuery<MapLocationsResponse>({
    queryKey: mapBoundsForScout
      ? [
          "/api/map/locations",
          mapBoundsForScout.north,
          mapBoundsForScout.south,
          mapBoundsForScout.east,
          mapBoundsForScout.west,
          discoveryRadiusKm,
        ]
      : ["/api/map/locations", "no-bounds"],
    enabled: !!mapBoundsForScout,
    queryFn: async () => {
      if (!mapBoundsForScout) return { hostLocations: [] };
      const params = new URLSearchParams({
        north: String(mapBoundsForScout.north),
        south: String(mapBoundsForScout.south),
        east: String(mapBoundsForScout.east),
        west: String(mapBoundsForScout.west),
        zoom: "13",
      });
      const response = await fetch(
        apiUrl(`/api/map/locations?${params.toString()}`),
        {
          credentials: "include",
        },
      );
      recordScoutSourceStatus("mapLocations", response.status);
      if (!response.ok) return { hostLocations: [] };
      return response.json();
    },
    staleTime: 45_000,
    retry: false,
  });

  const allScoutHostLocations = useMemo<ScoutHostLocation[]>(() => {
    const rows = Array.isArray(mapLocationsData?.hostLocations)
      ? mapLocationsData.hostLocations
      : [];
    return rows;
  }, [mapLocationsData]);

  const visibleHosts = useMemo<ScoutHostLocation[]>(() => {
    return allScoutHostLocations.filter((host) =>
      isWithinScoutRadius(
        resolvedScoutCoords,
        readNumberField(host, ["latitude", "lat"]),
        readNumberField(host, ["longitude", "lng"]),
        discoveryRadiusKm,
      ),
    );
  }, [allScoutHostLocations, discoveryRadiusKm, resolvedScoutCoords]);

  const mapHostLocations = useMemo<ScoutHostLocation[]>(() => {
    const rows = allScoutHostLocations.filter(
      (host) =>
        readNumberField(host, ["latitude", "lat"]) !== null &&
        readNumberField(host, ["longitude", "lng"]) !== null,
    );
    const nearbyHosts = rows.filter((host) =>
      isWithinScoutRadius(
        resolvedScoutCoords,
        readNumberField(host, ["latitude", "lat"]),
        readNumberField(host, ["longitude", "lng"]),
        discoveryRadiusKm,
      ),
    );
    return nearbyHosts.length > 0 ? nearbyHosts : rows;
  }, [allScoutHostLocations, discoveryRadiusKm, resolvedScoutCoords]);

  const visibleMapEventLocations = useMemo<ScoutMapEventLocation[]>(() => {
    const rows = Array.isArray(mapLocationsData?.eventLocations)
      ? mapLocationsData.eventLocations
      : [];
    return rows.filter(
      (host) =>
        readNumberField(host, ["hostLatitude", "latitude", "lat"]) !== null &&
        readNumberField(host, ["hostLongitude", "longitude", "lng"]) !== null,
    );
  }, [mapLocationsData]);

  const { data: parkingPassData } = useQuery<ScoutParkingPassListing[]>({
    queryKey: ["/api/parking-pass", "scout-map"],
    enabled: !!resolvedScoutLocation,
    queryFn: async () => {
      const response = await fetch(apiUrl("/api/parking-pass"), {
        credentials: "include",
      });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60_000,
    retry: false,
  });

  const visibleParkingPassListings = useMemo<ScoutParkingPassListing[]>(() => {
    const rows = Array.isArray(parkingPassData) ? parkingPassData : [];
    return rows.filter((listing) => {
      const host = listing.host;
      if (!host) return false;
      if (!isScoutMapWindowActiveNow(listing)) return false;
      return true;
    });
  }, [parkingPassData]);

  const parkedTrucksByHostKey = useMemo(() => {
    const byHost = new Map<
      string,
      NonNullable<MapAdapterMarker["parkedTrucks"]>
    >();
    const addTruck = (
      host: ScoutHostLocation,
      truck: NonNullable<MapAdapterMarker["parkedTrucks"]>[number],
    ) => {
      const key = getScoutHostMarkerKey(host);
      const existing = byHost.get(key) || [];
      const truckKey = String(truck.id || truck.name).toLowerCase();
      if (
        !existing.some(
          (item) => String(item.id || item.name).toLowerCase() === truckKey,
        )
      ) {
        existing.push(truck);
      }
      byHost.set(key, existing);
    };

    for (const listing of visibleParkingPassListings) {
      const host = listing.host;
      if (!host || !Array.isArray(listing.bookings)) continue;
      for (const booking of listing.bookings) {
        const truckName = String(booking.truckName || "").trim();
        if (!truckName) continue;
        const truckId = String(booking.truckId || "").trim();
        addTruck(host, {
          id: truckId || null,
          name: truckName,
          href: truckId ? `/truck/${encodeURIComponent(truckId)}` : null,
          source: "parking_pass",
          slotLabel: booking.slotType || null,
        });
      }
    }

    for (const event of visibleMapEventLocations) {
      if (!isScoutMapWindowActiveNow(event)) continue;
      const truckName = String(event.truckName || "").trim();
      if (!truckName) continue;
      const truckId = String(
        event.truckId || event.bookedRestaurantId || "",
      ).trim();
      const eventHostId = String(event.hostId || "").trim();
      const eventAddress = normalizeScoutLocationAddress(
        event.hostAddress,
        event.hostCity,
        event.hostState,
      );
      const eventLat = readNumberField(event, [
        "hostLatitude",
        "latitude",
        "lat",
      ]);
      const eventLng = readNumberField(event, [
        "hostLongitude",
        "longitude",
        "lng",
      ]);
      for (const host of mapHostLocations) {
        const hostIds = [host.hostId, host.id]
          .map((value) => String(value || "").trim())
          .filter(Boolean);
        const idMatches = Boolean(eventHostId && hostIds.includes(eventHostId));
        const addressMatches = Boolean(
          eventAddress &&
          eventAddress ===
            normalizeScoutLocationAddress(host.address, host.city, host.state),
        );
        const hostLat = readNumberField(host, ["latitude", "lat"]);
        const hostLng = readNumberField(host, ["longitude", "lng"]);
        const coordinateMatches =
          eventLat !== null &&
          eventLng !== null &&
          hostLat !== null &&
          hostLng !== null &&
          getDistanceMiles(
            { lat: eventLat, lng: eventLng },
            { lat: hostLat, lng: hostLng },
          ) <= 0.08;
        if (!idMatches && !addressMatches && !coordinateMatches) continue;
        addTruck(host, {
          id: truckId || null,
          name: truckName,
          href: truckId ? `/truck/${encodeURIComponent(truckId)}` : null,
          source:
            event.type === "truck_manual_schedule"
              ? "manual_schedule"
              : "event",
          slotLabel:
            event.startTime && event.endTime
              ? `${event.startTime} - ${event.endTime}`
              : null,
        });
      }
    }

    return byHost;
  }, [mapHostLocations, visibleMapEventLocations, visibleParkingPassListings]);

  /* --------- nearby restaurants --------- */

  const { data: nearbyRestaurantsData, isLoading: nearbyRestaurantsLoading } =
    useQuery<RestaurantSummary[]>({
      queryKey: resolvedScoutLocation
        ? [
            "/api/restaurants/subscribed",
            resolvedScoutLocation.lat,
            resolvedScoutLocation.lng,
            discoveryRadiusKm,
          ]
        : ["/api/restaurants/subscribed", "no-location"],
      enabled: !!resolvedScoutLocation,
      queryFn: async () => {
        if (!resolvedScoutLocation) return [];
        const response = await fetch(
          `/api/restaurants/subscribed/${resolvedScoutLocation.lat}/${resolvedScoutLocation.lng}?radius=${discoveryRadiusKm}`,
          { credentials: "include" },
        );
        recordScoutSourceStatus("restaurants", response.status);
        if (!response.ok) return [];
        return response.json();
      },
      staleTime: 120_000,
    });

  const { data: nearbyPublicRestaurantsData } = useQuery<RestaurantSummary[]>({
    queryKey: resolvedScoutLocation
      ? [
          "/api/restaurants/nearby",
          resolvedScoutLocation.lat,
          resolvedScoutLocation.lng,
          discoveryRadiusKm,
        ]
      : ["/api/restaurants/nearby", "no-location"],
    enabled: !!resolvedScoutLocation,
    queryFn: async () => {
      if (!resolvedScoutLocation) return [];
      const response = await fetch(
        `/api/restaurants/nearby/${resolvedScoutLocation.lat}/${resolvedScoutLocation.lng}?radius=${discoveryRadiusKm}`,
        { credentials: "include" },
      );
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 120_000,
  });

  const nearbyFoodBusinesses = useMemo<RestaurantSummary[]>(() => {
    const byId = new Map<string, RestaurantSummary>();
    for (const restaurant of [
      ...(Array.isArray(nearbyRestaurantsData) ? nearbyRestaurantsData : []),
      ...(Array.isArray(nearbyPublicRestaurantsData)
        ? nearbyPublicRestaurantsData
        : []),
    ]) {
      const id = String(restaurant?.id || "").trim();
      if (!id || byId.has(id)) continue;
      byId.set(id, restaurant);
    }
    return Array.from(byId.values()).filter((restaurant) => {
      const fallbackKm =
        typeof restaurant.distanceMiles === "number"
          ? restaurant.distanceMiles * 1.609344
          : typeof restaurant.distance === "number"
            ? restaurant.distance
            : null;
      return isWithinScoutRadius(
        resolvedScoutCoords,
        restaurant.latitude ?? restaurant.lat,
        restaurant.longitude ?? restaurant.lng,
        discoveryRadiusKm,
        fallbackKm,
      );
    });
  }, [
    resolvedScoutCoords,
    discoveryRadiusKm,
    nearbyPublicRestaurantsData,
    nearbyRestaurantsData,
  ]);

  const nearbyRestaurants = useMemo<RestaurantSummary[]>(() => {
    return nearbyFoodBusinesses.filter(
      (restaurant) => getScoutRestaurantLikeKind(restaurant) === "restaurant",
    );
  }, [nearbyFoodBusinesses]);

  const nearbyFoodTruckBusinesses = useMemo<RestaurantSummary[]>(() => {
    return nearbyFoodBusinesses.filter(
      (restaurant) => getScoutRestaurantLikeKind(restaurant) === "food_truck",
    );
  }, [nearbyFoodBusinesses]);

  const restaurantMenuPreviewQueries = useQueries({
    queries: nearbyRestaurants.slice(0, 8).map((restaurant) => ({
      queryKey: ["/api/restaurants", restaurant.id, "featured-item"],
      queryFn: async (): Promise<MenuPreviewItem[]> => {
        const response = await fetch(
          `/api/restaurants/${encodeURIComponent(String(restaurant.id))}/featured-item`,
          { credentials: "include" },
        );
        if (!response.ok) return [];
        const data = await response.json();
        return data?.item ? [data.item] : [];
      },
      staleTime: 120_000,
      retry: false,
    })),
  });

  const menuPreviewByRestaurantId = useMemo(() => {
    const map = new Map<string, MenuPreviewItem[]>();
    nearbyRestaurants.slice(0, 8).forEach((restaurant, index) => {
      const result = restaurantMenuPreviewQueries[index];
      map.set(
        String(restaurant.id),
        Array.isArray(result?.data) ? result.data : [],
      );
    });
    return map;
  }, [nearbyRestaurants, restaurantMenuPreviewQueries]);

  const { data: localMenuItemsData = [] } = useQuery<LocalMenuItemFeedItem[]>({
    queryKey: resolvedScoutLocation
      ? [
          "/api/menus/local-items",
          resolvedScoutLocation.lat,
          resolvedScoutLocation.lng,
          discoveryRadiusKm,
        ]
      : ["/api/menus/local-items", "no-location"],
    enabled: !!resolvedScoutLocation,
    queryFn: async () => {
      if (!resolvedScoutLocation) return [];
      const response = await fetch(
        `/api/menus/local-items?lat=${resolvedScoutLocation.lat}&lng=${resolvedScoutLocation.lng}&radiusKm=${discoveryRadiusKm}&limit=24`,
        { credentials: "include" },
      );
      recordScoutSourceStatus("menus", response.status);
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data?.items) ? data.items : [];
    },
    staleTime: 120_000,
    retry: false,
  });

  const localMenuItems = useMemo<LocalMenuItemFeedItem[]>(() => {
    return Array.isArray(localMenuItemsData) ? localMenuItemsData : [];
  }, [localMenuItemsData]);

  const { data: trendingData } = useQuery<ScoutTrendingResponse>({
    queryKey: ["/api/public/trending", "scout", 7],
    queryFn: async () => {
      const response = await fetch("/api/public/trending?limit=12&days=7", {
        credentials: "include",
      });
      if (!response.ok) {
        return {
          generatedAt: new Date(0).toISOString(),
          windowDays: 7,
          items: [],
          places: [],
        };
      }
      return response.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const { data: favoriteRestaurantsData = [] } = useQuery<any[]>({
    queryKey: ["/api/favorites/restaurants", "scout"],
    enabled: !!user,
    queryFn: async () => {
      const response = await fetch("/api/favorites/restaurants", {
        credentials: "include",
      });
      if (!response.ok) return [];
      return response.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const { data: followedRestaurantsData = [] } = useQuery<any[]>({
    queryKey: ["/api/following/restaurants", "scout"],
    enabled: !!user,
    queryFn: async () => {
      const response = await fetch("/api/following/restaurants", {
        credentials: "include",
      });
      if (!response.ok) return [];
      return response.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const { data: recommendedRestaurantsData = [] } = useQuery<any[]>({
    queryKey: ["/api/recommendations/restaurants", "scout"],
    enabled: !!user,
    queryFn: async () => {
      const response = await fetch("/api/recommendations/restaurants", {
        credentials: "include",
      });
      if (!response.ok) return [];
      return response.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const restaurantRelationships =
    useMemo<RestaurantRelationshipSnapshot>(() => {
      const pickId = (row: any) =>
        String(row?.restaurantId || row?.restaurant?.id || "").trim();
      return {
        favoriteIds: new Set(
          favoriteRestaurantsData.map(pickId).filter((id) => id.length > 0),
        ),
        followIds: new Set(
          followedRestaurantsData.map(pickId).filter((id) => id.length > 0),
        ),
        recommendationIds: new Set(
          recommendedRestaurantsData.map(pickId).filter((id) => id.length > 0),
        ),
      };
    }, [
      favoriteRestaurantsData,
      followedRestaurantsData,
      recommendedRestaurantsData,
    ]);

  /* --------- nearby deals (location-aware) --------- */

  const { data: nearbyDealsData } = useQuery<DealSummary[]>({
    queryKey: resolvedScoutLocation
      ? [
          "/api/deals/nearby",
          resolvedScoutLocation.lat,
          resolvedScoutLocation.lng,
          discoveryRadiusKm,
        ]
      : ["/api/deals/nearby", "no-location"],
    enabled: !!resolvedScoutLocation,
    queryFn: async () => {
      if (!resolvedScoutLocation) return [];
      const response = await fetch(
        `/api/deals/nearby/${resolvedScoutLocation.lat}/${resolvedScoutLocation.lng}?radius=${discoveryRadiusKm}`,
        { credentials: "include" },
      );
      recordScoutSourceStatus("deals", response.status);
      if (!response.ok) return [];
      const data = await response.json();
      if (Array.isArray(data)) return data;
      if (Array.isArray(data.deals)) return data.deals;
      return [];
    },
    staleTime: 60_000,
  });

  const nearbyDeals = useMemo<DealSummary[]>(() => {
    if (!nearbyDealsData) return [];
    if (Array.isArray(nearbyDealsData)) return nearbyDealsData;
    return [];
  }, [nearbyDealsData]);

  // Scout is a local dashboard. Do not leak global featured deals into this lane.
  const allDeals = useMemo<DealSummary[]>(() => {
    const seen = new Set<string>();
    const merged: DealSummary[] = [];
    for (const d of nearbyDeals) {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        merged.push(d);
      }
    }
    return merged;
  }, [nearbyDeals]);

  const marketCity = useMemo(() => {
    const label = String(resolvedScoutLocation?.label || "").trim();
    return label ? label.split(",")[0]?.trim().toLowerCase() || "" : "";
  }, [resolvedScoutLocation]);
  const marketState = useMemo(() => {
    const label = String(resolvedScoutLocation?.label || "").trim();
    return label.includes(",")
      ? label.split(",")[1]?.trim().toLowerCase() || ""
      : "";
  }, [resolvedScoutLocation]);

  const trendingPlacesThisWeek = useMemo(() => {
    const places = Array.isArray(trendingData?.places)
      ? trendingData.places
      : [];
    if (!marketCity && !marketState) return [];
    return places
      .filter((place) => {
        const placeCity = String(place.city || "")
          .trim()
          .toLowerCase();
        const placeState = String(place.state || "")
          .trim()
          .toLowerCase();
        if (marketCity && placeCity === marketCity) return true;
        return Boolean(marketState && placeState === marketState);
      })
      .slice(0, 8);
  }, [marketCity, marketState, trendingData?.places]);

  const popularDishes = useMemo(() => {
    const items = Array.isArray(trendingData?.items) ? trendingData.items : [];
    const localItems = items.filter((item) => {
      const itemCity = String(item.restaurantCity || "")
        .trim()
        .toLowerCase();
      const itemState = String(item.restaurantState || "")
        .trim()
        .toLowerCase();
      if (marketCity && itemCity === marketCity) return true;
      return Boolean(marketState && itemState === marketState);
    });
    return localItems.slice(0, 8);
  }, [marketCity, marketState, trendingData?.items]);

  const newToMealScoutRestaurants = useMemo(() => {
    const freshRows = nearbyRestaurants
      .map((restaurant) => ({
        restaurant,
        createdAt: readStringField(restaurant, ["createdAt"]),
      }))
      .filter(
        (
          value,
        ): value is {
          restaurant: RestaurantSummary;
          createdAt: string;
        } => Boolean(value.createdAt),
      )
      .filter(({ createdAt }) => {
        const createdAtMs = new Date(createdAt).getTime();
        if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return false;
        const ageDays = (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24);
        return ageDays <= 45;
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .map(({ restaurant }) => restaurant);
    return freshRows.slice(0, 8);
  }, [nearbyRestaurants]);

  const happyHourDeals = useMemo(() => {
    return allDeals.filter((deal) => {
      const haystack =
        `${deal.title || ""} ${deal.description || ""}`.toLowerCase();
      return haystack.includes("happy hour");
    });
  }, [allDeals]);

  const fallbackTruckBusinesses = useMemo<LiveTruckSummary[]>(
    () =>
      nearbyFoodTruckBusinesses.map((restaurant) => ({
        id: String(restaurant.id),
        name: getRestaurantName(restaurant),
        cuisineType: restaurant.cuisineType ?? null,
        imageUrl:
          restaurant.imageUrl ??
          restaurant.coverImageUrl ??
          restaurant.heroImageUrl ??
          restaurant.logoUrl ??
          null,
        coverImageUrl:
          restaurant.coverImageUrl ??
          restaurant.heroImageUrl ??
          restaurant.imageUrl ??
          null,
        logoUrl: restaurant.logoUrl ?? null,
        city: restaurant.city ?? null,
        state: restaurant.state ?? null,
        address: restaurant.address ?? null,
        latitude: restaurant.latitude ?? restaurant.lat ?? null,
        longitude: restaurant.longitude ?? restaurant.lng ?? null,
        distanceMiles: restaurant.distanceMiles ?? null,
        distance:
          typeof restaurant.distance === "number"
            ? restaurant.distance
            : typeof restaurant.distanceMiles === "number"
              ? restaurant.distanceMiles * 1.609344
              : null,
        mobileOnline: false,
        activeDealCount: Number(
          restaurant.activeDealsCount || restaurant.activeDealCount || 0,
        ),
      })),
    [nearbyFoodTruckBusinesses],
  );

  const scoutTruckInventory = useMemo(() => {
    const byId = new Map<string, LiveTruckSummary>();
    liveTrucks.forEach((truck) => byId.set(String(truck.id), truck));
    fallbackTruckBusinesses.forEach((truck) => {
      if (!byId.has(String(truck.id))) byId.set(String(truck.id), truck);
    });
    return Array.from(byId.values());
  }, [fallbackTruckBusinesses, liveTrucks]);

  /* --------- markers for the hero map --------- */

  const truckMarkers = useMemo<MapAdapterMarker[]>(() => {
    return scoutTruckInventory
      .map((t) => {
        const lat = t.latitude ?? t.lat;
        const lng = t.longitude ?? t.lng;
        if (typeof lat !== "number" || typeof lng !== "number") return null;
        const isServing = isTruckServingNow(t);
        return {
          id: String(t.id),
          sourceId: String(t.id),
          kind: "truck" as const,
          lat,
          lng,
          title: t.name,
          subtitle: getMapMarkerSubtitle(t.cuisineType, {
            kind: "truck",
            updatedAt: readStringField(t, ["updatedAt", "lastUpdatedAt"]),
            confirmedAt: readStringField(t, ["confirmedAt", "lastConfirmedAt"]),
            hasDeal: Boolean(t.activeDealCount && t.activeDealCount > 0),
            hasDistance: Boolean(formatDistance(t)),
            isOpen: isServing,
          }),
          color: getMapMarkerColor({
            kind: "truck",
            hasDeal: Boolean(t.activeDealCount && t.activeDealCount > 0),
            isOpen: isServing,
          }),
        } as MapAdapterMarker;
      })
      .filter((m): m is MapAdapterMarker => m !== null);
  }, [scoutTruckInventory]);
  const liveTruckById = useMemo(() => {
    const map = new Map<string, LiveTruckSummary>();
    for (const truck of scoutTruckInventory) map.set(String(truck.id), truck);
    return map;
  }, [scoutTruckInventory]);

  const restaurantMarkers = useMemo<MapAdapterMarker[]>(() => {
    return nearbyRestaurants
      .map((r) => {
        const lat = r.latitude ?? r.lat;
        const lng = r.longitude ?? r.lng;
        if (typeof lat !== "number" || typeof lng !== "number") return null;
        const dealCount = Number(r.activeDealsCount || r.activeDealCount || 0);
        const hasCommunityUpdate =
          Number(r.communityActivityCount || 0) > 0 ||
          Number(r.recommendationCount || 0) > 0 ||
          Number(r.videoRecommendationCount || 0) > 0;
        const freshnessMeta: FreshnessMeta = {
          kind: "restaurant",
          updatedAt: readStringField(r, ["updatedAt", "lastUpdatedAt"]),
          confirmedAt: readStringField(r, ["confirmedAt", "lastConfirmedAt"]),
          hasDeal: dealCount > 0,
          hasCommunityUpdate,
          hasDistance: Boolean(getRestaurantDistance(r)),
          isOpen: true,
        };
        return {
          id: `restaurant-${r.id}`,
          sourceId: String(r.id),
          kind: "restaurant" as const,
          lat,
          lng,
          title: r.businessName ?? r.name ?? undefined,
          subtitle: getMapMarkerSubtitle(r.cuisineType, freshnessMeta),
          color: getMapMarkerColor(freshnessMeta),
        } as MapAdapterMarker;
      })
      .filter((m): m is MapAdapterMarker => m !== null);
  }, [nearbyRestaurants]);

  const eventMarkers = useMemo<MapAdapterMarker[]>(() => {
    return visibleEvents
      .map((e) => {
        const lat = e.latitude ?? e.lat ?? e.venueLat;
        const lng = e.longitude ?? e.lng ?? e.venueLng;
        if (typeof lat !== "number" || typeof lng !== "number") return null;
        const freshnessMeta: FreshnessMeta = {
          kind: "event",
          startsAt: e.startsAt,
          startTime: e.startTime,
          updatedAt: readStringField(e, ["updatedAt", "lastUpdatedAt"]),
          confirmedAt: readStringField(e, ["confirmedAt", "lastConfirmedAt"]),
        };
        return {
          id: `event-${e.id}`,
          sourceId: String(e.id),
          kind: "event" as const,
          lat,
          lng,
          title: e.title ?? e.name ?? undefined,
          subtitle: getMapMarkerSubtitle(
            e.venueName ?? e.locationName,
            freshnessMeta,
          ),
          color: getMapMarkerColor(freshnessMeta),
        } as MapAdapterMarker;
      })
      .filter((m): m is MapAdapterMarker => m !== null);
  }, [visibleEvents]);

  const hostMarkers = useMemo<MapAdapterMarker[]>(() => {
    return mapHostLocations
      .map((host) => {
        const lat = readNumberField(host, ["latitude", "lat"]);
        const lng = readNumberField(host, ["longitude", "lng"]);
        if (lat === null || lng === null) return null;
        const hostKey = getScoutHostMarkerKey(host);
        const parkedTrucks = parkedTrucksByHostKey.get(hostKey) || [];
        const address = [host.address, host.city, host.state]
          .filter(Boolean)
          .join(", ");
        const title = host.businessName || host.name || "Host location";
        return {
          id: `host-${hostKey}`,
          sourceId: hostKey,
          kind: "parking" as const,
          lat,
          lng,
          title,
          subtitle:
            parkedTrucks.length > 0
              ? formatScoutCount(
                  parkedTrucks.length,
                  "truck parked here",
                  "trucks parked here",
                )
              : getMapMarkerSubtitle(address || "Host location", {
                  kind: "host",
                  updatedAt: readStringField(host, [
                    "updatedAt",
                    "lastUpdatedAt",
                  ]),
                  confirmedAt: readStringField(host, [
                    "confirmedAt",
                    "lastConfirmedAt",
                  ]),
                }),
          color: parkedTrucks.length > 0 ? "#fb923c" : "#f59e0b",
          address,
          spotImageUrl: host.spotImageUrl || null,
          parkedTrucks,
          parkingStatus: parkedTrucks.length > 0 ? "occupied" : "available",
        } as MapAdapterMarker;
      })
      .filter((m): m is MapAdapterMarker => Boolean(m && m.sourceId));
  }, [mapHostLocations, parkedTrucksByHostKey]);

  const dealMarkers = useMemo<MapAdapterMarker[]>(() => {
    return nearbyDeals
      .map((deal) => {
        const lat = readNumberField(deal, [
          "latitude",
          "lat",
          "restaurantLatitude",
          "restaurantLat",
          "locationLat",
        ]);
        const lng = readNumberField(deal, [
          "longitude",
          "lng",
          "restaurantLongitude",
          "restaurantLng",
          "locationLng",
        ]);
        if (lat === null || lng === null) return null;
        return {
          id: `deal-${deal.id}`,
          sourceId: String(deal.id),
          kind: "deal" as const,
          lat,
          lng,
          title: deal.title || "Deal today",
          subtitle: getMapMarkerSubtitle(deal.restaurantName || "Nearby", {
            kind: "deal",
            hasDeal: true,
          }),
          color: "#fb923c",
        } as MapAdapterMarker;
      })
      .filter((m): m is MapAdapterMarker => Boolean(m));
  }, [nearbyDeals]);

  // Combined markers for the full Google Map view
  const allMapMarkers = useMemo<MapAdapterMarker[]>(
    () => [
      ...truckMarkers,
      ...restaurantMarkers,
      ...eventMarkers,
      ...hostMarkers,
      ...dealMarkers,
    ],
    [truckMarkers, restaurantMarkers, eventMarkers, hostMarkers, dealMarkers],
  );

  const scoutDebugCounts = useMemo(() => {
    const rawLiveTruckRows = Array.isArray(liveTrucksData)
      ? liveTrucksData
      : Array.isArray(liveTrucksData?.trucks)
        ? liveTrucksData.trucks
        : [];
    const rawRestaurantRows = Array.isArray(nearbyRestaurantsData)
      ? nearbyRestaurantsData
      : [];
    const rawHostRows = Array.isArray(mapLocationsData?.hostLocations)
      ? mapLocationsData.hostLocations
      : [];
    const rawEventRows = Array.isArray(events) ? events : [];
    const rawDealRows = Array.isArray(nearbyDeals) ? nearbyDeals : [];

    const hasCoords = (row: unknown) =>
      readNumberField(row, [
        "latitude",
        "lat",
        "venueLat",
        "restaurantLatitude",
        "locationLat",
      ]) !== null &&
      readNumberField(row, [
        "longitude",
        "lng",
        "venueLng",
        "restaurantLongitude",
        "locationLng",
      ]) !== null;

    const pinsByKind = allMapMarkers.reduce<Record<string, number>>(
      (acc, marker) => {
        acc[marker.kind] = (acc[marker.kind] || 0) + 1;
        return acc;
      },
      {},
    );

    return {
      trucksReturned: rawLiveTruckRows.length,
      trucksMissingCoords: rawLiveTruckRows.filter((row) => !hasCoords(row))
        .length,
      trucksShown: scoutTruckInventory.length,
      restaurantsReturned: rawRestaurantRows.length,
      restaurantsMissingCoords: rawRestaurantRows.filter(
        (row) => !hasCoords(row),
      ).length,
      hostsReturned: rawHostRows.length,
      hostsMissingCoords: rawHostRows.filter((row) => !hasCoords(row)).length,
      hostsShown: mapHostLocations.length,
      eventsReturned: rawEventRows.length,
      eventsMissingCoords: rawEventRows.filter((row) => !hasCoords(row)).length,
      dealsReturned: rawDealRows.length,
      dealsMissingCoords: rawDealRows.filter((row) => !hasCoords(row)).length,
      mapPinsBuilt: allMapMarkers.length,
      mapPinsByKind: pinsByKind,
    };
  }, [
    allMapMarkers,
    events,
    liveTrucksData,
    mapLocationsData,
    nearbyDeals,
    nearbyRestaurantsData,
    scoutTruckInventory.length,
    mapHostLocations.length,
  ]);

  const [activeMapLayers, setActiveMapLayers] = useState<MapLayerState>({
    openNow: true,
    foodTrucks: true,
    deals: true,
    happeningToday: true,
  });

  const filteredMapMarkers = useMemo<MapAdapterMarker[]>(() => {
    const searchTerms = tokenizeScoutSearch(scoutSearchQuery);
    return allMapMarkers.filter((marker) => {
      let layerAllowed = true;
      if (marker.kind === "truck")
        layerAllowed = activeMapLayers.foodTrucks && activeMapLayers.openNow;
      if (marker.kind === "event")
        layerAllowed = activeMapLayers.happeningToday;
      if (marker.kind === "parking") {
        const hasParkedTruck = Boolean(marker.parkedTrucks?.length);
        layerAllowed =
          activeMapLayers.happeningToday ||
          (hasParkedTruck && activeMapLayers.foodTrucks);
      }
      if (marker.kind === "deal") layerAllowed = activeMapLayers.deals;
      if (marker.kind === "restaurant") {
        const restaurant = nearbyRestaurants.find(
          (item) => String(item.id) === String(marker.sourceId),
        );
        const hasDeal = Boolean(
          restaurant &&
          Number(
            restaurant.activeDealsCount || restaurant.activeDealCount || 0,
          ) > 0,
        );
        layerAllowed =
          activeMapLayers.openNow || (hasDeal && activeMapLayers.deals);
        if (hasDeal && !activeMapLayers.deals) layerAllowed = false;
      }
      if (!layerAllowed) return false;
      if (scoutSearchMode) {
        if (!matchesScoutSearchText(marker, searchTerms)) return false;
        if (!matchesScoutIntent(marker, scoutSearchIntent, marker.kind))
          return false;
      }
      return true;
    });
  }, [
    activeMapLayers,
    allMapMarkers,
    nearbyRestaurants,
    scoutSearchIntent,
    scoutSearchMode,
    scoutSearchQuery,
  ]);

  const sceneFilteredMapMarkers = useMemo<MapAdapterMarker[]>(() => {
    if (activeSceneLaneId === "for_you") return filteredMapMarkers;
    if (activeSceneLaneId === "community")
      return filteredMapMarkers.filter(
        (marker) =>
          marker.kind === "restaurant" ||
          marker.kind === "truck" ||
          marker.kind === "parking",
      );
    if (activeSceneLaneId === "nearby_now")
      return filteredMapMarkers.filter(
        (marker) =>
          marker.kind === "truck" ||
          marker.kind === "restaurant" ||
          marker.kind === "parking",
      );
    if (activeSceneLaneId === "food_trucks")
      return filteredMapMarkers.filter((marker) => marker.kind === "truck");
    if (activeSceneLaneId === "restaurants")
      return filteredMapMarkers.filter(
        (marker) => marker.kind === "restaurant",
      );
    if (activeSceneLaneId === "deals")
      return filteredMapMarkers.filter(
        (marker) => marker.kind === "restaurant" || marker.kind === "deal",
      );
    if (activeSceneLaneId === "events")
      return filteredMapMarkers.filter(
        (marker) => marker.kind === "event" || marker.kind === "parking",
      );
    if (activeSceneLaneId === "new_menus")
      return filteredMapMarkers.filter(
        (marker) => marker.kind === "restaurant" || marker.kind === "truck",
      );
    if (activeSceneLaneId === "late_night")
      return filteredMapMarkers.filter(
        (marker) =>
          marker.kind === "restaurant" ||
          marker.kind === "event" ||
          marker.kind === "parking",
      );
    if (activeSceneLaneId === "worth_discovering")
      return filteredMapMarkers.filter(
        (marker) => marker.kind === "restaurant" || marker.kind === "truck",
      );
    return filteredMapMarkers;
  }, [activeSceneLaneId, filteredMapMarkers]);

  const toggleMapLayer = useCallback((layer: MapLayerId) => {
    setActiveMapLayers((current) => ({
      ...current,
      [layer]: !current[layer],
    }));
  }, []);

  useEffect(() => {
    if (activeSceneLaneId === "food_trucks") {
      setActiveMapLayers({
        openNow: true,
        foodTrucks: true,
        deals: false,
        happeningToday: false,
      });
      return;
    }
    if (activeSceneLaneId === "restaurants") {
      setActiveMapLayers({
        openNow: true,
        foodTrucks: false,
        deals: true,
        happeningToday: false,
      });
      return;
    }
    if (activeSceneLaneId === "deals") {
      setActiveMapLayers({
        openNow: false,
        foodTrucks: false,
        deals: true,
        happeningToday: false,
      });
      return;
    }
    if (activeSceneLaneId === "events" || activeSceneLaneId === "late_night") {
      setActiveMapLayers({
        openNow: false,
        foodTrucks: false,
        deals: false,
        happeningToday: true,
      });
      return;
    }
    setActiveMapLayers({
      openNow: true,
      foodTrucks: true,
      deals: true,
      happeningToday: true,
    });
  }, [activeSceneLaneId]);

  /* --------- map state --------- */

  const HERO_ZOOM = 14;
  const [mapZoom, setMapZoom] = useState<number>(HERO_ZOOM);
  const [mapCenter, setMapCenter] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const userPushedMapRef = useRef(false);
  const [sheetState, setSheetState] = useState<"default" | "fullMap">(
    "default",
  );
  const [selectedLiveTruck, setSelectedLiveTruck] =
    useState<LiveTruckSummary | null>(null);
  const [selectedMapMarker, setSelectedMapMarker] =
    useState<MapAdapterMarker | null>(null);
  const [mapBounds, setMapBounds] = useState<MapBoundsLike | null>(null);
  // Once the full map has been opened once, keep GoogleMapSurface mounted
  // (just hidden) so it doesn't re-initialize on every collapse/expand.
  // Using state (not ref) so React re-renders when the map should first mount.
  const [hasOpenedFullMap, setHasOpenedFullMap] = useState(false);
  const googleMapContainerRef = useRef<HTMLDivElement | null>(null);
  const [googleMapFailed, setGoogleMapFailed] = useState(false);
  const { data: mapRuntime } = useQuery<MapRuntimeResponse>({
    queryKey: ["/api/map/runtime"],
    queryFn: async () => {
      const response = await fetch("/api/map/runtime");
      if (!response.ok) {
        return { hasGoogleMapsKey: false, googleMapsApiKey: null };
      }
      return response.json();
    },
    retry: 3,
    retryDelay: 800,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
  const runtimeGoogleMapsApiKey = String(
    mapRuntime?.googleMapsApiKey || "",
  ).trim();
  const runtimeGoogleMapsMapId = String(
    mapRuntime?.googleMapsMapId || "",
  ).trim();
  const mapRuntimeResolved = mapRuntime !== undefined;
  const buildGoogleMapsMapId = String(
    (import.meta as any).env?.VITE_GOOGLE_MAPS_MAP_ID || "",
  ).trim();
  const effectiveGoogleMapsApiKey =
    runtimeGoogleMapsApiKey ||
    (mapRuntimeResolved ? GOOGLE_MAPS_WEB_API_KEY : "");
  const effectiveGoogleMapsMapId =
    runtimeGoogleMapsMapId || buildGoogleMapsMapId;
  const hasMapKey = effectiveGoogleMapsApiKey.length > 0;

  const openScoutMap = useCallback(() => {
    if (resolvedScoutCoords) {
      setMapCenter(resolvedScoutCoords);
    }
    setHasOpenedFullMap(true);
    setGoogleMapFailed(false);
    setSheetState("fullMap");
  }, [resolvedScoutCoords]);

  const collapseScoutMap = useCallback(() => {
    setSheetState("default");
    setSelectedLiveTruck(null);
    setSelectedMapMarker(null);
  }, []);

  useEffect(() => {
    if (!hasMapKey) return;
    if (sheetState !== "default") return;
    if (typeof window === "undefined") return;
    const connection = (navigator as any).connection;
    if (connection?.saveData) return;

    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;

    const startPrefetch = () => {
      if (cancelled) return;
      if (window.location.pathname !== "/scout") return;
      preloadGoogleMapsScript(effectiveGoogleMapsApiKey);
    };

    timeoutId = window.setTimeout(() => {
      if ("requestIdleCallback" in window) {
        idleId = (window as any).requestIdleCallback(startPrefetch, {
          timeout: 2500,
        });
        return;
      }
      startPrefetch();
    }, 2500);

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (idleId !== null && "cancelIdleCallback" in window) {
        (window as any).cancelIdleCallback(idleId);
      }
    };
  }, [effectiveGoogleMapsApiKey, hasMapKey, sheetState]);

  // When we first get coords, set the map center to the right-quadrant offset.
  useEffect(() => {
    if (!resolvedScoutCoords || userPushedMapRef.current) return;
    setMapCenter(
      shiftCenterForRightQuadrant(
        resolvedScoutCoords.lat,
        resolvedScoutCoords.lng,
        HERO_ZOOM,
      ),
    );
  }, [resolvedScoutCoords]);

  const handleMapBoundsChanged = useCallback((bounds: MapBoundsLike) => {
    setMapBounds(bounds);
  }, []);
  const handleMapZoomChanged = useCallback((z: number) => {
    setMapZoom(z);
    userPushedMapRef.current = true;
  }, []);
  const handleMapCenterChanged = useCallback(
    (c: { lat: number; lng: number }) => {
      setMapCenter(c);
      userPushedMapRef.current = true;
    },
    [],
  );
  const selectLiveTruck = useCallback(
    (truck: LiveTruckSummary) => {
      const truckCoords = getTruckCoords(truck);
      setSelectedLiveTruck(truck);
      if (truckCoords) {
        setMapCenter(truckCoords);
        setMapZoom(16);
      } else if (resolvedScoutCoords) {
        setMapCenter(resolvedScoutCoords);
      }
      setHasOpenedFullMap(true);
      setGoogleMapFailed(false);
      setSheetState("fullMap");
    },
    [resolvedScoutCoords],
  );
  const handleMarkerTap = useCallback(
    (marker: MapAdapterMarker) => {
      if (marker.kind === "truck") {
        const truck = liveTruckById.get(String(marker.sourceId));
        if (truck) {
          selectLiveTruck(truck);
          setSelectedMapMarker(null);
          return;
        }
        navigate(`/truck/${marker.sourceId}`);
      } else if (
        marker.kind === "restaurant" ||
        marker.kind === "event" ||
        marker.kind === "parking" ||
        marker.kind === "deal"
      ) {
        setSelectedLiveTruck(null);
        setSelectedMapMarker(marker);
        setMapCenter({ lat: marker.lat, lng: marker.lng });
        setMapZoom(Math.max(mapZoom, 15));
      }
    },
    [liveTruckById, mapZoom, navigate, selectLiveTruck],
  );
  const handlePreviewMarkerTap = useCallback(
    (marker: MapAdapterMarker) => {
      setHasOpenedFullMap(true);
      setGoogleMapFailed(false);
      setSheetState("fullMap");
      handleMarkerTap(marker);
    },
    [handleMarkerTap],
  );

  /* --------- pull-down-to-fullscreen sheet --------- */

  // When sheetState transitions to fullMap:
  // 1. Set hasOpenedFullMap so GoogleMapSurface mounts for the first time.
  // 2. After the 320ms CSS height transition completes, fire a resize event
  //    so Google Maps re-tiles to the full 100dvh container dimensions.
  useEffect(() => {
    if (sheetState === "fullMap") {
      setHasOpenedFullMap(true);
      const timer = setTimeout(() => {
        // Dispatch a native resize event on the window — Google Maps listens
        // for this and re-tiles automatically.
        window.dispatchEvent(new Event("resize"));
      }, 340); // slightly after the 320ms CSS transition
      return () => clearTimeout(timer);
    }
  }, [sheetState]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle(
      "mealscout-map-fullscreen",
      sheetState === "fullMap",
    );
    return () => {
      document.body.classList.remove("mealscout-map-fullscreen");
    };
  }, [sheetState]);

  const dragStartY = useRef<number | null>(null);
  const dragLastY = useRef<number | null>(null);
  const mouseDragStartY = useRef<number | null>(null);
  const mouseDragLastY = useRef<number | null>(null);

  const handleSheetTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    dragStartY.current = touch.clientY;
    dragLastY.current = touch.clientY;
  }, []);
  const handleSheetTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    dragLastY.current = touch.clientY;
  }, []);
  const handleSheetTouchEnd = useCallback(() => {
    const start = dragStartY.current;
    const last = dragLastY.current;
    dragStartY.current = null;
    dragLastY.current = null;
    if (start === null || last === null) return;
    const delta = last - start;
    // Keep interactions simple: pull down to expand, pull up to collapse.
    if (delta > 40 && sheetState === "default") {
      openScoutMap();
      return;
    }
    if (delta < -40 && sheetState === "fullMap") {
      collapseScoutMap();
    }
  }, [collapseScoutMap, openScoutMap, sheetState]);

  const handleSheetMouseDown = useCallback((e: React.MouseEvent) => {
    mouseDragStartY.current = e.clientY;
    mouseDragLastY.current = e.clientY;
  }, []);

  const handleSheetMouseMove = useCallback((e: React.MouseEvent) => {
    if (mouseDragStartY.current === null) return;
    mouseDragLastY.current = e.clientY;
  }, []);

  const handleSheetMouseUp = useCallback(() => {
    const start = mouseDragStartY.current;
    const last = mouseDragLastY.current;
    mouseDragStartY.current = null;
    mouseDragLastY.current = null;
    if (start === null || last === null) return;
    const delta = last - start;
    if (delta > 24 && sheetState === "default") {
      openScoutMap();
      return;
    }
    if (delta < -24 && sheetState === "fullMap") {
      collapseScoutMap();
    }
  }, [collapseScoutMap, openScoutMap, sheetState]);

  /* --------- greeting --------- */

  const greetingTime = getGreetingTime();
  const greetingFirstLine = `Good ${greetingTime},`;
  const greetingSecondLine = firstName ? `${firstName}.` : "Welcome.";

  /* --------- render --------- */

  const currentUserId = getCurrentUserId(user);
  const showQuickUpdateBar = isFoodOperator(user);
  const scoutTruckInventoryForFeed = useMemo(
    () =>
      filterScoutSearchRows(
        scoutTruckInventory,
        scoutSearchMode,
        scoutSearchQuery,
        scoutSearchIntent,
        "truck",
      ),
    [scoutSearchIntent, scoutSearchMode, scoutSearchQuery, scoutTruckInventory],
  );
  const nearbyRestaurantsForFeed = useMemo(
    () =>
      filterScoutSearchRows(
        nearbyRestaurants,
        scoutSearchMode,
        scoutSearchQuery,
        scoutSearchIntent,
        "restaurant",
      ),
    [nearbyRestaurants, scoutSearchIntent, scoutSearchMode, scoutSearchQuery],
  );
  const allDealsForFeed = useMemo(
    () =>
      filterScoutSearchRows(
        allDeals,
        scoutSearchMode,
        scoutSearchQuery,
        scoutSearchIntent,
        "deal",
      ),
    [allDeals, scoutSearchIntent, scoutSearchMode, scoutSearchQuery],
  );
  const visibleEventsForFeed = useMemo(
    () =>
      filterScoutSearchRows(
        visibleEvents,
        scoutSearchMode,
        scoutSearchQuery,
        scoutSearchIntent,
        "event",
      ),
    [scoutSearchIntent, scoutSearchMode, scoutSearchQuery, visibleEvents],
  );
  const localMenuItemsForFeed = useMemo(
    () =>
      filterScoutSearchRows(
        localMenuItems,
        scoutSearchMode,
        scoutSearchQuery,
        scoutSearchIntent,
        "menu_item",
      ),
    [localMenuItems, scoutSearchIntent, scoutSearchMode, scoutSearchQuery],
  );
  const popularDishesForFeed = useMemo(
    () =>
      filterScoutSearchRows(
        popularDishes,
        scoutSearchMode,
        scoutSearchQuery,
        scoutSearchIntent,
        "menu_item",
      ),
    [popularDishes, scoutSearchIntent, scoutSearchMode, scoutSearchQuery],
  );
  const trendingPlacesThisWeekForFeed = useMemo(
    () =>
      filterScoutSearchRows(
        trendingPlacesThisWeek,
        scoutSearchMode,
        scoutSearchQuery,
        scoutSearchIntent,
        "restaurant",
      ),
    [
      scoutSearchIntent,
      scoutSearchMode,
      scoutSearchQuery,
      trendingPlacesThisWeek,
    ],
  );
  const newToMealScoutRestaurantsForFeed = useMemo(
    () =>
      filterScoutSearchRows(
        newToMealScoutRestaurants,
        scoutSearchMode,
        scoutSearchQuery,
        scoutSearchIntent,
        "restaurant",
      ),
    [
      newToMealScoutRestaurants,
      scoutSearchIntent,
      scoutSearchMode,
      scoutSearchQuery,
    ],
  );
  const trucksServingNow = useMemo(
    () => scoutTruckInventoryForFeed.filter(isTruckServingNow),
    [scoutTruckInventoryForFeed],
  );
  const restaurantsOpenNow = useMemo(
    () =>
      nearbyRestaurantsForFeed.filter(
        (restaurant) => getRestaurantOpenState(restaurant) === "open",
      ),
    [nearbyRestaurantsForFeed],
  );
  const moreFoodRestaurants = useMemo(
    () =>
      nearbyRestaurantsForFeed.filter(
        (restaurant) => getRestaurantOpenState(restaurant) !== "open",
      ),
    [nearbyRestaurantsForFeed],
  );

  const showFoodTrucksSection =
    liveTrucksLoading || trucksServingNow.length > 0;
  const showRestaurantsSection =
    nearbyRestaurantsLoading || restaurantsOpenNow.length > 0;
  const showDealsSection = allDeals.length > 0;
  const showEventsSection = visibleEvents.length > 0 || visibleHosts.length > 0;
  const sceneWantsCommunity =
    activeSceneLaneId === "community" || activeSceneLaneId === "for_you";
  const sceneWantsNearbyNow =
    activeSceneLaneId === "nearby_now" || activeSceneLaneId === "for_you";
  const sceneWantsFoodTrucks =
    activeSceneLaneId === "food_trucks" || activeSceneLaneId === "for_you";
  const sceneWantsRestaurants =
    activeSceneLaneId === "restaurants" ||
    activeSceneLaneId === "for_you" ||
    activeSceneLaneId === "nearby_now";
  const sceneWantsDeals =
    activeSceneLaneId === "deals" || activeSceneLaneId === "for_you";
  const sceneWantsEvents =
    activeSceneLaneId === "events" ||
    activeSceneLaneId === "for_you" ||
    activeSceneLaneId === "late_night";
  const sceneWantsNewMenus =
    activeSceneLaneId === "new_menus" || activeSceneLaneId === "for_you";
  const sceneWantsWorthDiscovering =
    activeSceneLaneId === "worth_discovering" ||
    activeSceneLaneId === "for_you" ||
    activeSceneLaneId === "new_menus";
  const localActivityCount =
    scoutTruckInventoryForFeed.length +
    localMenuItemsForFeed.length +
    nearbyRestaurantsForFeed.length +
    allDealsForFeed.length +
    visibleEventsForFeed.length +
    visibleHosts.length;
  const nearbyRestaurantsTitle = DISCOVERY_LAYERS.restaurants.title;
  const nearbyRestaurantsSubtitle = DISCOVERY_LAYERS.restaurants.subtitle;

  const selectedCraving = useMemo(() => {
    return (
      SCOUT_SEARCH_OPTIONS.find((cat) => cat.id === selectedCravingId) ??
      SCOUT_SEARCH_OPTIONS[0]
    );
  }, [selectedCravingId]);
  const handleSceneLaneChange = useCallback((laneId: ScoutSceneLaneId) => {
    setActiveSceneLaneId(laneId);
    const lane = SCOUT_SCENE_LANES.find((entry) => entry.id === laneId);
    if (lane) {
      setSelectedCravingId(lane.cravingId);
    }
  }, []);

  const cravingBoardItems = useMemo(
    () =>
      buildCravingBoardItems({
        craving: selectedCraving,
        liveTrucks: trucksServingNow,
        restaurants: restaurantsOpenNow,
        menuItems: localMenuItemsForFeed,
        deals: allDealsForFeed,
        events: visibleEventsForFeed,
      }),
    [
      allDealsForFeed,
      localMenuItemsForFeed,
      restaurantsOpenNow,
      selectedCraving,
      trucksServingNow,
      visibleEventsForFeed,
    ],
  );
  const sceneMixedFeedItems = useMemo(() => {
    const items = cravingBoardItems;
    if (activeSceneLaneId === "for_you") {
      const pickByKind = (kind: CravingBoardItem["kind"]) =>
        items.find((item) => item.kind === kind) || null;
      const picks: CravingBoardItem[] = [];
      const add = (candidate: CravingBoardItem | null) => {
        if (!candidate) return;
        if (picks.some((entry) => entry.id === candidate.id)) return;
        picks.push(candidate);
      };
      // Balanced first-screen mix: trucks, places, menu, deal, event, and discovery.
      add(pickByKind("Truck"));
      add(pickByKind("Place"));
      add(pickByKind("Menu"));
      add(pickByKind("Deal"));
      add(pickByKind("Event"));
      const discoveryPlace = items.find(
        (item) =>
          item.kind === "Place" &&
          /new|under|fresh|updated|quiet/i.test(String(item.reason || "")),
      );
      add(discoveryPlace || null);
      if (picks.length < 7) {
        for (const candidate of items) {
          add(candidate);
          if (picks.length >= 7) break;
        }
      }
      return picks.slice(0, 7);
    }
    if (activeSceneLaneId === "food_trucks") {
      return items
        .filter((item) => item.kind === "Truck" || item.kind === "Deal")
        .slice(0, 7);
    }
    if (activeSceneLaneId === "restaurants") {
      return items
        .filter((item) => item.kind === "Place" || item.kind === "Menu")
        .slice(0, 7);
    }
    if (activeSceneLaneId === "deals") {
      return items
        .filter((item) => item.kind === "Deal" || item.kind === "Place")
        .slice(0, 7);
    }
    if (activeSceneLaneId === "events") {
      return items
        .filter((item) => item.kind === "Event" || item.kind === "Place")
        .slice(0, 7);
    }
    if (activeSceneLaneId === "new_menus") {
      return items
        .filter((item) => item.kind === "Menu" || item.kind === "Place")
        .slice(0, 7);
    }
    if (activeSceneLaneId === "worth_discovering") {
      return items
        .filter((item) => item.kind === "Place" || item.kind === "Truck")
        .slice(0, 7);
    }
    return items.slice(0, 7);
  }, [activeSceneLaneId, cravingBoardItems]);
  const featuredRestaurantIds = useMemo(
    () =>
      new Set(
        sceneMixedFeedItems
          .map((item) => item.restaurantId)
          .filter((id): id is string => Boolean(id)),
      ),
    [sceneMixedFeedItems],
  );
  const featuredTruckIds = useMemo(
    () =>
      new Set(
        sceneMixedFeedItems
          .map((item) => item.truckId)
          .filter((id): id is string => Boolean(id)),
      ),
    [sceneMixedFeedItems],
  );
  const featuredDealIds = useMemo(
    () =>
      new Set(
        sceneMixedFeedItems
          .map((item) => item.dealId)
          .filter((id): id is string => Boolean(id)),
      ),
    [sceneMixedFeedItems],
  );
  const featuredEventIds = useMemo(
    () =>
      new Set(
        sceneMixedFeedItems
          .filter((item) => item.kind === "Event")
          .map((item) => item.id.replace(/^event-/, ""))
          .filter(Boolean),
      ),
    [sceneMixedFeedItems],
  );

  const localActivityItems = useMemo(
    () =>
      buildLocalActivityItems({
        menuItems: localMenuItemsForFeed,
        deals: allDealsForFeed,
        liveTrucks: trucksServingNow,
        events: visibleEventsForFeed,
        hosts: visibleHosts,
        restaurants: restaurantsOpenNow,
      }),
    [
      allDealsForFeed,
      localMenuItemsForFeed,
      restaurantsOpenNow,
      trucksServingNow,
      visibleEventsForFeed,
      visibleHosts,
    ],
  );
  const scoutActivityMode = useMemo(
    () =>
      getScoutActivityMode({
        servingTruckCount: trucksServingNow.length,
        openRestaurantCount: restaurantsOpenNow.length,
        dealCount: allDealsForFeed.length,
        eventCount: visibleEventsForFeed.length + visibleHosts.length,
        menuUpdateCount: localMenuItemsForFeed.length,
        activityItemCount: localActivityItems.length,
        mapMarkerCount: sceneFilteredMapMarkers.filter(
          (marker) => marker.kind !== "user",
        ).length,
      }),
    [
      allDealsForFeed.length,
      sceneFilteredMapMarkers,
      localActivityItems.length,
      localMenuItemsForFeed.length,
      restaurantsOpenNow.length,
      trucksServingNow.length,
      visibleEventsForFeed.length,
      visibleHosts.length,
    ],
  );
  useEffect(() => {
    if (!showScoutPreviewDebug) return;
    console.info("[scout-preview-counts]", {
      ...scoutDebugCounts,
      visibleScenePins: sceneFilteredMapMarkers.length,
      statuses: scoutSourceStatuses,
    });
  }, [
    sceneFilteredMapMarkers.length,
    scoutDebugCounts,
    scoutSourceStatuses,
    showScoutPreviewDebug,
  ]);
  useEffect(() => {
    if (!showScoutPreviewDebug) return;
    const dropped = {
      trucks: scoutDebugCounts.trucksMissingCoords,
      restaurants: scoutDebugCounts.restaurantsMissingCoords,
      hosts: scoutDebugCounts.hostsMissingCoords,
      events: scoutDebugCounts.eventsMissingCoords,
      deals: scoutDebugCounts.dealsMissingCoords,
    };
    const hasDrops = Object.values(dropped).some((count) => count > 0);
    if (hasDrops) {
      console.warn("[scout-preview-dropped-missing-coords]", dropped);
    }
  }, [scoutDebugCounts, sceneFilteredMapMarkers.length, showScoutPreviewDebug]);
  const visibleLocalActivityItems = useMemo(() => {
    const uniqueKeys = new Set<string>();
    const uniqueItems = localActivityItems.filter((item) => {
      const key =
        getRestaurantIdFromActivity(item) || `${item.type}-${item.entityId}`;
      if (uniqueKeys.has(key)) return false;
      uniqueKeys.add(key);
      return true;
    });
    return uniqueItems.length >= 2 && scoutActivityMode !== "low_activity"
      ? uniqueItems
      : [];
  }, [localActivityItems, scoutActivityMode]);
  const localActivityRestaurantIds = useMemo(() => {
    return new Set(
      visibleLocalActivityItems
        .map(getRestaurantIdFromActivity)
        .filter((id): id is string => Boolean(id)),
    );
  }, [visibleLocalActivityItems]);
  const visibleOpenRestaurants = useMemo(() => {
    return restaurantsOpenNow.filter(
      (restaurant) => !localActivityRestaurantIds.has(String(restaurant.id)),
    );
  }, [localActivityRestaurantIds, restaurantsOpenNow]);
  const visibleTrucksServingNow = useMemo(() => {
    return trucksServingNow;
  }, [trucksServingNow]);
  const visibleDeals = useMemo(() => {
    return allDealsForFeed;
  }, [allDealsForFeed]);
  const hotDealCandidates = useMemo(() => {
    const happyHourIds = new Set(happyHourDeals.map((deal) => deal.id));
    return visibleDeals.filter((deal) => !happyHourIds.has(deal.id));
  }, [happyHourDeals, visibleDeals]);
  const visibleSceneEvents = useMemo(() => {
    return visibleEventsForFeed;
  }, [visibleEventsForFeed]);
  const topLocalFavoriteRestaurants = useMemo(
    () =>
      nearbyRestaurants
        .map((restaurant) => ({
          restaurant,
          score: getRestaurantCommunityScore(restaurant),
        }))
        .filter(({ score }) => score > 0)
        .sort(
          (a, b) =>
            b.score - a.score ||
            (a.restaurant.distanceMiles ?? a.restaurant.distance ?? 999) -
              (b.restaurant.distanceMiles ?? b.restaurant.distance ?? 999),
        )
        .map(({ restaurant }) => restaurant),
    [nearbyRestaurants],
  );
  const topLocalFavoriteIds = useMemo(
    () =>
      new Set(
        topLocalFavoriteRestaurants.map((restaurant) => String(restaurant.id)),
      ),
    [topLocalFavoriteRestaurants],
  );
  const isHighActivity = scoutActivityMode === "high_activity";
  const isMediumActivity = scoutActivityMode === "medium_activity";
  const isLowActivity = scoutActivityMode === "low_activity";
  const visibleMoreFoodRestaurants = useMemo(() => {
    if (!isLowActivity) return moreFoodRestaurants;
    return moreFoodRestaurants.filter(
      (restaurant) => !topLocalFavoriteIds.has(String(restaurant.id)),
    );
  }, [isLowActivity, moreFoodRestaurants, topLocalFavoriteIds]);
  const openingLaterRestaurants = useMemo(
    () =>
      visibleMoreFoodRestaurants.filter(
        (restaurant) => getRestaurantOpenState(restaurant) === "closed",
      ),
    [visibleMoreFoodRestaurants],
  );
  const showMoreFoodSection = visibleMoreFoodRestaurants.length > 0;
  const showTopLocalFavoritesSection =
    (isLowActivity || activeSceneLaneId === "community") &&
    topLocalFavoriteRestaurants.length > 0;
  const isThinScoutViewport = isLowActivity && localActivityCount <= 1;
  const compactMapHeight = isThinScoutViewport
    ? "clamp(208px, 24dvh, 238px)"
    : "clamp(250px, 32dvh, 310px)";
  const collapsedMapClass = isHighActivity
    ? "mx-0 mt-0 rounded-b-[2rem] ring-1 ring-orange-200/25 bg-[#1f140c]"
    : "mx-0 mt-0 rounded-b-[1.8rem] ring-1 ring-orange-100/20 bg-[#211610]";
  const railSectionClass = isHighActivity
    ? "pl-4 pr-0 pt-1 pb-7"
    : "pl-4 pr-0 pt-2 pb-9 sm:pl-5";
  const compactRailSectionClass = isHighActivity
    ? "pl-4 pr-0 pt-0 pb-5"
    : "pl-4 pr-0 pt-1 pb-6 sm:pl-5";
  const truckCardWidth = isHighActivity
    ? "w-[184px] sm:w-[206px]"
    : "w-[204px] sm:w-[228px]";
  const standardCardWidth = isHighActivity
    ? "w-[194px] sm:w-[214px]"
    : "w-[206px] sm:w-[228px]";
  const featureCardWidth = isHighActivity
    ? "w-[218px] sm:w-[238px]"
    : "w-[238px] sm:w-[268px]";
  const restaurantsRailTitle = isMediumActivity
    ? "Open Near You"
    : nearbyRestaurantsTitle;
  const restaurantsRailSubtitle = isMediumActivity
    ? "Open restaurants and local places nearby."
    : nearbyRestaurantsSubtitle;
  const eventsRailTitle = isHighActivity
    ? DISCOVERY_LAYERS.events.title
    : "Upcoming Food Events";
  const eventsRailSubtitle = isHighActivity
    ? DISCOVERY_LAYERS.events.subtitle
    : "Food events and pop-ups coming up nearby.";
  const moreRailTitle = isLowActivity ? "Worth Checking Out" : "More Nearby";
  const moreRailSubtitle = isLowActivity
    ? "Local places and food options around you."
    : "Nearby trucks and restaurants without current open status.";
  const laneFoodTrucksTitle =
    activeSceneLaneId === "food_trucks"
      ? "Food Trucks Today"
      : DISCOVERY_LAYERS.foodTrucks.title;
  const laneRestaurantsTitle =
    activeSceneLaneId === "restaurants"
      ? "Nearby Restaurants"
      : restaurantsRailTitle;
  const laneDealsTitle =
    activeSceneLaneId === "deals" ? "Hot Deals" : DISCOVERY_LAYERS.deals.title;
  const laneEventsTitle =
    activeSceneLaneId === "events" ? "Events & Pop-Ups" : eventsRailTitle;
  const laneMoreTitle =
    activeSceneLaneId === "worth_discovering"
      ? "Worth Discovering"
      : moreRailTitle;
  const showQuickUpdateBarForLane =
    showQuickUpdateBar &&
    (activeSceneLaneId === "for_you" ||
      activeSceneLaneId === "food_trucks" ||
      activeSceneLaneId === "restaurants" ||
      activeSceneLaneId === "deals");
  const compactMapSceneHint =
    activeSceneLaneId === "food_trucks"
      ? "Truck activity nearby"
      : activeSceneLaneId === "restaurants"
        ? "Open restaurants nearby"
        : activeSceneLaneId === "deals"
          ? "Active deals nearby"
          : activeSceneLaneId === "events"
            ? "Food events nearby"
            : activeSceneLaneId === "new_menus"
              ? "Fresh menu updates nearby"
              : activeSceneLaneId === "worth_discovering"
                ? "New and under-scouted spots nearby"
                : "Find trucks, bowls, pop-ups, and local favorites near you.";
  const compactMapMarketHint =
    trucksServingNow.length > 0
      ? `${scoutMarketEyebrow} • ${formatScoutCount(
          trucksServingNow.length,
          "truck nearby now",
          "trucks nearby now",
        )}`
      : scoutMarketEyebrow;
  const laneHasContent =
    sceneMixedFeedItems.length > 0 ||
    (sceneWantsFoodTrucks && visibleTrucksServingNow.length > 0) ||
    (sceneWantsRestaurants && visibleOpenRestaurants.length > 0) ||
    (sceneWantsDeals && visibleDeals.length > 0) ||
    (sceneWantsEvents &&
      (visibleSceneEvents.length > 0 || visibleHosts.length > 0)) ||
    (sceneWantsNewMenus && localMenuItems.length > 0) ||
    (sceneWantsWorthDiscovering && visibleMoreFoodRestaurants.length > 0) ||
    (sceneWantsCommunity && topLocalFavoriteRestaurants.length > 0);
  const showForYouWorthFallback =
    activeSceneLaneId === "for_you" &&
    sceneMixedFeedItems.length === 0 &&
    visibleMoreFoodRestaurants.length > 0;
  return (
    <>
      <SEOHead
        title="Scout | MealScout"
        description="Discover food trucks, restaurants, and deals near you. MealScout puts the local food scene right in your hands."
      />

      {/* Quiet page base. Warm espresso/roasted-brown wash instead of
          crushing to near-black, so the food photography underneath still
          reads instead of getting stacked into a flat dark panel. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-20 bg-[#1c130c]"
        style={{
          backgroundImage:
            "radial-gradient(90% 50% at 50% -8%, rgba(255,150,72,0.24) 0%, rgba(28,19,12,0) 58%), linear-gradient(180deg, #241708 0%, #1b1109 62%, #170f0a 100%)",
        }}
      />

      <main
        className={`relative z-10 overflow-x-hidden md:-mt-16 ${
          sheetState === "fullMap"
            ? ""
            : "pb-44 md:mx-auto md:min-h-screen md:max-w-[1120px] md:px-4 xl:max-w-[1280px]"
        }`}
        style={{
          paddingBottom:
            sheetState === "fullMap"
              ? undefined
              : "calc(8.5rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {/* ============================================================
             SCOUT SURFACE
             Default: compact map accessory.
             Full map: interactive Google Map fills the viewport.
           ============================================================ */}
        <ScoutMapHero>
          <section
            data-testid="scout-map-container"
            data-scout-mobile-thirds-map="true"
            className={`relative overflow-hidden ${
              sheetState === "fullMap"
                ? "w-full bg-[#1a1108]"
                : collapsedMapClass
            }`}
            style={{
              height: sheetState === "fullMap" ? "100dvh" : compactMapHeight,
              transition: "height 320ms cubic-bezier(0.22,0.61,0.36,1)",
              touchAction: "auto",
              boxShadow:
                sheetState === "fullMap"
                  ? undefined
                  : isHighActivity
                    ? "0 30px 82px rgba(0,0,0,0.74), 0 0 42px rgba(255,100,48,0.10), inset 0 -1px 0 rgba(255,220,170,0.12)"
                    : "0 28px 70px rgba(0,0,0,0.68), 0 4px 22px rgba(255,138,60,0.08), inset 0 0 0 1px rgba(255,180,110,0.08)",
            }}
          >
            {/* Scout map surfaces
              ------------------
              DEFAULT state: compact interactive Google map surface.
              FULLMAP state: interactive Google Map widget for real
                pan/zoom/tap-pin exploration.
          */}
            <div className="absolute inset-0">
              <div
                data-testid="scout-map-preview"
                className="absolute inset-0"
                style={{
                  visibility: "visible",
                  pointerEvents: sheetState === "fullMap" ? "none" : "auto",
                  zIndex: 0,
                }}
              >
                {resolvedScoutCoords ? (
                  hasMapKey && !googleMapFailed && mapCenter ? (
                    <MapErrorBoundary>
                      <GoogleMapSurface
                        apiKey={effectiveGoogleMapsApiKey}
                        mapId={effectiveGoogleMapsMapId || undefined}
                        center={mapCenter}
                        zoom={13}
                        markers={sceneFilteredMapMarkers}
                        showRoadTrafficLayer={false}
                        userLocation={resolvedScoutCoords}
                        isNightTheme={true}
                        interactive={true}
                        onBoundsChanged={handleMapBoundsChanged}
                        onZoomChanged={handleMapZoomChanged}
                        onCenterChanged={handleMapCenterChanged}
                        onMarkerTap={handleMarkerTap}
                        onFatalError={() => setGoogleMapFailed(true)}
                      />
                    </MapErrorBoundary>
                  ) : (
                    <Suspense fallback={<HeroMapFallback reason="loading" />}>
                      <ThemedScoutMap
                        userLocation={resolvedScoutCoords}
                        markers={sceneFilteredMapMarkers}
                        zoom={13}
                        onMarkerTap={handlePreviewMarkerTap}
                      />
                    </Suspense>
                  )
                ) : (
                  <HeroMapFallback
                    reason={locationStatus === "denied" ? "denied" : "loading"}
                  />
                )}
              </div>

              {/* GoogleMapSurface:
                - Used for full interactive pan/zoom/tap-pin exploration.
                - Collapsed preview uses the same styled map family above.
            */}
              {sheetState === "fullMap" &&
              hasMapKey &&
              !googleMapFailed &&
              resolvedScoutCoords &&
              mapCenter ? (
                <div
                  ref={googleMapContainerRef}
                  data-testid="scout-interactive-map"
                  className="absolute inset-0"
                  style={{
                    visibility: "visible",
                    pointerEvents: sheetState === "fullMap" ? "auto" : "none",
                    zIndex: 1,
                  }}
                >
                  <MapErrorBoundary>
                    <GoogleMapSurface
                      apiKey={effectiveGoogleMapsApiKey}
                      mapId={effectiveGoogleMapsMapId || undefined}
                      center={mapCenter}
                      zoom={mapZoom}
                      markers={sceneFilteredMapMarkers}
                      showRoadTrafficLayer={false}
                      userLocation={resolvedScoutCoords}
                      isNightTheme={true}
                      onBoundsChanged={handleMapBoundsChanged}
                      onZoomChanged={handleMapZoomChanged}
                      onCenterChanged={handleMapCenterChanged}
                      onMarkerTap={handleMarkerTap}
                      onFatalError={() => setGoogleMapFailed(true)}
                    />
                  </MapErrorBoundary>
                </div>
              ) : sheetState === "fullMap" &&
                (googleMapFailed ||
                  !hasMapKey ||
                  !resolvedScoutCoords ||
                  !mapCenter) ? (
                <div
                  data-testid="scout-interactive-map"
                  className="absolute inset-0"
                  style={{ zIndex: 1 }}
                >
                  {resolvedScoutCoords ? (
                    <>
                      <Suspense fallback={<HeroMapFallback reason="loading" />}>
                        <ThemedScoutMap
                          userLocation={resolvedScoutCoords}
                          markers={sceneFilteredMapMarkers}
                          zoom={13}
                          interactive={true}
                          tone="night"
                          onMarkerTap={handlePreviewMarkerTap}
                        />
                      </Suspense>
                    </>
                  ) : (
                    <HeroMapFallback
                      reason={
                        locationStatus === "denied" ? "denied" : "loading"
                      }
                    />
                  )}
                </div>
              ) : null}
            </div>

            {sheetState === "fullMap" && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-[2]"
                style={{
                  background:
                    "linear-gradient(90deg, rgba(18,8,5,0.1) 0%, rgba(18,8,5,0.04) 28%, rgba(18,8,5,0) 62%, rgba(18,8,5,0.03) 100%), linear-gradient(180deg, rgba(18,8,5,0.03) 0%, transparent 38%, rgba(18,8,5,0.08) 100%)",
                }}
              />
            )}

            {/* Premium overlay frame:
              - Soft top vignette so the controls read cleanly without
                covering important map labels.
              - Subtle warm radial center keeps the surface feeling
                MealScout, not raw Google.
              - Light edge glow ties the frame together. */}
            {sheetState !== "fullMap" && (
              <div
                aria-hidden="true"
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage:
                    "linear-gradient(180deg, rgba(11,8,6,0.62) 0%, rgba(10,7,5,0.22) 26%, rgba(8,6,10,0.04) 54%, rgba(8,6,10,0.58) 100%), radial-gradient(110% 64% at 50% 42%, rgba(255,136,70,0.18), rgba(255,136,70,0.00) 60%), radial-gradient(100% 50% at 50% -8%, rgba(255,111,46,0.12), rgba(255,111,46,0) 56%)",
                }}
              />
            )}

            {sheetState === "fullMap" && (
              <MapLayerToggles
                layers={activeMapLayers}
                onToggle={toggleMapLayer}
              />
            )}

            {/* Floating "Collapse" button (top-right) — visible in fullMap state. */}
            {sheetState === "fullMap" && (
              <button
                type="button"
                onClick={collapseScoutMap}
                aria-label="Collapse map and return to discover"
                className="absolute z-30 right-4 top-[calc(env(safe-area-inset-top)+0.75rem)] inline-flex h-12 items-center gap-2 rounded-full bg-[rgba(52,33,20,0.84)] px-4 font-black text-orange-50 ring-1 ring-orange-200/55 backdrop-blur-md transition-colors hover:bg-[rgba(62,40,24,0.9)]"
                style={{
                  boxShadow:
                    "0 14px 36px rgba(0,0,0,0.48), 0 0 18px rgba(255,90,47,0.16)",
                }}
              >
                <Minimize2 className="h-4 w-4" aria-hidden="true" />
                <span className="text-sm">Collapse</span>
              </button>
            )}

            {sheetState === "fullMap" && (
              <ScoutMapHud
                locationLabel={shortLocation}
                marketEyebrow={scoutMarketEyebrow}
                liveTruckCount={liveTrucks.length}
                restaurantCount={nearbyRestaurants.length}
                eventCount={visibleEvents.length + visibleHosts.length}
                dealCount={allDeals.length}
                localActivityCount={localActivityCount}
                discoveryRadiusKm={discoveryRadiusKm}
                onRadiusChange={updateDiscoveryRadiusKm}
                onRecenter={() => {
                  if (resolvedScoutCoords) {
                    setMapCenter(resolvedScoutCoords);
                    setMapZoom(14);
                  }
                }}
              />
            )}

            {sheetState === "fullMap" && selectedLiveTruck && (
              <LiveTruckMapCard
                truck={selectedLiveTruck}
                userLocation={resolvedScoutCoords}
                onClose={() => setSelectedLiveTruck(null)}
              />
            )}

            {sheetState === "fullMap" && selectedMapMarker && (
              <MapPlaceCard
                marker={selectedMapMarker}
                userLocation={resolvedScoutCoords}
                onClose={() => setSelectedMapMarker(null)}
              />
            )}

            {sheetState === "fullMap" && mapBounds && (
              <MapEdgeIndicators
                markers={sceneFilteredMapMarkers}
                bounds={mapBounds}
                center={mapCenter || resolvedScoutCoords}
                selectedId={
                  selectedLiveTruck
                    ? String(selectedLiveTruck.id)
                    : selectedMapMarker?.id || null
                }
                onSelect={(marker) => {
                  setMapCenter({ lat: marker.lat, lng: marker.lng });
                  setMapZoom(Math.max(mapZoom, 15));
                  if (marker.kind === "truck") {
                    const truck = liveTruckById.get(String(marker.sourceId));
                    if (truck) setSelectedLiveTruck(truck);
                  } else {
                    setSelectedLiveTruck(null);
                    setSelectedMapMarker(marker);
                  }
                }}
              />
            )}

            {/* Compact map footer. Keep the collapsed map mostly clear. */}
            {sheetState === "default" && (
              <>
                <div className="absolute left-3 top-3 z-20">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#100c0a]/80 ring-1 ring-orange-200/40 backdrop-blur-xl shadow-[0_10px_24px_rgba(0,0,0,0.42)]">
                    <img
                      src={mealScoutIcon}
                      alt="MealScout"
                      className="h-6 w-6 object-contain"
                    />
                  </span>
                </div>
                <MapActivityPips
                  mode={scoutActivityMode}
                  truckCount={trucksServingNow.length}
                  restaurantCount={restaurantsOpenNow.length}
                  dealCount={allDeals.length}
                  eventCount={visibleEvents.length + visibleHosts.length}
                />
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-[58%]"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(8,5,2,0) 0%, rgba(8,5,2,0.35) 48%, rgba(8,5,2,0.78) 88%, rgba(8,5,2,0.88) 100%)",
                  }}
                />
                <div className="absolute bottom-3 left-3 right-3 z-20 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    {isPensacolaScoutPreview ? (
                      <p className="mb-1 inline-flex rounded-full bg-orange-500/18 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-orange-100 ring-1 ring-orange-200/30">
                        Admin preview
                      </p>
                    ) : null}
                    {showScoutPreviewDebug ? (
                      <p className="mb-1 text-[10px] font-bold text-white/75">
                        preview eligible:{String(isScoutPreviewEligible)} city:
                        {scoutPreviewCity || "none"} active:
                        {String(isPensacolaScoutPreview)} source:
                        {resolvedScoutLocation?.source || "none"} loc:
                        {resolvedScoutLocation
                          ? `${resolvedScoutLocation.label} ${resolvedScoutLocation.lat.toFixed(4)},${resolvedScoutLocation.lng.toFixed(4)}`
                          : "none"}{" "}
                        status[t:{scoutSourceStatuses.trucks ?? "-"} r:
                        {scoutSourceStatuses.restaurants ?? "-"} h:
                        {scoutSourceStatuses.mapLocations ?? "-"} d:
                        {scoutSourceStatuses.deals ?? "-"} e:
                        {scoutSourceStatuses.events ?? "-"}] counts[t:
                        {scoutDebugCounts.trucksReturned} h:
                        {scoutDebugCounts.hostsReturned} e:
                        {scoutDebugCounts.eventsReturned} r:
                        {scoutDebugCounts.restaurantsReturned} pins:
                        {scoutDebugCounts.mapPinsBuilt}]
                      </p>
                    ) : null}
                    {showScoutPreviewDebug &&
                    (scoutDebugCounts.trucksMissingCoords > 0 ||
                      scoutDebugCounts.hostsMissingCoords > 0 ||
                      scoutDebugCounts.restaurantsMissingCoords > 0 ||
                      scoutDebugCounts.eventsMissingCoords > 0 ||
                      scoutDebugCounts.dealsMissingCoords > 0) ? (
                      <p className="mb-1 text-[10px] font-semibold text-amber-200/85">
                        dropped missing coords - trucks:
                        {scoutDebugCounts.trucksMissingCoords} hosts:
                        {scoutDebugCounts.hostsMissingCoords} restaurants:
                        {scoutDebugCounts.restaurantsMissingCoords} events:
                        {scoutDebugCounts.eventsMissingCoords} deals:
                        {scoutDebugCounts.dealsMissingCoords}
                      </p>
                    ) : null}
                    <p className="truncate text-sm font-extrabold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]">
                      {hasResolvedLocation ? shortLocation : "Nearby now"}
                    </p>
                    <p className="truncate text-[11px] font-semibold text-white/65 drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]">
                      {compactMapMarketHint}
                    </p>
                    <p className="truncate text-[11px] font-semibold text-white/50 drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]">
                      {compactMapSceneHint}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openScoutMap}
                    aria-label="Open full map"
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#100c0a]/80 px-3 py-2 text-xs font-black text-white ring-1 ring-orange-200/40 backdrop-blur-xl shadow-[0_10px_24px_rgba(0,0,0,0.42)]"
                  >
                    <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Open map
                  </button>
                </div>
              </>
            )}
          </section>
        </ScoutMapHero>

        {/* ============================================================
             LOWER SHEET — discovery sections. Hidden when fullMap.
             Touch-swipe handlers sit on a thin drag handle at the top.
        ============================================================ */}
        {sheetState !== "fullMap" && (
          <ActiveScenePanel>
            <ActiveSceneContent
              laneId={activeSceneLaneId}
              sceneMixedFeedItems={sceneMixedFeedItems}
              visibleMoreFoodRestaurants={visibleMoreFoodRestaurants}
              topLocalFavoriteRestaurants={topLocalFavoriteRestaurants}
              scoutTruckInventory={scoutTruckInventoryForFeed}
              visibleTrucksServingNow={visibleTrucksServingNow}
              visibleOpenRestaurants={visibleOpenRestaurants}
              nearbyRestaurants={nearbyRestaurantsForFeed}
              visibleDeals={visibleDeals}
              hotDealCandidates={hotDealCandidates}
              happyHourDeals={happyHourDeals}
              visibleSceneEvents={visibleSceneEvents}
              visibleHosts={visibleHosts}
              localMenuItems={localMenuItemsForFeed}
              popularDishes={popularDishesForFeed}
              trendingPlacesThisWeek={trendingPlacesThisWeekForFeed}
              newToMealScoutRestaurants={newToMealScoutRestaurantsForFeed}
              openingLaterRestaurants={openingLaterRestaurants}
              visibleLocalActivityItems={visibleLocalActivityItems}
              scoutActivityMode={scoutActivityMode}
              liveTrucksLoading={liveTrucksLoading}
              liveTrucksError={liveTrucksError}
              nearbyRestaurantsLoading={nearbyRestaurantsLoading}
              locationStatus={locationStatus}
              currentUserId={currentUserId}
              isSignedIn={!!user}
              isAdminFamilyUser={isAdminFamilyUser}
              isTruckVendorUser={isTruckVendorUser}
              selectLiveTruck={selectLiveTruck}
              openScoutMap={openScoutMap}
              menuPreviewByRestaurantId={menuPreviewByRestaurantId}
              restaurantRelationships={restaurantRelationships}
              railSectionClass={railSectionClass}
              compactRailSectionClass={compactRailSectionClass}
              truckCardWidth={truckCardWidth}
              standardCardWidth={standardCardWidth}
              featureCardWidth={featureCardWidth}
              laneFoodTrucksTitle={laneFoodTrucksTitle}
              laneRestaurantsTitle={laneRestaurantsTitle}
              laneDealsTitle={laneDealsTitle}
              laneEventsTitle={laneEventsTitle}
              laneMoreTitle={laneMoreTitle}
              restaurantsRailSubtitle={restaurantsRailSubtitle}
              eventsRailSubtitle={eventsRailSubtitle}
              moreRailSubtitle={moreRailSubtitle}
              scoutSearchMode={scoutSearchMode}
              scoutSearchIntent={scoutSearchIntent}
              renderSearchDock={() => (
                <ScoutSearchDock
                  placement="inline"
                  searchMode={scoutSearchMode}
                  query={scoutSearchQuery}
                  activeFilter={scoutSearchFilter}
                  resultSummary={
                    scoutSearchMode
                      ? `${sceneFilteredMapMarkers.filter((marker) => marker.kind !== "user").length} matches nearby`
                      : formatScoutResultSummary(localActivityCount)
                  }
                  onOpen={() => setScoutSearchMode(true)}
                  onClose={closeScoutSearch}
                  onQueryChange={setScoutSearchQuery}
                  onFilterChange={(filter) => {
                    setScoutSearchMode(true);
                    setScoutSearchFilter(filter);
                  }}
                />
              )}
            />
          </ActiveScenePanel>
        )}
      </main>
    </>
  );
}

/* ============================================================
   SHARED SECTION HEADER
   ============================================================ */

function SectionHeader({
  title,
  linkHref,
  subtitle,
  itemCount,
}: {
  title: string;
  linkHref: string;
  subtitle?: string;
  itemCount?: number;
}) {
  const showLink = itemCount === undefined || itemCount > 1;

  return (
    <div className="mb-4 pr-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-black tracking-tight text-white sm:text-2xl">
            {title}
          </h2>
        </div>
        {showLink ? (
          <Link
            href={linkHref}
            className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full bg-orange-500/10 px-3 py-1.5 text-xs font-black uppercase tracking-[0.08em] text-orange-100 ring-1 ring-orange-200/20 transition-colors hover:bg-orange-500/16 sm:text-sm sm:normal-case sm:tracking-normal"
          >
            See All <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {subtitle ? (
        <p className="mt-1.5 text-xs leading-relaxed text-white/58 sm:text-sm">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

/* ============================================================
   SCOUT HERO + FILTERS
   ============================================================ */

function CravingCompass({
  mode,
  daypartCopy,
  locationStatus,
  onRefreshLocation,
}: {
  mode: ScoutActivityMode;
  daypartCopy: { title: string; body: string };
  locationStatus: "idle" | "requesting" | "ready" | "denied";
  onRefreshLocation: () => void;
}) {
  const hasLocation = locationStatus === "ready";
  const modeLabel =
    mode === "high_activity"
      ? "Food happening now"
      : mode === "medium_activity"
        ? "Food nearby now"
        : "Explore local food";

  return (
    <section
      className={mode === "high_activity" ? "px-4 pt-3 pb-2" : "px-4 pt-4 pb-3"}
    >
      <div
        className={
          mode === "high_activity"
            ? "px-1 py-2"
            : "overflow-hidden rounded-[1.35rem] bg-[#17100d]/86 ring-1 ring-white/10 shadow-[0_16px_46px_rgba(0,0,0,0.24)]"
        }
      >
        <div className={mode === "high_activity" ? "" : "px-4 py-4"}>
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/38">
            {modeLabel}
          </p>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-sans text-white text-lg font-black leading-tight">
                Find food near you.
              </h2>
              <p className="mt-1 text-white/62 text-xs leading-relaxed">
                Open restaurants, food trucks, and deals nearby.
              </p>
            </div>
            {!hasLocation ? (
              <button
                type="button"
                onClick={onRefreshLocation}
                className="shrink-0 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-black text-stone-900 ring-1 ring-white/40 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
              >
                Use location
              </button>
            ) : null}
          </div>
          <span className="sr-only">{daypartCopy.body}</span>
        </div>
      </div>
    </section>
  );
}

function SceneOptionsBar({
  activeSceneLaneId,
  onSceneLaneSelect,
}: {
  activeSceneLaneId: ScoutSceneLaneId;
  onSceneLaneSelect: (laneId: ScoutSceneLaneId) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollerRef.current?.scrollTo({ left: 0, behavior: "auto" });
  }, []);
  const getIcon = (icon: ScoutSceneLane["icon"]) => {
    if (icon === "spark")
      return <Compass className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "community")
      return <Users className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "nearby")
      return <Navigation2 className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "truck")
      return <Flame className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "restaurant")
      return <Utensils className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "deal")
      return <Tag className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "event")
      return <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "menu")
      return <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "late")
      return <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />;
    return <Heart className="h-3.5 w-3.5" aria-hidden="true" />;
  };

  return (
    <section className="px-4 pb-4">
      <div
        ref={scrollerRef}
        className="overflow-x-auto atmo-hide-scrollbar pl-0.5"
      >
        <div className="flex w-max gap-1 pr-2">
          {SCOUT_SCENE_LANES.map((lane) => {
            const isActive = lane.id === activeSceneLaneId;
            return (
              <button
                key={lane.id}
                type="button"
                onClick={() => onSceneLaneSelect(lane.id)}
                className={[
                  "inline-flex min-h-11 min-w-[76px] shrink-0 items-center justify-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-bold ring-1 transition-colors active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/60",
                  isActive
                    ? "bg-[#ff7945] text-white ring-white/20 shadow-[0_10px_22px_rgba(255,121,69,0.28)]"
                    : "bg-[#11131a]/82 text-white/78 ring-white/10 hover:bg-[#171a23] hover:text-white",
                ].join(" ")}
                aria-pressed={isActive}
              >
                {getIcon(lane.icon)}
                <span className="whitespace-nowrap">{lane.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ActiveSceneIntro({ laneId }: { laneId: ScoutSceneLaneId }) {
  const laneCopy: Record<
    ScoutSceneLaneId,
    { title: string; subtitle: string }
  > = {
    for_you: {
      title: "For You",
      subtitle:
        "Local favorites, open spots, new menus, and places worth finding.",
    },
    community: {
      title: "Community",
      subtitle: "What locals are saving, sharing, and coming back to.",
    },
    nearby_now: {
      title: "Nearby",
      subtitle: "Food, drinks, events, and trucks close to you.",
    },
    food_trucks: {
      title: "Food Trucks",
      subtitle: "Trucks posted up, scheduled, or serving nearby.",
    },
    restaurants: {
      title: "Restaurants",
      subtitle: "Open tables, local kitchens, and menu highlights.",
    },
    deals: {
      title: "Deals",
      subtitle: "Active offers from nearby spots.",
    },
    events: {
      title: "Events",
      subtitle: "Food, music, pop-ups, and things happening around town.",
    },
    new_menus: {
      title: "New Menus",
      subtitle: "Fresh dishes and menu updates from local spots.",
    },
    late_night: {
      title: "Late Night",
      subtitle: "Places still serving after hours.",
    },
    worth_discovering: {
      title: "Worth Discovering",
      subtitle: "New, quiet, or under-scouted spots nearby.",
    },
  };
  const activeCopy = laneCopy[laneId] ?? laneCopy.for_you;
  return (
    <section className="px-4 pb-3">
      <h2 className="font-sans text-2xl font-semibold tracking-tight text-white">
        {activeCopy.title}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-white/62">
        {activeCopy.subtitle}
      </p>
    </section>
  );
}

type ScoutRailRenderCard =
  | { cardType: "truck"; cardKind: "food_truck"; truck: LiveTruckSummary }
  | {
      cardType: "restaurant";
      cardKind: "restaurant" | "community_pick";
      restaurant: RestaurantSummary;
    }
  | {
      cardType: "menu_item";
      cardKind: "menu_item";
      item: LocalMenuItemFeedItem;
      position: number;
    }
  | { cardType: "deal"; cardKind: "deal" | "happy_hour"; deal: DealSummary }
  | { cardType: "event"; cardKind: "event"; event: EventSummary };

type ScoutImmediateDecisionItem =
  | {
      sourceRowId: ScoutHorizontalRowId;
      sectionLabel: string;
      summary: string;
      cardType: "truck";
      truck: LiveTruckSummary;
      businessKey: string | null;
    }
  | {
      sourceRowId: ScoutHorizontalRowId;
      sectionLabel: string;
      summary: string;
      cardType: "restaurant";
      restaurant: RestaurantSummary;
      businessKey: string | null;
    }
  | {
      sourceRowId: ScoutHorizontalRowId;
      sectionLabel: string;
      summary: string;
      cardType: "menu_item";
      item: LocalMenuItemFeedItem;
    }
  | {
      sourceRowId: ScoutHorizontalRowId;
      sectionLabel: string;
      summary: string;
      cardType: "deal";
      deal: DealSummary;
    }
  | {
      sourceRowId: ScoutHorizontalRowId;
      sectionLabel: string;
      summary: string;
      cardType: "event";
      event: EventSummary;
    }
  | {
      sourceRowId: ScoutHorizontalRowId;
      sectionLabel: string;
      summary: string;
      cardType: "host";
      host: ScoutHostLocation;
    };

type ScoutHorizontalRailDefinition = {
  id: ScoutHorizontalRowId;
  title: string;
  subtitle?: string;
  linkHref: string;
  cards: ScoutRailRenderCard[];
  className: string;
  cardWidth: string;
};

const scoutHorizontalRowMeta = new Map(
  SCOUT_HORIZONTAL_ROW_REGISTRY.map((row) => [row.id, row]),
);

function getScoutRailCardKey(card: ScoutRailRenderCard): string {
  if (card.cardType === "truck") return String(card.truck.id);
  if (card.cardType === "restaurant") return String(card.restaurant.id);
  if (card.cardType === "menu_item") return String(card.item.id);
  if (card.cardType === "deal") return String(card.deal.id);
  if (card.cardType === "event") return String(card.event.id);
  return "card";
}

function ScoutHorizontalCategoryRail({
  row,
  renderCard,
}: {
  row: ScoutHorizontalRailDefinition;
  renderCard: (card: ScoutRailRenderCard) => ReactNode;
}) {
  const rowMeta = scoutHorizontalRowMeta.get(row.id);
  if (!row.cards.length || !rowMeta?.hideWhenEmpty) return null;
  return (
    <section
      className={`${row.className} relative`}
      data-scout-row-id={row.id}
      data-scout-row-priority={rowMeta.priority}
      data-scout-accepted-kinds={rowMeta.acceptedCardKinds.join(",")}
      data-scout-dedup-policy={rowMeta.dedupPolicy}
    >
      <SectionHeader
        title={row.title}
        linkHref={row.linkHref}
        subtitle={row.subtitle}
        itemCount={row.cards.length}
      />
      <div
        className="w-full max-w-full overflow-x-auto overscroll-x-contain atmo-hide-scrollbar -mr-1"
        data-scout-horizontal-rail="true"
      >
        <ul
          className="flex w-max max-w-none snap-x snap-mandatory gap-3.5 pr-5 sm:gap-4"
          role="list"
          aria-label={row.title}
        >
          {row.cards.slice(0, rowMeta.maxCards).map((card, index) => (
            <li
              key={`${row.id}-${card.cardType}-${getScoutRailCardKey(card)}-${index}`}
              className={`shrink-0 snap-start ${row.cardWidth}`}
              data-scout-card-kind={card.cardKind}
            >
              {renderCard(card)}
            </li>
          ))}
        </ul>
      </div>
      {row.cards.length > 2 ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-20 items-center justify-end bg-gradient-to-l from-[#070609] via-[#070609]/82 to-transparent pr-2 sm:flex">
          <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white/68 ring-1 ring-white/10">
            Scroll
          </span>
        </div>
      ) : null}
    </section>
  );
}

function ScoutFirstScreenDecisionStack({
  items,
  thinMarket,
}: {
  items: ScoutImmediateDecisionItem[];
  thinMarket: boolean;
}) {
  const primary = items[0] ?? null;

  if (!primary) {
    return (
      <section
        className="px-4 pb-3 pt-3"
        data-scout-first-screen-decision-stack="true"
        data-scout-first-screen-empty="true"
      >
        <div className="rounded-[1.1rem] bg-[#120805]/72 px-4 py-3 text-white ring-1 ring-white/10">
          <p className="text-[11px] font-black uppercase tracking-[0.12em] text-orange-200/75">
            No nearby food yet
          </p>
          <p className="mt-1 text-sm font-semibold text-white/70">
            Try search or move the map
          </p>
          <ScoutRecoveryActions className="mt-3" />
        </div>
      </section>
    );
  }

  return (
    <section
      className="px-4 pb-3 pt-3"
      data-scout-first-screen-decision-stack="true"
      data-scout-decision-source-row={primary.sourceRowId}
    >
      <div className="rounded-[1.1rem] bg-[#120805]/78 p-3 text-white ring-1 ring-orange-200/20 shadow-[0_16px_40px_rgba(0,0,0,0.36)]">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.12em] text-orange-200/78">
              {primary.sectionLabel}
            </p>
            <p className="mt-0.5 truncate text-xs font-semibold text-white/55">
              {primary.summary}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-orange-400/14 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-orange-100 ring-1 ring-orange-200/20">
            Best now
          </span>
        </div>
        <ScoutImmediateCompactCard item={primary} />
        {thinMarket ? (
          <div
            className="mt-3 rounded-2xl bg-white/[0.045] px-3 py-3 ring-1 ring-white/10"
            data-testid="scout-thin-market-state"
          >
            <p className="text-sm font-black text-white">
              Coverage is still thin here, so Scout is showing the closest real
              place first.
            </p>
            <p className="mt-1 text-xs font-semibold leading-relaxed text-white/62">
              Browse nearby or open the map while you widen the board.
            </p>
            <ScoutRecoveryActions className="mt-3" />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ScoutRecoveryActions({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`.trim()}>
      <Link
        href="/search"
        className="rounded-full bg-[#ff7945] px-3 py-1.5 text-[11px] font-black text-white ring-1 ring-white/20"
      >
        Browse nearby
      </Link>
      <Link
        href="/search"
        className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[11px] font-black text-white/90 ring-1 ring-white/20"
      >
        Search nearby
      </Link>
    </div>
  );
}

function ScoutImmediateCompactCard({
  item,
}: {
  item: ScoutImmediateDecisionItem;
}) {
  if (item.cardType === "truck") {
    const truck = item.truck;
    const title = truck.name || "Food truck";
    const area = getTruckArea(truck);
    const status = isTruckServingNow(truck) ? "Live now" : "Scheduled";
    const meta = ["Food truck", status, area].filter(Boolean).join(" / ");
    const image =
      truck.logoUrl ||
      truck.imageUrl ||
      truck.coverImageUrl ||
      truck.heroImageUrl;
    const directionsUrl = buildDirectionsUrl(truck);
    return (
      <CompactDecisionCardShell
        href={getTruckProfilePath(truck)}
        imageUrl={image}
        fallbackIcon={
          <TruckIcon className="h-4 w-4 text-white/90" aria-hidden="true" />
        }
        title={title}
        meta={meta}
        primaryActionLabel="View truck"
        directionsUrl={directionsUrl}
        categoryPhoto={getDishCategoryPhoto(
          truck.name,
          truck.cuisineType,
          truck.vibe,
        )}
        variant="truck"
      />
    );
  }

  if (item.cardType === "restaurant") {
    const restaurant = item.restaurant;
    const normalizedKind = getScoutRestaurantLikeKind(restaurant);
    const typeLabel =
      normalizedKind === "food_truck"
        ? "Food truck"
        : normalizedKind === "restaurant"
          ? "Restaurant"
          : "Local food";
    const openState = getRestaurantOpenState(restaurant);
    const status =
      openState === "open"
        ? "Open now"
        : openState === "closed"
          ? "Closed now"
          : null;
    const area = getRestaurantArea(restaurant);
    const meta = [typeLabel, status, area].filter(Boolean).join(" / ");
    const image =
      restaurant.logoUrl ||
      restaurant.coverImageUrl ||
      restaurant.heroImageUrl ||
      restaurant.imageUrl;
    const directionsUrl = buildDirectionsUrl(restaurant);
    return (
      <CompactDecisionCardShell
        href={getRestaurantProfilePath(restaurant)}
        imageUrl={image}
        fallbackIcon={
          normalizedKind === "food_truck" ? (
            <TruckIcon className="h-4 w-4 text-white/90" aria-hidden="true" />
          ) : (
            <MapPin className="h-4 w-4 text-white/90" aria-hidden="true" />
          )
        }
        title={getRestaurantName(restaurant)}
        meta={meta}
        primaryActionLabel="View profile"
        directionsUrl={directionsUrl}
        categoryPhoto={getDishCategoryPhoto(
          getRestaurantName(restaurant),
          restaurant.cuisineType,
        )}
        variant={normalizedKind === "food_truck" ? "truck" : "place"}
      />
    );
  }

  if (item.cardType === "menu_item") {
    const menuItem = item.item;
    const reason = [
      menuItem.restaurantName || "Local menu",
      menuItem.cuisineType,
      typeof menuItem.priceCents === "number" && menuItem.priceCents > 0
        ? `$${(menuItem.priceCents / 100).toFixed(menuItem.priceCents % 100 === 0 ? 0 : 2)}`
        : null,
    ]
      .filter(Boolean)
      .join(" / ");
    return (
      <CompactDecisionCardShell
        href={getMenuItemProfilePath(menuItem)}
        imageUrl={
          menuItem.imageUrl ||
          menuItem.restaurantLogoUrl ||
          menuItem.restaurantCoverImageUrl ||
          null
        }
        fallbackIcon={
          <Utensils className="h-4 w-4 text-white/90" aria-hidden="true" />
        }
        title={menuItem.name}
        meta={reason || "Popular nearby dish"}
        primaryActionLabel="View dish"
        categoryPhoto={getDishCategoryPhoto(
          menuItem.name,
          menuItem.cuisineType,
        )}
        variant="dish"
      />
    );
  }

  if (item.cardType === "deal") {
    const deal = item.deal;
    return (
      <CompactDecisionCardShell
        href={`/deal/${encodeURIComponent(String(deal.id))}`}
        imageUrl={deal.imageUrl || null}
        fallbackIcon={
          <Tag className="h-4 w-4 text-white/90" aria-hidden="true" />
        }
        title={deal.title || "Local deal"}
        meta={
          [deal.restaurantName, deal.discountText || deal.description]
            .filter(Boolean)
            .join(" / ") || "Active nearby deal"
        }
        primaryActionLabel="View deal"
        categoryPhoto={getDishCategoryPhoto(
          deal.title,
          (deal as any).description,
        )}
        variant="deal"
      />
    );
  }

  if (item.cardType === "host") {
    const host = item.host;
    const hostName = host.businessName || host.name || "Host location";
    const hostId = String(host.hostId || host.id || "").trim();
    const area =
      [host.city, host.state].filter(Boolean).join(", ") ||
      host.address ||
      "Nearby location";
    const directionsUrl = buildDirectionsUrl({
      lat: readNumberField(host, ["latitude", "lat"]),
      lng: readNumberField(host, ["longitude", "lng"]),
    });
    return (
      <CompactDecisionCardShell
        href={
          hostId ? `/events?hostId=${encodeURIComponent(hostId)}` : "/events"
        }
        imageUrl={host.spotImageUrl || null}
        fallbackIcon={
          <MapPin className="h-4 w-4 text-white/90" aria-hidden="true" />
        }
        title={hostName}
        meta={["Host location", area].filter(Boolean).join(" / ")}
        primaryActionLabel="View host"
        directionsUrl={directionsUrl}
        variant="host"
      />
    );
  }

  const event = item.event;
  const title = event.title || event.name || "Food event";
  const start = event.startsAt || event.startTime;
  const startLabel = start
    ? new Date(start).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;
  return (
    <CompactDecisionCardShell
      href={`/events?eventId=${encodeURIComponent(String(event.id))}`}
      imageUrl={event.imageUrl || event.heroImageUrl || null}
      fallbackIcon={
        <CalendarDays className="h-4 w-4 text-white/90" aria-hidden="true" />
      }
      title={title}
      meta={
        [event.venueName || event.locationName, startLabel]
          .filter(Boolean)
          .join(" / ") || "Upcoming nearby event"
      }
      primaryActionLabel="View event"
      variant="event"
    />
  );
}

type CompactDecisionCardVariant =
  | "truck"
  | "place"
  | "dish"
  | "deal"
  | "event"
  | "host";

function CompactDecisionCardShell({
  href,
  imageUrl,
  fallbackIcon,
  title,
  meta,
  primaryActionLabel,
  directionsUrl,
  categoryPhoto = null,
  variant = "place",
}: {
  href: string;
  imageUrl?: string | null;
  fallbackIcon: ReactNode;
  title: string;
  meta: string;
  primaryActionLabel: string;
  directionsUrl?: string | null;
  categoryPhoto?: DishCategoryPhoto | null;
  variant?: CompactDecisionCardVariant;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);
  const showImage = Boolean(imageUrl) && !imageFailed;
  const shellClass =
    variant === "dish"
      ? "rounded-[0.85rem] bg-[#2c1609]/82 ring-orange-200/25"
      : variant === "truck"
        ? "rounded-[1.3rem] bg-[#100806]/84 ring-orange-300/30"
        : variant === "deal"
          ? "rounded-[0.95rem] bg-[#12200f]/72 ring-lime-200/20"
          : variant === "event"
            ? "rounded-[1rem] bg-[#0d1724]/72 ring-sky-200/20"
            : variant === "host"
              ? "rounded-[1rem] bg-[#201407]/78 ring-amber-200/30"
              : "rounded-[0.95rem] bg-[#0c1714]/78 ring-emerald-200/20";
  const thumbClass =
    variant === "dish"
      ? "rounded-full bg-orange-200/10 ring-orange-100/25"
      : variant === "truck"
        ? "rounded-2xl bg-orange-200/8 ring-orange-300/25"
        : variant === "deal"
          ? "rounded-lg bg-lime-200/8 ring-lime-200/20"
          : variant === "event"
            ? "rounded-lg bg-sky-200/8 ring-sky-200/20"
            : variant === "host"
              ? "rounded-xl bg-amber-200/10 ring-amber-200/25"
              : "rounded-lg bg-emerald-200/8 ring-emerald-200/20";
  const actionClass =
    variant === "deal"
      ? "bg-lime-300 text-[#102006]"
      : variant === "event"
        ? "bg-sky-300 text-[#071322]"
        : variant === "host"
          ? "bg-amber-300 text-[#1f1204]"
          : "bg-orange-400 text-[#1a0d08]";
  return (
    <div
      className={`relative flex min-h-[82px] items-center gap-3 overflow-hidden p-2.5 ring-1 ${variant === "truck" ? "pl-4" : ""} ${shellClass}`}
      data-scout-immediate-compact-card="true"
    >
      {variant === "truck" ? (
        <span
          className="absolute inset-y-0 left-0 w-1.5 bg-[repeating-linear-gradient(180deg,rgba(251,146,60,0.95)_0_8px,rgba(88,39,12,0.95)_8px_14px)]"
          aria-hidden="true"
        />
      ) : null}
      {variant === "dish" ? (
        <span
          className="absolute inset-x-3 bottom-0 border-t border-dashed border-orange-100/20"
          aria-hidden="true"
        />
      ) : null}
      <div
        className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden ring-1 ${thumbClass}`}
      >
        {showImage ? (
          <img
            src={imageUrl || undefined}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : categoryPhoto ? (
          <img
            src={categoryPhoto.image}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            aria-hidden="true"
            data-testid="scout-compact-card-image-fallback"
          />
        ) : (
          <div
            className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[linear-gradient(150deg,#ff8a4c_0%,#ff5a2f_45%,#c2410c_100%)]"
            data-testid="scout-compact-card-image-fallback"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.22),transparent_55%)]" />
            <div className="relative text-white/90">{fallbackIcon}</div>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-black leading-tight text-white">
          {title}
        </p>
        <p className="mt-1 truncate text-xs font-semibold text-white/58">
          {meta}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Link
            href={href}
            className={`rounded-full px-3 py-1.5 text-[11px] font-black ${actionClass}`}
          >
            {primaryActionLabel}
          </Link>
          {directionsUrl ? (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-white/[0.08] px-3 py-1.5 text-[11px] font-black text-white/82 ring-1 ring-white/10"
            >
              Directions
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type DishCategoryPhoto = { image: string; label: string };

const DISH_CATEGORY_PHOTO_RULES: Array<{
  match: RegExp;
  image: string;
  label: string;
}> = [
  // Ordered most-specific-first: several real menu items hit more than one
  // keyword group (e.g. "Authentic Cuban Sandwich" contains "pulled pork"),
  // and the first matching rule wins, so the more specific dish category
  // goes ahead of the broader one it could otherwise get misread as.
  {
    match:
      /sandwich|\bsub\b|hoagie|\bcuban\b|panini|\bwrap\b|\bmelt\b|po.?boy/i,
    image: "/atmospheric/craving-sandwich.jpg",
    label: "Sandwiches",
  },
  {
    match: /\bbbq\b|barbecue|brisket|\bribs\b|pulled pork|smoked|smokehouse/i,
    image: "/atmospheric/craving-bbq.jpg",
    label: "BBQ",
  },
  {
    match: /\bwings?\b|buffalo|hot wings|\bflats\b|\bdrums\b/i,
    image: "/atmospheric/craving-wings.jpg",
    label: "Wings",
  },
  {
    match: /\bpoke\b|sushi|ahi tuna|nigiri|sashimi|\bmaki\b|poke bowl/i,
    image: "/atmospheric/craving-poke.jpg",
    label: "Poke & Sushi",
  },
  {
    match:
      /seafood|shrimp|\bcrab\b|\bfish\b|grouper|snapper|oyster|scallop|lobster/i,
    image: "/atmospheric/craving-seafood.jpg",
    label: "Seafood",
  },
  {
    match: /salad|greens|caesar|garden salad|greek salad|chopped salad/i,
    image: "/atmospheric/craving-salad.jpg",
    label: "Salads",
  },
  {
    match: /\bcoffee\b|\blatte\b|espresso|cappuccino|cold brew|\bmocha\b/i,
    image: "/atmospheric/craving-coffee.jpg",
    label: "Coffee",
  },
  {
    match:
      /smoothie bowl|acai|açaí|berry bowl|granola bowl|pitaya|\bgranola\b|\bblended\b/i,
    image: "/atmospheric/craving-smoothie-bowl.jpg",
    label: "Smoothie Bowls",
  },
  {
    match:
      /breakfast|\beggs\b|\bbacon\b|biscuit|pancakes?|\bwaffles?\b|hash browns?|omelet|brunch/i,
    image: "/atmospheric/craving-breakfast.jpg",
    label: "Breakfast",
  },
  {
    match: /burger|cheeseburger|hamburger|smash/i,
    image: "/atmospheric/craving-burgers.jpg",
    label: "Burgers",
  },
  {
    match: /taco|burrito|quesadilla|nacho/i,
    image: "/atmospheric/craving-tacos.jpg",
    label: "Tacos",
  },
  {
    match: /pizza|slice|calzone/i,
    image: "/atmospheric/craving-pizza.jpg",
    label: "Pizza",
  },
  {
    match: /ramen|noodle|pho\b/i,
    image: "/atmospheric/craving-ramen.jpg",
    label: "Noodles",
  },
  {
    match: /ice cream|dessert|cake|cookie|donut|pastry|sweet|churro/i,
    image: "/atmospheric/craving-dessert.jpg",
    label: "Desserts",
  },
  {
    match: /juice|drink|tea\b|lemonade|boba/i,
    image: "/atmospheric/craving-drinks.jpg",
    label: "Drinks",
  },
];

function getDishCategoryPhoto(
  ...textParts: Array<string | null | undefined>
): DishCategoryPhoto | null {
  const haystack = textParts.filter(Boolean).join(" ").toLowerCase();
  if (!haystack.trim()) return null;
  for (const rule of DISH_CATEGORY_PHOTO_RULES) {
    if (rule.match.test(haystack))
      return { image: rule.image, label: rule.label };
  }
  return null;
}

function ScoutCardMedia({
  imageUrl,
  fallbackIcon,
  fallbackTestId,
  imageClassName,
  fallbackClassName = "",
  categoryPhoto = null,
}: {
  imageUrl?: string | null;
  fallbackIcon: ReactNode;
  fallbackTestId: string;
  imageClassName: string;
  fallbackClassName?: string;
  categoryPhoto?: DishCategoryPhoto | null;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);
  const showImage = Boolean(imageUrl) && !imageFailed;

  if (showImage) {
    return (
      <img
        src={imageUrl || undefined}
        alt=""
        className={imageClassName}
        loading="lazy"
        onError={() => setImageFailed(true)}
      />
    );
  }

  if (categoryPhoto) {
    return (
      <div
        className="absolute inset-0 overflow-hidden"
        data-testid={fallbackTestId}
      >
        <img
          src={categoryPhoto.image}
          alt=""
          className={imageClassName}
          loading="lazy"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.55) 100%)",
          }}
          aria-hidden="true"
        />
        <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] text-white/85 ring-1 ring-white/25 backdrop-blur-sm">
          {categoryPhoto.label} · photo coming soon
        </span>
      </div>
    );
  }

  return (
    <div
      className={[
        "absolute inset-0 flex items-center justify-center overflow-hidden",
        "bg-[linear-gradient(150deg,#ff8a4c_0%,#ff5a2f_45%,#c2410c_100%)]",
        fallbackClassName,
      ].join(" ")}
      data-testid={fallbackTestId}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.22),transparent_55%)]" />
      <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur-sm">
        {fallbackIcon}
      </div>
    </div>
  );
}

function ActiveSceneContent({
  laneId,
  sceneMixedFeedItems,
  visibleMoreFoodRestaurants,
  topLocalFavoriteRestaurants,
  scoutTruckInventory,
  visibleTrucksServingNow,
  visibleOpenRestaurants,
  nearbyRestaurants,
  visibleDeals,
  hotDealCandidates,
  happyHourDeals,
  visibleSceneEvents,
  visibleHosts,
  localMenuItems,
  popularDishes,
  trendingPlacesThisWeek,
  newToMealScoutRestaurants,
  openingLaterRestaurants,
  visibleLocalActivityItems,
  scoutActivityMode,
  liveTrucksLoading,
  liveTrucksError,
  nearbyRestaurantsLoading,
  locationStatus,
  currentUserId,
  isSignedIn,
  isAdminFamilyUser,
  isTruckVendorUser,
  selectLiveTruck,
  openScoutMap,
  menuPreviewByRestaurantId,
  restaurantRelationships,
  railSectionClass,
  compactRailSectionClass,
  truckCardWidth,
  standardCardWidth,
  featureCardWidth,
  laneFoodTrucksTitle,
  laneRestaurantsTitle,
  laneDealsTitle,
  laneEventsTitle,
  laneMoreTitle,
  restaurantsRailSubtitle,
  eventsRailSubtitle,
  moreRailSubtitle,
  scoutSearchMode,
  scoutSearchIntent,
  renderSearchDock,
}: {
  laneId: ScoutSceneLaneId;
  sceneMixedFeedItems: CravingBoardItem[];
  visibleMoreFoodRestaurants: RestaurantSummary[];
  topLocalFavoriteRestaurants: RestaurantSummary[];
  scoutTruckInventory: LiveTruckSummary[];
  visibleTrucksServingNow: LiveTruckSummary[];
  visibleOpenRestaurants: RestaurantSummary[];
  nearbyRestaurants: RestaurantSummary[];
  visibleDeals: DealSummary[];
  hotDealCandidates: DealSummary[];
  happyHourDeals: DealSummary[];
  visibleSceneEvents: EventSummary[];
  visibleHosts: ScoutHostLocation[];
  localMenuItems: LocalMenuItemFeedItem[];
  popularDishes: TrendingDishSummary[];
  trendingPlacesThisWeek: TrendingPlaceSummary[];
  newToMealScoutRestaurants: RestaurantSummary[];
  openingLaterRestaurants: RestaurantSummary[];
  visibleLocalActivityItems: LocalActivityItem[];
  scoutActivityMode: ScoutActivityMode;
  liveTrucksLoading: boolean;
  liveTrucksError: boolean;
  nearbyRestaurantsLoading: boolean;
  locationStatus: "idle" | "requesting" | "ready" | "denied";
  currentUserId?: string | null;
  isSignedIn: boolean;
  isAdminFamilyUser: boolean;
  isTruckVendorUser: boolean;
  selectLiveTruck: (truck: LiveTruckSummary) => void;
  openScoutMap: () => void;
  menuPreviewByRestaurantId: Map<string, MenuPreviewItem[]>;
  restaurantRelationships: RestaurantRelationshipSnapshot;
  railSectionClass: string;
  compactRailSectionClass: string;
  truckCardWidth: string;
  standardCardWidth: string;
  featureCardWidth: string;
  laneFoodTrucksTitle: string;
  laneRestaurantsTitle: string;
  laneDealsTitle: string;
  laneEventsTitle: string;
  laneMoreTitle: string;
  restaurantsRailSubtitle?: string;
  eventsRailSubtitle?: string;
  moreRailSubtitle: string;
  scoutSearchMode: boolean;
  scoutSearchIntent: ScoutSearchIntent;
  renderSearchDock?: () => ReactNode;
}) {
  const isLowActivityLane = scoutActivityMode === "low_activity";
  if (laneId === "for_you") {
    type ScoutBusinessSectionCard =
      | { cardType: "truck"; truck: LiveTruckSummary }
      | { cardType: "restaurant"; restaurant: RestaurantSummary };

    const toBusinessKey = (card: ScoutBusinessSectionCard) =>
      card.cardType === "truck"
        ? getScoutBusinessCardKey(card.truck, getTruckProfilePath(card.truck))
        : getScoutBusinessCardKey(
            card.restaurant,
            getRestaurantProfilePath(card.restaurant),
          );
    const truckCards = (
      items: LiveTruckSummary[],
    ): ScoutBusinessSectionCard[] =>
      items.map((truck) => ({ cardType: "truck", truck }));
    const restaurantCards = (
      items: RestaurantSummary[],
    ): ScoutBusinessSectionCard[] =>
      items.map((restaurant) => ({ cardType: "restaurant", restaurant }));
    const extractTrucks = (items: ScoutBusinessSectionCard[] = []) =>
      items
        .filter(
          (item): item is { cardType: "truck"; truck: LiveTruckSummary } =>
            item.cardType === "truck",
        )
        .map((item) => item.truck);
    const extractRestaurants = (items: ScoutBusinessSectionCard[] = []) =>
      items
        .filter(
          (
            item,
          ): item is {
            cardType: "restaurant";
            restaurant: RestaurantSummary;
          } => item.cardType === "restaurant",
        )
        .map((item) => item.restaurant);

    const liveTruckCandidates = visibleTrucksServingNow;
    const foodTrucksTodayCandidates = scoutTruckInventory;
    const nearbyRestaurantCandidates = nearbyRestaurants;
    const favoriteRestaurantCandidates = nearbyRestaurantCandidates.filter(
      (restaurant) =>
        restaurantRelationships.favoriteIds.has(String(restaurant.id)),
    );
    const followedRestaurantCandidates = nearbyRestaurantCandidates.filter(
      (restaurant) =>
        restaurantRelationships.followIds.has(String(restaurant.id)),
    );
    const orderAgainCandidates: ScoutBusinessSectionCard[] = [];
    const trendingPlaceCardsRaw: RestaurantSummary[] =
      trendingPlacesThisWeek.map((place) => ({
        id: place.id,
        businessName: place.name,
        name: place.name,
        city: place.city ?? null,
        state: place.state ?? null,
        cuisineType: place.cuisineType ?? null,
        coverImageUrl: place.coverImageUrl ?? null,
        logoUrl: place.logoUrl ?? null,
        businessType: place.businessType ?? null,
        isFoodTruck: place.isFoodTruck ?? null,
      }));
    const scoutBusinessAssignments =
      assignScoutBusinessCardsBySection<ScoutBusinessSectionCard>([
        {
          id: "live_trucks_now",
          items: truckCards(liveTruckCandidates),
          getBusinessKey: toBusinessKey,
        },
        {
          id: "food_trucks_today",
          items: truckCards(foodTrucksTodayCandidates),
          getBusinessKey: toBusinessKey,
        },
        {
          id: "open_now_near_you",
          items: [
            ...truckCards(liveTruckCandidates),
            ...restaurantCards(visibleOpenRestaurants),
          ],
          getBusinessKey: toBusinessKey,
        },
        {
          id: "saved_favorites",
          items: restaurantCards(favoriteRestaurantCandidates),
          getBusinessKey: toBusinessKey,
        },
        {
          id: "following",
          items: restaurantCards(followedRestaurantCandidates),
          getBusinessKey: toBusinessKey,
        },
        {
          id: "order_again",
          items: orderAgainCandidates,
          getBusinessKey: toBusinessKey,
        },
        {
          id: "nearby_restaurants",
          items: restaurantCards(
            nearbyRestaurantCandidates.filter(
              (restaurant) =>
                getScoutRestaurantLikeKind(restaurant) === "restaurant",
            ),
          ),
          getBusinessKey: toBusinessKey,
        },
        {
          id: "trending_this_week",
          items: restaurantCards(trendingPlaceCardsRaw),
          getBusinessKey: toBusinessKey,
        },
        {
          id: "new_to_mealscout",
          items: restaurantCards(newToMealScoutRestaurants),
          getBusinessKey: toBusinessKey,
        },
        {
          id: "community_picks",
          items: restaurantCards(topLocalFavoriteRestaurants),
          getBusinessKey: toBusinessKey,
        },
        {
          id: "worth_discovering",
          items: [
            ...truckCards(scoutTruckInventory),
            ...restaurantCards(visibleMoreFoodRestaurants),
          ],
          getBusinessKey: toBusinessKey,
        },
      ]);
    const liveTruckCards = extractTrucks(
      scoutBusinessAssignments.live_trucks_now,
    );
    const forYouTruckItems = extractTrucks(
      scoutBusinessAssignments.food_trucks_today,
    );
    const openNowTruckCards = extractTrucks(
      scoutBusinessAssignments.open_now_near_you,
    );
    const openNowRestaurantCards = extractRestaurants(
      scoutBusinessAssignments.open_now_near_you,
    );
    const favoriteCards = extractRestaurants(
      scoutBusinessAssignments.saved_favorites,
    );
    const followingCards = extractRestaurants(
      scoutBusinessAssignments.following,
    );
    const orderAgainCards = scoutBusinessAssignments.order_again ?? [];
    const nearbyRestaurantCards = extractRestaurants(
      scoutBusinessAssignments.nearby_restaurants,
    );
    const trendingPlaceCards = extractRestaurants(
      scoutBusinessAssignments.trending_this_week,
    );
    const newToMealScoutCards = extractRestaurants(
      scoutBusinessAssignments.new_to_mealscout,
    );
    const communityPickCards = extractRestaurants(
      scoutBusinessAssignments.community_picks,
    );
    const worthDiscoveringCards =
      scoutBusinessAssignments.worth_discovering ?? [];
    const knownTruckIds = new Set(
      scoutTruckInventory.map((truck) => String(truck.id)),
    );
    const popularDishCards: LocalMenuItemFeedItem[] =
      popularDishes.length > 0
        ? popularDishes.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description ?? null,
            imageUrl: item.imageUrl ?? null,
            priceCents: item.priceCents ?? null,
            restaurantId: item.restaurantId,
            restaurantName: item.restaurantName ?? null,
            restaurantCity: item.restaurantCity ?? null,
            restaurantState: item.restaurantState ?? null,
            restaurantLogoUrl: item.restaurantLogoUrl ?? null,
            restaurantCoverImageUrl: item.restaurantCoverImageUrl ?? null,
            cuisineType: item.cuisineType ?? null,
            businessType:
              item.businessType ??
              (knownTruckIds.has(String(item.restaurantId))
                ? "food_truck"
                : null),
            isFoodTruck:
              item.isFoodTruck ?? knownTruckIds.has(String(item.restaurantId)),
          }))
        : localMenuItems.slice(0, 8);

    const highPriorityDecisionItems: ScoutImmediateDecisionItem[] = [
      ...liveTruckCards.map((truck) => ({
        sourceRowId: "live_trucks_now" as const,
        sectionLabel: "Now Serving Trucks",
        summary: formatScoutCount(
          liveTruckCards.length,
          "truck live now",
          "trucks live now",
        ),
        cardType: "truck" as const,
        truck,
        businessKey: getScoutBusinessCardKey(truck, getTruckProfilePath(truck)),
      })),
      ...forYouTruckItems.map((truck) => ({
        sourceRowId: "food_trucks_today" as const,
        sectionLabel: "Food Trucks Today",
        summary: formatScoutCount(
          forYouTruckItems.length,
          "truck nearby today",
          "trucks nearby today",
        ),
        cardType: "truck" as const,
        truck,
        businessKey: getScoutBusinessCardKey(truck, getTruckProfilePath(truck)),
      })),
      ...openNowTruckCards.map((truck) => ({
        sourceRowId: "open_now_near_you" as const,
        sectionLabel: "Open Now",
        summary: formatScoutCount(
          openNowTruckCards.length + openNowRestaurantCards.length,
          "open nearby",
          "open nearby",
        ),
        cardType: "truck" as const,
        truck,
        businessKey: getScoutBusinessCardKey(truck, getTruckProfilePath(truck)),
      })),
      ...openNowRestaurantCards.map((restaurant) => ({
        sourceRowId: "open_now_near_you" as const,
        sectionLabel: "Open Nearby",
        summary: formatScoutCount(
          openNowTruckCards.length + openNowRestaurantCards.length,
          "open nearby",
          "open nearby",
        ),
        cardType: "restaurant" as const,
        restaurant,
        businessKey: getScoutBusinessCardKey(
          restaurant,
          getRestaurantProfilePath(restaurant),
        ),
      })),
      ...visibleHosts.map((host) => ({
        sourceRowId: "host_locations" as const,
        sectionLabel: "Host Locations",
        summary: formatScoutCount(
          visibleHosts.length,
          "host nearby",
          "hosts nearby",
        ),
        cardType: "host" as const,
        host,
      })),
      ...communityPickCards.map((restaurant) => ({
        sourceRowId: "community_picks" as const,
        sectionLabel: "Community Picks",
        summary: formatScoutCount(
          communityPickCards.length,
          "real community pick",
          "real community picks",
        ),
        cardType: "restaurant" as const,
        restaurant,
        businessKey: getScoutBusinessCardKey(
          restaurant,
          getRestaurantProfilePath(restaurant),
        ),
      })),
      ...trendingPlaceCards.map((restaurant) => ({
        sourceRowId: "trending_this_week" as const,
        sectionLabel: "Best Now",
        summary: formatScoutCount(
          trendingPlaceCards.length,
          "popular pick",
          "popular picks",
        ),
        cardType: "restaurant" as const,
        restaurant,
        businessKey: getScoutBusinessCardKey(
          restaurant,
          getRestaurantProfilePath(restaurant),
        ),
      })),
      ...newToMealScoutCards.map((restaurant) => ({
        sourceRowId: "new_to_mealscout" as const,
        sectionLabel: "Newest",
        summary: formatScoutCount(
          newToMealScoutCards.length,
          "new nearby listing",
          "new nearby listings",
        ),
        cardType: "restaurant" as const,
        restaurant,
        businessKey: getScoutBusinessCardKey(
          restaurant,
          getRestaurantProfilePath(restaurant),
        ),
      })),
      ...popularDishCards.map((item) => ({
        sourceRowId: "popular_dishes" as const,
        sectionLabel: "Popular Dishes",
        summary: formatScoutCount(
          popularDishCards.length,
          "popular dish",
          "popular dishes",
        ),
        cardType: "menu_item" as const,
        item,
      })),
      ...hotDealCandidates.map((deal) => ({
        sourceRowId: "hot_deals" as const,
        sectionLabel: "Deals",
        summary: formatScoutCount(
          hotDealCandidates.length,
          "active deal",
          "active deals",
        ),
        cardType: "deal" as const,
        deal,
      })),
      ...happyHourDeals.map((deal) => ({
        sourceRowId: "happy_hours" as const,
        sectionLabel: "Happy Hours",
        summary: formatScoutCount(
          happyHourDeals.length,
          "happy hour",
          "happy hours",
        ),
        cardType: "deal" as const,
        deal,
      })),
      ...visibleSceneEvents.map((event) => ({
        sourceRowId: "events_popups" as const,
        sectionLabel: "Events & Pop-Ups",
        summary: formatScoutCount(
          visibleSceneEvents.length,
          "nearby event",
          "nearby events",
        ),
        cardType: "event" as const,
        event,
      })),
    ];
    const nearbyOnlyDecisionItems: ScoutImmediateDecisionItem[] =
      highPriorityDecisionItems.length > 0
        ? []
        : nearbyRestaurantCards.map((restaurant) => {
            const openState = getRestaurantOpenState(restaurant);
            const summary =
              openState === "open"
                ? formatScoutCount(
                    nearbyRestaurantCards.length,
                    "open nearby",
                    "open nearby",
                  )
                : formatScoutCount(
                    nearbyRestaurantCards.length,
                    "nearby spot",
                    "nearby spots",
                  );
            return {
              sourceRowId: "nearby_restaurants" as const,
              sectionLabel: openState === "open" ? "Open Nearby" : "Nearby Now",
              summary,
              cardType: "restaurant" as const,
              restaurant,
              businessKey: getScoutBusinessCardKey(
                restaurant,
                getRestaurantProfilePath(restaurant),
              ),
            };
          });
    const firstScreenDecisionItems = [
      ...highPriorityDecisionItems,
      ...nearbyOnlyDecisionItems,
    ];
    const primaryFirstScreenDecision = firstScreenDecisionItems[0] ?? null;
    const popularDishesRailTitle =
      primaryFirstScreenDecision?.sourceRowId === "popular_dishes"
        ? "More Dishes Nearby"
        : DISCOVERY_LAYERS.menuItems.title;
    const firstScreenSuppressedBusinessKey =
      primaryFirstScreenDecision?.cardType === "truck" ||
      primaryFirstScreenDecision?.cardType === "restaurant"
        ? primaryFirstScreenDecision.businessKey
        : null;
    const suppressFirstScreenBusiness = (card: ScoutRailRenderCard) => {
      if (!firstScreenSuppressedBusinessKey) return false;
      if (card.cardType === "truck") {
        return (
          getScoutBusinessCardKey(
            card.truck,
            getTruckProfilePath(card.truck),
          ) === firstScreenSuppressedBusinessKey
        );
      }
      if (card.cardType === "restaurant") {
        return (
          getScoutBusinessCardKey(
            card.restaurant,
            getRestaurantProfilePath(card.restaurant),
          ) === firstScreenSuppressedBusinessKey
        );
      }
      return false;
    };

    const hasForYouSections =
      visibleLocalActivityItems.length > 0 ||
      liveTruckCards.length > 0 ||
      openNowRestaurantCards.length > 0 ||
      forYouTruckItems.length > 0 ||
      favoriteCards.length > 0 ||
      followingCards.length > 0 ||
      orderAgainCards.length > 0 ||
      nearbyRestaurantCards.length > 0 ||
      trendingPlaceCards.length > 0 ||
      newToMealScoutCards.length > 0 ||
      popularDishCards.length > 0 ||
      hotDealCandidates.length > 0 ||
      happyHourDeals.length > 0 ||
      visibleSceneEvents.length > 0 ||
      visibleHosts.length > 0 ||
      communityPickCards.length > 0 ||
      worthDiscoveringCards.length > 0;

    if (!hasForYouSections) {
      return (
        <>
          <ScoutFirstScreenDecisionStack
            items={firstScreenDecisionItems}
            thinMarket={
              isLowActivityLane && firstScreenDecisionItems.length <= 1
            }
          />
          {renderSearchDock?.()}
          <ScoutSceneEmptyState laneId="for_you" />
        </>
      );
    }

    const truckRailCards = (
      trucks: LiveTruckSummary[],
    ): ScoutRailRenderCard[] =>
      trucks.map((truck) => ({
        cardType: "truck",
        cardKind: "food_truck",
        truck,
      }));
    const restaurantRailCards = (
      restaurants: RestaurantSummary[],
      cardKind: "restaurant" | "community_pick" = "restaurant",
    ): ScoutRailRenderCard[] =>
      restaurants.map((restaurant) => ({
        cardType: "restaurant",
        cardKind,
        restaurant,
      }));
    const menuItemRailCards = (
      items: LocalMenuItemFeedItem[],
    ): ScoutRailRenderCard[] =>
      items.map((item, position) => ({
        cardType: "menu_item",
        cardKind: "menu_item",
        item,
        position,
      }));
    const dealRailCards = (
      deals: DealSummary[],
      cardKind: "deal" | "happy_hour" = "deal",
    ): ScoutRailRenderCard[] =>
      deals.map((deal) => ({ cardType: "deal", cardKind, deal }));
    const eventRailCards = (events: EventSummary[]): ScoutRailRenderCard[] =>
      events.map((event) => ({ cardType: "event", cardKind: "event", event }));
    const businessSectionRailCards = (
      cards: ScoutBusinessSectionCard[],
    ): ScoutRailRenderCard[] =>
      cards.map((card) =>
        card.cardType === "truck"
          ? { cardType: "truck", cardKind: "food_truck", truck: card.truck }
          : {
              cardType: "restaurant",
              cardKind: "restaurant",
              restaurant: card.restaurant,
            },
      );

    const scoutRows = (
      [
        {
          id: "live_trucks_now",
          title: "Now Serving Trucks",
          subtitle: "Food trucks currently serving nearby.",
          linkHref: DISCOVERY_LAYERS.foodTrucks.href,
          cards: truckRailCards(liveTruckCards),
          className: railSectionClass,
          cardWidth: truckCardWidth,
        },
        {
          id: "food_trucks_today",
          title: "Food Trucks Today",
          subtitle:
            "Scheduled trucks and open-now options from real local data.",
          linkHref: DISCOVERY_LAYERS.foodTrucks.href,
          cards: truckRailCards(forYouTruckItems),
          className: railSectionClass,
          cardWidth: truckCardWidth,
        },
        {
          id: "open_now_near_you",
          title: "Open Now Near You",
          subtitle: "Open restaurants and serving trucks near your location.",
          linkHref: DISCOVERY_LAYERS.restaurants.href,
          cards: [
            ...truckRailCards(openNowTruckCards),
            ...restaurantRailCards(openNowRestaurantCards),
          ],
          className: railSectionClass,
          cardWidth: standardCardWidth,
        },
        {
          id: "saved_favorites",
          title: "Your Favorites",
          subtitle:
            "Saved spots near this Scout area that are not already shown above.",
          linkHref: "/favorites",
          cards: restaurantRailCards(favoriteCards),
          className: compactRailSectionClass,
          cardWidth: standardCardWidth,
        },
        {
          id: "following",
          title: "Following",
          subtitle: "Places you follow near this Scout area.",
          linkHref: "/favorites",
          cards: restaurantRailCards(followingCards),
          className: compactRailSectionClass,
          cardWidth: standardCardWidth,
        },
        {
          id: "order_again",
          title: "Order Again",
          subtitle:
            "Past orders will appear here when real order history is available.",
          linkHref: "/orders",
          cards: businessSectionRailCards(orderAgainCards),
          className: compactRailSectionClass,
          cardWidth: standardCardWidth,
        },
        {
          id: "popular_dishes",
          title: popularDishesRailTitle,
          subtitle:
            popularDishes.length > 0
              ? DISCOVERY_LAYERS.menuItems.subtitle
              : "Recent menu items from nearby restaurants and trucks.",
          linkHref: DISCOVERY_LAYERS.menuItems.href,
          cards: menuItemRailCards(popularDishCards),
          className: railSectionClass,
          cardWidth: featureCardWidth,
        },
        {
          id: "hot_deals",
          title: DISCOVERY_LAYERS.deals.title,
          subtitle: DISCOVERY_LAYERS.deals.subtitle,
          linkHref: DISCOVERY_LAYERS.deals.href,
          cards: dealRailCards(hotDealCandidates),
          className: railSectionClass,
          cardWidth: featureCardWidth,
        },
        {
          id: "happy_hours",
          title: "Happy Hours",
          subtitle: "Deals explicitly marked as happy hour nearby.",
          linkHref: DISCOVERY_LAYERS.deals.href,
          cards: dealRailCards(happyHourDeals, "happy_hour"),
          className: compactRailSectionClass,
          cardWidth: featureCardWidth,
        },
        {
          id: "events_popups",
          title: DISCOVERY_LAYERS.events.title,
          subtitle: "Pop-ups and food events near this Scout area.",
          linkHref: DISCOVERY_LAYERS.events.href,
          cards: eventRailCards(visibleSceneEvents),
          className: railSectionClass,
          cardWidth: featureCardWidth,
        },
        {
          id: "nearby_restaurants",
          title: DISCOVERY_LAYERS.restaurants.title,
          subtitle: DISCOVERY_LAYERS.restaurants.subtitle,
          linkHref: DISCOVERY_LAYERS.restaurants.href,
          cards: restaurantRailCards(nearbyRestaurantCards),
          className: railSectionClass,
          cardWidth: standardCardWidth,
        },
        {
          id: "trending_this_week",
          title: "Popular Nearby",
          subtitle: "Fresh finds and active trucks near you right now.",
          linkHref: DISCOVERY_LAYERS.trending.href,
          cards: restaurantRailCards(trendingPlaceCards),
          className: compactRailSectionClass,
          cardWidth: standardCardWidth,
        },
        {
          id: "new_to_mealscout",
          title: "Newest on MealScout",
          subtitle: "Fresh local listings that recently joined the board.",
          linkHref: "/search",
          cards: restaurantRailCards(newToMealScoutCards),
          className: compactRailSectionClass,
          cardWidth: standardCardWidth,
        },
        {
          id: "community_picks",
          title: DISCOVERY_LAYERS.localBoard.title,
          subtitle:
            "Saved, followed, recommended, and revisited by locals nearby.",
          linkHref: DISCOVERY_LAYERS.localBoard.href,
          cards: restaurantRailCards(communityPickCards, "community_pick"),
          className: compactRailSectionClass,
          cardWidth: standardCardWidth,
        },
        {
          id: "worth_discovering",
          title: "Worth Discovering",
          subtitle:
            "Quiet, nearby food spots not already claimed by stronger shelves.",
          linkHref: DISCOVERY_LAYERS.restaurants.href,
          cards: businessSectionRailCards(worthDiscoveringCards),
          className: compactRailSectionClass,
          cardWidth: standardCardWidth,
        },
      ] satisfies ScoutHorizontalRailDefinition[]
    )
      .sort((a, b) => {
        const restaurantSearchPriority: Partial<
          Record<ScoutHorizontalRowId, number>
        > =
          scoutSearchMode && scoutSearchIntent === "restaurants"
            ? {
                live_trucks_now: 1,
                nearby_restaurants: 2,
                open_now_near_you: 3,
              }
            : {};
        return (
          (restaurantSearchPriority[a.id] ??
            scoutHorizontalRowMeta.get(a.id)?.priority ??
            999) -
          (restaurantSearchPriority[b.id] ??
            scoutHorizontalRowMeta.get(b.id)?.priority ??
            999)
        );
      })
      .map((row) => ({
        ...row,
        cards: row.cards.filter((card) => !suppressFirstScreenBusiness(card)),
      }));

    const renderScoutRailCard = (card: ScoutRailRenderCard) => {
      if (card.cardType === "truck") {
        return card.cardKind === "food_truck" &&
          isTruckServingNow(card.truck) ? (
          <LiveTruckCard
            truck={card.truck}
            currentUserId={currentUserId}
            relationshipSnapshot={restaurantRelationships}
          />
        ) : (
          <TruckCard truck={card.truck} currentUserId={currentUserId} />
        );
      }
      if (card.cardType === "restaurant") {
        return (
          <NearbyRestaurantCard
            restaurant={card.restaurant}
            menuPreview={
              menuPreviewByRestaurantId.get(String(card.restaurant.id)) ?? []
            }
            isSignedIn={isSignedIn}
            currentUserId={currentUserId}
            relationshipSnapshot={restaurantRelationships}
          />
        );
      }
      if (card.cardType === "menu_item") {
        return (
          <LocalMenuItemCard
            item={card.item}
            position={card.position}
            currentUserId={currentUserId}
          />
        );
      }
      if (card.cardType === "deal") {
        return <DealCard deal={card.deal} currentUserId={currentUserId} />;
      }
      if (card.cardType === "event") {
        return <EventCard event={card.event} currentUserId={currentUserId} />;
      }
      return null;
    };

    return (
      <>
        <ScoutFirstScreenDecisionStack
          items={firstScreenDecisionItems}
          thinMarket={isLowActivityLane && firstScreenDecisionItems.length <= 1}
        />
        {renderSearchDock?.()}
        {scoutRows.map((row) => (
          <ScoutHorizontalCategoryRail
            key={row.id}
            row={row}
            renderCard={renderScoutRailCard}
          />
        ))}
      </>
    );
  }

  if (laneId === "community") {
    if (topLocalFavoriteRestaurants.length > 0) {
      return (
        <section className={compactRailSectionClass}>
          <SectionHeader
            title={DISCOVERY_LAYERS.localBoard.title}
            linkHref={DISCOVERY_LAYERS.localBoard.href}
            subtitle="Saved, followed, or shared by people nearby."
            itemCount={topLocalFavoriteRestaurants.length}
          />
          <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
            <ul
              className="flex gap-4 pr-5"
              role="list"
              aria-label="Top local favorites"
            >
              {topLocalFavoriteRestaurants.slice(0, 10).map((restaurant) => (
                <li
                  key={`local-favorite-${restaurant.id}`}
                  className={`shrink-0 ${standardCardWidth}`}
                >
                  <SavedRestaurantCard restaurant={restaurant} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    }
    return <ScoutSceneEmptyState laneId="community" />;
  }

  return (
    <>
      {laneId === "nearby_now" && visibleLocalActivityItems.length > 0 ? (
        <LocalActivityRail
          mode={scoutActivityMode}
          items={visibleLocalActivityItems}
        />
      ) : null}

      {(laneId === "nearby_now" || laneId === "food_trucks") && (
        <section className={railSectionClass}>
          <SectionHeader
            title={laneFoodTrucksTitle}
            linkHref={DISCOVERY_LAYERS.foodTrucks.href}
            subtitle={DISCOVERY_LAYERS.foodTrucks.subtitle}
            itemCount={visibleTrucksServingNow.length}
          />
          {liveTrucksLoading && visibleTrucksServingNow.length === 0 ? (
            <HorizontalSkeletonRow count={3} width={200} />
          ) : (
            <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
              <ul
                className="flex gap-4 pr-5"
                role="list"
                aria-label="Food trucks near you"
              >
                {visibleTrucksServingNow.slice(0, 12).map((t) => (
                  <li key={t.id} className={`shrink-0 ${truckCardWidth}`}>
                    <TruckCard
                      truck={t}
                      onSelect={selectLiveTruck}
                      currentUserId={currentUserId}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {(laneId === "nearby_now" ||
        laneId === "restaurants" ||
        laneId === "late_night") && (
        <section className={railSectionClass}>
          <SectionHeader
            title={laneRestaurantsTitle}
            linkHref={DISCOVERY_LAYERS.restaurants.href}
            subtitle={restaurantsRailSubtitle}
            itemCount={visibleOpenRestaurants.length}
          />
          {nearbyRestaurantsLoading && visibleOpenRestaurants.length === 0 ? (
            <HorizontalSkeletonRow count={3} width={200} />
          ) : (
            <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
              <ul
                className="flex gap-4 pr-5"
                role="list"
                aria-label="Restaurants open now"
              >
                {visibleOpenRestaurants.slice(0, 10).map((r) => (
                  <li key={r.id} className={`shrink-0 ${standardCardWidth}`}>
                    <NearbyRestaurantCard
                      restaurant={r}
                      menuPreview={
                        menuPreviewByRestaurantId.get(String(r.id)) ?? []
                      }
                      isSignedIn={isSignedIn}
                      currentUserId={currentUserId}
                      relationshipSnapshot={restaurantRelationships}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {(laneId === "nearby_now" || laneId === "deals") &&
      visibleDeals.length > 0 ? (
        <section className={railSectionClass}>
          <SectionHeader
            title={laneDealsTitle}
            linkHref={DISCOVERY_LAYERS.deals.href}
            subtitle={DISCOVERY_LAYERS.deals.subtitle}
            itemCount={visibleDeals.length}
          />
          <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
            <ul className="flex gap-4 pr-5" role="list">
              {visibleDeals.slice(0, 10).map((d) => (
                <li key={d.id} className={`shrink-0 ${featureCardWidth}`}>
                  <DealCard deal={d} currentUserId={currentUserId} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {(laneId === "nearby_now" || laneId === "events") &&
      visibleSceneEvents.length > 0 ? (
        <section className={railSectionClass}>
          <SectionHeader
            title={laneEventsTitle}
            linkHref={DISCOVERY_LAYERS.events.href}
            subtitle={eventsRailSubtitle}
            itemCount={visibleSceneEvents.length}
          />
          <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
            <ul className="flex gap-4 pr-5" role="list">
              {visibleSceneEvents.slice(0, 8).map((e) => (
                <li key={e.id} className={`shrink-0 ${featureCardWidth}`}>
                  <EventCard event={e} currentUserId={currentUserId} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {laneId === "new_menus" && localMenuItems.length > 0 ? (
        <section className={railSectionClass}>
          <SectionHeader
            title="New Menus"
            linkHref={DISCOVERY_LAYERS.menuItems.href}
            subtitle="Fresh menu items and recent local updates."
            itemCount={localMenuItems.length}
          />
          <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
            <ul className="flex gap-4 pr-5" role="list" aria-label="New menus">
              {localMenuItems.slice(0, 10).map((item, index) => (
                <li
                  key={`menu-item-${item.id}`}
                  className={`shrink-0 ${featureCardWidth}`}
                >
                  <LocalMenuItemCard
                    item={item}
                    position={index}
                    currentUserId={currentUserId}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {(laneId === "worth_discovering" || laneId === "late_night") &&
      visibleMoreFoodRestaurants.length > 0 ? (
        <section className={compactRailSectionClass}>
          <SectionHeader
            title={laneMoreTitle}
            linkHref={DISCOVERY_LAYERS.restaurants.href}
            subtitle={moreRailSubtitle}
            itemCount={visibleMoreFoodRestaurants.length}
          />
          <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
            <ul
              className="flex gap-4 pr-5"
              role="list"
              aria-label="Worth discovering"
            >
              {visibleMoreFoodRestaurants.slice(0, 10).map((r) => (
                <li
                  key={`restaurant-worth-${r.id}`}
                  className={`shrink-0 ${standardCardWidth}`}
                >
                  <SavedRestaurantCard restaurant={r} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {laneId === "late_night" && openingLaterRestaurants.length > 0 ? (
        <section className={compactRailSectionClass}>
          <SectionHeader
            title="Opening Later"
            linkHref={DISCOVERY_LAYERS.restaurants.href}
            subtitle="Places nearby that are closed right now but worth checking soon."
            itemCount={openingLaterRestaurants.length}
          />
          <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
            <ul
              className="flex gap-4 pr-5"
              role="list"
              aria-label="Opening later"
            >
              {openingLaterRestaurants.slice(0, 10).map((r) => (
                <li
                  key={`restaurant-later-${r.id}`}
                  className={`shrink-0 ${standardCardWidth}`}
                >
                  <SavedRestaurantCard restaurant={r} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {(laneId === "food_trucks" && visibleTrucksServingNow.length === 0) ||
      (laneId === "restaurants" && visibleOpenRestaurants.length === 0) ||
      (laneId === "deals" && visibleDeals.length === 0) ||
      (laneId === "events" &&
        visibleSceneEvents.length === 0 &&
        visibleHosts.length === 0) ||
      (laneId === "new_menus" && localMenuItems.length === 0) ||
      (laneId === "late_night" &&
        visibleOpenRestaurants.length === 0 &&
        visibleMoreFoodRestaurants.length === 0) ||
      (laneId === "worth_discovering" &&
        visibleMoreFoodRestaurants.length === 0) ||
      (laneId === "nearby_now" &&
        visibleLocalActivityItems.length === 0 &&
        visibleTrucksServingNow.length === 0 &&
        visibleOpenRestaurants.length === 0 &&
        visibleDeals.length === 0 &&
        visibleSceneEvents.length === 0 &&
        visibleHosts.length === 0) ? (
        <ScoutSceneEmptyState laneId={laneId} />
      ) : null}
    </>
  );
}

function SceneMixedFeed({ items }: { items: CravingBoardItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="px-4 pb-4">
      <ul
        className="space-y-2.5"
        role="list"
        aria-label="Today around you feed"
      >
        {items.map((item) => (
          <li key={item.id}>
            <SceneMixedFeedCard item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SceneMixedFeedCard({ item }: { item: CravingBoardItem }) {
  const kindColor =
    item.kind === "Truck"
      ? "text-orange-200"
      : item.kind === "Menu"
        ? "text-orange-300"
        : item.kind === "Deal"
          ? "text-lime-300"
          : item.kind === "Event"
            ? "text-sky-300"
            : "text-orange-300";
  const badge =
    item.kind === "Truck"
      ? "Food truck"
      : item.kind === "Menu"
        ? "Menu item"
        : item.kind === "Deal"
          ? "Deal today"
          : item.kind === "Event"
            ? "Event today"
            : "Restaurant";
  const freshnessMeta = item.freshnessMeta || { kind: "restaurant" as const };
  const badges = [item.reason, ...getOperationalBadges(freshnessMeta)]
    .filter((label): label is string => Boolean(label))
    .filter((label, index, all) => all.indexOf(label) === index)
    .slice(0, 1);
  const shellClass =
    item.kind === "Menu"
      ? "rounded-[0.85rem] bg-[#2c1609]/82 ring-orange-200/25 hover:bg-[#351a0a]/92 hover:ring-orange-200/50"
      : item.kind === "Truck"
        ? "rounded-[1.35rem] bg-[#100806]/84 ring-orange-300/30 hover:bg-[#1a0d07]/92 hover:ring-orange-200/40"
        : item.kind === "Deal"
          ? "rounded-xl bg-[#12200f]/72 ring-lime-200/20 hover:bg-[#172913]/86 hover:ring-lime-200/30"
          : item.kind === "Event"
            ? "rounded-xl bg-[#0d1724]/72 ring-sky-200/20 hover:bg-[#111e2f]/86 hover:ring-sky-200/30"
            : "rounded-xl bg-[#0c1714]/78 ring-emerald-200/20 hover:bg-[#121f1b]/88 hover:ring-emerald-200/30";
  const thumbClass =
    item.kind === "Menu"
      ? "rounded-full bg-orange-200/10 ring-orange-100/25"
      : item.kind === "Truck"
        ? "rounded-2xl bg-orange-200/8 ring-orange-300/25"
        : item.kind === "Deal"
          ? "rounded-lg bg-lime-200/8 ring-lime-200/20"
          : item.kind === "Event"
            ? "rounded-lg bg-sky-200/8 ring-sky-200/20"
            : "rounded-lg bg-emerald-200/8 ring-emerald-200/20";

  return (
    <Link
      href={item.href}
      className={`relative flex items-center gap-3 overflow-hidden px-3 py-2.5 text-white ring-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 ${item.kind === "Truck" ? "pl-5" : ""} ${shellClass}`}
    >
      {item.kind === "Truck" ? (
        <span
          className="absolute inset-y-0 left-0 w-1.5 bg-[repeating-linear-gradient(180deg,rgba(251,146,60,0.95)_0_8px,rgba(88,39,12,0.95)_8px_14px)]"
          aria-hidden="true"
        />
      ) : null}
      {item.kind === "Menu" ? (
        <span
          className="absolute inset-x-3 bottom-0 border-t border-dashed border-orange-100/20"
          aria-hidden="true"
        />
      ) : null}
      <div
        className={`h-16 w-16 shrink-0 overflow-hidden ring-1 ${thumbClass}`}
      >
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {item.kind === "Truck" ? (
              <TruckIcon
                className="h-5 w-5 text-orange-200/70"
                aria-hidden="true"
              />
            ) : item.kind === "Deal" ? (
              <Tag className="h-5 w-5 text-lime-200/70" aria-hidden="true" />
            ) : item.kind === "Event" ? (
              <CalendarDays
                className="h-5 w-5 text-sky-200/70"
                aria-hidden="true"
              />
            ) : item.kind === "Place" ? (
              <MapPin
                className="h-5 w-5 text-emerald-200/70"
                aria-hidden="true"
              />
            ) : (
              <Utensils
                className="h-5 w-5 text-orange-200/70"
                aria-hidden="true"
              />
            )}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`text-[11px] font-black uppercase tracking-wide ${kindColor}`}
        >
          {badge}
        </p>
        <p className="truncate text-xl font-semibold leading-tight">
          {item.title}
        </p>
        <p className="truncate text-sm text-white/70">{item.subtitle}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {item.meta ? (
            <span className="text-xs font-semibold text-white/64">
              {item.meta}
            </span>
          ) : null}
          {badges.map((label) => (
            <span
              key={`${item.id}-${label}`}
              className={getFreshnessBadgeClass(freshnessMeta, label)}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
      <span className="rounded-full bg-[#fff4e1]/10 px-3 py-1 text-xs font-black text-orange-100 ring-1 ring-orange-200/25">
        View
      </span>
    </Link>
  );
}

function ActiveSceneEmptyState({ laneId }: { laneId: ScoutSceneLaneId }) {
  const isForYou = laneId === "for_you";
  const title = isForYou
    ? "The local board is quiet right now."
    : laneId === "community"
      ? "No local favorites nearby yet."
      : laneId === "deals"
        ? "No active deals nearby right now."
        : laneId === "food_trucks"
          ? "No food trucks nearby right now."
          : laneId === "events"
            ? "No food events nearby right now."
            : "Nothing strong here yet.";
  const body = isForYou
    ? "Try Worth Discovering, New Menus, or widen your area."
    : laneId === "community"
      ? "Explore nearby and save spots to build your local favorites."
      : laneId === "deals"
        ? "Try Nearby or New Menus for fresh local options."
        : laneId === "food_trucks"
          ? "Try Restaurants, Events, or Worth Discovering."
          : laneId === "events"
            ? "Check Nearby or Worth Discovering."
            : "Try another scene or widen your area.";

  return (
    <section className="px-4 pb-4">
      <div className="rounded-2xl bg-white/[0.04] px-4 py-3 text-white ring-1 ring-white/10">
        <p className="text-sm font-black">{title}</p>
        <p className="mt-1 text-xs font-semibold leading-relaxed text-white/58">
          {body}
        </p>
        {isForYou ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/search"
              className="rounded-full bg-[#ff7945] px-3 py-1.5 text-[11px] font-black text-white ring-1 ring-white/20"
            >
              Widen Area
            </Link>
            <Link
              href="/search?q=worth%20discovering"
              className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[11px] font-black text-white/90 ring-1 ring-white/20"
            >
              Worth Discovering
            </Link>
            <Link
              href="/search?q=new%20menus"
              className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[11px] font-black text-white/90 ring-1 ring-white/20"
            >
              New Menus
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ExploreSceneTiles({
  activeSceneLaneId,
  onSceneLaneSelect,
}: {
  activeSceneLaneId: ScoutSceneLaneId;
  onSceneLaneSelect: (laneId: ScoutSceneLaneId) => void;
}) {
  const lowerTiles = SCOUT_SCENE_LANES.filter((lane) =>
    [
      "community",
      "food_trucks",
      "restaurants",
      "deals",
      "events",
      "new_menus",
      "late_night",
      "worth_discovering",
    ].includes(lane.id),
  );

  return (
    <section className="px-4 pb-10">
      <h3 className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-white/44">
        Explore the scene
      </h3>
      <div className="grid grid-cols-2 gap-2.5">
        {lowerTiles.map((lane) => {
          const active = lane.id === activeSceneLaneId;
          return (
            <button
              key={lane.id}
              type="button"
              onClick={() => onSceneLaneSelect(lane.id)}
              className={[
                "rounded-2xl px-3 py-2.5 text-left text-sm font-bold ring-1 transition-colors",
                active
                  ? "bg-[#ff7945] text-white ring-white/20"
                  : "bg-white/[0.04] text-white/78 ring-white/10 hover:bg-white/[0.08]",
              ].join(" ")}
            >
              {lane.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function FilterNearbyChips({
  selectedCraving,
  onCravingSelect,
}: {
  selectedCraving: CravingCategory;
  onCravingSelect: (id: string) => void;
}) {
  const filters = [
    { id: "open-now", label: "Open" },
    { id: "food-truck", label: "Trucks" },
    { id: "deals-today", label: "Deals" },
    { id: "today", label: "Today" },
  ];

  return (
    <section className="px-4 pb-7">
      <p className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-white/48">
        Filter nearby
      </p>
      <div className="overflow-x-auto atmo-hide-scrollbar">
        <div className="flex w-max gap-2 pr-1">
          {filters.map((filter) => {
            const isActive = selectedCraving.id === filter.id;
            return (
              <button
                key={filter.id}
                type="button"
                onClick={() => onCravingSelect(filter.id)}
                className={[
                  "min-h-8 shrink-0 rounded-full px-3 py-1.5 text-[11px] font-black ring-1 transition-colors active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/60",
                  isActive
                    ? "bg-[#ff7945] text-white ring-white/20"
                    : "bg-white/[0.04] text-white/58 ring-white/10 hover:bg-white/[0.08] hover:text-white/78",
                ].join(" ")}
                aria-pressed={isActive}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function QuietNearbyNotice() {
  return (
    <section className="px-4 pb-6">
      <div className="rounded-2xl bg-white/[0.04] px-4 py-3 text-white ring-1 ring-white/10">
        <p className="text-sm font-black">
          The local board is quiet right now.
        </p>
        <p className="mt-1 text-xs font-semibold leading-relaxed text-white/58">
          Try Worth Discovering, New Menus, or widen your area.
        </p>
      </div>
    </section>
  );
}

function CollapsedMapPinCard({
  marker,
  userLocation,
  onClose,
}: {
  marker: MapAdapterMarker;
  userLocation?: { lat: number; lng: number } | null;
  onClose: () => void;
}) {
  const destination =
    marker.kind === "truck"
      ? `/truck/${marker.sourceId}`
      : marker.kind === "restaurant"
        ? `/restaurant/${marker.sourceId}`
        : marker.kind === "deal"
          ? "/deals-featured"
          : marker.kind === "parking"
            ? `/events?hostId=${encodeURIComponent(String(marker.sourceId))}`
            : "/events";
  const status =
    marker.kind === "truck"
      ? "Food truck"
      : marker.kind === "restaurant"
        ? "Open place"
        : marker.kind === "deal"
          ? "Deal today"
          : marker.kind === "parking"
            ? "Event host"
            : "Event";
  const computedDistance =
    userLocation && Number.isFinite(marker.lat) && Number.isFinite(marker.lng)
      ? formatMiles(
          getDistanceMiles(userLocation, { lat: marker.lat, lng: marker.lng }),
        )
      : null;
  const originParam = userLocation
    ? `&origin=${userLocation.lat},${userLocation.lng}`
    : "";
  const directionsUrl = `https://www.google.com/maps/dir/?api=1${originParam}&destination=${marker.lat},${marker.lng}&travelmode=driving`;

  return (
    <div
      className="absolute left-3 right-3 bottom-16 z-20 rounded-2xl bg-[#0f1017]/88 px-3 py-3 text-white ring-1 ring-white/10 backdrop-blur-xl"
      style={{ boxShadow: "0 16px 36px rgba(0,0,0,0.48)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-orange-200/80">
            {status}
          </p>
          <p className="truncate text-base font-black">
            {marker.title || "Nearby place"}
          </p>
          <p className="truncate text-xs text-white/70">
            {computedDistance ? `${computedDistance} away` : "Nearby"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={destination}
            className="rounded-xl bg-[#ff7945] px-3 py-1.5 text-xs font-black text-white ring-1 ring-white/20"
          >
            View
          </Link>
          <a
            href={directionsUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-black text-white ring-1 ring-white/10"
          >
            Route
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss"
            className="rounded-xl px-2 py-1.5 text-xs font-bold text-white/50"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

function LocalActivityRail({
  mode,
  items,
}: {
  mode: ScoutActivityMode;
  items: LocalActivityItem[];
}) {
  if (items.length === 0) return null;
  const isCompact = mode === "high_activity";

  return (
    <section
      className={isCompact ? "pl-4 pr-0 pt-0 pb-5" : "pl-5 pr-0 pt-1 pb-6"}
    >
      <SectionHeader
        title={getActivityRailTitle(mode)}
        linkHref="/search"
        subtitle={getActivityRailSubtitle(mode)}
        itemCount={items.length}
      />
      <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
        <ul
          className={`flex ${isCompact ? "gap-2.5" : "gap-3"} pr-5`}
          role="list"
          aria-label="Happening nearby"
        >
          {items.map((item) => (
            <li
              key={item.id}
              className={`shrink-0 ${isCompact ? "w-[168px] sm:w-[194px]" : "w-[190px] sm:w-[220px]"}`}
            >
              <LocalActivityCard item={item} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function QuickUpdateBar() {
  // Future flow hooks: one-tap open now, one-tap location confirm,
  // quick deal posting, and quick menu updates can attach behind these links.
  const actions = [
    {
      label: "Update status",
      href: "/restaurant-owner-dashboard?src=scout&setup=status",
      icon: <Flame className="h-3.5 w-3.5" aria-hidden="true" />,
    },
    {
      label: "Confirm location",
      href: "/restaurant-owner-dashboard?src=scout&setup=location",
      icon: <Navigation2 className="h-3.5 w-3.5" aria-hidden="true" />,
    },
    {
      label: "Update menu",
      href: "/menu-builder?src=scout",
      icon: <Utensils className="h-3.5 w-3.5" aria-hidden="true" />,
    },
    {
      label: "Post deal",
      href: "/deal-creation?src=scout",
      icon: <Tag className="h-3.5 w-3.5" aria-hidden="true" />,
    },
  ];

  return (
    <section className="px-4 pb-4 -mt-1" aria-label="Quick updates">
      <div className="rounded-2xl bg-[#120805]/42 px-3 py-2.5 ring-1 ring-orange-200/10">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-orange-100/72">
            Quick updates
          </p>
          <p className="text-[10px] font-bold text-white/42">For your places</p>
        </div>
        <div className="overflow-x-auto atmo-hide-scrollbar">
          <div className="flex w-max gap-2 pr-1">
            {actions.map((action) => (
              <Link
                key={action.label}
                href={action.href}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-[#fff4e1]/10 px-2.5 py-1.5 text-[10px] font-black text-orange-50 ring-1 ring-orange-200/25 transition-colors hover:bg-[#fff4e1]/14 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
              >
                {action.icon}
                <span>{action.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function OwnerOperationalActions({
  actions,
}: {
  actions: Array<{ label: string; href: string; icon: React.ReactNode }>;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="mt-2 overflow-x-auto atmo-hide-scrollbar">
      <div className="flex w-max gap-1.5 pr-1">
        {actions.map((action) => (
          <Link
            key={`${action.label}-${action.href}`}
            href={action.href}
            className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-full bg-orange-300/14 px-2 py-1 text-[10px] font-black text-orange-100 ring-1 ring-orange-200/25 transition-colors hover:bg-orange-300/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
          >
            {action.icon}
            <span>{action.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function LocalActivityCard({ item }: { item: LocalActivityItem }) {
  const icon =
    item.type === "menu_update" ? (
      <Utensils className="h-3.5 w-3.5" aria-hidden="true" />
    ) : item.type === "deal" ? (
      <Tag className="h-3.5 w-3.5" aria-hidden="true" />
    ) : item.type === "truck" ? (
      <Flame className="h-3.5 w-3.5" aria-hidden="true" />
    ) : item.type === "event" ? (
      <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
    ) : (
      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
    );
  const badges = [
    item.timeLabel,
    item.sourceLabel,
    ...getOperationalBadges(item.freshnessMeta),
  ]
    .filter((label): label is string => Boolean(label))
    .filter((label, index, all) => all.indexOf(label) === index)
    .slice(0, 2);

  return (
    <Link
      href={item.href}
      className="block rounded-2xl bg-[#120805]/56 p-3 text-white ring-1 ring-white/10 transition-colors hover:bg-[#1a0d08]/78 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-300/14 text-orange-200 ring-1 ring-orange-200/20">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-black leading-tight text-white">
            {item.title}
          </p>
          <p className="mt-1 line-clamp-2 text-[11px] font-semibold leading-snug text-orange-100/64">
            {item.subtitle}
          </p>
        </div>
      </div>
      {badges.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {badges.map((badge) => (
            <span
              key={badge}
              className={getFreshnessBadgeClass(item.freshnessMeta, badge)}
            >
              {badge}
            </span>
          ))}
        </div>
      ) : null}
    </Link>
  );
}

/* ============================================================
   HERO MAP FALLBACK
   ============================================================ */

function HeroMapFallback({
  reason,
}: {
  reason: "no-key" | "denied" | "loading";
}) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        background:
          "linear-gradient(140deg, #070a10 0%, #0e1320 40%, #070a10 100%)",
        animation: "heroAtmosphere 8s ease-in-out infinite",
      }}
    >
      {/* CSS animation keyframes injected inline */}
      <style>{`
        @keyframes heroAtmosphere {
          0%   { background: radial-gradient(ellipse at 20% 60%, rgba(255,90,47,0.18) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 75% 30%, rgba(180,83,9,0.12) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
          25%  { background: radial-gradient(ellipse at 55% 70%, rgba(255,90,47,0.14) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 20% 25%, rgba(180,83,9,0.16) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
          50%  { background: radial-gradient(ellipse at 70% 50%, rgba(255,90,47,0.20) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 30% 70%, rgba(180,83,9,0.10) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
          75%  { background: radial-gradient(ellipse at 35% 35%, rgba(255,90,47,0.15) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 65% 65%, rgba(180,83,9,0.18) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
          100% { background: radial-gradient(ellipse at 20% 60%, rgba(255,90,47,0.18) 0%, rgba(8,10,15,0) 55%), radial-gradient(ellipse at 75% 30%, rgba(180,83,9,0.12) 0%, rgba(8,10,15,0) 50%), linear-gradient(160deg, #080a0f 0%, #0f1117 50%, #080a0f 100%); }
        }
        @keyframes heroAtmosphereGrain {
          0%   { opacity: 0.04; transform: translate(0,0); }
          20%  { opacity: 0.06; transform: translate(-1px, 1px); }
          40%  { opacity: 0.03; transform: translate(1px, -1px); }
          60%  { opacity: 0.05; transform: translate(-1px, -1px); }
          80%  { opacity: 0.04; transform: translate(1px, 1px); }
          100% { opacity: 0.04; transform: translate(0,0); }
        }
      `}</style>
      {/* Subtle noise grain overlay */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "42px 42px, 42px 42px",
          opacity: 0.35,
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: "180px 180px",
          mixBlendMode: "overlay",
          animation: "heroAtmosphereGrain 3s steps(1) infinite",
          pointerEvents: "none",
        }}
      />
      <span className="sr-only">
        {reason === "no-key"
          ? "Map preview unavailable."
          : reason === "denied"
            ? "Turn on location for the map."
            : "Loading map."}
      </span>
    </div>
  );
}

/* ============================================================
   CARDS
   ============================================================ */

function LiveNowEmptyCard({
  title,
  body,
  onCta,
}: {
  title: string;
  body: string;
  onCta: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onCta}
      className="block w-full text-left rounded-2xl overflow-hidden bg-white/5 backdrop-blur-md ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}
      aria-label={title}
    >
      <div className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <span
            className="h-9 w-9 rounded-full bg-orange-500/15 ring-1 ring-orange-300/40 flex items-center justify-center shrink-0 mt-0.5"
            aria-hidden="true"
          >
            <MapPin className="h-4 w-4 text-orange-300" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white text-sm leading-snug">
              {title}
            </p>
            <p className="mt-1 text-xs text-white/60 leading-relaxed">{body}</p>
          </div>
        </div>
      </div>
    </button>
  );
}

function LiveTruckSkeletonCard() {
  return (
    <div
      aria-hidden="true"
      className="rounded-3xl overflow-hidden bg-white/5 ring-1 ring-white/10"
    >
      <div className="aspect-[4/5] w-full animate-pulse bg-white/5" />
    </div>
  );
}

function LiveTruckCard({
  truck,
  currentUserId,
  relationshipSnapshot,
}: {
  truck: LiveTruckSummary;
  currentUserId?: string | null;
  relationshipSnapshot: RestaurantRelationshipSnapshot;
}) {
  const truckId = String(truck.id);
  const [isFavorite, setIsFavorite] = useState(false);
  const [pendingFavorite, setPendingFavorite] = useState(false);

  useEffect(() => {
    setIsFavorite(relationshipSnapshot.favoriteIds.has(truckId));
  }, [relationshipSnapshot, truckId]);

  const toggleFavorite = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!currentUserId) {
      window.location.href = `/login?redirect=${encodeURIComponent("/scout")}`;
      return;
    }
    const nextState = !isFavorite;
    setIsFavorite(nextState);
    setPendingFavorite(true);
    try {
      const response = await fetch(
        `/api/restaurants/${encodeURIComponent(truckId)}/favorite`,
        {
          method: nextState ? "POST" : "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: nextState ? "{}" : undefined,
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          String(data?.message || "").trim() || "Favorite action failed",
        );
      }
    } catch (error) {
      setIsFavorite(!nextState);
      if (nextState) {
        toast({
          variant: "destructive",
          description:
            error instanceof Error
              ? error.message
              : "Couldn't save this truck.",
        });
      }
    } finally {
      setPendingFavorite(false);
    }
  };

  const distance = formatDistance(truck);
  const wait = formatWait(truck);
  const vibe = getCrowdVibe(truck);
  const heroImage = truck.heroImageUrl || truck.imageUrl || truck.logoUrl;
  const truckTone = getTruckCardTone(truck);
  const freshnessMeta: FreshnessMeta = {
    kind: "truck",
    updatedAt: readStringField(truck, ["updatedAt", "lastUpdatedAt"]),
    confirmedAt: readStringField(truck, ["confirmedAt", "lastConfirmedAt"]),
    hasDeal: Boolean(truck.activeDealCount && truck.activeDealCount > 0),
    hasDistance: Boolean(distance),
    isOpen: true,
  };
  const badges = getOperationalBadges(freshnessMeta).slice(0, 3);
  const canEdit = isOwnedByCurrentUser(truck, currentUserId);
  const actions = canEdit
    ? [
        {
          label: "Update status",
          href: getTruckUpdateHref(String(truck.id), "status"),
          icon: <Flame className="h-3 w-3" aria-hidden="true" />,
        },
        {
          label: "Confirm location",
          href: getTruckUpdateHref(String(truck.id), "location"),
          icon: <Navigation2 className="h-3 w-3" aria-hidden="true" />,
        },
      ]
    : [];

  return (
    <Link
      href={getTruckProfilePath(truck)}
      className="group relative block overflow-hidden rounded-[1.7rem] bg-[#100806]/90 ring-1 ring-orange-300/40 transition duration-200 hover:-translate-y-0.5 hover:ring-emerald-200/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70"
      aria-label={`Open ${truck.name}`}
      style={{
        boxShadow:
          "0 18px 54px rgba(0,0,0,0.56), inset 0 0 0 1px rgba(251,146,60,0.08)",
      }}
    >
      <span
        className="absolute inset-y-0 left-0 z-20 w-2 bg-[repeating-linear-gradient(180deg,rgba(251,146,60,0.95)_0_10px,rgba(88,39,12,0.95)_10px_18px)]"
        aria-hidden="true"
      />
      <span
        className="absolute left-5 top-5 bottom-5 z-20 w-px bg-orange-200/20"
        aria-hidden="true"
      />
      <span
        className="absolute left-[1.05rem] top-5 z-20 h-2 w-2 rounded-full bg-orange-300 shadow-[0_0_12px_rgba(251,146,60,0.8)]"
        aria-hidden="true"
      />
      <span
        className="absolute left-[1.05rem] bottom-5 z-20 h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.75)]"
        aria-hidden="true"
      />
      <div className="relative aspect-[16/11] w-full bg-[#120805]/60 pl-2">
        <ScoutCardMedia
          imageUrl={heroImage || null}
          fallbackIcon={
            <TruckIcon className="h-5 w-5 text-white/80" aria-hidden="true" />
          }
          fallbackTestId="scout-live-truck-card-image-fallback"
          imageClassName="absolute inset-0 h-full w-full object-cover"
          categoryPhoto={getDishCategoryPhoto(
            truck.name,
            truck.cuisineType,
            truck.vibe,
          )}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0) 38%, rgba(0,0,0,0.92) 100%)",
          }}
          aria-hidden="true"
        />

        <span
          className={`absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide shadow-md ring-1 ${getTruckToneClass(truckTone.tone)}`}
        >
          <TruckIcon className="h-3 w-3" aria-hidden="true" />
          <span
            className={`h-1.5 w-1.5 rounded-full ${getTruckToneDotClass(truckTone.tone)}`}
            aria-hidden="true"
          />
          {truckTone.label}
        </span>
        <span className="absolute bottom-3 left-3 inline-flex items-center rounded-full bg-black/62 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/86 ring-1 ring-white/10">
          Food truck
        </span>

        <button
          type="button"
          aria-label={isFavorite ? "Saved" : "Save"}
          aria-pressed={isFavorite}
          onClick={toggleFavorite}
          disabled={pendingFavorite}
          className={`absolute top-2.5 right-2.5 h-9 w-9 rounded-full flex items-center justify-center backdrop-blur-sm transition-colors ${
            isFavorite
              ? "bg-orange-400/90 hover:bg-orange-400"
              : "bg-[#120805]/30 hover:bg-[#120805]/50"
          }`}
        >
          <Heart
            className={`h-5 w-5 ${isFavorite ? "text-[#1a0d08] fill-current" : "text-white"}`}
            aria-hidden="true"
          />
        </button>
      </div>
      <div className="relative border-t border-orange-200/12 bg-[#190b06]/94 px-4 py-3 pl-7">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-orange-300/14 text-orange-200 ring-1 ring-orange-200/25">
            <TruckIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-black leading-tight text-white">
              {truck.name}
            </p>
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-orange-200/86">
              <Navigation2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {[wait, distance].filter(Boolean).join(" / ") ||
                  "Live location active"}
              </span>
            </p>
          </div>
        </div>
        <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-white/72">
          <Flame className="h-4 w-4 text-orange-300" aria-hidden="true" />
          <span>{vibe.label}</span>
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {badges.map((badge) => (
            <span
              key={badge}
              className={getFreshnessBadgeClass(freshnessMeta, badge)}
            >
              {badge}
            </span>
          ))}
        </div>
        <OwnerOperationalActions actions={actions} />
      </div>
    </Link>
  );
}

function DealCard({
  deal,
  currentUserId,
}: {
  deal: DealSummary;
  currentUserId?: string | null;
}) {
  const freshnessMeta: FreshnessMeta = {
    kind: "deal",
    updatedAt: readStringField(deal, ["updatedAt", "lastUpdatedAt"]),
    confirmedAt: readStringField(deal, ["confirmedAt", "lastConfirmedAt"]),
    hasDeal: true,
  };
  const badges = getOperationalBadges(freshnessMeta).slice(0, 2);
  const canEdit = isOwnedByCurrentUser(deal, currentUserId);
  const actions = canEdit
    ? [
        {
          label: "Update status",
          href: `/deal-edit/${encodeURIComponent(String(deal.id))}`,
          icon: <Flame className="h-3 w-3" aria-hidden="true" />,
        },
      ]
    : [];

  return (
    <Link
      href={`/deal/${deal.id}`}
      className="block overflow-hidden rounded-[1.05rem] bg-[#12200f]/82 ring-1 ring-lime-200/20 transition duration-200 hover:-translate-y-0.5 hover:ring-lime-200/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/70"
      style={{ boxShadow: "0 14px 36px rgba(0,0,0,0.5)" }}
      aria-label={`Open deal ${deal.title || ""}`}
    >
      <div className="relative aspect-[4/5] w-full bg-[#120805]/60">
        <ScoutCardMedia
          imageUrl={deal.imageUrl || null}
          fallbackIcon={
            <Tag className="h-5 w-5 text-white/80" aria-hidden="true" />
          }
          fallbackTestId="scout-deal-card-image-fallback"
          imageClassName="absolute inset-0 h-full w-full object-cover"
          fallbackClassName="bg-[linear-gradient(150deg,#a3e635_0%,#65a30d_45%,#3f6212_100%)]"
          categoryPhoto={getDishCategoryPhoto(
            deal.title,
            (deal as any).description,
          )}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0) 38%, rgba(0,0,0,0.92) 100%)",
          }}
          aria-hidden="true"
        />
        <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-lime-300 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#102006] shadow-md">
          <Tag className="h-3 w-3" aria-hidden="true" />
          {deal.discountText || "Deal"}
        </span>
        <div className="absolute bottom-3 left-3 right-3">
          <p className="text-white font-bold text-lg leading-tight line-clamp-2">
            {deal.title || "Featured Deal"}
          </p>
          {deal.restaurantName && (
            <p className="mt-1 text-white/75 text-xs truncate">
              {deal.restaurantName}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {badges.map((badge) => (
              <span
                key={badge}
                className={getFreshnessBadgeClass(freshnessMeta, badge)}
              >
                {badge}
              </span>
            ))}
          </div>
          <OwnerOperationalActions actions={actions} />
        </div>
      </div>
    </Link>
  );
}

function trackLocalMenuItemEngagement(payload: {
  eventName: "menu_item_impression" | "menu_item_click";
  itemId: string;
  restaurantId?: string | null;
  layerId?: string;
  surface?: string;
  position?: number;
  discoveryScore?: number | null;
  discoveryReasons?: string[] | null;
}) {
  void fetch("/api/menus/local-items/engagement", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    body: JSON.stringify(payload),
  }).catch(() => {});
}

function LocalMenuItemCard({
  item,
  position,
  currentUserId,
}: {
  item: LocalMenuItemFeedItem;
  position: number;
  currentUserId?: string | null;
}) {
  const price =
    typeof item.priceCents === "number" && Number.isFinite(item.priceCents)
      ? `$${(item.priceCents / 100).toFixed(item.priceCents % 100 === 0 ? 0 : 2)}`
      : null;
  const distLabel =
    typeof item.distanceMiles === "number" &&
    Number.isFinite(item.distanceMiles)
      ? `${item.distanceMiles.toFixed(item.distanceMiles < 10 ? 1 : 0)} mi`
      : null;
  const tags = Array.isArray(item.dietaryTags)
    ? item.dietaryTags.filter(Boolean).slice(0, 2)
    : [];
  const freshnessMeta: FreshnessMeta = {
    kind: "menu",
    updatedAt: readStringField(item, ["updatedAt", "lastUpdatedAt"]),
    confirmedAt: readStringField(item, ["confirmedAt", "lastConfirmedAt"]),
    hasMenu: true,
    hasDistance: Boolean(distLabel),
  };
  const badges = getOperationalBadges(freshnessMeta).slice(0, 3);
  const canEdit = isOwnedByCurrentUser(item, currentUserId);
  const actions = canEdit
    ? [
        {
          label: "Update menu",
          href: getRestaurantUpdateHref(String(item.restaurantId), "menu"),
          icon: <Utensils className="h-3 w-3" aria-hidden="true" />,
        },
      ]
    : [];

  const [isRecommendDialogOpen, setIsRecommendDialogOpen] = useState(false);
  const [recommendComment, setRecommendComment] = useState("");
  const [recommendRating, setRecommendRating] = useState("5");
  const [recommendPhoto, setRecommendPhoto] = useState<File | null>(null);
  const [isSubmittingEnrich, setIsSubmittingEnrich] = useState(false);
  const [isRemovingRecommend, setIsRemovingRecommend] = useState(false);
  const [isTogglingRecommend, setIsTogglingRecommend] = useState(false);
  const [hasRecommended, setHasRecommended] = useState(false);

  const { data: myRecommendationData } = useQuery({
    queryKey: ["/api/menu-items", item.id, "my-recommendation", currentUserId],
    queryFn: async () => {
      // Deliberately same-origin (not apiUrl's cross-origin API host): this
      // check depends on the session cookie, which mobile/Safari privacy
      // rules strip from cross-site requests. www.mealscout.us proxies
      // /api/* to the backend, so a relative path keeps the cookie first-party.
      const res = await fetch(
        `/api/menu-items/${encodeURIComponent(item.id)}/my-recommendation`,
        { credentials: "include" },
      );
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(currentUserId),
    staleTime: 60_000,
  });

  useEffect(() => {
    setHasRecommended(Boolean((myRecommendationData as any)?.recommendation));
  }, [myRecommendationData]);

  const postMenuItemRecommendation = async (opts: {
    comment?: string;
    rating?: string;
    photo?: File | null;
  }) => {
    const formData = new FormData();
    formData.append("comment", opts.comment ?? "");
    formData.append("rating", opts.rating ?? "5");
    if (opts.photo) formData.append("image", opts.photo);
    // Same-origin for the same reason as the my-recommendation check above.
    return fetch(`/api/menu-items/${encodeURIComponent(item.id)}/recommend`, {
      method: "POST",
      credentials: "include",
      body: formData,
    });
  };

  const handleRecommendClick = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!currentUserId) {
      window.location.href = `/login?redirect=${encodeURIComponent("/scout")}`;
      return;
    }
    if (hasRecommended) {
      // Already recommended - reopen the popup so they can edit or remove it.
      setIsRecommendDialogOpen(true);
      return;
    }
    setIsTogglingRecommend(true);
    try {
      const res = await postMenuItemRecommendation({});
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          description:
            String(data?.message || "").trim() ||
            "Couldn't recommend this dish.",
        });
        return;
      }
      setHasRecommended(true);
      setIsRecommendDialogOpen(true);
    } finally {
      setIsTogglingRecommend(false);
    }
  };

  const submitEnrichedRecommendation = async () => {
    setIsSubmittingEnrich(true);
    try {
      const res = await postMenuItemRecommendation({
        comment: recommendComment,
        rating: recommendRating,
        photo: recommendPhoto,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          description:
            String(data?.message || "").trim() ||
            "Couldn't save your recommendation.",
        });
        return;
      }
      toast({
        description:
          data?.photoStatus?.status === "pending"
            ? "Recommendation saved. Photo is pending approval."
            : "Recommendation saved.",
      });
      setRecommendComment("");
      setRecommendPhoto(null);
      setIsRecommendDialogOpen(false);
    } finally {
      setIsSubmittingEnrich(false);
    }
  };

  const removeRecommendation = async () => {
    setIsRemovingRecommend(true);
    try {
      const res = await fetch(
        `/api/menu-items/${encodeURIComponent(item.id)}/recommend`,
        { method: "DELETE", credentials: "include" },
      );
      if (res.ok) {
        setHasRecommended(false);
        setIsRecommendDialogOpen(false);
        setRecommendComment("");
        setRecommendPhoto(null);
      }
    } finally {
      setIsRemovingRecommend(false);
    }
  };

  useEffect(() => {
    trackLocalMenuItemEngagement({
      eventName: "menu_item_impression",
      itemId: item.id,
      restaurantId: item.restaurantId,
      layerId: "menuItems",
      surface: "scout",
      position,
      discoveryScore: item.discoveryScore,
      discoveryReasons: item.discoveryReasons,
    });
  }, [
    item.id,
    item.restaurantId,
    item.discoveryScore,
    item.discoveryReasons,
    position,
  ]);

  return (
    <Link
      href={getMenuItemProfilePath(item)}
      onClick={() =>
        trackLocalMenuItemEngagement({
          eventName: "menu_item_click",
          itemId: item.id,
          restaurantId: item.restaurantId,
          layerId: "menuItems",
          surface: "scout",
          position,
          discoveryScore: item.discoveryScore,
          discoveryReasons: item.discoveryReasons,
        })
      }
      className="block overflow-hidden rounded-[0.85rem] bg-[#2c1609]/92 p-2 ring-1 ring-orange-200/30 transition duration-200 hover:-translate-y-0.5 hover:ring-orange-200/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      style={{ boxShadow: "0 14px 34px rgba(0,0,0,0.48)" }}
      aria-label={`Open ${item.name} from ${item.restaurantName || "local menu"}`}
      data-testid="scout-local-menu-item-card"
    >
      <div className="relative rounded-[0.7rem] bg-[#180b05]/76 p-3 ring-1 ring-orange-200/10">
        <div className="relative mx-auto aspect-square w-[82%] rounded-full bg-orange-200/10 p-2 ring-1 ring-orange-100/20">
          <div className="relative h-full w-full overflow-hidden rounded-full bg-[#120805]/60 ring-1 ring-black/30">
            <ScoutCardMedia
              imageUrl={
                item.imageUrl ||
                item.restaurantLogoUrl ||
                item.restaurantCoverImageUrl ||
                null
              }
              fallbackIcon={
                <Utensils
                  className="h-5 w-5 text-white/80"
                  aria-hidden="true"
                />
              }
              fallbackTestId="scout-local-menu-item-card-image-fallback"
              imageClassName="absolute inset-0 h-full w-full object-cover"
              fallbackClassName="bg-[linear-gradient(150deg,#fb923c_0%,#ea580c_45%,#9a3412_100%)]"
              categoryPhoto={getDishCategoryPhoto(item.name, item.description)}
            />
          </div>
        </div>
        {price && (
          <span className="absolute right-2.5 top-2.5 rounded-md bg-[#120805]/86 px-2 py-1 text-[11px] font-black text-orange-100 ring-1 ring-orange-300/30">
            {price}
          </span>
        )}
      </div>
      <div className="border-t border-dashed border-orange-100/20 px-2.5 pb-1 pt-3">
        <p className="line-clamp-2 text-sm font-bold leading-snug text-white">
          {item.name}
        </p>
        <p className="mt-1 truncate text-xs font-semibold text-orange-200/85">
          {item.restaurantName || "Local spot"}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-white/55">
          {item.cuisineType && <span>{item.cuisineType}</span>}
          {item.restaurantCity && <span>{item.restaurantCity}</span>}
          {distLabel && <span>{distLabel}</span>}
        </div>
        {item.description && (
          <p className="mt-2 line-clamp-2 text-xs leading-snug text-white/58">
            {item.description}
          </p>
        )}
        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-white/8 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-white/65"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          {badges.map((badge) => (
            <span
              key={badge}
              className={getFreshnessBadgeClass(freshnessMeta, badge)}
            >
              {badge}
            </span>
          ))}
        </div>
        <OwnerOperationalActions actions={actions} />
        <div className="mt-2 border-t border-white/8 pt-2">
          <button
            type="button"
            onClick={handleRecommendClick}
            disabled={isTogglingRecommend}
            className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide disabled:opacity-60 ${
              hasRecommended
                ? "text-emerald-300"
                : "text-orange-300 hover:text-orange-200"
            }`}
          >
            <Star
              className={`h-3 w-3 ${hasRecommended ? "fill-current" : ""}`}
              aria-hidden="true"
            />
            {hasRecommended ? "Recommended" : "Recommend"}
          </button>
        </div>
      </div>
      <Dialog
        open={isRecommendDialogOpen}
        onOpenChange={setIsRecommendDialogOpen}
      >
        <DialogContent
          className="max-w-sm"
          onClick={(event) => event.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{item.name}</DialogTitle>
            <DialogDescription>
              Tell us why you recommend it, or just close this - your
              recommendation is already saved.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={recommendComment}
            onChange={(event) => setRecommendComment(event.target.value)}
            placeholder="What makes this dish worth it? (optional)"
            className="min-h-[72px] w-full rounded border border-[color:var(--border-subtle)] bg-black/20 px-2 py-1.5 text-sm"
          />
          <div className="flex items-center gap-2">
            <label
              className="text-xs text-[color:var(--text-muted)]"
              htmlFor={`rating-${item.id}`}
            >
              Rating
            </label>
            <select
              id={`rating-${item.id}`}
              value={recommendRating}
              onChange={(event) => setRecommendRating(event.target.value)}
              className="rounded border border-[color:var(--border-subtle)] bg-black/20 px-1.5 py-1 text-sm"
            >
              <option value="5">5</option>
              <option value="4">4</option>
              <option value="3">3</option>
              <option value="2">2</option>
              <option value="1">1</option>
            </select>
            <input
              type="file"
              accept="image/*"
              onChange={(event) =>
                setRecommendPhoto(event.target.files?.[0] || null)
              }
              className="flex-1 text-xs"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={removeRecommendation}
              disabled={isRemovingRecommend}
              className="text-xs text-[color:var(--text-muted)] underline hover:text-[color:var(--text-primary)] disabled:opacity-60"
            >
              Remove recommendation
            </button>
            <button
              type="button"
              onClick={submitEnrichedRecommendation}
              disabled={isSubmittingEnrich}
              className="rounded-full bg-orange-400 px-3 py-1.5 text-xs font-black text-[#1a0d08] disabled:opacity-60"
            >
              {isSubmittingEnrich ? "Saving…" : "Save"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </Link>
  );
}

function EventCard({
  event,
  currentUserId,
}: {
  event: EventSummary;
  currentUserId?: string | null;
}) {
  const title = event.title || event.name || "Event";
  const venue = event.venueName || event.locationName || "";
  const start = event.startsAt || event.startTime;
  const startLabel = start
    ? new Date(start).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const img = event.heroImageUrl || event.imageUrl;
  const freshnessMeta: FreshnessMeta = {
    kind: "event",
    startsAt: event.startsAt,
    startTime: event.startTime,
    updatedAt: readStringField(event, ["updatedAt", "lastUpdatedAt"]),
    confirmedAt: readStringField(event, ["confirmedAt", "lastConfirmedAt"]),
  };
  const badges = getOperationalBadges(freshnessMeta).slice(0, 2);
  const canEdit = isOwnedByCurrentUser(event, currentUserId);
  const actions = canEdit
    ? [
        {
          label: "Update status",
          href: `/host-dashboard?src=scout&eventId=${encodeURIComponent(String(event.id))}`,
          icon: <Flame className="h-3 w-3" aria-hidden="true" />,
        },
      ]
    : [];
  return (
    <Link
      href={`/event/${event.id}`}
      className="block overflow-hidden rounded-[1.2rem] bg-[#0d1724]/82 ring-1 ring-sky-200/20 transition duration-200 hover:-translate-y-0.5 hover:ring-sky-200/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70"
      style={{ boxShadow: "0 16px 42px rgba(0,0,0,0.5)" }}
      aria-label={`Open event ${title}`}
    >
      <div className="relative aspect-[4/5] w-full bg-[#120805]/60">
        <ScoutCardMedia
          imageUrl={img || null}
          fallbackIcon={
            <CalendarDays
              className="h-5 w-5 text-white/80"
              aria-hidden="true"
            />
          }
          fallbackTestId="scout-event-card-image-fallback"
          imageClassName="absolute inset-0 h-full w-full object-cover"
          fallbackClassName="bg-[linear-gradient(150deg,#38bdf8_0%,#2563eb_48%,#1e1b4b_100%)]"
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0) 38%, rgba(0,0,0,0.92) 100%)",
          }}
          aria-hidden="true"
        />
        <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-sky-300 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#071322] shadow-md">
          <CalendarDays className="h-3 w-3" aria-hidden="true" />
          Event
        </span>
        <div className="absolute bottom-3 left-3 right-3">
          <p className="text-white font-bold text-lg leading-tight line-clamp-2">
            {title}
          </p>
          {venue && (
            <p className="mt-1 text-white/80 text-xs truncate">{venue}</p>
          )}
          {startLabel && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-sky-200 text-xs font-semibold">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              {startLabel}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {badges.map((badge) => (
              <span
                key={badge}
                className={getFreshnessBadgeClass(freshnessMeta, badge)}
              >
                {badge}
              </span>
            ))}
          </div>
          <OwnerOperationalActions actions={actions} />
        </div>
      </div>
    </Link>
  );
}

function DiscoveryEmptyRow({
  icon,
  title,
  body,
  ctaLabel,
  onCta,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  ctaLabel: string;
  onCta: () => void;
}) {
  return (
    <div className="mr-5 rounded-3xl bg-white/5 ring-1 ring-white/10 backdrop-blur-md p-5">
      <div className="flex items-start gap-4">
        <span
          className="h-10 w-10 rounded-full bg-orange-500/15 ring-1 ring-orange-300/40 flex items-center justify-center shrink-0"
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold">{title}</p>
          <p className="text-white/70 text-sm mt-1">{body}</p>
          <button
            type="button"
            onClick={onCta}
            className="mt-3 inline-flex items-center gap-1.5 text-orange-200 text-sm font-semibold"
          >
            {ctaLabel} <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function NearbyRestaurantCard({
  restaurant,
  menuPreview = [],
  isSignedIn,
  currentUserId,
  relationshipSnapshot,
}: {
  restaurant: RestaurantSummary;
  menuPreview?: MenuPreviewItem[];
  isSignedIn: boolean;
  currentUserId?: string | null;
  relationshipSnapshot: RestaurantRelationshipSnapshot;
}) {
  const normalizedKind = getScoutRestaurantLikeKind(restaurant);
  const isFoodTruckEntity = normalizedKind === "food_truck";
  const isBarEntity =
    String(
      restaurant.entityType ||
        restaurant.profileType ||
        restaurant.businessType ||
        "",
    )
      .trim()
      .toLowerCase() === "bar";
  const canonicalLabel = isFoodTruckEntity
    ? "Food truck"
    : isBarEntity
      ? "Bar"
      : normalizedKind === "restaurant"
        ? "Restaurant"
        : "Local activity";
  const profileHref = getRestaurantProfilePath(restaurant);
  const name = restaurant.businessName || restaurant.name || canonicalLabel;
  const img =
    restaurant.coverImageUrl ||
    restaurant.heroImageUrl ||
    restaurant.imageUrl ||
    restaurant.logoUrl;
  const cuisine = restaurant.cuisineType;
  const location = restaurant.neighborhood || restaurant.city;
  const dealCount =
    restaurant.activeDealsCount ?? restaurant.activeDealCount ?? 0;
  const favoriteCount = Number(restaurant.favoriteCount || 0);
  const followCount = Number(restaurant.followCount || 0);
  const recommendationCount = Number(restaurant.recommendationCount || 0);
  const videoRecommendationCount = Number(
    restaurant.videoRecommendationCount || 0,
  );
  const communityActivityCount = Number(restaurant.communityActivityCount || 0);
  const dist =
    restaurant.distanceMiles ??
    (restaurant.distance ? restaurant.distance * 0.621371 : null);
  const distLabel =
    typeof dist === "number" && Number.isFinite(dist)
      ? `${dist.toFixed(dist < 10 ? 1 : 0)} mi`
      : null;
  const restaurantId = String(restaurant.id);
  const canEdit = isOwnedByCurrentUser(restaurant, currentUserId);
  const ownerActions = canEdit
    ? [
        {
          label: "Update status",
          href: getRestaurantUpdateHref(restaurantId, "status"),
          icon: <Flame className="h-3 w-3" aria-hidden="true" />,
        },
        {
          label: "Update menu",
          href: getRestaurantUpdateHref(restaurantId, "menu"),
          icon: <Utensils className="h-3 w-3" aria-hidden="true" />,
        },
        {
          label: "Post deal",
          href: getRestaurantUpdateHref(restaurantId, "deal"),
          icon: <Tag className="h-3 w-3" aria-hidden="true" />,
        },
      ]
    : [];
  const [isFavorite, setIsFavorite] = useState(false);
  const [isFollowed, setIsFollowed] = useState(false);
  const [isRecommended, setIsRecommended] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  useEffect(() => {
    setIsFavorite(relationshipSnapshot.favoriteIds.has(restaurantId));
    setIsFollowed(relationshipSnapshot.followIds.has(restaurantId));
    setIsRecommended(relationshipSnapshot.recommendationIds.has(restaurantId));
  }, [relationshipSnapshot, restaurantId]);

  const formatPrice = (cents?: number | null) =>
    typeof cents === "number" && Number.isFinite(cents) && cents > 0
      ? `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
      : null;
  const communityUpdates = [
    videoRecommendationCount > 0
      ? `${videoRecommendationCount} video update${videoRecommendationCount === 1 ? "" : "s"}`
      : null,
    recommendationCount > 0
      ? `${recommendationCount} community update${recommendationCount === 1 ? "" : "s"}`
      : null,
    favoriteCount > 0
      ? `${favoriteCount} save${favoriteCount === 1 ? "" : "s"}`
      : null,
    followCount > 0
      ? `${followCount} follow${followCount === 1 ? "" : "s"}`
      : null,
    communityActivityCount > 0 ? "active buzz" : null,
  ].filter((update): update is string => Boolean(update));
  const statusLabels = [
    ...getOperationalBadges({
      kind: isFoodTruckEntity ? "truck" : "restaurant",
      updatedAt: readStringField(restaurant, ["updatedAt", "lastUpdatedAt"]),
      confirmedAt: readStringField(restaurant, [
        "confirmedAt",
        "lastConfirmedAt",
      ]),
      hasDeal: dealCount > 0,
      hasMenu: menuPreview.length > 0,
      hasCommunityUpdate: communityUpdates.length > 0,
      hasDistance: Boolean(distLabel),
      isOpen: isFoodTruckEntity
        ? isTruckServingNow(restaurant as unknown as LiveTruckSummary)
        : true,
    }),
  ];
  const cardShellClass = isFoodTruckEntity
    ? "group relative block overflow-hidden rounded-[1.65rem] bg-[#100806]/88 ring-1 ring-orange-300/30 transition duration-200 hover:-translate-y-0.5 hover:ring-orange-200/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
    : "group block overflow-hidden rounded-[1rem] bg-[#0c1714]/84 ring-1 ring-emerald-200/20 transition duration-200 hover:-translate-y-0.5 hover:ring-emerald-200/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70";
  const labelPillClass = isFoodTruckEntity
    ? "bg-[#120805]/72 text-orange-100 ring-orange-200/20"
    : "bg-[#071411]/72 text-emerald-100 ring-emerald-200/20";
  const statusDotClass = isFoodTruckEntity ? "bg-orange-400" : "bg-emerald-400";
  const statusTextClass = isFoodTruckEntity
    ? "text-orange-200/85"
    : "text-emerald-200/85";
  const placeIcon = isFoodTruckEntity ? (
    <TruckIcon className="h-5 w-5 text-white/80" aria-hidden="true" />
  ) : (
    <MapPin className="h-5 w-5 text-white/80" aria-hidden="true" />
  );

  const sendRestaurantAction = async (
    action: "favorite" | "follow" | "recommend",
    nextState: boolean,
  ) => {
    if (!isSignedIn) {
      window.location.href = `/login?redirect=${encodeURIComponent("/scout")}`;
      return;
    }

    const method = nextState ? "POST" : "DELETE";
    if (action === "recommend" && !nextState) return;
    setPendingAction(action);
    try {
      const response = await fetch(
        `/api/restaurants/${encodeURIComponent(restaurantId)}/${action}`,
        {
          method,
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: method === "POST" ? "{}" : undefined,
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          String(data?.message || "").trim() || "Restaurant action failed",
        );
      }
    } finally {
      setPendingAction(null);
    }
  };

  const toggleFavorite = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const nextState = !isFavorite;
    const wasFollowed = isFollowed;
    setIsFavorite(nextState);
    // Favoriting implies following; the server does this too, so mirror it
    // optimistically. Un-favoriting does not auto-unfollow.
    if (nextState) setIsFollowed(true);
    try {
      await sendRestaurantAction("favorite", nextState);
    } catch (error) {
      setIsFavorite(!nextState);
      if (nextState) setIsFollowed(wasFollowed);
      if (nextState) {
        toast({
          variant: "destructive",
          description:
            error instanceof Error
              ? error.message
              : "Couldn't save this restaurant.",
        });
      }
    }
  };

  const toggleFollow = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const nextState = !isFollowed;
    setIsFollowed(nextState);
    try {
      await sendRestaurantAction("follow", nextState);
    } catch {
      setIsFollowed(!nextState);
    }
  };

  const recommend = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (isRecommended) {
      setIsRecommendDialogOpen(true);
      return;
    }
    const wasFollowed = isFollowed;
    setIsRecommended(true);
    // Recommending implies following, same as favoriting above.
    setIsFollowed(true);
    try {
      // The tap itself is the shallow like/follow/recommend - it's already
      // saved by the time the popup opens. The popup just offers to add more
      // (or Share/Favorite); closing it without doing anything is fine.
      await sendRestaurantAction("recommend", true);
      setIsRecommendDialogOpen(true);
    } catch {
      setIsRecommended(false);
      setIsFollowed(wasFollowed);
    }
  };

  const [isRecommendDialogOpen, setIsRecommendDialogOpen] = useState(false);
  const [restaurantRecommendComment, setRestaurantRecommendComment] =
    useState("");
  const [restaurantRecommendRating, setRestaurantRecommendRating] =
    useState("5");
  const [isSubmittingRestaurantRecommend, setIsSubmittingRestaurantRecommend] =
    useState(false);

  const submitRestaurantRecommendationDetails = async () => {
    setIsSubmittingRestaurantRecommend(true);
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId,
          rating: Number(restaurantRecommendRating),
          comment: restaurantRecommendComment.trim() || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast({
          variant: "destructive",
          description:
            String(data?.message || "").trim() ||
            "Couldn't save your recommendation.",
        });
        return;
      }
      toast({ description: "Recommendation saved." });
      setRestaurantRecommendComment("");
      setIsRecommendDialogOpen(false);
    } catch {
      toast({
        variant: "destructive",
        description: "Couldn't save your recommendation.",
      });
    } finally {
      setIsSubmittingRestaurantRecommend(false);
    }
  };

  return (
    <Link
      href={profileHref}
      className={cardShellClass}
      aria-label={`Open ${name}`}
      style={{ boxShadow: "0 16px 42px rgba(0,0,0,0.48)" }}
      data-testid="scout-restaurant-card"
    >
      {isFoodTruckEntity ? (
        <>
          <span
            className="absolute inset-y-0 left-0 z-20 w-2 bg-[repeating-linear-gradient(180deg,rgba(251,146,60,0.95)_0_10px,rgba(88,39,12,0.95)_10px_18px)]"
            aria-hidden="true"
          />
          <span
            className="absolute left-5 top-5 bottom-5 z-20 w-px bg-orange-200/20"
            aria-hidden="true"
          />
          <span
            className="absolute left-[1.05rem] top-5 z-20 h-2 w-2 rounded-full bg-orange-300 shadow-[0_0_12px_rgba(251,146,60,0.8)]"
            aria-hidden="true"
          />
          <span
            className="absolute left-[1.05rem] bottom-5 z-20 h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.75)]"
            aria-hidden="true"
          />
        </>
      ) : null}
      {/* Image */}
      <div
        className={`relative w-full bg-[#120805]/60 ${isFoodTruckEntity ? "aspect-[16/9] pl-2" : "aspect-[4/3]"}`}
      >
        <ScoutCardMedia
          imageUrl={img || null}
          fallbackIcon={placeIcon}
          fallbackTestId="scout-nearby-restaurant-card-image-fallback"
          imageClassName="absolute inset-0 h-full w-full object-cover"
          categoryPhoto={getDishCategoryPhoto(name, cuisine)}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%)",
          }}
          aria-hidden="true"
        />
        {dealCount > 0 && (
          <span
            className={`absolute top-2.5 inline-flex items-center gap-1 rounded-full bg-orange-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow ${isFoodTruckEntity ? "left-4" : "left-2.5"}`}
          >
            <Tag className="h-2.5 w-2.5" aria-hidden="true" />
            {dealCount} deal{dealCount > 1 ? "s" : ""}
          </span>
        )}
        <span
          className={`absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${labelPillClass}`}
        >
          {isFoodTruckEntity ? (
            <TruckIcon className="h-3 w-3" aria-hidden="true" />
          ) : (
            <MapPin className="h-3 w-3" aria-hidden="true" />
          )}
          {canonicalLabel}
        </span>
      </div>
      {/* Info */}
      <div
        className={
          isFoodTruckEntity
            ? "border-t border-orange-200/12 bg-[#190b06]/92 px-3 py-3 pl-7"
            : "border-t border-emerald-200/10 bg-[#0f1b17]/82 px-3 py-2.5"
        }
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-white font-semibold text-sm leading-snug">
            {name}
          </p>
          {statusLabels.length > 0 && (
            <span
              className={`inline-flex shrink-0 items-center gap-1 text-[9px] font-bold uppercase tracking-wide ${statusTextClass}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`}
                style={{
                  boxShadow: isFoodTruckEntity
                    ? "0 0 6px rgba(251,146,60,0.8)"
                    : "0 0 6px rgba(52,211,153,0.7)",
                }}
                aria-hidden="true"
              />
              {statusLabels[0]}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          {cuisine && (
            <span
              className={`${isFoodTruckEntity ? "text-orange-300/80" : "text-emerald-200/76"} text-[11px]`}
            >
              {cuisine}
            </span>
          )}
          {cuisine && (location || distLabel) && (
            <span className="text-white/30 text-[11px]">·</span>
          )}
          {location && (
            <span className="text-white/60 text-[11px] truncate">
              {location}
            </span>
          )}
          {distLabel && (
            <>
              <span className="text-white/30 text-[11px]">·</span>
              <span className="text-white/50 text-[11px]">{distLabel}</span>
            </>
          )}
        </div>
        {menuPreview.length > 0 && (
          <div
            className="mt-2 flex items-center gap-2 border-t border-white/8 pt-2"
            data-testid="scout-menu-preview"
          >
            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg relative">
              <ScoutCardMedia
                imageUrl={menuPreview[0].imageUrl || null}
                fallbackIcon={
                  <Utensils
                    className="h-3 w-3 text-white/70"
                    aria-hidden="true"
                  />
                }
                fallbackTestId="scout-restaurant-featured-item-fallback"
                imageClassName="absolute inset-0 h-full w-full object-cover"
                categoryPhoto={getDishCategoryPhoto(
                  menuPreview[0].name,
                  menuPreview[0].description,
                )}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-white/85">
                {menuPreview[0].name}
              </p>
              <p className="text-[9px] font-bold uppercase tracking-wide text-orange-200/70">
                Featured item
              </p>
            </div>
            {formatPrice(menuPreview[0].priceCents) && (
              <span className="shrink-0 text-[11px] font-semibold text-orange-200/85">
                {formatPrice(menuPreview[0].priceCents)}
              </span>
            )}
          </div>
        )}
        <OwnerOperationalActions actions={ownerActions} />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div
            className="flex items-center gap-2.5"
            aria-hidden={communityUpdates.length === 0}
          >
            {favoriteCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-white/45">
                <Bookmark className="h-2.5 w-2.5" aria-hidden="true" />
                {favoriteCount}
              </span>
            )}
            {followCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-white/45">
                <Heart className="h-2.5 w-2.5" aria-hidden="true" />
                {followCount}
              </span>
            )}
          </div>
          <div
            className="flex items-center gap-1.5"
            aria-label={`${name} quick actions`}
          >
            {/* Single entry point: a bare tap is the shallow like/follow/recommend
                bundle (no popup). Tapping again (already recommended) opens the
                popup, where Share, Favorite, and enrichment live. */}
            <button
              type="button"
              onClick={recommend}
              disabled={pendingAction === "recommend"}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full transition ${
                isRecommended
                  ? "bg-orange-300 text-[#1a0d08]"
                  : "bg-white/8 text-white/70 hover:bg-white/12"
              }`}
              aria-pressed={isRecommended}
              aria-label={
                isRecommended ? "Recommended - tap for more" : "Recommend"
              }
              title={isRecommended ? "Recommended - tap for more" : "Recommend"}
            >
              <Heart
                className={`h-3 w-3 ${isRecommended ? "fill-current" : ""}`}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </div>
      <Dialog
        open={isRecommendDialogOpen}
        onOpenChange={setIsRecommendDialogOpen}
      >
        <DialogContent
          className="max-w-sm"
          onClick={(event) => event.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{name}</DialogTitle>
            <DialogDescription>
              Tell us why you recommend it, or just close this - your
              recommendation is already saved.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleFavorite}
              disabled={pendingAction === "favorite"}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                isFavorite
                  ? "bg-orange-300 text-[#1a0d08]"
                  : "bg-white/8 text-white/80 hover:bg-white/12"
              }`}
            >
              <Bookmark
                className={`h-3.5 w-3.5 ${isFavorite ? "fill-current" : ""}`}
                aria-hidden="true"
              />
              {isFavorite ? "Favorited" : "Favorite"}
            </button>
            <ShareButton
              url={profileHref}
              title={name}
              variant="outline"
              size="sm"
            />
          </div>
          {isFollowed && (
            <button
              type="button"
              onClick={toggleFollow}
              className="self-start text-[11px] text-[color:var(--text-muted)] underline underline-offset-2"
            >
              Following · Unfollow
            </button>
          )}
          <textarea
            value={restaurantRecommendComment}
            onChange={(event) =>
              setRestaurantRecommendComment(event.target.value)
            }
            placeholder="What makes this place worth it? (optional)"
            className="min-h-[72px] w-full rounded border border-[color:var(--border-subtle)] bg-black/20 px-2 py-1.5 text-sm"
          />
          <div className="flex items-center gap-2">
            <label
              className="text-xs text-[color:var(--text-muted)]"
              htmlFor={`restaurant-rating-${restaurantId}`}
            >
              Rating
            </label>
            <select
              id={`restaurant-rating-${restaurantId}`}
              value={restaurantRecommendRating}
              onChange={(event) =>
                setRestaurantRecommendRating(event.target.value)
              }
              className="rounded border border-[color:var(--border-subtle)] bg-black/20 px-1.5 py-1 text-sm"
            >
              <option value="5">5</option>
              <option value="4">4</option>
              <option value="3">3</option>
              <option value="2">2</option>
              <option value="1">1</option>
            </select>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={submitRestaurantRecommendationDetails}
              disabled={isSubmittingRestaurantRecommend}
              className="rounded-full bg-orange-400 px-3 py-1.5 text-xs font-black text-[#1a0d08] disabled:opacity-60"
            >
              {isSubmittingRestaurantRecommend ? "Saving…" : "Save"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </Link>
  );
}

function SavedRestaurantCard({
  restaurant,
}: {
  restaurant: RestaurantSummary;
}) {
  const normalizedKind = getScoutRestaurantLikeKind(restaurant);
  const isFoodTruckEntity = normalizedKind === "food_truck";
  const canonicalLabel = isFoodTruckEntity
    ? "Food truck"
    : normalizedKind === "restaurant"
      ? "Restaurant"
      : "Local activity";
  const profileHref = getRestaurantProfilePath(restaurant);
  const name = restaurant.businessName || restaurant.name || canonicalLabel;
  const img =
    restaurant.coverImageUrl ||
    restaurant.heroImageUrl ||
    restaurant.imageUrl ||
    restaurant.logoUrl;
  const location =
    restaurant.neighborhood || restaurant.city || restaurant.address;
  const cuisine = restaurant.cuisineType;
  const cardShellClass = isFoodTruckEntity
    ? "relative block overflow-hidden rounded-[1.55rem] bg-[#100806]/86 ring-1 ring-orange-300/30 transition hover:bg-[#1a0d07]/92 hover:ring-orange-200/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
    : "block overflow-hidden rounded-xl bg-[#0c1714]/82 ring-1 ring-emerald-200/20 transition hover:bg-[#121f1b]/88 hover:ring-emerald-200/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70";
  const labelPillClass = isFoodTruckEntity
    ? "bg-[#120805]/72 text-orange-100 ring-orange-200/20"
    : "bg-[#071411]/72 text-emerald-100 ring-emerald-200/20";

  return (
    <Link
      href={profileHref}
      className={cardShellClass}
      aria-label={`Open saved ${canonicalLabel.toLowerCase()} ${name}`}
    >
      {isFoodTruckEntity ? (
        <span
          className="absolute inset-y-0 left-0 z-20 w-2 bg-[repeating-linear-gradient(180deg,rgba(251,146,60,0.95)_0_10px,rgba(88,39,12,0.95)_10px_18px)]"
          aria-hidden="true"
        />
      ) : null}
      <div
        className={`relative h-24 bg-[#120805]/50 ${isFoodTruckEntity ? "pl-2" : ""}`}
      >
        <ScoutCardMedia
          imageUrl={img || null}
          fallbackIcon={
            isFoodTruckEntity ? (
              <TruckIcon className="h-5 w-5 text-white/80" aria-hidden="true" />
            ) : (
              <MapPin className="h-5 w-5 text-white/80" aria-hidden="true" />
            )
          }
          fallbackTestId="scout-saved-restaurant-card-image-fallback"
          imageClassName="absolute inset-0 h-full w-full object-cover"
          categoryPhoto={getDishCategoryPhoto(name, cuisine)}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.78))",
          }}
          aria-hidden="true"
        />
        <span
          className={`absolute top-2.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${isFoodTruckEntity ? "left-4" : "left-2.5"} ${labelPillClass}`}
        >
          {isFoodTruckEntity ? (
            <TruckIcon className="h-3 w-3" aria-hidden="true" />
          ) : (
            <MapPin className="h-3 w-3" aria-hidden="true" />
          )}
          {canonicalLabel}
        </span>
      </div>
      <div
        className={
          isFoodTruckEntity
            ? "border-t border-orange-200/12 bg-[#190b06]/90 px-3 py-3 pl-6"
            : "border-t border-emerald-200/10 bg-[#0f1b17]/80 px-3 py-3"
        }
      >
        <p className="truncate text-sm font-semibold text-white">{name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
          {cuisine && (
            <span
              className={
                isFoodTruckEntity ? "text-orange-200/80" : "text-emerald-200/74"
              }
            >
              {cuisine}
            </span>
          )}
          {cuisine && location && <span className="text-white/25">·</span>}
          {location && (
            <span className="truncate text-white/55">{location}</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ============================================================
   OPEN NOW SECTION
   The first content rail under the map. Broad food view across
   any business with a public hours/schedule footprint:
     - food trucks broadcasting service
     - public events / pop-ups happening today
     - restaurants and bars with active deals
   Empty state collapses to a quiet status chip + Why? helper.
   ============================================================ */

function OpenNowSection({
  liveTrucks,
  liveTrucksLoading,
  liveTrucksError,
  restaurants,
  nearbyRestaurantsLoading,
  events,
  deals,
  locationStatus,
  onExpandMap,
  onSelectTruck,
  currentUserId,
  isSignedIn,
  menuPreviewByRestaurantId,
  relationshipSnapshot,
}: {
  liveTrucks: LiveTruckSummary[];
  liveTrucksLoading: boolean;
  liveTrucksError: boolean;
  restaurants: RestaurantSummary[];
  nearbyRestaurantsLoading: boolean;
  events: EventSummary[];
  deals: DealSummary[];
  locationStatus: "idle" | "requesting" | "ready" | "denied";
  onExpandMap: () => void;
  onSelectTruck: (truck: LiveTruckSummary) => void;
  currentUserId?: string | null;
  isSignedIn: boolean;
  menuPreviewByRestaurantId: Map<string, MenuPreviewItem[]>;
  relationshipSnapshot: RestaurantRelationshipSnapshot;
}) {
  const todaysEvents = useMemo(() => {
    const now = new Date();
    const startOfTomorrow = new Date(now);
    startOfTomorrow.setHours(24, 0, 0, 0);
    return events.filter((e) => {
      const raw = e.startsAt || e.startTime;
      if (!raw) return true; // unknown start → still surface (likely current)
      const t = new Date(raw).getTime();
      if (!Number.isFinite(t)) return true;
      return t < startOfTomorrow.getTime();
    });
  }, [events]);

  const hasAnyContent =
    liveTrucks.length > 0 ||
    restaurants.length > 0 ||
    todaysEvents.length > 0 ||
    deals.length > 0;

  // While loading and no content yet, show skeletons
  if (liveTrucksLoading && nearbyRestaurantsLoading && !hasAnyContent) {
    return (
      <section className="pl-5 pr-0 pt-2 pb-10">
        <SectionHeader
          title="Open Now"
          linkHref="/search"
          subtitle="Open restaurants, serving trucks, live deals, and food events nearby."
        />
        <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
          <ul className="flex gap-4 pr-5" role="list">
            {[0, 1, 2].map((i) => (
              <li key={i} className="shrink-0 w-[230px] sm:w-[260px]">
                <LiveTruckSkeletonCard />
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  // We have local food — render a unified rail of cards.
  if (hasAnyContent) {
    const liveCount = liveTrucks.length;
    const restaurantCount = restaurants.length;
    const eventsCount = todaysEvents.length;
    const dealsCount = deals.length;
    const summaryBits = [
      restaurantCount > 0
        ? `${restaurantCount} open place${restaurantCount === 1 ? "" : "s"}`
        : null,
      liveCount > 0 ? `${liveCount} truck${liveCount === 1 ? "" : "s"}` : null,
      eventsCount > 0 ? `${eventsCount} happening today` : null,
      dealsCount > 0
        ? `${dealsCount} active deal${dealsCount === 1 ? "" : "s"}`
        : null,
    ].filter(Boolean);

    return (
      <section className="pl-5 pr-0 pt-2 pb-10">
        <SectionHeader
          title="Open Now"
          linkHref="/search"
          subtitle={
            summaryBits.length > 0
              ? summaryBits.join(" · ")
              : "Open restaurants, serving trucks, live deals, and food events nearby."
          }
        />
        <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
          <ul
            className="flex gap-4 pr-5"
            role="list"
            aria-label="Businesses, events, and deals open right now"
          >
            {liveTrucks.slice(0, 8).map((truck) => (
              <li
                key={`truck-${truck.id}`}
                className="shrink-0 w-[230px] sm:w-[260px]"
              >
                <LiveTruckCard
                  truck={truck}
                  currentUserId={currentUserId}
                  relationshipSnapshot={relationshipSnapshot}
                />
              </li>
            ))}
            {restaurants.slice(0, 8).map((restaurant) => (
              <li
                key={`restaurant-${restaurant.id}`}
                className="shrink-0 w-[230px] sm:w-[260px]"
              >
                <NearbyRestaurantCard
                  restaurant={restaurant}
                  menuPreview={
                    menuPreviewByRestaurantId.get(String(restaurant.id)) ?? []
                  }
                  isSignedIn={isSignedIn}
                  currentUserId={currentUserId}
                  relationshipSnapshot={relationshipSnapshot}
                />
              </li>
            ))}
            {todaysEvents.slice(0, 6).map((ev) => (
              <li
                key={`event-${ev.id}`}
                className="shrink-0 w-[230px] sm:w-[260px]"
              >
                <EventCard event={ev} currentUserId={currentUserId} />
              </li>
            ))}
            {deals.slice(0, 6).map((d) => (
              <li
                key={`deal-${d.id}`}
                className="shrink-0 w-[230px] sm:w-[260px]"
              >
                <DealCard deal={d} currentUserId={currentUserId} />
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  // No useful local food yet: keep the page focused on the craving picker instead
  // of spending first-screen space explaining an empty feed.
  void liveTrucksError;
  void locationStatus;
  void onExpandMap;
  void onSelectTruck;
  return null;
}

/* ============================================================
   TRUCK CARD
   Shows a food truck in the Food Trucks Near You section.
   ============================================================ */

function LiveTruckMapCard({
  truck,
  userLocation,
  onClose,
}: {
  truck: LiveTruckSummary;
  userLocation?: { lat: number; lng: number } | null;
  onClose: () => void;
}) {
  const distance = formatDistance(truck);
  const wait = formatWait(truck);
  const place = formatTruckPlace(truck);
  const directionsUrl = buildTruckDirectionsUrl(truck, userLocation);

  return (
    <div
      className="absolute left-4 right-4 bottom-[calc(env(safe-area-inset-bottom)+7.25rem)] z-30 rounded-3xl bg-[rgba(46,30,18,0.84)] p-4 text-white ring-1 ring-orange-200/50 backdrop-blur-xl"
      style={{
        boxShadow:
          "0 22px 70px rgba(0,0,0,0.62), 0 0 24px rgba(255,90,47,0.18)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/18 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-orange-200 ring-1 ring-orange-300/25">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-300 animate-pulse" />
            Food truck
          </div>
          <h3 className="mt-2 truncate text-lg font-black">
            {truck.name || "Food Truck"}
          </h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-orange-100/80">
            <MapPin
              className="h-4 w-4 shrink-0 text-orange-300"
              aria-hidden="true"
            />
            <span className="truncate">{place}</span>
          </p>
          <p className="mt-1 text-xs text-white/60">
            {[distance, wait].filter(Boolean).join(" · ") ||
              "Center map to compare it with your location."}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-1 text-xs font-bold text-white/60 ring-1 ring-white/10"
        >
          Close
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <a
          href={directionsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex flex-col items-center justify-center gap-1 rounded-2xl bg-orange-500 px-2 py-3 text-center text-xs font-black text-[#160904]"
        >
          <Navigation2 className="h-4 w-4" aria-hidden="true" />
          Directions
        </a>
        <Link
          href={getTruckProfilePath(truck)}
          className="inline-flex flex-col items-center justify-center gap-1 rounded-2xl bg-white/10 px-2 py-3 text-center text-xs font-black text-white ring-1 ring-white/10"
        >
          <Flame className="h-4 w-4 text-orange-300" aria-hidden="true" />
          Profile
        </Link>
        <Link
          href={`${getTruckProfilePath(truck)}?message=1`}
          className="inline-flex flex-col items-center justify-center gap-1 rounded-2xl bg-white/10 px-2 py-3 text-center text-xs font-black text-white ring-1 ring-white/10"
        >
          <MessageCircle
            className="h-4 w-4 text-orange-300"
            aria-hidden="true"
          />
          Message
        </Link>
      </div>
    </div>
  );
}

function MapPlaceCard({
  marker,
  userLocation,
  onClose,
}: {
  marker: MapAdapterMarker;
  userLocation?: { lat: number; lng: number } | null;
  onClose: () => void;
}) {
  const destination =
    marker.kind === "restaurant"
      ? `/restaurant/${marker.sourceId}`
      : marker.kind === "deal"
        ? "/deals-featured"
        : marker.kind === "parking"
          ? `/events?hostId=${encodeURIComponent(String(marker.sourceId))}`
          : "/events";
  const label =
    marker.kind === "restaurant"
      ? "Food spot"
      : marker.kind === "deal"
        ? "Deal today"
        : marker.kind === "parking"
          ? "Event Host"
          : "Local event";
  const action =
    marker.kind === "restaurant"
      ? "Open profile"
      : marker.kind === "deal"
        ? "View deal"
        : marker.kind === "parking"
          ? "View host"
          : "See events";
  const originParam = userLocation
    ? `&origin=${userLocation.lat},${userLocation.lng}`
    : "";
  const directionsUrl = `https://www.google.com/maps/dir/?api=1${originParam}&destination=${marker.lat},${marker.lng}&travelmode=driving`;

  if (marker.kind === "parking") {
    const parkedTrucks = marker.parkedTrucks || [];
    const hasParkedTrucks = parkedTrucks.length > 0;
    const hostDestination = `/events?hostId=${encodeURIComponent(String(marker.sourceId))}`;

    return (
      <div
        data-scout-map-card-kind="host"
        className="absolute left-3 right-3 bottom-[calc(env(safe-area-inset-bottom)+7.25rem)] z-30 rounded-2xl bg-[rgba(27,16,8,0.96)] p-3 text-white ring-1 ring-amber-300/45 backdrop-blur-xl"
        style={{
          boxShadow:
            "0 18px 54px rgba(0,0,0,0.58), 0 0 22px rgba(245,158,11,0.2)",
        }}
      >
        <div className="flex items-start gap-3">
          {marker.spotImageUrl ? (
            <img
              src={marker.spotImageUrl}
              alt=""
              className="h-12 w-12 shrink-0 rounded-xl object-cover ring-1 ring-amber-200/25"
            />
          ) : (
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/18 text-amber-100 ring-1 ring-amber-300/35">
              {hasParkedTrucks ? (
                <TruckIcon className="h-5 w-5" aria-hidden="true" />
              ) : (
                <MapPin className="h-5 w-5" aria-hidden="true" />
              )}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-amber-100 ring-1 ring-amber-300/25">
              {hasParkedTrucks ? "Truck parked" : "Host location"}
            </div>
            <h3 className="mt-1.5 truncate text-base font-black">
              {marker.title || "Host location"}
            </h3>
            <p className="mt-0.5 truncate text-xs font-bold text-amber-100/70">
              {marker.address || marker.subtitle || "Parking Pass host spot"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold text-white/60 ring-1 ring-white/10"
          >
            Close
          </button>
        </div>

        {hasParkedTrucks ? (
          <div className="mt-3 space-y-1.5">
            {parkedTrucks.slice(0, 3).map((truck, index) => {
              const key = `${truck.id || truck.name}-${index}`;
              const content = (
                <>
                  <TruckIcon
                    className="h-3.5 w-3.5 shrink-0 text-orange-200"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{truck.name}</span>
                  {truck.slotLabel ? (
                    <span className="shrink-0 truncate text-[10px] uppercase tracking-wide text-amber-100/60">
                      {truck.slotLabel}
                    </span>
                  ) : null}
                </>
              );
              return truck.href ? (
                <Link
                  key={key}
                  href={truck.href}
                  className="flex h-9 items-center gap-2 rounded-xl bg-orange-500/10 px-3 text-xs font-black text-orange-50 ring-1 ring-orange-300/20"
                >
                  {content}
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-orange-200/70"
                    aria-hidden="true"
                  />
                </Link>
              ) : (
                <div
                  key={key}
                  className="flex h-9 items-center gap-2 rounded-xl bg-orange-500/10 px-3 text-xs font-black text-orange-50 ring-1 ring-orange-300/20"
                >
                  {content}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-xs font-bold text-amber-50/70 ring-1 ring-white/10">
            Host spot available for Parking Pass visits.
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link
            href={hostDestination}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-amber-400 px-3 text-center text-xs font-black text-[#1a0d03]"
          >
            View host
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <a
            href={directionsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white/10 px-3 text-center text-xs font-black text-white ring-1 ring-white/10"
          >
            Route
            <Navigation2
              className="h-4 w-4 text-amber-200"
              aria-hidden="true"
            />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute left-4 right-4 bottom-[calc(env(safe-area-inset-bottom)+7.25rem)] z-30 rounded-3xl bg-[rgba(46,30,18,0.84)] p-4 text-white ring-1 ring-orange-200/50 backdrop-blur-xl"
      style={{
        boxShadow:
          "0 22px 70px rgba(0,0,0,0.62), 0 0 24px rgba(255,90,47,0.18)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/18 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-orange-200 ring-1 ring-orange-300/25">
            {label}
          </div>
          <h3 className="mt-2 truncate text-lg font-black">
            {marker.title || label}
          </h3>
          {marker.subtitle ? (
            <p className="mt-1 text-sm text-orange-100/75">{marker.subtitle}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-1 text-xs font-bold text-white/60 ring-1 ring-white/10"
        >
          Close
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link
          href={destination}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-3 py-3 text-center text-xs font-black text-[#160904]"
        >
          {action}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <a
          href={directionsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/10 px-3 py-3 text-center text-xs font-black text-white ring-1 ring-white/10"
        >
          Directions
          <Navigation2 className="h-4 w-4 text-orange-300" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}

function MapActivityPips({
  mode,
  truckCount,
  restaurantCount,
  dealCount,
  eventCount,
}: {
  mode: ScoutActivityMode;
  truckCount: number;
  restaurantCount: number;
  dealCount: number;
  eventCount: number;
}) {
  if (mode === "low_activity") return null;

  const pips = [
    truckCount > 0
      ? { label: "Trucks", value: truckCount, className: "bg-orange-300" }
      : null,
    restaurantCount > 0
      ? { label: "Open", value: restaurantCount, className: "bg-emerald-300" }
      : null,
    dealCount > 0
      ? { label: "Deals", value: dealCount, className: "bg-lime-300" }
      : null,
    eventCount > 0
      ? { label: "Today", value: eventCount, className: "bg-amber-300" }
      : null,
  ].filter(
    (item): item is { label: string; value: number; className: string } =>
      Boolean(item),
  );

  if (pips.length === 0) return null;

  return (
    <div
      className={[
        "pointer-events-none absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap",
        mode === "high_activity" ? "gap-2" : "gap-1.5",
      ].join(" ")}
    >
      {pips.slice(0, 4).map((pip) => (
        <span
          key={pip.label}
          className={[
            "inline-flex items-center gap-1 rounded-full font-black uppercase tracking-[0.08em] text-white ring-1 backdrop-blur-md",
            mode === "high_activity"
              ? "bg-[#120805]/78 px-2.5 py-1.5 text-[10px] ring-white/20 shadow-[0_10px_24px_rgba(0,0,0,0.34)]"
              : "bg-[#120805]/68 px-2 py-1 text-[10px] ring-white/10",
          ].join(" ")}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${pip.className}`}
            aria-hidden="true"
          />
          {pip.value} {pip.label}
        </span>
      ))}
    </div>
  );
}

function MapLayerToggles({
  layers,
  onToggle,
}: {
  layers: MapLayerState;
  onToggle: (layer: MapLayerId) => void;
}) {
  const options: Array<{
    id: MapLayerId;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      id: "openNow",
      label: "Open",
      icon: <Flame className="h-3 w-3" aria-hidden="true" />,
    },
    {
      id: "foodTrucks",
      label: "Trucks",
      icon: <Utensils className="h-3 w-3" aria-hidden="true" />,
    },
    {
      id: "deals",
      label: "Deals",
      icon: <Tag className="h-3 w-3" aria-hidden="true" />,
    },
    {
      id: "happeningToday",
      label: "Today",
      icon: <CalendarDays className="h-3 w-3" aria-hidden="true" />,
    },
  ];

  return (
    <div className="absolute left-3 right-3 top-[calc(env(safe-area-inset-top)+4.7rem)] z-20 overflow-x-auto atmo-hide-scrollbar sm:left-4 sm:right-auto sm:w-[360px]">
      <div className="flex w-max gap-1 rounded-full bg-[#120805]/66 p-1 text-[10px] font-black uppercase tracking-wide text-white/70 ring-1 ring-white/10 backdrop-blur-xl">
        {options.map((option) => {
          const isActive = layers[option.id];
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onToggle(option.id)}
              className={[
                "inline-flex h-7 items-center gap-1 rounded-full px-2 transition-colors",
                isActive
                  ? "bg-white/15 text-white ring-1 ring-white/20"
                  : "bg-transparent text-white/50 hover:bg-white/10 hover:text-white/75",
              ].join(" ")}
              aria-pressed={isActive}
            >
              {option.icon}
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ScoutMapHud({
  locationLabel,
  marketEyebrow,
  liveTruckCount,
  restaurantCount,
  eventCount,
  dealCount,
  localActivityCount,
  discoveryRadiusKm,
  onRadiusChange,
  onRecenter,
}: {
  locationLabel: string;
  marketEyebrow: string;
  liveTruckCount: number;
  restaurantCount: number;
  eventCount: number;
  dealCount: number;
  localActivityCount: number;
  discoveryRadiusKm: number;
  onRadiusChange: (value: number) => void;
  onRecenter: () => void;
}) {
  const radiusOptions = [5, 12, 25, 40];
  const [isExpanded, setIsExpanded] = useState(false);
  const totalPins = liveTruckCount + restaurantCount + eventCount;
  const sceneLine =
    totalPins > 0
      ? `${liveTruckCount} trucks • ${dealCount} deals • ${eventCount} events`
      : "No nearby pins yet - pan the map or widen radius";

  return (
    <div className="pointer-events-none absolute left-3 right-3 top-[calc(env(safe-area-inset-top)+4.25rem)] z-20 sm:left-4 sm:right-auto sm:w-[360px]">
      <div
        className="pointer-events-auto rounded-2xl bg-[rgba(46,30,18,0.84)] p-3 text-white ring-1 ring-orange-200/52 backdrop-blur-xl"
        style={{
          boxShadow:
            "0 18px 54px rgba(0,0,0,0.52), 0 0 26px rgba(255,90,47,0.2)",
        }}
      >
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/18 pb-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-500/15 ring-1 ring-orange-200/30">
              <img
                src={mealScoutIcon}
                alt=""
                className="h-7 w-7 object-contain"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-200/75">
                Map
              </p>
              <p className="truncate text-sm font-black text-white">
                Local food scene
              </p>
            </div>
          </div>
          <span className="rounded-full bg-orange-500/16 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-orange-100 ring-1 ring-orange-200/25">
            Live map
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-orange-200/72">
              {marketEyebrow}
            </p>
            <h2 className="truncate text-base font-black text-orange-50">
              {locationLabel}
            </h2>
            <p className="text-[11px] font-semibold text-white/78">
              {sceneLine}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded((value) => !value)}
              className="rounded-full bg-white/18 px-3 py-2 text-xs font-black text-orange-50 ring-1 ring-orange-200/28 transition-colors hover:bg-white/24"
              aria-expanded={isExpanded}
            >
              {isExpanded ? "Less" : "Details"}
            </button>
            <button
              type="button"
              onClick={onRecenter}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#ff5a2f] text-[#160904] ring-1 ring-orange-200/40 shadow-[0_0_18px_rgba(255,90,47,0.32)]"
              aria-label="Recenter map on your location"
            >
              <Navigation2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="mt-3">
            <p className="text-xs text-white/76">
              Tap the glowing pins to jump into what's cooking near you right
              now.
            </p>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              <MapHudCount label="Trucks" value={liveTruckCount} />
              <MapHudCount label="Food" value={restaurantCount} />
              <MapHudCount label="Deals" value={dealCount} />
              <MapHudCount label="Events" value={eventCount} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 rounded-2xl bg-black/18 px-2.5 py-2 ring-1 ring-white/10">
              <MapFreshnessKey dotClassName="bg-emerald-300" label="Updated" />
              <MapFreshnessKey
                dotClassName="bg-orange-200"
                label="Older info"
              />
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-white/16 px-3 py-2 ring-1 ring-orange-200/18">
          <span className="text-xs font-bold text-white/72">Radius</span>
          <div className="flex rounded-full bg-black/25 p-1">
            {radiusOptions.map((radius) => {
              const isActive = discoveryRadiusKm === radius;
              return (
                <button
                  key={radius}
                  type="button"
                  onClick={() => onRadiusChange(radius)}
                  className={[
                    "rounded-full px-2 py-1 text-[10px] font-black transition-colors",
                    isActive
                      ? "bg-[#ff5a2f] text-[#1b0b02] shadow-[0_0_14px_rgba(255,90,47,0.3)]"
                      : "text-white/58 hover:text-white",
                  ].join(" ")}
                  aria-pressed={isActive}
                >
                  {Math.round(radius * 0.621371)} mi
                </button>
              );
            })}
          </div>
        </div>

        {isExpanded && localActivityCount === 0 ? (
          <div className="mt-3 rounded-2xl bg-white/10 px-3 py-2 text-xs text-white/72 ring-1 ring-white/10">
            No nearby pins right here yet. Pan the map or widen discovery from
            the feed below.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MapHudCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/10 px-2 py-2 ring-1 ring-white/10">
      <p className="text-base font-black text-orange-200">{value}</p>
      <p className="text-[9px] font-bold uppercase tracking-wide text-white/48">
        {label}
      </p>
    </div>
  );
}

function MapFreshnessKey({
  dotClassName,
  label,
}: {
  dotClassName: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/6 px-2 py-1 text-[10px] font-bold text-white/62">
      <span
        className={`h-1.5 w-1.5 rounded-full ${dotClassName}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function MapEdgeIndicators({
  markers,
  bounds,
  center,
  selectedId,
  onSelect,
}: {
  markers: MapAdapterMarker[];
  bounds: MapBoundsLike;
  center?: { lat: number; lng: number } | null;
  selectedId?: string | null;
  onSelect: (marker: MapAdapterMarker) => void;
}) {
  if (!center) return null;
  const offscreen = markers
    .filter((marker) => marker.kind !== "user")
    .filter(
      (marker) => marker.id !== selectedId && marker.sourceId !== selectedId,
    )
    .filter((marker) => !bounds.contains([marker.lat, marker.lng]))
    .map((marker) => {
      const dx = marker.lng - center.lng;
      const dy = marker.lat - center.lat;
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const edge = horizontal
        ? dx > 0
          ? "right"
          : "left"
        : dy > 0
          ? "top"
          : "bottom";
      const distanceScore = Math.sqrt(dx * dx + dy * dy);
      return { marker, edge, distanceScore };
    })
    .sort((a, b) => a.distanceScore - b.distanceScore)
    .slice(0, 8);

  if (offscreen.length === 0) return null;

  const byEdge = offscreen.reduce<Record<string, typeof offscreen>>(
    (acc, item) => {
      acc[item.edge] = acc[item.edge] || [];
      acc[item.edge].push(item);
      return acc;
    },
    {},
  );

  const edgeClass: Record<string, string> = {
    top: "left-1/2 top-[calc(env(safe-area-inset-top)+15.5rem)] -translate-x-1/2 flex-row",
    right: "right-3 top-1/2 -translate-y-1/2 flex-col",
    bottom:
      "left-1/2 bottom-[calc(env(safe-area-inset-bottom)+12rem)] -translate-x-1/2 flex-row",
    left: "left-3 top-1/2 -translate-y-1/2 flex-col",
  };

  return (
    <>
      {Object.entries(byEdge).map(([edge, items]) => (
        <div
          key={edge}
          className={`pointer-events-none absolute z-25 flex gap-2 ${edgeClass[edge]}`}
        >
          {items.slice(0, 3).map(({ marker }) => (
            <button
              key={marker.id}
              type="button"
              onClick={() => onSelect(marker)}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-[#1b0d05]/88 px-3 py-2 text-xs font-black text-orange-100 ring-1 ring-orange-300/40 backdrop-blur-xl"
              style={{
                boxShadow:
                  "0 12px 36px rgba(0,0,0,0.42), 0 0 18px rgba(255,90,47,0.16)",
              }}
              aria-label={`Show ${marker.title || marker.kind} on map`}
            >
              <span className="text-orange-300">
                {edge === "left"
                  ? "‹"
                  : edge === "right"
                    ? "›"
                    : edge === "top"
                      ? "⌃"
                      : "⌄"}
              </span>
              <span>
                {marker.kind === "truck"
                  ? "Truck"
                  : marker.kind === "restaurant"
                    ? "Food"
                    : marker.kind === "deal"
                      ? "Deal"
                      : marker.kind === "parking"
                        ? "Host"
                        : "Event"}
              </span>
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

function TruckCard({
  truck,
  onSelect,
  currentUserId,
}: {
  truck: LiveTruckSummary;
  onSelect?: (truck: LiveTruckSummary) => void;
  currentUserId?: string | null;
}) {
  const name = truck.name || "Food Truck";
  const cuisine = truck.cuisineType ?? null;
  const img =
    truck.coverImageUrl ??
    truck.heroImageUrl ??
    truck.imageUrl ??
    truck.logoUrl ??
    null;

  const distMiles = truck.distanceMiles;
  const distKm = truck.distance;
  let distLabel: string | null = null;
  if (typeof distMiles === "number" && Number.isFinite(distMiles)) {
    distLabel = `${distMiles.toFixed(distMiles < 10 ? 1 : 0)} mi`;
  } else if (typeof distKm === "number" && Number.isFinite(distKm)) {
    const m = distKm * 0.621371;
    distLabel = `${m.toFixed(m < 10 ? 1 : 0)} mi`;
  }

  const wait = truck.waitMinutes ?? truck.estimatedWaitMinutes;
  const waitLabel =
    typeof wait === "number" && Number.isFinite(wait) && wait > 0
      ? `~${Math.round(wait)} min`
      : null;
  const isServing = isTruckServingNow(truck);
  const truckTone = getTruckCardTone(truck);
  const freshnessMeta: FreshnessMeta = {
    kind: "truck",
    updatedAt: readStringField(truck, ["updatedAt", "lastUpdatedAt"]),
    confirmedAt: readStringField(truck, ["confirmedAt", "lastConfirmedAt"]),
    hasDeal: Boolean(truck.activeDealCount && truck.activeDealCount > 0),
    hasDistance: Boolean(distLabel),
    isOpen: isServing,
  };
  const badges = getOperationalBadges(freshnessMeta).slice(0, 3);
  const canEdit = isOwnedByCurrentUser(truck, currentUserId);
  const actions = canEdit
    ? [
        {
          label: "Update status",
          href: getTruckUpdateHref(String(truck.id), "status"),
          icon: <Flame className="h-3 w-3" aria-hidden="true" />,
        },
        {
          label: "Confirm location",
          href: getTruckUpdateHref(String(truck.id), "location"),
          icon: <Navigation2 className="h-3 w-3" aria-hidden="true" />,
        },
      ]
    : [];

  return (
    <Link
      href={getTruckProfilePath(truck)}
      onClick={(event) => {
        if (!onSelect) return;
        event.preventDefault();
        onSelect(truck);
      }}
      className="relative block overflow-hidden rounded-[1.65rem] bg-[#100806]/88 ring-1 ring-orange-300/30 transition duration-200 hover:-translate-y-0.5 hover:ring-orange-200/40 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      style={{
        boxShadow:
          "0 16px 42px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(251,146,60,0.08)",
      }}
    >
      <span
        className="absolute inset-y-0 left-0 z-20 w-2 bg-[repeating-linear-gradient(180deg,rgba(251,146,60,0.95)_0_10px,rgba(88,39,12,0.95)_10px_18px)]"
        aria-hidden="true"
      />
      <span
        className="absolute left-5 top-5 bottom-5 z-20 w-px bg-orange-200/20"
        aria-hidden="true"
      />
      <span
        className="absolute left-[1.05rem] top-5 z-20 h-2 w-2 rounded-full bg-orange-300 shadow-[0_0_12px_rgba(251,146,60,0.8)]"
        aria-hidden="true"
      />
      <span
        className="absolute left-[1.05rem] bottom-5 z-20 h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.75)]"
        aria-hidden="true"
      />
      {/* Hero image */}
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-[#120805]/40 pl-2">
        <ScoutCardMedia
          imageUrl={img || null}
          fallbackIcon={
            <TruckIcon className="h-5 w-5 text-white/80" aria-hidden="true" />
          }
          fallbackTestId="scout-truck-card-image-fallback"
          imageClassName="h-full w-full object-cover"
          categoryPhoto={getDishCategoryPhoto(
            truck.name,
            truck.cuisineType,
            truck.vibe,
          )}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%)",
          }}
          aria-hidden="true"
        />
        <span
          className={`absolute top-2.5 left-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow ring-1 ${getTruckToneClass(truckTone.tone)}`}
        >
          <TruckIcon className="h-3 w-3" aria-hidden="true" />
          <span
            className={`h-1.5 w-1.5 rounded-full ${getTruckToneDotClass(truckTone.tone)}`}
            aria-hidden="true"
          />
          {truckTone.label}
        </span>
        {truck.activeDealCount && truck.activeDealCount > 0 ? (
          <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-white bg-orange-600 shadow">
            <Tag className="h-2.5 w-2.5" aria-hidden="true" />
            Deal
          </span>
        ) : null}
        <span className="absolute bottom-2.5 left-4 inline-flex items-center rounded-full bg-black/62 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/86 ring-1 ring-white/10">
          Food truck
        </span>
      </div>
      {/* Info */}
      <div className="border-t border-orange-200/12 bg-[#190b06]/92 px-3 py-3 pl-7">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-orange-300/14 text-orange-200 ring-1 ring-orange-200/25">
            <TruckIcon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-black leading-snug text-white">
              {name}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              {cuisine && (
                <span className="text-orange-300/80 text-[11px]">
                  {cuisine}
                </span>
              )}
              {cuisine && (distLabel || waitLabel) && (
                <span className="text-white/30 text-[11px]">/</span>
              )}
              {distLabel && (
                <span className="text-white/60 text-[11px]">{distLabel}</span>
              )}
              {distLabel && waitLabel && (
                <span className="text-white/30 text-[11px]">/</span>
              )}
              {waitLabel && (
                <span className="text-white/50 text-[11px]">
                  {waitLabel} wait
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {badges.map((badge) => (
            <span
              key={badge}
              className={getFreshnessBadgeClass(freshnessMeta, badge)}
            >
              {badge}
            </span>
          ))}
        </div>
        <OwnerOperationalActions actions={actions} />
      </div>
    </Link>
  );
}

/* ============================================================
   HORIZONTAL SKELETON ROW
   Loading placeholder for any horizontal scroll section.
   ============================================================ */

function HorizontalSkeletonRow({
  count = 3,
  width = 200,
}: {
  count?: number;
  width?: number;
}) {
  return (
    <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
      <ul className="flex gap-4 pr-5" role="list" aria-label="Loading…">
        {Array.from({ length: count }).map((_, i) => (
          <li key={i} className="shrink-0" style={{ width }}>
            <div className="rounded-2xl overflow-hidden bg-white/5 ring-1 ring-white/10">
              <div className="aspect-[4/3] w-full animate-pulse bg-white/5" />
              <div className="p-3 space-y-2">
                <div className="h-3 w-3/4 rounded bg-white/10 animate-pulse" />
                <div className="h-2.5 w-1/2 rounded bg-white/8 animate-pulse" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
