Warning: truncated output (original token count: 96798)
Total output lines: 11510

import {
  DEFAULT_TRUCK_BROADCAST_FRESHNESS_MS,
  deriveTruckPresence,
} from "@shared/consumerEntity";
import { isBarBusinessType } from "@shared/businessTypes";
import {
  expandScoutSearchTerms,
  tokenizeScoutSearchIntent,
} from "@shared/scoutSearchIntent";
import {
  selectScoutDiscoveryResults,
  toScoutDiscoveryResult,
  type ScoutDiscoveryResultKind,
  type ScoutDiscoveryScope,
  type ScoutDiscoverySource,
} from "@shared/scoutDiscoveryResult";
import { resolveBusinessMedia, type BusinessMediaAsset } from "@/lib/businessMedia";
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
import { createPortal } from "react-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  Bookmark,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Compass,
  Flame,
  Heart,
  MapPin,
  Maximize2,
  Plus,
  MessageCircle,
  Minimize2,
  Navigation2,
  Tag,
  TrendingUp,
  Truck as TruckIcon,
  Users,
  Utensils,
  User as UserIcon,
  X,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import {
  useEffectiveLocationContext,
  type EffectiveLocationContext,
} from "@/hooks/useEffectiveLocationContext";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import { SEOHead } from "@/components/seo-head";
import { ScoutMapHero } from "@/components/scout/ScoutMapHero";
import { PlaceAutocompleteInput } from "@/components/maps/place-autocomplete-input";
import { ActiveScenePanel } from "@/components/scout/ActiveScenePanel";
import type { ScoutSearchFilterId } from "@/components/scout/ScoutSearchDock";
import { useScoutNavSearch } from "@/components/scout/ScoutNavSearchContext";
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
import {
  getDishCategoryPhoto,
  type DishCategoryPhoto,
} from "@/lib/dishCategoryPhoto";
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
import {
  buildScoutResultViewModel,
  type ScoutResultViewModel,
} from "@/features/scout/scoutResultViewModel";
import type { ScoutSceneLane, ScoutSceneId } from "@/features/scout/scoutTypes";

const ThemedScoutMap = lazy(
  () => import("@/components/maps/themed-scout-map-v2"),
);

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
  dishRecommendationCount?: number | null;
  cvsScore?: number | null;
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

type ScoutGlobalSearchResponse = {
  query: string;
  restaurants: RestaurantSummary[];
  deals: DealSummary[];
  events: EventSummary[];
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
  },
  cravings: {
    title: "Search by Craving",
    href: "/search",
    subtitle: "Search dishes, trucks, places, and events by what sounds good.",
  },
  trending: {
    title: "Local Activity",
    href: "/search",
  },
  menuItems: {
    title: "Menu Highlights",
    href: "/search",
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
    isBarBusinessType(
      source.entityType || source.profileType || source.businessType,
    )
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
  return (
    buildPublicProfilePath({
      entityType:
        placeKind === "food_truck"
          ? "truck"
          : isBarBusinessType(place.businessType)
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

function isTruckBroadcastLive(truck: LiveTruckSummary): boolean {
  return (
    deriveTruckPresence(
      {
        mobileOnline: truck.mobileOnline,
        liveBroadcasting: truck.liveBroadcasting,
        currentLatitude: truck.latitude ?? truck.lat,
        currentLongitude: truck.longitude ?? truck.lng,
        lastBroadcastAt: truck.lastBroadcastAt,
        liveUntilAt: truck.liveUntilAt,
        locationSource: readStringField(truck, ["locationSource", "location_source"]),
      },
      { freshnessMs: DEFAULT_TRUCK_BROADCAST_FRESHNESS_MS },
    ).broadcastState === "live"
  );
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
    return "Serving now";
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

function splitCuisineCategories(raw: string | null | undefined): string[] {
  return String(raw || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

// A business's cuisine field is often several categories crammed into one
// string (e.g. "Asian, Hawaiian, Korean BBQ") - showing all of them on a
// small dish card is exactly the kind of clutter that makes cards hard to
// scan. This picks exactly one: prefer a category matching the viewer's own
// interests (inferred from what they've favorited), otherwise a stable pick
// from the business's own list (same category every time for a given
// business, distributed across their categories rather than always the
// first one) so cards stay consistent without needing personalization data.
function pickDisplayCategory(
  cuisineTypeRaw: string | null | undefined,
  userInterestCuisines: Set<string>,
  seedKey: string,
): string | null {
  const categories = splitCuisineCategories(cuisineTypeRaw);
  if (categories.length === 0) return null;
  if (categories.length === 1) return categories[0];
  if (userInterestCuisines.size > 0) {
    const match = categories.find((c) =>
      userInterestCuisines.has(c.toLowerCase()),
    );
    if (match) return match;
  }
  let hash = 0;
  for (let i = 0; i < seedKey.length; i += 1) {
    hash = (hash * 31 + seedKey.charCodeAt(i)) >>> 0;
  }
  return categories[hash % categories.length];
}

// Reads the same react-query cache entry the main Scout page already
// populates (`/api/favorites/restaurants`) so dish cards can infer "cuisines
// this viewer likes" without a separate fetch or prop-drilling the favorites
// list through every card's parent.
function useFavoriteCuisineInterests(
  currentUserId?: string | null,
): Set<string> {
  const { data: favoriteRestaurantsData = [] } = useQuery<any[]>({
    queryKey: ["/api/favorites/restaurants", "scout"],
    enabled: !!currentUserId,
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
  return useMemo(() => {
    const cuisines = new Set<string>();
    for (const favorite of favoriteRestaurantsData) {
      for (const category of splitCuisineCategories(
        favorite?.restaurant?.cuisineType,
      )) {
        cuisines.add(category.toLowerCase());
      }
    }
    return cuisines;
  }, [favoriteRestaurantsData]);
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
  if (
    entityOrMeta.hasMenu ||
    entityOrMeta.kind === "Menu" ||
    entityOrMeta.kind === "menu"
  )
    labels.add("Menu updated");
  if (entityOrMeta.isOpen)
    labels.add(
      entityOrMeta.kind === "Truck" || entityOrMeta.kind === "truck"
        ? "Serving now"
        : "Open now",
    );
  if (entityOrMeta.hasDistance) labels.add("Nearby");
  if (isTodayDate(entityOrMeta.startsAt || entityOrMeta.startTime))
    labels.add("Happening today");
  const allowedLabels = new Set([
    "Open now",
    "Serving now",
    "Updated today",
    "Confirmed today",
    "Deal today",
    "Menu updated",
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
  if (count <= 0) return "Search nearby food or widen your area";
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

function resolveScoutBusinessImage(input: {
  coverImageUrl?: string | null;
  heroImageUrl?: string | null;
  imageUrl?: string | null;
  logoUrl?: string | null;
}): string | null {
  const assets: BusinessMediaAsset[] = [
    ...(input.coverImageUrl
      ? [{ kind: "cover" as const, image: input.coverImageUrl, publicApproved: true }]
      : []),
    ...(input.heroImageUrl
      ? [{ kind: "hero" as const, image: input.heroImageUrl, publicApproved: true }]
      : []),
    ...(input.imageUrl
      ? [{ kind: "legacy" as const, image: input.imageUrl, publicApproved: true }]
      : []),
    ...(input.logoUrl
      ? [{ kind: "logo" as const, image: input.logoUrl, publicApproved: true }]
      : []),
  ];
  return resolveBusinessMedia(assets, "scout_card")?.url || null;
}

function getRestaurantImage(restaurant: RestaurantSummary): string | null {
  return resolveScoutBusinessImage(restaurant);
}

function getTruckImage(truck: LiveTruckSummary): string | null {
  return resolveScoutBusinessImage(truck);
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
          .join(" / ") ||
        (isTruckBroadcastLive(truck) ? "Live now" : "Serving now"),
      reason: isTruckBroadcastLive(truck) ? "Live now" : "Serving now",
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
      title: isTruckBroadcastLive(truck) ? "Live now" : "Serving now",
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
  if (isTruckBroadcastLive(truck)) return { label: "Live now", tone: "live" };
  if (isTruckServingNow(truck)) return { label: "Serving now", tone: "scheduled" };

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
  return tokenizeScoutSearchIntent(value);
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

function filterScoutFallbackRows<T>(
  rows: T[],
  searchMode: boolean,
  query: string,
  intent: ScoutSearchIntent,
  kindHint?: string,
): T[] {
  if (!searchMode || !query.trim()) return rows;
  const expandedTerms = expandScoutSearchTerms(query);
  const fallbackIntent =
    kindHint === "restaurant" && intent === "dishes" ? "all" : intent;
  return rows.filter(
    (row) =>
      expandedTerms.some((term) => matchesScoutSearchText(row, [term])) &&
      matchesScoutIntent(row, fallbackIntent, kindHint),
  );
}

function canonicalizeScoutRows<T>(
  rows: T[],
  {
    kind,
    scope,
    source,
    query,
    limit,
  }: {
    kind: ScoutDiscoveryResultKind;
    scope: ScoutDiscoveryScope;
    source: ScoutDiscoverySource;
    query?: string;
    limit?: number;
  },
): T[] {
  return selectScoutDiscoveryResults(rows, {
    kind,
    scope,
    source,
    queryTerms: query ? expandScoutSearchTerms(query) : [],
    limit,
  }).map((result) => result.raw);
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
  const {
    searchMode: scoutSearchMode,
    query: scoutSearchQuery,
    activeFilter: scoutSearchFilter,
    closeSearch: closeScoutSearch,
    setQuery: setScoutSearchQuery,
    setActiveFilter: setScoutSearchFilter,
  } = useScoutNavSearch();
  const [resultsSheet, setResultsSheet] =
    useState<ScoutResultsSheetData | null>(null);
  const [isPlaceRequestOpen, setIsPlaceRequestOpen] = useState(false);
  const [placeRequestQuery, setPlaceRequestQuery] = useState("");
  const [selectedPlaceRequest, setSelectedPlaceRequest] = useState<{
    placeId: string;
    restaurantName: string;
    address: string;
    city: string;
    county: string;
    state: string;
    latitude: number | null;
    longitude: number | null;
  } | null>(null);
  const [isLoadingPlaceRequest, setIsLoadingPlaceRequest] = useState(false);
  const [isSubmittingPlaceRequest, setIsSubmittingPlaceRequest] =
    useState(false);
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

  const { data: eventsData, isLoading: eventsLoading } =
    useQuery<EventsResponse>({
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

  const {
    data: nearbyPublicRestaurantsData,
    isLoading: nearbyPublicRestaurantsLoading,
  } = useQuery<RestaurantSummary[]>({
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

  const {
    data: localMenuItemsData = [],
    isLoading: localMenuItemsLoading,
  } = useQuery<LocalMenuItemFeedItem[]>({
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

  const { data: trendingData, isLoading: trendingLoading } =
    useQuery<ScoutTrendingResponse>({
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

  const {
    data: globalSearchData,
    isLoading: globalSearchLoading,
  } = useQuery<ScoutGlobalSearchResponse>({
    queryKey: ["/api/search", "scout-network", scoutSearchQuery.trim()],
    enabled: scoutSearchMode && scoutSearchQuery.trim().length >= 2,
    queryFn: async () => {
      const query = scoutSearchQuery.trim();
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query)}`,
        { credentials: "include" },
      );
      if (!response.ok) {
        return { query, restaurants: [], deals: [], events: [] };
      }
      const data = await response.json();
      return {
        query,
        restaurants: Array.isArray(data?.restaurants)
          ? data.restaurants
          : [],
        deals: Array.isArray(data?.deals) ? data.deals : [],
        events: Array.isArray(data?.events) ? data.events : [],
      };
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

  const { data: nearbyDealsData, isLoading: nearbyDealsLoading } =
    useQuery<DealSummary[]>({
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

  const openFavoritePlaceRequest = useCallback(() => {
    setPlaceRequestQuery("");
    setSelectedPlaceRequest(null);
    setIsPlaceRequestOpen(true);
  }, []);

  const selectFavoritePlaceRequest = useCallback(
    async (suggestion: {
      placeId: string;
      text: string;
      mainText: string;
      secondaryText: string;
      _sessionToken?: string;
    }) => {
      setIsLoadingPlaceRequest(true);
      try {
        const detailUrl = new URL(
          `/api/map/place-details/${encodeURIComponent(suggestion.placeId)}`,
          window.location.origin,
        );
        if (suggestion._sessionToken) {
          detailUrl.searchParams.set("sessionToken", suggestion._sessionToken);
        }
        const response = await fetch(detailUrl.toString(), {
          credentials: "include",
        });
        if (!response.ok) throw new Error("Could not load that place");
        const data = await response.json().catch(() => ({}));
        const place = data?.place || {};
        setSelectedPlaceRequest({
          placeId: String(place.placeId || suggestion.placeId),
          restaurantName: String(
            place.name || suggestion.mainText || suggestion.text,
          ).trim(),
          address: String(
            place.formattedAddress || suggestion.text || "",
          ).trim(),
          city: String(place.city || marketCity || "").trim(),
          county: String(place.county || "").trim(),
          state: String(place.state || marketState || "").trim(),
          latitude:
            typeof place.latitude === "number" ? place.latitude : null,
          longitude:
            typeof place.longitude === "number" ? place.longitude : null,
        });
      } catch {
        toast({
          variant: "destructive",
          description: "We couldn't load that place. Please try another result.",
        });
      } finally {
        setIsLoadingPlaceRequest(false);
      }
    },
    [marketCity, marketState, toast],
  );

  const submitFavoritePlaceRequest = useCallback(async () => {
    if (!selectedPlaceRequest?.restaurantName) return;
    setIsSubmittingPlaceRequest(true);
    try {
      const response = await fetch(apiUrl("/api/affiliate/submit-restaurant"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantName: selectedPlaceRequest.restaurantName,
          address: selectedPlaceRequest.address,
          county:
            selectedPlaceRequest.county ||
            selectedPlaceRequest.city ||
            String(resolvedScoutLocation?.label || "Scout request"),
          state: selectedPlaceRequest.state || "Unknown",
          category: scoutSearchQuery.trim() || undefined,
          latitude:
            selectedPlaceRequest.latitude === null
              ? undefined
              : String(selectedPlaceRequest.latitude),
          longitude:
            selectedPlaceRequest.longitude === null
              ? undefined
              : String(selectedPlaceRequest.longitude),
          description: scoutSearchQuery.trim()
            ? `Requested from Scout after no nearby result for "${scoutSearchQuery.trim()}".`
            : "Requested from Scout because local coverage was empty.",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(data?.error || "Request failed"));
      }
      toast({
        description:
          data?.success === false
            ? "That place has already been requested."
            : "Requested. We'll review it for MealScout.",
      });
      setIsPlaceRequestOpen(false);
      setPlaceRequestQuery("");
      setSelectedPlaceRequest(null);
    } catch {
      toast({
        variant: "destructive",
        description: "We couldn't send that request. Please try again.",
      });
    } finally {
      setIsSubmittingPlaceRequest(false);
    }
  }, [
    resolvedScoutLocation?.label,
    scoutSearchQuery,
    selectedPlaceRequest,
    toast,
  ]);

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
            hasDeal: Boolean(t.activeDealCount && t.activ…36798 tokens truncated…null}

      {(laneId === "worth_discovering" || laneId === "late_night") &&
      visibleMoreFoodRestaurants.length > 0 ? (
        <section className={compactRailSectionClass}>
          <SectionHeader
            title={laneMoreTitle}
            linkHref={DISCOVERY_LAYERS.restaurants.href}
            subtitle={moreRailSubtitle}
            itemCount={visibleMoreFoodRestaurants.length}
            onSeeAll={
              onOpenResultsSheet
                ? () =>
                    onOpenResultsSheet({
                      title: laneMoreTitle,
                      subtitle: moreRailSubtitle,
                      items: visibleMoreFoodRestaurants,
                      renderItem: (r) => <SavedRestaurantCard restaurant={r} />,
                      getKey: (r) => String(r.id),
                    })
                : undefined
            }
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
            onSeeAll={
              onOpenResultsSheet
                ? () =>
                    onOpenResultsSheet({
                      title: "Opening Later",
                      subtitle:
                        "Places nearby that are closed right now but worth checking soon.",
                      items: openingLaterRestaurants,
                      renderItem: (r) => <SavedRestaurantCard restaurant={r} />,
                      getKey: (r) => String(r.id),
                    })
                : undefined
            }
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
        aria-label="Today around you picks"
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
        ? "rounded-[1.35rem] bg-[#100806]/84 ring-orange-200/18 hover:bg-[#1a0d07]/92 hover:ring-orange-200/28"
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
      className={`relative flex items-center gap-3 overflow-hidden px-3 py-2.5 text-white ring-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 ${shellClass}`}
    >
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
    ? "Nearby food is quiet right now."
    : laneId === "community"
      ? "No local favorites nearby yet."
      : laneId === "deals"
        ? "No active deals nearby right now."
        : laneId === "food_trucks"
          ? "No food trucks nearby right now."
          : laneId === "events"
            ? "No food events nearby right now."
            : "Nothing nearby yet.";
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
            : "Try another nearby category or widen your area.";

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
        Explore nearby food
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
          Nearby food is quiet right now.
        </p>
        <p className="mt-1 text-xs font-semibold leading-relaxed text-white/58">
          Try Worth Discovering, New Menus, or widen your area.
        </p>
      </div>
    </section>
  );
}

function ScoutPointsBadge({ userId }: { userId: string }) {
  const { data } = useQuery<{
    level: number;
    totalFavorites: number;
    totalStories: number;
  } | null>({
    queryKey: ["/api/stories/reviewer-level", userId],
    queryFn: async () => {
      const res = await fetch(
        `/api/stories/reviewer-level/${encodeURIComponent(userId)}`,
        {
          credentials: "include",
        },
      );
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!data) return null;
  const pts = (data.totalFavorites ?? 0) * 10 + (data.totalStories ?? 0) * 5;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#100c0a]/80 px-2.5 py-1.5 text-[11px] font-black text-amber-300 ring-1 ring-orange-200/30 backdrop-blur-xl shadow-[0_8px_20px_rgba(0,0,0,0.38)]">
      <Flame
        className="h-3 w-3 fill-amber-400 text-amber-400"
        aria-hidden="true"
      />
      {pts} pts
    </span>
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
          {marker.kind === "parking" &&
          (marker.parkedTrucks?.length || 0) > 0 ? (
            <p className="mt-0.5 truncate text-xs font-black text-orange-200/90">
              🚚 {marker.parkedTrucks!.map((t) => t.name).join(", ")}
            </p>
          ) : null}
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
  onOpenResultsSheet,
}: {
  mode: ScoutActivityMode;
  items: LocalActivityItem[];
  onOpenResultsSheet?: (data: ScoutResultsSheetData) => void;
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
        onSeeAll={
          onOpenResultsSheet
            ? () =>
                onOpenResultsSheet({
                  title: getActivityRailTitle(mode),
                  subtitle: getActivityRailSubtitle(mode),
                  items,
                  renderItem: (item: LocalActivityItem) => (
                    <LocalActivityCard item={item} />
                  ),
                  getKey: (item: LocalActivityItem) => String(item.id),
                })
            : undefined
        }
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
  viewModel,
  currentUserId,
  relationshipSnapshot,
}: {
  truck: LiveTruckSummary;
  viewModel?: ScoutResultViewModel;
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
  const cardView = viewModel || buildTruckResultViewModel(truck);
  const heroImage = cardView.imageUrl;
  const cardTitle = cardView.title;
  const cardHref = cardView.href;
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
      href={cardHref}
      className="group relative block overflow-hidden rounded-xl bg-[#100806]/90 ring-1 ring-orange-200/20 transition duration-200 hover:-translate-y-0.5 hover:ring-emerald-200/32 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70"
      aria-label={`Open ${cardTitle}`}
      style={{
        boxShadow:
          "0 14px 36px rgba(0,0,0,0.48), inset 0 0 0 1px rgba(251,146,60,0.05)",
      }}
    >
      <div className="relative aspect-[16/11] w-full bg-[#120805]/60">
        <ScoutCardMedia
          imageUrl={heroImage || null}
          imageObjectPosition={cardView.imageObjectPosition}
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
        <ScoutNetworkScopeBadge label={cardView.scopeLabel} />
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
              {cardTitle}
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
  viewModel,
  currentUserId,
}: {
  deal: DealSummary;
  viewModel?: ScoutResultViewModel;
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
  const cardView = viewModel || buildDealResultViewModel(deal);
  const cardTitle = cardView.title;
  const cardHref = cardView.href;

  return (
    <Link
      href={cardHref}
      className="block overflow-hidden rounded-[1.05rem] bg-[#12200f]/82 ring-1 ring-lime-200/20 transition duration-200 hover:-translate-y-0.5 hover:ring-lime-200/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/70"
      style={{ boxShadow: "0 14px 36px rgba(0,0,0,0.5)" }}
      aria-label={`Open deal ${cardTitle}`}
    >
      <div className="relative aspect-[4/5] w-full bg-[#120805]/60">
        <ScoutCardMedia
          imageUrl={cardView.imageUrl}
          imageObjectPosition={cardView.imageObjectPosition}
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
        <ScoutNetworkScopeBadge
          label={cardView.scopeLabel}
          position="top-right"
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
            {cardTitle}
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
  viewModel,
  position,
  currentUserId,
}: {
  item: LocalMenuItemFeedItem;
  viewModel?: ScoutResultViewModel;
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
  const userInterestCuisines = useFavoriteCuisineInterests(currentUserId);
  const displayCategory = pickDisplayCategory(
    item.cuisineType,
    userInterestCuisines,
    String(item.restaurantId || item.id),
  );
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
  const cardView = viewModel || buildMenuItemResultViewModel(item);
  const cardTitle = cardView.title;
  const cardHref = cardView.href;

  const [isRecommendDialogOpen, setIsRecommendDialogOpen] = useState(false);
  const [recommendComment, setRecommendComment] = useState("");
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
    photo?: File | null;
  }) => {
    const formData = new FormData();
    formData.append("comment", opts.comment ?? "");
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
      href={cardHref}
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
      className="block overflow-hidden rounded-xl bg-[#170d08]/92 ring-1 ring-orange-100/18 transition duration-200 hover:-translate-y-0.5 hover:ring-orange-200/36 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      style={{ boxShadow: "0 12px 28px rgba(0,0,0,0.38)" }}
      aria-label={`Open ${cardTitle} from ${item.restaurantName || "local menu"}`}
      data-testid="scout-local-menu-item-card"
    >
      <div className="relative aspect-[4/3] bg-[#120805]/70">
        <ScoutCardMedia
          imageUrl={cardView.imageUrl}
          imageObjectPosition={cardView.imageObjectPosition}
          fallbackIcon={
            <Utensils className="h-5 w-5 text-white/80" aria-hidden="true" />
          }
          fallbackTestId="scout-local-menu-item-card-image-fallback"
          imageClassName="absolute inset-0 h-full w-full object-cover"
          fallbackClassName="bg-[linear-gradient(150deg,#fb923c_0%,#ea580c_45%,#9a3412_100%)]"
          categoryPhoto={getDishCategoryPhoto(item.name, item.description)}
        />
        <ScoutNetworkScopeBadge label={cardView.scopeLabel} />
        <div className="absolute inset-0 bg-gradient-to-b from-black/8 via-transparent to-black/58" />
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-orange-300 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-[#1a0d08]">
          <Utensils className="h-3 w-3" aria-hidden="true" />
          Dish
        </span>
        {price && (
          <span className="absolute right-2 top-2 rounded-md bg-[#120805]/86 px-2 py-0.5 text-[11px] font-black text-orange-100 ring-1 ring-orange-300/24">
            {price}
          </span>
        )}
      </div>
      <div className="px-3 pb-3 pt-2.5">
        <p className="line-clamp-2 min-h-[2.25rem] text-sm font-bold leading-tight text-white">
          {cardTitle}
        </p>
        <p className="mt-1 truncate text-xs font-semibold text-orange-200/82">
          {item.restaurantName || "Local spot"}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-white/48">
          {displayCategory && <span>{displayCategory}</span>}
          {distLabel && <span>{distLabel}</span>}
        </div>
        {item.description && (
          <p className="mt-2 line-clamp-2 text-xs leading-snug text-white/62">
            {item.description}
          </p>
        )}
        <OwnerOperationalActions actions={actions} />
        <div className="mt-2">
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
            <Heart
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
  viewModel,
  currentUserId,
}: {
  event: EventSummary;
  viewModel?: ScoutResultViewModel;
  currentUserId?: string | null;
}) {
  const cardView = viewModel || buildEventResultViewModel(event);
  const title = cardView.title;
  const venue = event.venueName || event.locationName || "";
  const start = event.startsAt || event.startTime;
  const startLabel = start
    ? new Date(start).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const img = cardView.imageUrl;
  const cardHref = cardView.href;
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
      href={cardHref}
      className="block overflow-hidden rounded-[1.2rem] bg-[#0d1724]/82 ring-1 ring-sky-200/20 transition duration-200 hover:-translate-y-0.5 hover:ring-sky-200/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70"
      style={{ boxShadow: "0 16px 42px rgba(0,0,0,0.5)" }}
      aria-label={`Open event ${title}`}
    >
      <div className="relative aspect-[4/5] w-full bg-[#120805]/60">
        <ScoutCardMedia
          imageUrl={img || null}
          imageObjectPosition={cardView.imageObjectPosition}
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
        <ScoutNetworkScopeBadge
          label={cardView.scopeLabel}
          position="top-right"
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
  viewModel,
  menuPreview = [],
  isSignedIn,
  currentUserId,
  relationshipSnapshot,
}: {
  restaurant: RestaurantSummary;
  viewModel?: ScoutResultViewModel;
  menuPreview?: MenuPreviewItem[];
  isSignedIn: boolean;
  currentUserId?: string | null;
  relationshipSnapshot: RestaurantRelationshipSnapshot;
}) {
  const cardView = viewModel || buildRestaurantResultViewModel(restaurant);
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
  const profileHref = cardView.href;
  const name = cardView.title || canonicalLabel;
  const img = cardView.imageUrl;
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
    ? "group relative block overflow-hidden rounded-xl bg-[#170d08]/92 ring-1 ring-orange-100/18 transition duration-200 hover:-translate-y-0.5 hover:ring-orange-200/36 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
    : "group block overflow-hidden rounded-xl bg-[#0d1713]/88 ring-1 ring-emerald-100/16 transition duration-200 hover:-translate-y-0.5 hover:ring-emerald-200/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70";
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
      // saved by the time the context card opens. Closing it without adding
      // details keeps the recommendation.
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
  const [restaurantRecommendPhoto, setRestaurantRecommendPhoto] =
    useState<File | null>(null);
  const [restaurantRecommendScores, setRestaurantRecommendScores] = useState({
    food: 80,
    value: 75,
    speed: 75,
    vibe: 75,
  });
  const [isSubmittingRestaurantRecommend, setIsSubmittingRestaurantRecommend] =
    useState(false);

  const submitRestaurantRecommendationDetails = async () => {
    setIsSubmittingRestaurantRecommend(true);
    try {
      const formData = new FormData();
      formData.append("comment", restaurantRecommendComment.trim());
      formData.append("scores", JSON.stringify(restaurantRecommendScores));
      if (restaurantRecommendPhoto) {
        formData.append("image", restaurantRecommendPhoto);
      }
      const response = await fetch(
        `/api/restaurants/${encodeURIComponent(restaurantId)}/recommend`,
        {
          method: "POST",
          credentials: "include",
          body: formData,
        },
      );
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
      setRestaurantRecommendPhoto(null);
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
      style={{ boxShadow: "0 12px 28px rgba(0,0,0,0.38)" }}
      data-testid="scout-restaurant-card"
    >
      {/* Image */}
      <div className="relative aspect-[4/3] w-full bg-[#120805]/60">
        <ScoutCardMedia
          imageUrl={img || null}
          imageObjectPosition={cardView.imageObjectPosition}
          fallbackIcon={placeIcon}
          fallbackTestId="scout-nearby-restaurant-card-image-fallback"
          imageClassName="absolute inset-0 h-full w-full object-cover"
          categoryPhoto={getDishCategoryPhoto(name, cuisine)}
        />
        <ScoutNetworkScopeBadge label={cardView.scopeLabel} />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.62))",
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
          className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${labelPillClass}`}
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
            ? "px-3 pb-3 pt-2.5"
            : "px-3 pb-3 pt-2.5"
        }
      >
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 line-clamp-2 min-h-[2.25rem] text-sm font-bold leading-tight text-white">
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
        <div className="mt-1 flex items-center gap-1.5 overflow-hidden text-[11px]">
          {cuisine && (
            <span
              className={`${isFoodTruckEntity ? "text-orange-300/80" : "text-emerald-200/76"} truncate`}
            >
              {cuisine}
            </span>
          )}
          {cuisine && (location || distLabel) && (
            <span className="text-white/30 text-[11px]">·</span>
          )}
          {location && (
            <span className="truncate text-white/55">
              {location}
            </span>
          )}
          {distLabel && (
            <>
              <span className="text-white/30 text-[11px]">·</span>
              <span className="shrink-0 text-white/50">{distLabel}</span>
            </>
          )}
        </div>
        {menuPreview.length > 0 && (
          <div
            className="mt-2 flex items-center gap-2 rounded-lg bg-white/[0.04] p-1.5"
            data-testid="scout-menu-preview"
          >
            <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-md">
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
            {/* Single entry point: a bare tap saves the shallow recommend.
                Tapping again opens optional context, with no duplicate actions. */}
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
              Add context if you want. Closing keeps your recommendation saved.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={restaurantRecommendComment}
            onChange={(event) =>
              setRestaurantRecommendComment(event.target.value)
            }
            placeholder="What makes this place worth it? (optional)"
            className="min-h-[72px] w-full rounded border border-[color:var(--border-subtle)] bg-black/20 px-2 py-1.5 text-sm"
          />
          <input
            type="file"
            accept="image/*"
            onChange={(event) =>
              setRestaurantRecommendPhoto(event.target.files?.[0] || null)
            }
            className="text-xs"
          />
          <div className="space-y-3">
            {(
              [
                ["food", "Food"],
                ["value", "Value"],
                ["speed", "Speed"],
                ["vibe", "Vibe"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block space-y-1">
                <span className="flex items-center justify-between text-xs font-semibold text-[color:var(--text-muted)]">
                  <span>{label}</span>
                  <span>{restaurantRecommendScores[key]}</span>
                </span>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={restaurantRecommendScores[key]}
                  onChange={(event) =>
                    setRestaurantRecommendScores((current) => ({
                      ...current,
                      [key]: Number(event.target.value),
                    }))
                  }
                  className="w-full accent-orange-400"
                />
              </label>
            ))}
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
    ? "relative block overflow-hidden rounded-xl bg-[#100806]/86 ring-1 ring-orange-200/18 transition hover:bg-[#1a0d07]/92 hover:ring-orange-200/28 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
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
      <div
        className="relative h-24 bg-[#120805]/50"
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
            ? "border-t border-orange-200/10 bg-[#190b06]/90 px-3 py-3"
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
      className="absolute left-4 right-4 bottom-[calc(env(safe-area-inset-bottom)+7.25rem)] z-30 rounded-3xl bg-[#120805]/88 p-4 text-white ring-1 ring-orange-300/40 backdrop-blur-xl"
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
          className="inline-flex flex-col items-center justify-center gap-1 rounded-2xl bg-white/8 px-2 py-3 text-center text-xs font-black text-white ring-1 ring-white/10"
        >
          <Flame className="h-4 w-4 text-orange-300" aria-hidden="true" />
          Profile
        </Link>
        <Link
          href={`${getTruckProfilePath(truck)}?message=1`}
          className="inline-flex flex-col items-center justify-center gap-1 rounded-2xl bg-white/8 px-2 py-3 text-center text-xs font-black text-white ring-1 ring-white/10"
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
        className="absolute left-3 right-3 bottom-[calc(env(safe-area-inset-bottom)+7.25rem)] z-30 rounded-2xl bg-[#1b1008]/94 p-3 text-white ring-1 ring-amber-300/45 backdrop-blur-xl"
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
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white/8 px-3 text-center text-xs font-black text-white ring-1 ring-white/10"
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
      className="absolute left-4 right-4 bottom-[calc(env(safe-area-inset-bottom)+7.25rem)] z-30 rounded-3xl bg-[#120805]/88 p-4 text-white ring-1 ring-orange-300/40 backdrop-blur-xl"
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
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white/8 px-3 py-3 text-center text-xs font-black text-white ring-1 ring-white/10"
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
      ? { label: "Food trucks", value: truckCount, className: "bg-orange-300" }
      : null,
    restaurantCount > 0
      ? { label: "Open places", value: restaurantCount, className: "bg-emerald-300" }
      : null,
    dealCount > 0
      ? { label: "Deals", value: dealCount, className: "bg-lime-300" }
      : null,
    eventCount > 0
      ? { label: "Events", value: eventCount, className: "bg-amber-300" }
      : null,
  ].filter(
    (item): item is { label: string; value: number; className: string } =>
      Boolean(item),
  );

  if (pips.length === 0) return null;

  return (
    <div
      aria-label="Nearby discovery summary"
      data-testid="map-discovery-summary"
      className={[
        "pointer-events-none absolute left-3 top-14 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap",
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
                  ? "bg-white/14 text-white ring-1 ring-white/20"
                  : "bg-transparent text-white/48 hover:bg-white/8 hover:text-white/76",
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
      : "No nearby spots yet - pan the map or widen radius";

  return (
    <div className="pointer-events-none absolute left-3 right-3 top-[calc(env(safe-area-inset-top)+4.25rem)] z-20 sm:left-4 sm:right-auto sm:w-[360px]">
      <div
        className="pointer-events-auto rounded-2xl bg-[#120805]/88 p-3 text-white ring-1 ring-orange-200/40 backdrop-blur-xl"
        style={{
          boxShadow:
            "0 18px 54px rgba(0,0,0,0.52), 0 0 26px rgba(255,90,47,0.2)",
        }}
      >
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
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
                Local food nearby
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
            <p className="text-[11px] font-semibold text-white/58">
              {sceneLine}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded((value) => !value)}
              className="rounded-full bg-white/8 px-3 py-2 text-xs font-black text-orange-100 ring-1 ring-orange-200/20 transition-colors hover:bg-white/12"
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
            <p className="text-xs text-white/62">
              Tap nearby spots to jump into what's cooking near you right
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

        <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-white/7 px-3 py-2 ring-1 ring-orange-200/10">
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
          <div className="mt-3 rounded-2xl bg-white/7 px-3 py-2 text-xs text-white/72 ring-1 ring-white/10">
            No nearby spots right here yet. Pan the map or widen discovery from
            the picks below.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MapHudCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/7 px-2 py-2 ring-1 ring-white/10">
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
  viewModel,
  onSelect,
  currentUserId,
}: {
  truck: LiveTruckSummary;
  viewModel?: ScoutResultViewModel;
  onSelect?: (truck: LiveTruckSummary) => void;
  currentUserId?: string | null;
}) {
  const cardView = viewModel || buildTruckResultViewModel(truck);
  const name = cardView.title || "Food Truck";
  const cuisine = truck.cuisineType ?? null;
  const img = cardView.imageUrl;
  const cardHref = cardView.href;

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
      href={cardHref}
      onClick={(event) => {
        if (!onSelect) return;
        event.preventDefault();
        onSelect(truck);
      }}
      className="relative block overflow-hidden rounded-xl bg-[#100806]/88 ring-1 ring-orange-200/18 transition duration-200 hover:-translate-y-0.5 hover:ring-orange-200/28 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      style={{
        boxShadow:
          "0 14px 36px rgba(0,0,0,0.46), inset 0 0 0 1px rgba(251,146,60,0.05)",
      }}
    >
      {/* Hero image */}
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-[#120805]/40">
        <ScoutCardMedia
          imageUrl={img || null}
          imageObjectPosition={cardView.imageObjectPosition}
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
        <ScoutNetworkScopeBadge label={cardView.scopeLabel} />
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
