import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
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
  Search,
  Tag,
  TrendingUp,
  Users,
  Utensils,
  User as UserIcon,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import { SEOHead } from "@/components/seo-head";
import { ScoutMapHero } from "@/components/scout/ScoutMapHero";
import { SceneOptionsBar as ScoutSceneOptionsBar } from "@/components/scout/SceneOptionsBar";
import { ActiveScenePanel } from "@/components/scout/ActiveScenePanel";
import { ActiveSceneIntro as ScoutActiveSceneIntro } from "@/components/scout/ActiveSceneIntro";
import { ScoutSearchDock } from "@/components/scout/ScoutSearchDock";
import { ScoutEmptyState as ScoutSceneEmptyState } from "@/components/scout/ScoutEmptyState";
import {
  GoogleMapSurface,
  preloadGoogleMapsScript,
} from "@/components/maps/google-map-surface";
import { MapErrorBoundary } from "@/components/maps/map-error-boundary";
import { GOOGLE_MAPS_WEB_API_KEY } from "@/lib/mapProvider";
import type {
  MapAdapterMarker,
  MapBoundsLike,
} from "@/components/maps/map-adapter.types";
import mealScoutIcon from "@assets/meal-scout-icon.png";
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
  latitude?: number | string | null;
  longitude?: number | string | null;
}

type MapLocationsResponse = {
  hostLocations?: ScoutHostLocation[];
  eventLocations?: unknown[];
  supplierLocations?: unknown[];
} | null;
interface RestaurantSummary {
  id: string;
  businessName?: string | null;
  name?: string | null;
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
  cuisineType?: string | null;
  distanceMiles?: number | null;
  dietaryTags?: string[] | null;
  discoveryReasons?: string[] | null;
  discoveryScore?: number | null;
}

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
  { id: "for_you", label: "For You", icon: "spark", cravingId: "something-new" },
  { id: "community", label: "Community", icon: "community", cravingId: "something-new" },
  { id: "nearby_now", label: "Nearby", icon: "nearby", cravingId: "open-now" },
  { id: "food_trucks", label: "Food Trucks", icon: "truck", cravingId: "food-truck" },
  { id: "restaurants", label: "Restaurants", icon: "restaurant", cravingId: "sit-down" },
  { id: "deals", label: "Deals", icon: "deal", cravingId: "deals-today" },
  { id: "events", label: "Events", icon: "event", cravingId: "today" },
  { id: "new_menus", label: "New Menus", icon: "menu", cravingId: "something-new" },
  { id: "late_night", label: "Late Night", icon: "late", cravingId: "open-now" },
  { id: "worth_discovering", label: "Worth Discovering", icon: "discover", cravingId: "something-new" },
];

function getSceneOptionIcon(icon: ScoutSceneLane["icon"]) {
  if (icon === "spark") return <Compass className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "community") return <Users className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "nearby") return <Navigation2 className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "truck") return <Flame className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "restaurant") return <Utensils className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "deal") return <Tag className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "event") return <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "menu") return <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />;
  if (icon === "late") return <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />;
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
    keywords: ["quick", "fast", "lunch", "pickup", "sandwich", "taco", "burger", "truck"],
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
    keywords: ["coffee", "breakfast", "bakery", "biscuit", "bagel", "pastry", "brunch", "taco"],
    image: "/atmospheric/craving-dessert.jpg",
  },
  {
    id: "snack-coffee",
    label: "Snack & coffee",
    query: "coffee snack dessert",
    helper: "A useful reset between meals",
    keywords: ["coffee", "snack", "dessert", "sweet", "bakery", "pastry", "tea"],
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
    keywords: ["dinner", "restaurant", "table", "plate", "meal", "group", "date"],
    image: "/atmospheric/craving-pizza.jpg",
  },
  {
    id: "sweet-tooth",
    label: "Sweet tooth",
    query: "dessert bakery sweets",
    helper: "Dessert, bakeries, and treats",
    keywords: ["dessert", "ice cream", "cake", "pastry", "sweet", "chocolate", "bakery"],
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
  type: "menu_update" | "deal" | "truck" | "event" | "open" | "update";
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
    title: "Top Local Favorites",
    href: "/scout",
    subtitle: "Busy local spots, food trucks, deals, and menu updates near you.",
  },
  cravings: {
    title: "Explore by Craving",
    href: "/search",
    subtitle: "Jump into local food by mood, not by chain category.",
  },
  trending: {
    title: "Trending Nearby",
    href: "/trending",
    subtitle: "What people are visiting, tasting, and sharing in your area.",
  },
  menuItems: {
    title: "New Local Menu Items",
    href: "/search",
    subtitle: "Freshly available dishes from nearby restaurants and trucks.",
  },
  foodTrucks: {
    title: "Trucks Serving Now",
    href: "/truck-discovery",
    subtitle: "Food trucks currently serving nearby.",
  },
  restaurants: {
    title: "Restaurants Open Now",
    href: "/search",
    subtitle: "Restaurants with current open status near you.",
  },
  deals: {
    title: "Deals Today",
    href: "/scout",
    subtitle: "Active offers from nearby restaurants, bars, and food trucks.",
  },
  events: {
    title: "Events Today",
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
  kind?: CravingBoardItem["kind"] | "event" | "restaurant" | "truck" | "deal" | "menu";
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
      if (["true", "open", "serving", "available", "yes"].includes(normalized)) return true;
      if (["false", "closed", "not_open", "unavailable", "no"].includes(normalized)) return false;
    }
  }
  return null;
}

function getCurrentUserId(user: unknown): string | null {
  return readStringField(user, ["id", "userId"]);
}

function isFoodOperator(user: unknown): boolean {
  const userType = readStringField(user, ["userType", "role", "primaryRole"]);
  return userType === "restaurant_owner" || userType === "food_truck";
}

function isOwnedByCurrentUser(entity: unknown, currentUserId?: string | null): boolean {
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
  const explicit = readBooleanField(truck, ["isOpen", "openNow", "currentlyOpen", "isServing", "servingNow", "availableNow"]);
  if (explicit !== null) return explicit;
  return truck.mobileOnline !== false;
}

function getRestaurantOpenState(restaurant: RestaurantSummary): "open" | "closed" | "unknown" {
  const explicit = readBooleanField(restaurant, ["isOpen", "openNow", "currentlyOpen", "isCurrentlyOpen"]);
  if (explicit === true) return "open";
  if (explicit === false) return "closed";
  const status = readStringField(restaurant, ["openStatus", "status", "hoursStatus", "businessStatus"]);
  if (status) {
    const normalized = status.toLowerCase();
    if (normalized.includes("open")) return "open";
    if (normalized.includes("closed") || normalized.includes("not open")) return "closed";
  }
  return "unknown";
}

function getKnownTimestamp(meta: FreshnessMeta): { value: string; type: "updated" | "confirmed" } | null {
  const updated = meta.updatedAt || meta.lastUpdatedAt;
  if (updated) return { value: updated, type: "updated" };
  const confirmed = meta.confirmedAt || meta.lastConfirmedAt;
  if (confirmed) return { value: confirmed, type: "confirmed" };
  return null;
}

function formatFreshnessTime(timestamp: string): { state: FreshnessState; label: string } | null {
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
  if (timestamp) return formatFreshnessTime(timestamp.value)?.state ?? "unknown";
  if (entityOrMeta.isOpen || entityOrMeta.hasDeal || entityOrMeta.hasMenu || isTodayDate(entityOrMeta.startsAt || entityOrMeta.startTime)) {
    return "fresh";
  }
  if (entityOrMeta.hasDistance || entityOrMeta.hasCommunityUpdate) return "unknown";
  return "unknown";
}

function getFreshnessLabel(entityOrMeta: FreshnessMeta): string {
  const timestamp = getKnownTimestamp(entityOrMeta);
  if (timestamp) {
    const formatted = formatFreshnessTime(timestamp.value);
    if (formatted) {
      if (timestamp.type === "confirmed" && formatted.label === "Updated today") return "Confirmed today";
      if (timestamp.type === "confirmed" && formatted.label.startsWith("Updated ")) {
        return formatted.label.replace("Updated", "Confirmed");
      }
      return formatted.label;
    }
  }

  if (entityOrMeta.hasMenu || entityOrMeta.kind === "Menu" || entityOrMeta.kind === "menu") return "Menu updated";
  if (entityOrMeta.hasDeal || entityOrMeta.kind === "Deal" || entityOrMeta.kind === "deal") return "Deal today";
  if (entityOrMeta.kind === "Truck" || entityOrMeta.kind === "truck") return "Serving now";
  if (isTodayDate(entityOrMeta.startsAt || entityOrMeta.startTime)) return "Happening today";
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
  if (entityOrMeta.kind === "Truck" || entityOrMeta.kind === "truck") labels.add("Food truck");
  if (entityOrMeta.hasDeal || entityOrMeta.kind === "Deal" || entityOrMeta.kind === "deal") labels.add("Deal today");
  if (entityOrMeta.hasMenu || entityOrMeta.kind === "Menu" || entityOrMeta.kind === "menu") labels.add("Menu updated");
  if (entityOrMeta.isOpen) labels.add(entityOrMeta.kind === "Truck" || entityOrMeta.kind === "truck" ? "Serving now" : "Open now");
  if (entityOrMeta.hasDistance) labels.add("Nearby");
  if (isTodayDate(entityOrMeta.startsAt || entityOrMeta.startTime)) labels.add("Happening today");
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
  const base = "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1";
  if (getFreshnessState(meta) === "needs_update") {
    return `${base} bg-amber-300/14 text-amber-100 ring-amber-200/20`;
  }
  if (getFreshnessState(meta) === "aging") {
    return `${base} bg-white/8 text-orange-100/78 ring-white/10`;
  }
  return `${base} bg-emerald-300/12 text-emerald-100 ring-emerald-200/18`;
}

function getRestaurantUpdateHref(restaurantId: string, setup: "status" | "location" | "menu" | "deal"): string {
  if (setup === "menu") {
    return `/menu-builder?src=scout&restaurantId=${encodeURIComponent(restaurantId)}`;
  }
  if (setup === "deal") {
    return `/deal-creation?src=scout&restaurantId=${encodeURIComponent(restaurantId)}`;
  }
  return `/restaurant-owner-dashboard?src=scout&setup=${setup}&restaurantId=${encodeURIComponent(restaurantId)}`;
}

function getTruckUpdateHref(truckId: string, setup: "status" | "location" | "menu" | "deal"): string {
  return getRestaurantUpdateHref(truckId, setup);
}

function getMapMarkerColor(meta: FreshnessMeta): string {
  if (meta.kind === "Truck" || meta.kind === "truck") return "#ff6f3c";
  if (meta.hasDeal || meta.kind === "Deal" || meta.kind === "deal") return "#22c55e";
  if (meta.kind === "event") return "#f59e0b";
  if (getFreshnessState(meta) === "fresh") return "#14b8a6";
  return "#f97316";
}

function getMapMarkerSubtitle(base: string | null | undefined, meta: FreshnessMeta): string | undefined {
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
    (servingTruckCount >= 2 && dealCount + eventCount + openRestaurantCount >= 3)
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
    Number(restaurant.videoRecommendationCount || 0) > 0 ? "recent video updates" : null,
    Number(restaurant.recommendationCount || 0) > 0 ? "community updates" : null,
    Number(restaurant.activeDealsCount || restaurant.activeDealCount || 0) > 0 ? "active deal" : null,
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
  const addPick = (items: CravingBoardItem[], pick: CravingBoardItem | null) => {
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
        (b.restaurant.homeRankingScore ?? 0) - (a.restaurant.homeRankingScore ?? 0) ||
        (a.restaurant.distanceMiles ?? 999) - (b.restaurant.distanceMiles ?? 999),
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
      const subtitle = [event.venueName, event.locationName].filter(Boolean).join(" ");
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
      href: `/restaurant/${item.restaurantId}`,
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
      subtitle: restaurant.cuisineType || restaurant.description || "Local restaurant",
      href: `/restaurant/${restaurant.id}`,
      restaurantId: String(restaurant.id),
      imageUrl: getRestaurantImage(restaurant),
      meta: getRestaurantDistance(restaurant) || "Place",
      reason: getRestaurantSearchReason(restaurant),
      freshnessMeta: {
        kind: "restaurant",
        updatedAt: readStringField(restaurant, ["updatedAt", "lastUpdatedAt"]),
        confirmedAt: readStringField(restaurant, ["confirmedAt", "lastConfirmedAt"]),
        hasDeal: Number(restaurant.activeDealsCount || restaurant.activeDealCount || 0) > 0,
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
      href: `/truck/${truck.id}`,
      truckId: String(truck.id),
      imageUrl: getTruckImage(truck),
      meta: [formatDistance(truck), formatWait(truck)].filter(Boolean).join(" / ") || "Serving now",
      reason: "Serving now",
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
      subtitle: [event.venueName || event.locationName, formatEventStartLabel(event)]
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
  restaurants,
}: {
  menuItems: LocalMenuItemFeedItem[];
  deals: DealSummary[];
  liveTrucks: LiveTruckSummary[];
  events: EventSummary[];
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
      subtitle: [item.name, item.restaurantName, distance].filter(Boolean).join(" · "),
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
      subtitle: [deal.title, deal.restaurantName || deal.discountText].filter(Boolean).join(" · "),
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
      title: "Serving now",
      subtitle: [truck.name, truck.cuisineType, distance].filter(Boolean).join(" · "),
      href: `/truck/${truck.id}`,
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
      subtitle: [event.title || event.name, event.venueName || event.locationName, formatEventStartLabel(event)]
        .filter(Boolean)
        .join(" · "),
      href: `/event/${event.id}`,
      entityId: String(event.id),
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
      confirmedAt: readStringField(restaurant, ["confirmedAt", "lastConfirmedAt"]),
      hasDeal: Number(restaurant.activeDealsCount || restaurant.activeDealCount || 0) > 0,
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
      subtitle: [getRestaurantName(restaurant), restaurant.cuisineType, distance].filter(Boolean).join(" · "),
      href: `/restaurant/${restaurant.id}`,
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
  if (raw.includes("hot") || raw.includes("packed")) return { label: "Crowd is Hot" };
  if (raw.includes("busy")) return { label: "Busy Right Now" };
  return { label: "Open & Serving" };
}

function getTruckCoords(truck: LiveTruckSummary): { lat: number; lng: number } | null {
  const lat = truck.latitude ?? truck.lat;
  const lng = truck.longitude ?? truck.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return { lat, lng };
}

function formatTruckPlace(truck: LiveTruckSummary): string {
  return [truck.address, truck.city, truck.state].filter(Boolean).join(", ") || "Nearby location";
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
  return Math.max(MIN_DISCOVERY_RADIUS_KM, Math.min(MAX_DISCOVERY_RADIUS_KM, value));
}

function readDiscoveryRadiusKm(): number {
  if (typeof window === "undefined") return DEFAULT_DISCOVERY_RADIUS_KM;
  const stored = Number(window.localStorage.getItem(DISCOVERY_RADIUS_STORAGE_KEY));
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
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
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
  if (typeof fallbackDistanceKm === "number" && Number.isFinite(fallbackDistanceKm)) {
    return fallbackDistanceKm <= radiusKm;
  }
  return false;
}

function extractMenuPreviewItems(data: any): MenuPreviewItem[] {
  const menus = Array.isArray(data?.menus) ? data.menus : [];
  const items: MenuPreviewItem[] = [];
  const seen = new Set<string>();
  for (const menu of menus) {
    const categoryItems = Array.isArray(menu?.categories)
      ? menu.categories.flatMap((category: any) =>
          Array.isArray(category?.items) ? category.items : [],
        )
      : [];
    const uncategorized = Array.isArray(menu?.uncategorizedItems)
      ? menu.uncategorizedItems
      : [];
    for (const item of [...categoryItems, ...uncategorized]) {
      const id = String(item?.id || "").trim();
      const name = String(item?.name || "").trim();
      if (!id || !name || seen.has(id) || item?.isAvailable === false) continue;
      seen.add(id);
      items.push({
        id,
        name,
        description: item?.description ?? null,
        imageUrl: item?.imageUrl ?? null,
        priceCents:
          typeof item?.priceCents === "number" && Number.isFinite(item.priceCents)
            ? item.priceCents
            : null,
      });
      if (items.length >= 3) return items;
    }
  }
  return items;
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
  const [location, navigate] = useWouterLocation();

  const firstName =
    typeof user?.name === "string" && user.name.trim().length > 0
      ? user.name.trim().split(" ")[0]
      : null;

  /* --------- location --------- */

  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [discoveryRadiusKm, setDiscoveryRadiusKm] = useState<number>(() =>
    readDiscoveryRadiusKm(),
  );
  const [locationName, setLocationName] = useState<string>("Your area");
  const [locationStatus, setLocationStatus] = useState<
    "idle" | "requesting" | "ready" | "denied"
  >("idle");
  const [currentDaypart] = useState<Daypart>(() => getDaypart());
  const [selectedCravingId, setSelectedCravingId] = useState<string>(
    () => DAYPART_DEFAULT_INTENT[getDaypart()],
  );
  const [activeSceneLaneId, setActiveSceneLaneId] = useState<ScoutSceneLaneId>("for_you");
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
  const normalizedUserType = String(userType || "").trim().toLowerCase();
  const userRoles = useMemo(() => {
    const roles = new Set<string>();
    const rawRoles = (user as { roles?: unknown } | null | undefined)?.roles;
    if (Array.isArray(rawRoles)) {
      rawRoles.forEach((role) => {
        const normalized = String(role || "").trim().toLowerCase();
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
  const scoutPreviewCity = useMemo(() => {
    const query = location.includes("?") ? location.slice(location.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);
    const raw = (params.get("scoutPreview") || params.get("previewCity") || "").trim().toLowerCase();
    return raw;
  }, [location]);
  const isPensacolaScoutPreview = isScoutPreviewEligible && scoutPreviewCity === "pensacola";
  const previewCoords = useMemo(
    () => (isPensacolaScoutPreview ? { lat: 30.4213, lng: -87.2169 } : null),
    [isPensacolaScoutPreview],
  );
  const resolvedScoutLocation = useMemo(
    () =>
      coords
        ? {
            label: locationName || "Your area",
            lat: coords.lat,
            lng: coords.lng,
          }
        : null,
    [coords, locationName],
  );
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

  useEffect(() => {
    if (!isPensacolaScoutPreview || !previewCoords) return;
    setCoords(previewCoords);
    setLocationName("Pensacola");
    setLocationStatus("ready");
    setMapCenter(previewCoords);
  }, [isPensacolaScoutPreview, previewCoords]);

  const requestLocation = useCallback(() => {
    if (isPensacolaScoutPreview && previewCoords) {
      setCoords(previewCoords);
      setLocationName("Pensacola");
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
        setCoords({ lat: latitude, lng: longitude });
        setLocationStatus("ready");
        getReverseGeocodedLocationName(latitude, longitude, (name) => {
          if (name) setLocationName(name);
        }).catch(() => {});
      },
      () => {
        setLocationStatus("denied");
      },
      { timeout: 10000, maximumAge: 0 },
    );
  }, [isPensacolaScoutPreview, previewCoords]);

  // Auto-request on mount
  useEffect(() => {
    requestLocation();
  }, [requestLocation]);

  const updateDiscoveryRadiusKm = useCallback((value: number) => {
    const nextRadius = clampDiscoveryRadiusKm(value);
    setDiscoveryRadiusKm(nextRadius);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DISCOVERY_RADIUS_STORAGE_KEY, String(nextRadius));
    }
  }, []);

  const shortLocation = useMemo(() => {
    if (!locationName) return "Your area";
    return locationName.split(",")[0] || locationName;
  }, [locationName]);

  const hasResolvedLocation = useMemo(() => {
    const trimmed = (locationName || "").trim();
    return trimmed.length > 0 && trimmed.toLowerCase() !== "your area";
  }, [locationName]);

  /* --------- trucks --------- */

  const {
    data: liveTrucksData,
    isLoading: liveTrucksLoading,
    isError: liveTrucksError,
  } = useQuery<LiveTrucksResponse>({
    queryKey: resolvedScoutLocation
      ? ["/api/trucks/live", resolvedScoutLocation.lat, resolvedScoutLocation.lng, discoveryRadiusKm]
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
      const response = await fetch(`/api/map/locations?${params.toString()}`, {
        credentials: "include",
      });
      recordScoutSourceStatus("mapLocations", response.status);
      if (!response.ok) return { hostLocations: [] };
      return response.json();
    },
    staleTime: 45_000,
    retry: false,
  });

  const visibleHosts = useMemo<ScoutHostLocation[]>(() => {
    const rows = Array.isArray(mapLocationsData?.hostLocations)
      ? mapLocationsData.hostLocations
      : [];
    return rows.filter((host) =>
      isWithinScoutRadius(
        resolvedScoutCoords,
        readNumberField(host, ["latitude", "lat"]),
        readNumberField(host, ["longitude", "lng"]),
        discoveryRadiusKm,
      ),
    );
  }, [discoveryRadiusKm, mapLocationsData, resolvedScoutCoords]);

  /* --------- nearby restaurants --------- */

  const { data: nearbyRestaurantsData, isLoading: nearbyRestaurantsLoading } = useQuery<RestaurantSummary[]>({
    queryKey: resolvedScoutLocation
      ? ["/api/restaurants/subscribed", resolvedScoutLocation.lat, resolvedScoutLocation.lng, discoveryRadiusKm]
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

  const nearbyRestaurants = useMemo<RestaurantSummary[]>(() => {
    if (!nearbyRestaurantsData) return [];
    if (!Array.isArray(nearbyRestaurantsData)) return [];
    return nearbyRestaurantsData.filter((restaurant) => {
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
  }, [resolvedScoutCoords, discoveryRadiusKm, nearbyRestaurantsData]);

  const restaurantMenuPreviewQueries = useQueries({
    queries: nearbyRestaurants.slice(0, 8).map((restaurant) => ({
      queryKey: ["/api/menus", restaurant.id, "scout-preview"],
      queryFn: async () => {
        const response = await fetch(
          `/api/menus/${encodeURIComponent(String(restaurant.id))}`,
          { credentials: "include" },
        );
        if (!response.ok) return [];
        const data = await response.json();
        return extractMenuPreviewItems(data);
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
      ? ["/api/menus/local-items", resolvedScoutLocation.lat, resolvedScoutLocation.lng, discoveryRadiusKm]
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

  const restaurantRelationships = useMemo<RestaurantRelationshipSnapshot>(() => {
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
      ? ["/api/deals/nearby", resolvedScoutLocation.lat, resolvedScoutLocation.lng, discoveryRadiusKm]
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
      if (!seen.has(d.id)) { seen.add(d.id); merged.push(d); }
    }
    return merged;
  }, [nearbyDeals]);

  const fallbackTruckBusinesses = useMemo<LiveTruckSummary[]>(
    () =>
      nearbyRestaurants
        .filter((restaurant) =>
          readBooleanField(restaurant, ["isFoodTruck", "foodTruck", "isTruck"]) === true,
        )
        .map((restaurant) => ({
          id: String(restaurant.id),
          name: getRestaurantName(restaurant),
          cuisineType: restaurant.cuisineType ?? null,
          imageUrl:
            restaurant.imageUrl ?? restaurant.coverImageUrl ?? restaurant.heroImageUrl ?? restaurant.logoUrl ?? null,
          coverImageUrl: restaurant.coverImageUrl ?? restaurant.heroImageUrl ?? restaurant.imageUrl ?? null,
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
          activeDealCount: Number(restaurant.activeDealsCount || restaurant.activeDealCount || 0),
        })),
    [nearbyRestaurants],
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
          subtitle: getMapMarkerSubtitle(e.venueName ?? e.locationName, freshnessMeta),
          color: getMapMarkerColor(freshnessMeta),
        } as MapAdapterMarker;
      })
      .filter((m): m is MapAdapterMarker => m !== null);
  }, [visibleEvents]);

  const hostMarkers = useMemo<MapAdapterMarker[]>(() => {
    return visibleHosts
      .map((host) => {
        const lat = readNumberField(host, ["latitude", "lat"]);
        const lng = readNumberField(host, ["longitude", "lng"]);
        if (lat === null || lng === null) return null;
        return {
          id: `host-${host.hostId || host.id}`,
          sourceId: String(host.hostId || host.id || ""),
          kind: "parking" as const,
          lat,
          lng,
          title: host.businessName || host.name || "Host location",
          subtitle: getMapMarkerSubtitle("Host", {
            kind: "event",
            updatedAt: readStringField(host, ["updatedAt", "lastUpdatedAt"]),
            confirmedAt: readStringField(host, ["confirmedAt", "lastConfirmedAt"]),
          }),
          color: "#f59e0b",
        } as MapAdapterMarker;
      })
      .filter((m): m is MapAdapterMarker => Boolean(m && m.sourceId));
  }, [visibleHosts]);

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
    () => [...truckMarkers, ...restaurantMarkers, ...eventMarkers, ...hostMarkers, ...dealMarkers],
    [truckMarkers, restaurantMarkers, eventMarkers, hostMarkers, dealMarkers],
  );

  const scoutDebugCounts = useMemo(() => {
    const rawLiveTruckRows = Array.isArray(liveTrucksData)
      ? liveTrucksData
      : Array.isArray(liveTrucksData?.trucks)
        ? liveTrucksData.trucks
        : [];
    const rawRestaurantRows = Array.isArray(nearbyRestaurantsData) ? nearbyRestaurantsData : [];
    const rawHostRows = Array.isArray(mapLocationsData?.hostLocations) ? mapLocationsData.hostLocations : [];
    const rawEventRows = Array.isArray(events) ? events : [];
    const rawDealRows = Array.isArray(nearbyDeals) ? nearbyDeals : [];

    const hasCoords = (row: unknown) =>
      readNumberField(row, ["latitude", "lat", "venueLat", "restaurantLatitude", "locationLat"]) !== null &&
      readNumberField(row, ["longitude", "lng", "venueLng", "restaurantLongitude", "locationLng"]) !== null;

    const pinsByKind = allMapMarkers.reduce<Record<string, number>>((acc, marker) => {
      acc[marker.kind] = (acc[marker.kind] || 0) + 1;
      return acc;
    }, {});

    return {
      trucksReturned: rawLiveTruckRows.length,
      trucksMissingCoords: rawLiveTruckRows.filter((row) => !hasCoords(row)).length,
      trucksShown: scoutTruckInventory.length,
      restaurantsReturned: rawRestaurantRows.length,
      restaurantsMissingCoords: rawRestaurantRows.filter((row) => !hasCoords(row)).length,
      hostsReturned: rawHostRows.length,
      hostsMissingCoords: rawHostRows.filter((row) => !hasCoords(row)).length,
      hostsShown: visibleHosts.length,
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
    visibleHosts.length,
  ]);

  const [activeMapLayers, setActiveMapLayers] = useState<MapLayerState>({
    openNow: true,
    foodTrucks: true,
    deals: true,
    happeningToday: true,
  });

  const filteredMapMarkers = useMemo<MapAdapterMarker[]>(() => {
    return allMapMarkers.filter((marker) => {
      if (marker.kind === "truck") return activeMapLayers.foodTrucks && activeMapLayers.openNow;
      if (marker.kind === "event") return activeMapLayers.happeningToday;
      if (marker.kind === "parking") return activeMapLayers.happeningToday;
      if (marker.kind === "deal") return activeMapLayers.deals;
      if (marker.kind === "restaurant") {
        const restaurant = nearbyRestaurants.find((item) => String(item.id) === String(marker.sourceId));
        const hasDeal = Boolean(
          restaurant &&
            Number(restaurant.activeDealsCount || restaurant.activeDealCount || 0) > 0,
        );
        if (hasDeal && !activeMapLayers.deals) return false;
        return activeMapLayers.openNow || (hasDeal && activeMapLayers.deals);
      }
      return true;
    });
  }, [activeMapLayers, allMapMarkers, nearbyRestaurants]);

  const sceneFilteredMapMarkers = useMemo<MapAdapterMarker[]>(() => {
    if (activeSceneLaneId === "for_you") return filteredMapMarkers;
    if (activeSceneLaneId === "community")
      return filteredMapMarkers.filter((marker) => marker.kind === "restaurant" || marker.kind === "truck" || marker.kind === "parking");
    if (activeSceneLaneId === "nearby_now")
      return filteredMapMarkers.filter((marker) => marker.kind === "truck" || marker.kind === "restaurant" || marker.kind === "parking");
    if (activeSceneLaneId === "food_trucks")
      return filteredMapMarkers.filter((marker) => marker.kind === "truck");
    if (activeSceneLaneId === "restaurants")
      return filteredMapMarkers.filter((marker) => marker.kind === "restaurant");
    if (activeSceneLaneId === "deals")
      return filteredMapMarkers.filter((marker) => marker.kind === "restaurant" || marker.kind === "deal");
    if (activeSceneLaneId === "events")
      return filteredMapMarkers.filter((marker) => marker.kind === "event" || marker.kind === "parking");
    if (activeSceneLaneId === "new_menus")
      return filteredMapMarkers.filter((marker) => marker.kind === "restaurant" || marker.kind === "truck");
    if (activeSceneLaneId === "late_night")
      return filteredMapMarkers.filter((marker) => marker.kind === "restaurant" || marker.kind === "event" || marker.kind === "parking");
    if (activeSceneLaneId === "worth_discovering")
      return filteredMapMarkers.filter((marker) => marker.kind === "restaurant" || marker.kind === "truck");
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
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const userPushedMapRef = useRef(false);
  const [sheetState, setSheetState] = useState<"default" | "fullMap">("default");
  const [selectedLiveTruck, setSelectedLiveTruck] = useState<LiveTruckSummary | null>(null);
  const [selectedMapMarker, setSelectedMapMarker] = useState<MapAdapterMarker | null>(null);
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
  const effectiveGoogleMapsApiKey = runtimeGoogleMapsApiKey ||
    (mapRuntimeResolved ? GOOGLE_MAPS_WEB_API_KEY : "");
  const effectiveGoogleMapsMapId =
    runtimeGoogleMapsMapId || buildGoogleMapsMapId;
  const hasMapKey = effectiveGoogleMapsApiKey.length > 0;

  const openScoutMap = useCallback(() => {
    if (coords) {
      setMapCenter(coords);
    }
    setHasOpenedFullMap(true);
    setGoogleMapFailed(false);
    setSheetState("fullMap");
  }, [coords]);

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
    if (!coords || userPushedMapRef.current) return;
    setMapCenter(shiftCenterForRightQuadrant(coords.lat, coords.lng, HERO_ZOOM));
  }, [coords]);

  const handleMapBoundsChanged = useCallback((bounds: MapBoundsLike) => {
    setMapBounds(bounds);
  }, []);
  const handleMapZoomChanged = useCallback((z: number) => {
    setMapZoom(z);
    userPushedMapRef.current = true;
  }, []);
  const handleMapCenterChanged = useCallback((c: { lat: number; lng: number }) => {
    setMapCenter(c);
    userPushedMapRef.current = true;
  }, []);
  const selectLiveTruck = useCallback(
    (truck: LiveTruckSummary) => {
      const truckCoords = getTruckCoords(truck);
      setSelectedLiveTruck(truck);
      if (truckCoords) {
        setMapCenter(truckCoords);
        setMapZoom(16);
      } else if (coords) {
        setMapCenter(coords);
      }
      setHasOpenedFullMap(true);
      setGoogleMapFailed(false);
      setSheetState("fullMap");
    },
    [coords],
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
      }
      else if (marker.kind === "restaurant" || marker.kind === "event" || marker.kind === "parking" || marker.kind === "deal") {
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
    document.body.classList.toggle("mealscout-map-fullscreen", sheetState === "fullMap");
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
  const trucksServingNow = useMemo(
    () => scoutTruckInventory.filter(isTruckServingNow),
    [scoutTruckInventory],
  );
  const trucksNearByStatus = useMemo(
    () => scoutTruckInventory.filter((truck) => !isTruckServingNow(truck)),
    [scoutTruckInventory],
  );
  const restaurantsOpenNow = useMemo(
    () => nearbyRestaurants.filter((restaurant) => getRestaurantOpenState(restaurant) === "open"),
    [nearbyRestaurants],
  );
  const moreFoodRestaurants = useMemo(
    () => nearbyRestaurants.filter((restaurant) => getRestaurantOpenState(restaurant) !== "open"),
    [nearbyRestaurants],
  );

  const showFoodTrucksSection =
    liveTrucksLoading || trucksServingNow.length > 0 || trucksNearByStatus.length > 0;
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
    scoutTruckInventory.length +
    localMenuItems.length +
    nearbyRestaurants.length +
    allDeals.length +
    visibleEvents.length +
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
        menuItems: localMenuItems,
        deals: allDeals,
        events: visibleEvents,
      }),
    [allDeals, localMenuItems, restaurantsOpenNow, selectedCraving, trucksServingNow, visibleEvents],
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
      return items.filter((item) => item.kind === "Truck" || item.kind === "Deal").slice(0, 7);
    }
    if (activeSceneLaneId === "restaurants") {
      return items.filter((item) => item.kind === "Place" || item.kind === "Menu").slice(0, 7);
    }
    if (activeSceneLaneId === "deals") {
      return items.filter((item) => item.kind === "Deal" || item.kind === "Place").slice(0, 7);
    }
    if (activeSceneLaneId === "events") {
      return items.filter((item) => item.kind === "Event" || item.kind === "Place").slice(0, 7);
    }
    if (activeSceneLaneId === "new_menus") {
      return items.filter((item) => item.kind === "Menu" || item.kind === "Place").slice(0, 7);
    }
    if (activeSceneLaneId === "worth_discovering") {
      return items.filter((item) => item.kind === "Place" || item.kind === "Truck").slice(0, 7);
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
        menuItems: localMenuItems,
        deals: allDeals,
        liveTrucks: trucksServingNow,
        events: visibleEvents,
        restaurants: restaurantsOpenNow,
      }),
    [allDeals, localMenuItems, restaurantsOpenNow, trucksServingNow, visibleEvents],
  );
  const scoutActivityMode = useMemo(
    () =>
      getScoutActivityMode({
        servingTruckCount: trucksServingNow.length,
        openRestaurantCount: restaurantsOpenNow.length,
        dealCount: allDeals.length,
        eventCount: visibleEvents.length,
        menuUpdateCount: localMenuItems.length,
        activityItemCount: localActivityItems.length,
        mapMarkerCount: sceneFilteredMapMarkers.filter((marker) => marker.kind !== "user").length,
      }),
    [
      allDeals.length,
      sceneFilteredMapMarkers,
      localActivityItems.length,
      localMenuItems.length,
      restaurantsOpenNow.length,
      trucksServingNow.length,
      visibleEvents.length,
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
  }, [
    scoutDebugCounts,
    sceneFilteredMapMarkers.length,
    showScoutPreviewDebug,
  ]);
  const visibleLocalActivityItems = useMemo(() => {
    const uniqueKeys = new Set<string>();
    const uniqueItems = localActivityItems.filter((item) => {
      const key = getRestaurantIdFromActivity(item) || `${item.type}-${item.entityId}`;
      if (uniqueKeys.has(key)) return false;
      uniqueKeys.add(key);
      return true;
    });
    return uniqueItems.length >= 2 && scoutActivityMode !== "low_activity" ? uniqueItems : [];
  }, [localActivityItems, scoutActivityMode]);
  const localActivityRestaurantIds = useMemo(() => {
    return new Set(
      visibleLocalActivityItems
        .map(getRestaurantIdFromActivity)
        .filter((id): id is string => Boolean(id)),
    );
  }, [visibleLocalActivityItems]);
  const visibleOpenRestaurants = useMemo(() => {
    const filtered = restaurantsOpenNow.filter(
      (restaurant) =>
        !localActivityRestaurantIds.has(String(restaurant.id)) &&
        !featuredRestaurantIds.has(String(restaurant.id)),
    );
    return filtered.length > 0 ? filtered : restaurantsOpenNow;
  }, [featuredRestaurantIds, localActivityRestaurantIds, restaurantsOpenNow]);
  const visibleTrucksServingNow = useMemo(() => {
    const filtered = trucksServingNow.filter(
      (truck) => !featuredTruckIds.has(String(truck.id)),
    );
    if (filtered.length > 0) return filtered;
    if (trucksServingNow.length > 0) return trucksServingNow;
    return trucksNearByStatus;
  }, [featuredTruckIds, trucksNearByStatus, trucksServingNow]);
  const visibleDeals = useMemo(() => {
    const filtered = allDeals.filter((deal) => !featuredDealIds.has(String(deal.id)));
    return filtered.length > 0 ? filtered : allDeals;
  }, [allDeals, featuredDealIds]);
  const visibleSceneEvents = useMemo(() => {
    const filtered = visibleEvents.filter((event) => !featuredEventIds.has(String(event.id)));
    return filtered.length > 0 ? filtered : visibleEvents;
  }, [featuredEventIds, visibleEvents]);
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
    () => new Set(topLocalFavoriteRestaurants.map((restaurant) => String(restaurant.id))),
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
  const compactMapHeight = isHighActivity
    ? "clamp(300px, 35vh, 440px)"
    : isMediumActivity
      ? "clamp(280px, 33vh, 420px)"
      : "clamp(270px, 31vh, 390px)";
  const collapsedMapClass = isHighActivity
    ? "mx-0 mt-0 rounded-b-[2.1rem] ring-1 ring-orange-200/12 bg-[#070707]"
    : "mx-3 mt-3 rounded-[1.65rem] ring-1 ring-white/10 bg-[#0b0908]";
  const railSectionClass = isHighActivity
    ? "pl-4 pr-0 pt-1 pb-7"
    : "pl-5 pr-0 pt-2 pb-10";
  const compactRailSectionClass = isHighActivity
    ? "pl-4 pr-0 pt-0 pb-5"
    : "pl-5 pr-0 pt-1 pb-6";
  const truckCardWidth = isHighActivity
    ? "w-[176px] sm:w-[200px]"
    : "w-[200px] sm:w-[220px]";
  const standardCardWidth = isHighActivity
    ? "w-[190px] sm:w-[210px]"
    : "w-[200px] sm:w-[220px]";
  const featureCardWidth = isHighActivity
    ? "w-[210px] sm:w-[230px]"
    : "w-[230px] sm:w-[260px]";
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
  const laneFoodTrucksTitle = activeSceneLaneId === "food_trucks" ? "Food Trucks Nearby" : DISCOVERY_LAYERS.foodTrucks.title;
  const laneRestaurantsTitle = activeSceneLaneId === "restaurants" ? "Restaurants Nearby" : restaurantsRailTitle;
  const laneDealsTitle = activeSceneLaneId === "deals" ? "Deals Today" : DISCOVERY_LAYERS.deals.title;
  const laneEventsTitle =
    activeSceneLaneId === "events" ? "Happening Today" : eventsRailTitle;
  const laneMoreTitle =
    activeSceneLaneId === "worth_discovering" ? "Worth Discovering" : moreRailTitle;
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
                : "Tap the map to explore nearby food";
  const laneHasContent =
    sceneMixedFeedItems.length > 0 ||
    (sceneWantsFoodTrucks && visibleTrucksServingNow.length > 0) ||
    (sceneWantsRestaurants && visibleOpenRestaurants.length > 0) ||
    (sceneWantsDeals && visibleDeals.length > 0) ||
    (sceneWantsEvents && visibleSceneEvents.length > 0) ||
    (sceneWantsNewMenus && localMenuItems.length > 0) ||
    (sceneWantsWorthDiscovering && visibleMoreFoodRestaurants.length > 0) ||
    (sceneWantsCommunity && topLocalFavoriteRestaurants.length > 0);
  const showForYouWorthFallback =
    activeSceneLaneId === "for_you" &&
    sceneMixedFeedItems.length === 0 &&
    visibleMoreFoodRestaurants.length > 0;
  const collapsedMapSelectedMarker = useMemo(
    () =>
      sceneFilteredMapMarkers.find(
        (marker) =>
          marker.kind !== "user" &&
          Number.isFinite(marker.lat) &&
          Number.isFinite(marker.lng),
      ) ?? null,
    [sceneFilteredMapMarkers],
  );
  return (
    <>
      <SEOHead
        title="Scout | MealScout"
        description="Discover food trucks, restaurants, and deals near you. MealScout puts the local food scene right in your hands."
      />

      {/* Quiet page base. The food park photo was fighting the actual app
          content, so keep the brand atmosphere subtle and let the controls
          carry the experience. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-20 bg-[#08060a]"
        style={{
          backgroundImage:
            "radial-gradient(90% 50% at 50% -8%, rgba(255,138,60,0.20) 0%, rgba(8,6,10,0) 58%), linear-gradient(180deg, #100906 0%, #070609 62%, #050507 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage:
            "linear-gradient(180deg, rgba(8,6,10,0.08) 0%, rgba(8,6,10,0.42) 100%)",
        }}
      />

      <main
        className={`relative z-10 ${
          sheetState === "fullMap"
            ? ""
            : "pb-44 md:mx-auto md:max-w-[640px] md:min-h-screen"
        }`}
        style={{
          overscrollBehaviorY: "none",
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
          className={`relative overflow-hidden ${
            sheetState === "fullMap"
              ? "w-full bg-[#06070b]"
              : collapsedMapClass
          }`}
          style={{
            height:
              sheetState === "fullMap" ? "100dvh" : compactMapHeight,
            transition: "height 320ms cubic-bezier(0.22,0.61,0.36,1)",
            touchAction: "auto",
            overscrollBehaviorY: "none",
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
              {coords ? (
                hasMapKey && !googleMapFailed && mapCenter ? (
                  <MapErrorBoundary>
                    <GoogleMapSurface
                      apiKey={effectiveGoogleMapsApiKey}
                      mapId={effectiveGoogleMapsMapId || undefined}
                      center={mapCenter}
                      zoom={13}
                      markers={sceneFilteredMapMarkers}
                      showRoadTrafficLayer={false}
                      userLocation={coords}
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
                      userLocation={coords}
                      markers={sceneFilteredMapMarkers}
                      zoom={13}
                      onMarkerTap={handlePreviewMarkerTap}
                    />
                  </Suspense>
                )
              ) : (
                <HeroMapFallback
                  reason={
                    locationStatus === "denied"
                        ? "denied"
                        : "loading"
                  }
                />
              )}
            </div>

            {/* GoogleMapSurface:
                - Used for full interactive pan/zoom/tap-pin exploration.
                - Collapsed preview uses the same styled map family above.
            */}
            {sheetState === "fullMap" && hasMapKey && !googleMapFailed && coords && mapCenter ? (
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
                    userLocation={coords}
                      isNightTheme={true}
                    onBoundsChanged={handleMapBoundsChanged}
                    onZoomChanged={handleMapZoomChanged}
                    onCenterChanged={handleMapCenterChanged}
                    onMarkerTap={handleMarkerTap}
                    onFatalError={() => setGoogleMapFailed(true)}
                  />
                </MapErrorBoundary>
              </div>
            ) : sheetState === "fullMap" && (googleMapFailed || !hasMapKey || !coords || !mapCenter) ? (
              <div
                data-testid="scout-interactive-map"
                className="absolute inset-0"
                style={{ zIndex: 1 }}
              >
                {coords ? (
                  <>
                    <Suspense fallback={<HeroMapFallback reason="loading" />}>
                      <ThemedScoutMap
                        userLocation={coords}
                        markers={sceneFilteredMapMarkers}
                        zoom={13}
                        interactive={true}
                        onMarkerTap={handlePreviewMarkerTap}
                      />
                    </Suspense>
                    {(!hasMapKey || googleMapFailed) && (
                      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 max-w-[18rem] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white/88 px-5 py-4 text-center text-sm font-bold text-orange-900 ring-1 ring-orange-200/60 backdrop-blur-xl">
                        Full pan and zoom are warming up. The MealScout map is still available.
                      </div>
                    )}
                  </>
                ) : (
                  <HeroMapFallback
                    reason={locationStatus === "denied" ? "denied" : "loading"}
                  />
                )}
              </div>
            ) : null}
          </div>

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
              className="absolute z-30 right-4 top-[calc(env(safe-area-inset-top)+0.75rem)] inline-flex h-12 items-center gap-2 rounded-full bg-white/90 px-4 font-black text-orange-800 ring-1 ring-orange-200/70 backdrop-blur-md transition-colors hover:bg-orange-50"
              style={{
                boxShadow: "0 12px 30px rgba(154,72,18,0.18)",
              }}
            >
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
              <span className="text-sm">Collapse</span>
            </button>
          )}

          {sheetState === "fullMap" && (
            <ScoutMapHud
              locationLabel={shortLocation}
              liveTruckCount={liveTrucks.length}
              restaurantCount={nearbyRestaurants.length}
              eventCount={visibleEvents.length}
              dealCount={allDeals.length}
              localActivityCount={localActivityCount}
              discoveryRadiusKm={discoveryRadiusKm}
              onRadiusChange={updateDiscoveryRadiusKm}
              onRecenter={() => {
                if (coords) {
                  setMapCenter(coords);
                  setMapZoom(14);
                }
              }}
            />
          )}

          {sheetState === "fullMap" && selectedLiveTruck && (
            <LiveTruckMapCard
              truck={selectedLiveTruck}
              userLocation={coords}
              onClose={() => setSelectedLiveTruck(null)}
            />
          )}

          {sheetState === "fullMap" && selectedMapMarker && (
            <MapPlaceCard
              marker={selectedMapMarker}
              userLocation={coords}
              onClose={() => setSelectedMapMarker(null)}
            />
          )}

          {sheetState === "fullMap" && mapBounds && (
            <MapEdgeIndicators
              markers={sceneFilteredMapMarkers}
              bounds={mapBounds}
              center={mapCenter || coords}
              selectedId={selectedLiveTruck ? String(selectedLiveTruck.id) : selectedMapMarker?.id || null}
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
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#100c0a]/80 ring-1 ring-orange-200/35 backdrop-blur-xl shadow-[0_10px_24px_rgba(0,0,0,0.42)]">
                  <img src={mealScoutIcon} alt="MealScout" className="h-6 w-6 object-contain" />
                </span>
              </div>
              <MapActivityPips
                mode={scoutActivityMode}
                truckCount={trucksServingNow.length}
                restaurantCount={restaurantsOpenNow.length}
                dealCount={allDeals.length}
                eventCount={visibleEvents.length}
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
                    <p className="mb-1 inline-flex rounded-full bg-orange-500/18 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-orange-100 ring-1 ring-orange-200/28">
                      Admin preview
                    </p>
                  ) : null}
                  {showScoutPreviewDebug ? (
                    <p className="mb-1 text-[10px] font-bold text-white/75">
                      preview eligible:{String(isScoutPreviewEligible)} city:{scoutPreviewCity || "none"} active:{String(isPensacolaScoutPreview)} loc:{resolvedScoutLocation ? `${resolvedScoutLocation.label} ${resolvedScoutLocation.lat.toFixed(4)},${resolvedScoutLocation.lng.toFixed(4)}` : "none"} status[t:{scoutSourceStatuses.trucks ?? "-"} r:{scoutSourceStatuses.restaurants ?? "-"} h:{scoutSourceStatuses.mapLocations ?? "-"} d:{scoutSourceStatuses.deals ?? "-"} e:{scoutSourceStatuses.events ?? "-"}] counts[t:{scoutDebugCounts.trucksReturned} h:{scoutDebugCounts.hostsReturned} e:{scoutDebugCounts.eventsReturned} r:{scoutDebugCounts.restaurantsReturned} pins:{scoutDebugCounts.mapPinsBuilt}]
                    </p>
                  ) : null}
                  {showScoutPreviewDebug &&
                  (scoutDebugCounts.trucksMissingCoords > 0 ||
                    scoutDebugCounts.hostsMissingCoords > 0 ||
                    scoutDebugCounts.restaurantsMissingCoords > 0 ||
                    scoutDebugCounts.eventsMissingCoords > 0 ||
                    scoutDebugCounts.dealsMissingCoords > 0) ? (
                    <p className="mb-1 text-[10px] font-semibold text-amber-200/85">
                      dropped missing coords - trucks:{scoutDebugCounts.trucksMissingCoords} hosts:{scoutDebugCounts.hostsMissingCoords} restaurants:{scoutDebugCounts.restaurantsMissingCoords} events:{scoutDebugCounts.eventsMissingCoords} deals:{scoutDebugCounts.dealsMissingCoords}
                    </p>
                  ) : null}
                  <p className="truncate text-sm font-extrabold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]">
                    {hasResolvedLocation ? shortLocation : "Nearby now"}
                  </p>
                  <p className="truncate text-[11px] font-semibold text-white/65 drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]">
                    {compactMapSceneHint}
                  </p>
                </div>
              </div>
              {collapsedMapSelectedMarker ? (
                <CollapsedMapPinCard
                  marker={collapsedMapSelectedMarker}
                  userLocation={coords}
                />
              ) : null}
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
            <ScoutSceneOptionsBar
              lanes={SCOUT_SCENE_LANES}
              activeSceneLaneId={activeSceneLaneId}
              onSceneLaneSelect={handleSceneLaneChange}
              renderIcon={getSceneOptionIcon}
            />

            <ScoutActiveSceneIntro laneId={activeSceneLaneId} />
            <ActiveSceneContent
              laneId={activeSceneLaneId}
              sceneMixedFeedItems={sceneMixedFeedItems}
              visibleMoreFoodRestaurants={visibleMoreFoodRestaurants}
              topLocalFavoriteRestaurants={topLocalFavoriteRestaurants}
              visibleTrucksServingNow={visibleTrucksServingNow}
              visibleOpenRestaurants={visibleOpenRestaurants}
              visibleDeals={visibleDeals}
              visibleSceneEvents={visibleSceneEvents}
              visibleHosts={visibleHosts}
              localMenuItems={localMenuItems}
              openingLaterRestaurants={openingLaterRestaurants}
              visibleLocalActivityItems={visibleLocalActivityItems}
              scoutActivityMode={scoutActivityMode}
              liveTrucksLoading={liveTrucksLoading}
              nearbyRestaurantsLoading={nearbyRestaurantsLoading}
              currentUserId={currentUserId}
              isSignedIn={!!user}
              selectLiveTruck={selectLiveTruck}
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
            />

          </ActiveScenePanel>
        )}
        {sheetState !== "fullMap" && (
          <ScoutSearchDock />
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
    <div className="pr-5 mb-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-white text-xl sm:text-2xl font-black tracking-tight">{title}</h2>
        </div>
        {showLink ? (
          <Link
            href={linkHref}
            className="shrink-0 text-sm text-orange-200 inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-3 py-1.5 ring-1 ring-white/10 font-semibold transition-colors hover:bg-white/[0.08]"
          >
            See All <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
      {subtitle ? (
        <p className="mt-1.5 text-xs sm:text-sm text-white/64 leading-relaxed">{subtitle}</p>
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
    <section className={mode === "high_activity" ? "px-4 pt-3 pb-2" : "px-4 pt-4 pb-3"}>
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
    if (icon === "spark") return <Compass className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "community") return <Users className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "nearby") return <Navigation2 className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "truck") return <Flame className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "restaurant") return <Utensils className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "deal") return <Tag className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "event") return <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "menu") return <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />;
    if (icon === "late") return <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />;
    return <Heart className="h-3.5 w-3.5" aria-hidden="true" />;
  };

  return (
    <section className="px-4 pb-4">
      <div ref={scrollerRef} className="overflow-x-auto atmo-hide-scrollbar pl-0.5">
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
                    : "bg-[#11131a]/82 text-white/78 ring-white/12 hover:bg-[#171a23] hover:text-white",
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
  const laneCopy: Record<ScoutSceneLaneId, { title: string; subtitle: string }> = {
    for_you: {
      title: "For You",
      subtitle: "Local favorites, open spots, new menus, and places worth finding.",
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
      <h2 className="font-sans text-2xl font-semibold tracking-tight text-white">{activeCopy.title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-white/62">
        {activeCopy.subtitle}
      </p>
    </section>
  );
}

function ActiveSceneContent({
  laneId,
  sceneMixedFeedItems,
  visibleMoreFoodRestaurants,
  topLocalFavoriteRestaurants,
  visibleTrucksServingNow,
  visibleOpenRestaurants,
  visibleDeals,
  visibleSceneEvents,
  visibleHosts,
  localMenuItems,
  openingLaterRestaurants,
  visibleLocalActivityItems,
  scoutActivityMode,
  liveTrucksLoading,
  nearbyRestaurantsLoading,
  currentUserId,
  isSignedIn,
  selectLiveTruck,
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
}: {
  laneId: ScoutSceneLaneId;
  sceneMixedFeedItems: CravingBoardItem[];
  visibleMoreFoodRestaurants: RestaurantSummary[];
  topLocalFavoriteRestaurants: RestaurantSummary[];
  visibleTrucksServingNow: LiveTruckSummary[];
  visibleOpenRestaurants: RestaurantSummary[];
  visibleDeals: DealSummary[];
  visibleSceneEvents: EventSummary[];
  visibleHosts: ScoutHostLocation[];
  localMenuItems: LocalMenuItemFeedItem[];
  openingLaterRestaurants: RestaurantSummary[];
  visibleLocalActivityItems: LocalActivityItem[];
  scoutActivityMode: ScoutActivityMode;
  liveTrucksLoading: boolean;
  nearbyRestaurantsLoading: boolean;
  currentUserId?: string | null;
  isSignedIn: boolean;
  selectLiveTruck: (truck: LiveTruckSummary) => void;
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
}) {
  if (laneId === "for_you") {
    if (sceneMixedFeedItems.length > 0) {
      return <SceneMixedFeed items={sceneMixedFeedItems} />;
    }
    if (visibleMoreFoodRestaurants.length > 0) {
      return (
        <section className="px-4 pb-6">
          <SectionHeader
            title="Worth Discovering"
            linkHref={DISCOVERY_LAYERS.restaurants.href}
            subtitle="New, quiet, or under-scouted spots nearby."
            itemCount={visibleMoreFoodRestaurants.length}
          />
          <ul className="space-y-2.5" role="list" aria-label="Worth discovering">
            {visibleMoreFoodRestaurants.slice(0, 8).map((restaurant) => {
              const name = getRestaurantName(restaurant);
              const cuisine = restaurant.cuisineType || "Local food";
              const location = [restaurant.neighborhood, restaurant.city].filter(Boolean).join(" · ");
              const label =
                restaurant.activeDealsCount || restaurant.activeDealCount
                  ? "Open now nearby"
                  : "Under-scouted";
              const lat =
                typeof restaurant.latitude === "number"
                  ? restaurant.latitude
                  : typeof restaurant.lat === "number"
                    ? restaurant.lat
                    : null;
              const lng =
                typeof restaurant.longitude === "number"
                  ? restaurant.longitude
                  : typeof restaurant.lng === "number"
                    ? restaurant.lng
                    : null;
              const routeUrl =
                typeof lat === "number" && typeof lng === "number"
                  ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
                  : null;
              return (
                <li key={`for-you-worth-${restaurant.id}`}>
                  <div className="rounded-2xl bg-[#101219]/82 p-3 ring-1 ring-white/12">
                    <p className="truncate text-base font-semibold text-white">{name}</p>
                    <p className="mt-0.5 truncate text-xs text-white/65">
                      {cuisine}{location ? ` · ${location}` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-orange-300/14 px-2 py-1 text-[10px] font-bold text-orange-100 ring-1 ring-orange-200/25">
                        {label}
                      </span>
                      <Link
                        href={`/restaurant/${restaurant.id}`}
                        className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white ring-1 ring-white/20"
                      >
                        View
                      </Link>
                      {routeUrl ? (
                        <a
                          href={routeUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white ring-1 ring-white/20"
                        >
                          Route
                        </a>
                      ) : null}
                      {isSignedIn ? (
                        <Link
                          href={`/restaurant/${restaurant.id}`}
                          className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white ring-1 ring-white/20"
                        >
                          Save
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      );
    }
    return <ScoutSceneEmptyState laneId="for_you" />;
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
            <ul className="flex gap-4 pr-5" role="list" aria-label="Top local favorites">
              {topLocalFavoriteRestaurants.slice(0, 10).map((restaurant) => (
                <li key={`local-favorite-${restaurant.id}`} className={`shrink-0 ${standardCardWidth}`}>
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
        <LocalActivityRail mode={scoutActivityMode} items={visibleLocalActivityItems} />
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
              <ul className="flex gap-4 pr-5" role="list" aria-label="Food trucks near you">
                {visibleTrucksServingNow.slice(0, 12).map((t) => (
                  <li key={t.id} className={`shrink-0 ${truckCardWidth}`}>
                    <TruckCard truck={t} onSelect={selectLiveTruck} currentUserId={currentUserId} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {(laneId === "nearby_now" || laneId === "restaurants" || laneId === "late_night") && (
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
              <ul className="flex gap-4 pr-5" role="list" aria-label="Restaurants open now">
                {visibleOpenRestaurants.slice(0, 10).map((r) => (
                  <li key={r.id} className={`shrink-0 ${standardCardWidth}`}>
                    <NearbyRestaurantCard
                      restaurant={r}
                      menuPreview={menuPreviewByRestaurantId.get(String(r.id)) ?? []}
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

      {(laneId === "nearby_now" || laneId === "deals") && visibleDeals.length > 0 ? (
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

      {(laneId === "nearby_now" || laneId === "events") && visibleSceneEvents.length > 0 ? (
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

      {(laneId === "nearby_now" || laneId === "events") && visibleHosts.length > 0 ? (
        <section className={compactRailSectionClass}>
          <SectionHeader
            title="Event Hosts Nearby"
            linkHref="/parking-pass"
            subtitle="Host and event locations with real map coordinates."
            itemCount={visibleHosts.length}
          />
          <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
            <ul className="flex gap-4 pr-5" role="list" aria-label="Event hosts nearby">
              {visibleHosts.slice(0, 10).map((host) => (
                <li key={`host-${host.hostId || host.id}`} className={`shrink-0 ${standardCardWidth}`}>
                  <HostLocationCard host={host} />
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
                <li key={`menu-item-${item.id}`} className={`shrink-0 ${featureCardWidth}`}>
                  <LocalMenuItemCard item={item} position={index} currentUserId={currentUserId} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {(laneId === "worth_discovering" || laneId === "late_night") && visibleMoreFoodRestaurants.length > 0 ? (
        <section className={compactRailSectionClass}>
          <SectionHeader
            title={laneMoreTitle}
            linkHref={DISCOVERY_LAYERS.restaurants.href}
            subtitle={moreRailSubtitle}
            itemCount={visibleMoreFoodRestaurants.length}
          />
          <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
            <ul className="flex gap-4 pr-5" role="list" aria-label="Worth discovering">
              {visibleMoreFoodRestaurants.slice(0, 10).map((r) => (
                <li key={`restaurant-worth-${r.id}`} className={`shrink-0 ${standardCardWidth}`}>
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
            <ul className="flex gap-4 pr-5" role="list" aria-label="Opening later">
              {openingLaterRestaurants.slice(0, 10).map((r) => (
                <li key={`restaurant-later-${r.id}`} className={`shrink-0 ${standardCardWidth}`}>
                  <SavedRestaurantCard restaurant={r} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {((laneId === "food_trucks" && visibleTrucksServingNow.length === 0) ||
        (laneId === "restaurants" && visibleOpenRestaurants.length === 0) ||
        (laneId === "deals" && visibleDeals.length === 0) ||
        (laneId === "events" && visibleSceneEvents.length === 0 && visibleHosts.length === 0) ||
        (laneId === "new_menus" && localMenuItems.length === 0) ||
        (laneId === "late_night" &&
          visibleOpenRestaurants.length === 0 &&
          visibleMoreFoodRestaurants.length === 0) ||
        (laneId === "worth_discovering" && visibleMoreFoodRestaurants.length === 0) ||
        (laneId === "nearby_now" &&
          visibleLocalActivityItems.length === 0 &&
          visibleTrucksServingNow.length === 0 &&
          visibleOpenRestaurants.length === 0 &&
          visibleDeals.length === 0 &&
          visibleSceneEvents.length === 0 &&
          visibleHosts.length === 0)) ? (
        <ScoutSceneEmptyState laneId={laneId} />
      ) : null}
    </>
  );
}

function SceneMixedFeed({ items }: { items: CravingBoardItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="px-4 pb-4">
      <ul className="space-y-2.5" role="list" aria-label="Today around you feed">
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
      ? "text-purple-300"
      : item.kind === "Menu"
        ? "text-amber-300"
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

  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 rounded-2xl bg-[#120805]/56 px-3 py-2.5 text-white ring-1 ring-white/10 transition-colors hover:bg-[#1a0d08]/78 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
    >
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white/6 ring-1 ring-white/10">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Utensils className="h-5 w-5 text-orange-200/70" aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-[11px] font-black uppercase tracking-wide ${kindColor}`}>{badge}</p>
        <p className="truncate text-xl font-semibold leading-tight">{item.title}</p>
        <p className="truncate text-sm text-white/70">{item.subtitle}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {item.meta ? <span className="text-xs font-semibold text-white/64">{item.meta}</span> : null}
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
      <span className="rounded-full bg-[#fff4e1]/10 px-3 py-1 text-xs font-black text-orange-100 ring-1 ring-orange-200/24">
        View
      </span>
    </Link>
  );
}

function HostLocationCard({ host }: { host: ScoutHostLocation }) {
  const hostName = host.businessName || host.name || "Host location";
  const area = [host.city, host.state].filter(Boolean).join(", ");
  const lat = readNumberField(host, ["latitude", "lat"]);
  const lng = readNumberField(host, ["longitude", "lng"]);
  const routeUrl =
    typeof lat === "number" && typeof lng === "number"
      ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
      : null;
  const hostId = String(host.hostId || host.id || "").trim();
  const hostHref = hostId ? `/parking-pass?hostId=${encodeURIComponent(hostId)}` : "/parking-pass";
  return (
    <div className="rounded-2xl overflow-hidden bg-white/5 ring-1 ring-white/10 p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-orange-200/75">Host</p>
      <p className="mt-1 truncate text-sm font-semibold text-white">{hostName}</p>
      <p className="mt-0.5 truncate text-xs text-white/65">{area || "Nearby location"}</p>
      <div className="mt-2 flex items-center gap-2">
        <Link
          href={hostHref}
          className="rounded-full bg-orange-500 px-2.5 py-1 text-[10px] font-bold text-[#160904]"
        >
          View Host
        </Link>
        {routeUrl ? (
          <a
            href={routeUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold text-white ring-1 ring-white/20"
          >
            Route
          </a>
        ) : null}
      </div>
    </div>
  );
}

function ActiveSceneEmptyState({ laneId }: { laneId: ScoutSceneLaneId }) {
  const isForYou = laneId === "for_you";
  const title =
    isForYou
      ? "The local board is quiet right now."
      :
    laneId === "community"
      ? "Community activity is still building here."
      : laneId === "deals"
        ? "No active deals nearby right now."
        : laneId === "food_trucks"
          ? "No trucks posted up nearby right now."
          : laneId === "events"
            ? "No food events nearby right now."
            : "Nothing strong here yet.";
  const body =
    isForYou
      ? "Try Nearby, Worth Discovering, or widen your area."
      :
    laneId === "community"
      ? "Explore nearby and save spots to help shape local favorites."
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
        <p className="mt-1 text-xs font-semibold leading-relaxed text-white/58">{body}</p>
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
              className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[11px] font-black text-white/90 ring-1 ring-white/16"
            >
              Worth Discovering
            </Link>
            <Link
              href="/search?q=new%20menus"
              className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[11px] font-black text-white/90 ring-1 ring-white/16"
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
    ["community", "food_trucks", "restaurants", "deals", "events", "new_menus", "late_night", "worth_discovering"].includes(
      lane.id,
    ),
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
        <p className="text-sm font-black">The local board is quiet right now.</p>
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
}: {
  marker: MapAdapterMarker;
  userLocation?: { lat: number; lng: number } | null;
}) {
  const destination =
    marker.kind === "truck"
      ? `/truck/${marker.sourceId}`
      : marker.kind === "restaurant"
        ? `/restaurant/${marker.sourceId}`
        : marker.kind === "deal"
          ? "/deals-featured"
        : marker.kind === "parking"
          ? `/parking-pass?hostId=${encodeURIComponent(String(marker.sourceId))}`
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
    userLocation &&
    Number.isFinite(marker.lat) &&
    Number.isFinite(marker.lng)
      ? formatMiles(getDistanceMiles(userLocation, { lat: marker.lat, lng: marker.lng }))
      : null;
  const originParam = userLocation ? `&origin=${userLocation.lat},${userLocation.lng}` : "";
  const directionsUrl = `https://www.google.com/maps/dir/?api=1${originParam}&destination=${marker.lat},${marker.lng}&travelmode=driving`;

  return (
    <div
      className="absolute left-3 right-3 bottom-16 z-20 rounded-2xl bg-[#0f1017]/88 px-3 py-3 text-white ring-1 ring-white/14 backdrop-blur-xl"
      style={{ boxShadow: "0 16px 36px rgba(0,0,0,0.48)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-orange-200/80">
            {status}
          </p>
          <p className="truncate text-base font-black">{marker.title || "Nearby place"}</p>
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
            className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-black text-white ring-1 ring-white/14"
          >
            Route
          </a>
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
    <section className={isCompact ? "pl-4 pr-0 pt-0 pb-5" : "pl-5 pr-0 pt-1 pb-6"}>
      <SectionHeader
        title={getActivityRailTitle(mode)}
        linkHref="/search"
        subtitle={getActivityRailSubtitle(mode)}
        itemCount={items.length}
      />
      <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
        <ul className={`flex ${isCompact ? "gap-2.5" : "gap-3"} pr-5`} role="list" aria-label="Happening nearby">
          {items.map((item) => (
            <li key={item.id} className={`shrink-0 ${isCompact ? "w-[168px] sm:w-[194px]" : "w-[190px] sm:w-[220px]"}`}>
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
    { label: "Update status", href: "/restaurant-owner-dashboard?src=scout&setup=status", icon: <Flame className="h-3.5 w-3.5" aria-hidden="true" /> },
    { label: "Confirm location", href: "/restaurant-owner-dashboard?src=scout&setup=location", icon: <Navigation2 className="h-3.5 w-3.5" aria-hidden="true" /> },
    { label: "Update menu", href: "/menu-builder?src=scout", icon: <Utensils className="h-3.5 w-3.5" aria-hidden="true" /> },
    { label: "Post deal", href: "/deal-creation?src=scout", icon: <Tag className="h-3.5 w-3.5" aria-hidden="true" /> },
  ];

  return (
    <section className="px-4 pb-4 -mt-1" aria-label="Quick updates">
      <div className="rounded-2xl bg-[#120805]/42 px-3 py-2.5 ring-1 ring-orange-200/14">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-orange-100/72">
            Quick updates
          </p>
          <p className="text-[10px] font-bold text-white/42">
            For your places
          </p>
        </div>
        <div className="overflow-x-auto atmo-hide-scrollbar">
          <div className="flex w-max gap-2 pr-1">
          {actions.map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-[#fff4e1]/10 px-2.5 py-1.5 text-[10px] font-black text-orange-50 ring-1 ring-orange-200/24 transition-colors hover:bg-[#fff4e1]/14 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
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
            className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-full bg-orange-300/14 px-2 py-1 text-[10px] font-black text-orange-100 ring-1 ring-orange-200/24 transition-colors hover:bg-orange-300/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
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
          <p className="text-sm font-black leading-tight text-white">{item.title}</p>
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
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
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
            <p className="font-semibold text-white text-sm leading-snug">{title}</p>
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
}: {
  truck: LiveTruckSummary;
  currentUserId?: string | null;
}) {
  const distance = formatDistance(truck);
  const wait = formatWait(truck);
  const vibe = getCrowdVibe(truck);
  const heroImage = truck.heroImageUrl || truck.imageUrl || truck.logoUrl;
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
  const truckStatusLabel = (() => {
    if (isTruckServingNow(truck)) return "Posted up now";
    const status = readStringField(truck, ["serviceStatus", "status", "operatingStatus"]);
    if (status) {
      const normalized = status.toLowerCase();
      if (normalized.includes("scheduled")) return "Scheduled";
      if (normalized.includes("claim")) return "Claimed truck";
      if (normalized.includes("serving area")) return "Serving area";
    }
    return "Serving area";
  })();
  const truckStatusClass = isTruckServingNow(truck) ? "bg-red-500/90" : "bg-amber-500/90";
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
      href={`/truck/${truck.id}`}
      className="block rounded-3xl overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 bg-[#120805]/40 ring-1 ring-white/10"
      aria-label={`Open ${truck.name}`}
      style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.55)" }}
    >
      <div className="relative aspect-[4/5] w-full bg-[#120805]/60">
        {heroImage ? (
          <img
            src={heroImage}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(160deg, rgba(255,90,47,0.18), rgba(0,0,0,0.6))",
            }}
            aria-hidden="true"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0) 38%, rgba(0,0,0,0.92) 100%)",
          }}
          aria-hidden="true"
        />

        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide text-white bg-orange-600 shadow-md">
          <span
            className="h-1.5 w-1.5 rounded-full bg-white atmo-pulse-amber"
            aria-hidden="true"
          />Serving now</span>

        <button
          type="button"
          aria-label="Save"
          onClick={(e) => {
            e.preventDefault();
          }}
          className="absolute top-2.5 right-2.5 h-9 w-9 rounded-full flex items-center justify-center bg-[#120805]/30 backdrop-blur-sm hover:bg-[#120805]/50 transition-colors"
        >
          <Heart className="h-5 w-5 text-white" aria-hidden="true" />
        </button>

        <div className="absolute bottom-3 left-3 right-3">
          <p className="text-white font-bold text-lg leading-tight truncate">
            {truck.name}
          </p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-orange-200 text-sm font-semibold">
            <Flame className="h-4 w-4" aria-hidden="true" />
            <span>{vibe.label}</span>
          </p>
          <p className="mt-1 text-white/75 text-xs">
            {[wait, distance].filter(Boolean).join(" • ") || "Serving now"}
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
      className="block rounded-3xl overflow-hidden bg-[#120805]/40 ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.55)" }}
      aria-label={`Open deal ${deal.title || ""}`}
    >
      <div className="relative aspect-[4/5] w-full bg-[#120805]/60">
        {deal.imageUrl ? (
          <img
            src={deal.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(160deg, rgba(34,197,94,0.18), rgba(0,0,0,0.6))",
            }}
            aria-hidden="true"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0) 38%, rgba(0,0,0,0.92) 100%)",
          }}
          aria-hidden="true"
        />
        {deal.discountText && (
          <span className="absolute top-3 left-3 inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide text-[#1a0d08] bg-orange-300 shadow-md">
            {deal.discountText}
          </span>
        )}
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
    typeof item.distanceMiles === "number" && Number.isFinite(item.distanceMiles)
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
  }, [item.id, item.restaurantId, item.discoveryScore, item.discoveryReasons, position]);

  return (
    <Link
      href={`/restaurant/${item.restaurantId}`}
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
      className="block rounded-3xl overflow-hidden bg-[#120805]/40 ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.55)" }}
      aria-label={`Open ${item.name} from ${item.restaurantName || "local menu"}`}
      data-testid="scout-local-menu-item-card"
    >
      <div className="relative aspect-[4/3] w-full bg-[#120805]/60">
        {item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle at 28% 20%, rgba(255,120,55,0.36), transparent 34%), linear-gradient(160deg, rgba(255,90,47,0.16), rgba(0,0,0,0.66))",
            }}
            aria-hidden="true"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0) 34%, rgba(0,0,0,0.9) 100%)",
          }}
          aria-hidden="true"
        />
        <span className="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-orange-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#1a0d08]">
          <Utensils className="h-3 w-3" aria-hidden="true" />
          Menu
        </span>
        {price && (
          <span className="absolute top-3 right-3 rounded-full bg-[#120805]/75 px-2.5 py-1 text-[11px] font-bold text-orange-100 ring-1 ring-orange-300/30">
            {price}
          </span>
        )}
      </div>
      <div className="px-3 py-3">
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
      </div>
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
      className="block rounded-3xl overflow-hidden bg-[#120805]/40 ring-1 ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.55)" }}
      aria-label={`Open event ${title}`}
    >
      <div className="relative aspect-[4/5] w-full bg-[#120805]/60">
        {img ? (
          <img
            src={img}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(160deg, rgba(217,70,239,0.18), rgba(0,0,0,0.6))",
            }}
            aria-hidden="true"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0) 38%, rgba(0,0,0,0.92) 100%)",
          }}
          aria-hidden="true"
        />
        <div className="absolute bottom-3 left-3 right-3">
          <p className="text-white font-bold text-lg leading-tight line-clamp-2">
            {title}
          </p>
          {venue && (
            <p className="mt-1 text-white/80 text-xs truncate">{venue}</p>
          )}
          {startLabel && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-orange-200 text-xs font-semibold">
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
  const name = restaurant.businessName || restaurant.name || "Restaurant";
  const img = restaurant.coverImageUrl || restaurant.heroImageUrl || restaurant.imageUrl || restaurant.logoUrl;
  const cuisine = restaurant.cuisineType;
  const location = restaurant.neighborhood || restaurant.city;
  const dealCount = restaurant.activeDealsCount ?? restaurant.activeDealCount ?? 0;
  const favoriteCount = Number(restaurant.favoriteCount || 0);
  const followCount = Number(restaurant.followCount || 0);
  const recommendationCount = Number(restaurant.recommendationCount || 0);
  const videoRecommendationCount = Number(
    restaurant.videoRecommendationCount || 0,
  );
  const communityActivityCount = Number(restaurant.communityActivityCount || 0);
  const dist = restaurant.distanceMiles ?? (restaurant.distance ? restaurant.distance * 0.621371 : null);
  const distLabel = typeof dist === "number" && Number.isFinite(dist)
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
      kind: "restaurant",
      updatedAt: readStringField(restaurant, ["updatedAt", "lastUpdatedAt"]),
      confirmedAt: readStringField(restaurant, ["confirmedAt", "lastConfirmedAt"]),
      hasDeal: dealCount > 0,
      hasMenu: menuPreview.length > 0,
      hasCommunityUpdate: communityUpdates.length > 0,
      hasDistance: Boolean(distLabel),
      isOpen: true,
    }),
  ];
  const rankingReason =
    communityUpdates.length > 0
      ? `Community activity: ${communityUpdates.slice(0, 2).join(" + ")}`
      : distLabel
        ? "Nearby now"
        : "Open near you";

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
      if (!response.ok) throw new Error("Restaurant action failed");
    } finally {
      setPendingAction(null);
    }
  };

  const toggleFavorite = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const nextState = !isFavorite;
    setIsFavorite(nextState);
    try {
      await sendRestaurantAction("favorite", nextState);
    } catch {
      setIsFavorite(!nextState);
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
    if (isRecommended) return;
    setIsRecommended(true);
    try {
      await sendRestaurantAction("recommend", true);
    } catch {
      setIsRecommended(false);
    }
  };

  return (
    <Link
      href={`/restaurant/${restaurant.id}`}
      className="block rounded-2xl overflow-hidden group focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70 bg-[#120805]/40 ring-1 ring-white/10"
      aria-label={`Open ${name}`}
      style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}
      data-testid="scout-restaurant-card"
    >
      {/* Image */}
      <div className="relative aspect-[4/3] w-full bg-[#120805]/60">
        {img ? (
          <img
            src={img}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: "linear-gradient(160deg, rgba(255,90,47,0.18), rgba(0,0,0,0.6))",
            }}
            aria-hidden="true"
          />
        )}
        <div
          className="absolute inset-0"
          style={{ backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%)" }}
          aria-hidden="true"
        />
        {dealCount > 0 && (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-white bg-orange-600 shadow">
            <Tag className="h-2.5 w-2.5" aria-hidden="true" />
            {dealCount} deal{dealCount > 1 ? "s" : ""}
          </span>
        )}
      </div>
      {/* Info */}
      <div className="px-3 py-2.5">
        <p className="text-white font-semibold text-sm leading-snug truncate">{name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          {cuisine && (
            <span className="text-orange-300/80 text-[11px]">{cuisine}</span>
          )}
          {cuisine && (location || distLabel) && (
            <span className="text-white/30 text-[11px]">·</span>
          )}
          {location && (
            <span className="text-white/60 text-[11px] truncate">{location}</span>
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
            className="mt-2 rounded-xl bg-orange-300/10 ring-1 ring-orange-300/20 px-2.5 py-2"
            data-testid="scout-menu-preview"
          >
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-orange-200">
              <Utensils className="h-3 w-3" aria-hidden="true" />
              Menu preview
            </div>
            <div className="mt-1.5 space-y-1">
              {menuPreview.slice(0, 2).map((item) => {
                const price = formatPrice(item.priceCents);
                return (
                  <div
                    key={item.id}
                    className="flex items-baseline justify-between gap-2 text-[11px]"
                  >
                    <span className="min-w-0 truncate text-white/82">
                      {item.name}
                    </span>
                    {price && (
                      <span className="shrink-0 text-orange-200/85">
                        {price}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-wide">
          {statusLabels.slice(0, 3).map((label) => (
            <span
              key={label}
              className={getFreshnessBadgeClass(
                {
                  kind: "restaurant",
                  updatedAt: readStringField(restaurant, ["updatedAt", "lastUpdatedAt"]),
                  confirmedAt: readStringField(restaurant, ["confirmedAt", "lastConfirmedAt"]),
                  hasDeal: dealCount > 0,
                  hasMenu: menuPreview.length > 0,
                  hasCommunityUpdate: communityUpdates.length > 0,
                  hasDistance: Boolean(distLabel),
                  isOpen: true,
                },
                label,
              )}
            >
              {label}
            </span>
          ))}
          {statusLabels.length === 0 ? (
            <span className="rounded-full bg-white/8 px-2 py-1 text-white/65">
              Open near you
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-[10px] font-semibold text-white/45">
          {rankingReason}
        </p>
        <OwnerOperationalActions actions={ownerActions} />
        <div
          className="mt-2 grid grid-cols-3 gap-1.5 text-[10px] font-bold"
          aria-label={`${name} quick actions`}
        >
          <button
            type="button"
            onClick={toggleFavorite}
            disabled={pendingAction === "favorite"}
            className={`inline-flex items-center justify-center gap-1 rounded-full px-2 py-1.5 transition ${
              isFavorite
                ? "bg-orange-300 text-[#1a0d08]"
                : "bg-white/8 text-white/70 hover:bg-white/12"
            }`}
            aria-pressed={isFavorite}
          >
            <Bookmark className="h-3 w-3" aria-hidden="true" />
            Save
          </button>
          <button
            type="button"
            onClick={toggleFollow}
            disabled={pendingAction === "follow"}
            className={`inline-flex items-center justify-center gap-1 rounded-full px-2 py-1.5 transition ${
              isFollowed
                ? "bg-white text-[#1a0d08]"
                : "bg-white/8 text-white/70 hover:bg-white/12"
            }`}
            aria-pressed={isFollowed}
          >
            <Heart className="h-3 w-3" aria-hidden="true" />
            Follow
          </button>
          <button
            type="button"
            onClick={recommend}
            disabled={pendingAction === "recommend" || isRecommended}
            className={`inline-flex items-center justify-center gap-1 rounded-full px-2 py-1.5 transition ${
              isRecommended
                ? "bg-emerald-300 text-[#1a0d08]"
                : "bg-white/8 text-white/70 hover:bg-white/12"
            }`}
            aria-pressed={isRecommended}
          >
            <Heart className="h-3 w-3" aria-hidden="true" />
            {isRecommended ? "Supported" : "Support"}
          </button>
        </div>
      </div>
    </Link>
  );
}

function SavedRestaurantCard({ restaurant }: { restaurant: RestaurantSummary }) {
  const name = restaurant.businessName || restaurant.name || "Restaurant";
  const img =
    restaurant.coverImageUrl ||
    restaurant.heroImageUrl ||
    restaurant.imageUrl ||
    restaurant.logoUrl;
  const location = restaurant.neighborhood || restaurant.city || restaurant.address;
  const cuisine = restaurant.cuisineType;

  return (
    <Link
      href={`/restaurant/${restaurant.id}`}
      className="block overflow-hidden rounded-3xl bg-white/5 ring-1 ring-white/10 transition hover:bg-white/8 hover:ring-orange-300/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
      aria-label={`Open saved restaurant ${name}`}
    >
      <div className="relative h-24 bg-[#120805]/50">
        {img ? (
          <img
            src={img}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(145deg, rgba(255,90,47,0.22), rgba(2,6,23,0.92))",
            }}
            aria-hidden="true"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.78))",
          }}
          aria-hidden="true"
        />
      </div>
      <div className="px-3 py-3">
        <p className="truncate text-sm font-semibold text-white">{name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
          {cuisine && <span className="text-orange-200/80">{cuisine}</span>}
          {cuisine && location && <span className="text-white/25">·</span>}
          {location && <span className="truncate text-white/55">{location}</span>}
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
  events,
  deals,
  locationStatus,
  onExpandMap,
  onSelectTruck,
  currentUserId,
}: {
  liveTrucks: LiveTruckSummary[];
  liveTrucksLoading: boolean;
  liveTrucksError: boolean;
  events: EventSummary[];
  deals: DealSummary[];
  locationStatus: "idle" | "requesting" | "ready" | "denied";
  onExpandMap: () => void;
  onSelectTruck: (truck: LiveTruckSummary) => void;
  currentUserId?: string | null;
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
    liveTrucks.length > 0 || todaysEvents.length > 0 || deals.length > 0;

  // While loading and no content yet, show skeletons
  if (liveTrucksLoading && !hasAnyContent) {
    return (
      <section className="pl-5 pr-0 pt-2 pb-10">
        <SectionHeader
          title="Nearby"
          linkHref="/truck-discovery"
          subtitle="Trucks, restaurants, bars, and pop-ups serving near you right now."
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
    const eventsCount = todaysEvents.length;
    const dealsCount = deals.length;
    const summaryBits = [
      liveCount > 0 ? `${liveCount} truck${liveCount === 1 ? "" : "s"}` : null,
      eventsCount > 0 ? `${eventsCount} happening today` : null,
      dealsCount > 0 ? `${dealsCount} active deal${dealsCount === 1 ? "" : "s"}` : null,
    ].filter(Boolean);

    return (
      <section className="pl-5 pr-0 pt-2 pb-10">
        <SectionHeader
          title="Nearby"
          linkHref="/truck-discovery"
          subtitle={
            summaryBits.length > 0
              ? summaryBits.join(" · ")
              : "Trucks, restaurants, bars, and pop-ups serving near you right now."
          }
        />
        <div className="overflow-x-auto atmo-hide-scrollbar -mr-1">
          <ul
            className="flex gap-4 pr-5"
            role="list"
            aria-label="Businesses, events, and deals open right now"
          >
            {liveTrucks.slice(0, 8).map((truck) => (
              <li key={`truck-${truck.id}`} className="shrink-0 w-[230px] sm:w-[260px]">
                <LiveTruckCard truck={truck} currentUserId={currentUserId} />
              </li>
            ))}
            {todaysEvents.slice(0, 6).map((ev) => (
              <li key={`event-${ev.id}`} className="shrink-0 w-[230px] sm:w-[260px]">
                <EventCard event={ev} currentUserId={currentUserId} />
              </li>
            ))}
            {deals.slice(0, 6).map((d) => (
              <li key={`deal-${d.id}`} className="shrink-0 w-[230px] sm:w-[260px]">
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
      className="absolute left-4 right-4 bottom-[calc(env(safe-area-inset-bottom)+7.25rem)] z-30 rounded-3xl bg-[#120805]/88 p-4 text-white ring-1 ring-orange-300/35 backdrop-blur-xl"
      style={{ boxShadow: "0 22px 70px rgba(0,0,0,0.62), 0 0 24px rgba(255,90,47,0.18)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/18 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-orange-200 ring-1 ring-orange-300/25">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-300 animate-pulse" />
            Food truck
          </div>
          <h3 className="mt-2 truncate text-lg font-black">{truck.name || "Food Truck"}</h3>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-orange-100/80">
            <MapPin className="h-4 w-4 shrink-0 text-orange-300" aria-hidden="true" />
            <span className="truncate">{place}</span>
          </p>
          <p className="mt-1 text-xs text-white/60">
            {[distance, wait].filter(Boolean).join(" · ") || "Center map to compare it with your location."}
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
          href={`/truck/${truck.id}`}
          className="inline-flex flex-col items-center justify-center gap-1 rounded-2xl bg-white/8 px-2 py-3 text-center text-xs font-black text-white ring-1 ring-white/10"
        >
          <Flame className="h-4 w-4 text-orange-300" aria-hidden="true" />
          Profile
        </Link>
        <Link
          href={`/truck/${truck.id}?message=1`}
          className="inline-flex flex-col items-center justify-center gap-1 rounded-2xl bg-white/8 px-2 py-3 text-center text-xs font-black text-white ring-1 ring-white/10"
        >
          <MessageCircle className="h-4 w-4 text-orange-300" aria-hidden="true" />
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
        ? `/parking-pass?hostId=${encodeURIComponent(String(marker.sourceId))}`
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
  const originParam = userLocation ? `&origin=${userLocation.lat},${userLocation.lng}` : "";
  const directionsUrl = `https://www.google.com/maps/dir/?api=1${originParam}&destination=${marker.lat},${marker.lng}&travelmode=driving`;

  return (
    <div
      className="absolute left-4 right-4 bottom-[calc(env(safe-area-inset-bottom)+7.25rem)] z-30 rounded-3xl bg-[#120805]/88 p-4 text-white ring-1 ring-orange-300/35 backdrop-blur-xl"
      style={{ boxShadow: "0 22px 70px rgba(0,0,0,0.62), 0 0 24px rgba(255,90,47,0.18)" }}
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
    truckCount > 0 ? { label: "Trucks", value: truckCount, className: "bg-orange-300" } : null,
    restaurantCount > 0 ? { label: "Open", value: restaurantCount, className: "bg-emerald-300" } : null,
    dealCount > 0 ? { label: "Deals", value: dealCount, className: "bg-lime-300" } : null,
    eventCount > 0 ? { label: "Today", value: eventCount, className: "bg-amber-300" } : null,
  ].filter((item): item is { label: string; value: number; className: string } => Boolean(item));

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
              ? "bg-[#120805]/78 px-2.5 py-1.5 text-[10px] ring-white/16 shadow-[0_10px_24px_rgba(0,0,0,0.34)]"
              : "bg-[#120805]/68 px-2 py-1 text-[10px] ring-white/12",
          ].join(" ")}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${pip.className}`} aria-hidden="true" />
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
  const options: Array<{ id: MapLayerId; label: string; icon: React.ReactNode }> = [
    { id: "openNow", label: "Open", icon: <Flame className="h-3 w-3" aria-hidden="true" /> },
    { id: "foodTrucks", label: "Trucks", icon: <Utensils className="h-3 w-3" aria-hidden="true" /> },
    { id: "deals", label: "Deals", icon: <Tag className="h-3 w-3" aria-hidden="true" /> },
    { id: "happeningToday", label: "Today", icon: <CalendarDays className="h-3 w-3" aria-hidden="true" /> },
  ];

  return (
    <div
      className="absolute left-3 right-3 top-[calc(env(safe-area-inset-top)+4.7rem)] z-20 overflow-x-auto atmo-hide-scrollbar sm:left-4 sm:right-auto sm:w-[360px]"
    >
      <div className="flex w-max gap-1 rounded-full bg-[#120805]/66 p-1 text-[10px] font-black uppercase tracking-wide text-white/70 ring-1 ring-white/12 backdrop-blur-xl">
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
                  ? "bg-white/14 text-white ring-1 ring-white/18"
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
  const totalPins =
    liveTruckCount + restaurantCount + eventCount;
  const sceneLine =
    totalPins > 0
      ? `${liveTruckCount} trucks • ${dealCount} deals • ${eventCount} events`
      : "No nearby pins yet - pan the map or widen radius";

  return (
    <div className="pointer-events-none absolute left-3 right-3 top-[calc(env(safe-area-inset-top)+4.25rem)] z-20 sm:left-4 sm:right-auto sm:w-[360px]">
      <div
        className="pointer-events-auto rounded-2xl bg-[#120805]/88 p-3 text-white ring-1 ring-orange-200/35 backdrop-blur-xl"
        style={{ boxShadow: "0 18px 54px rgba(0,0,0,0.52), 0 0 26px rgba(255,90,47,0.2)" }}
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
                Local food scene
              </p>
            </div>
          </div>
          <span className="rounded-full bg-orange-500/16 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-orange-100 ring-1 ring-orange-200/25">Serving now</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
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
              Tap the glowing pins to jump into what's cooking near you right now.
            </p>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              <MapHudCount label="Trucks" value={liveTruckCount} />
              <MapHudCount label="Food" value={restaurantCount} />
              <MapHudCount label="Deals" value={dealCount} />
              <MapHudCount label="Events" value={eventCount} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 rounded-2xl bg-black/18 px-2.5 py-2 ring-1 ring-white/10">
              <MapFreshnessKey dotClassName="bg-emerald-300" label="Updated" />
              <MapFreshnessKey dotClassName="bg-orange-200" label="Older info" />
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-white/7 px-3 py-2 ring-1 ring-orange-200/12">
          <span className="text-xs font-bold text-white/72">
            Radius
          </span>
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
            No nearby pins right here yet. Pan the map or widen discovery from the feed below.
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
      <p className="text-[9px] font-bold uppercase tracking-wide text-white/48">{label}</p>
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
      <span className={`h-1.5 w-1.5 rounded-full ${dotClassName}`} aria-hidden="true" />
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
    .filter((marker) => marker.id !== selectedId && marker.sourceId !== selectedId)
    .filter((marker) => !bounds.contains([marker.lat, marker.lng]))
    .map((marker) => {
      const dx = marker.lng - center.lng;
      const dy = marker.lat - center.lat;
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const edge = horizontal ? (dx > 0 ? "right" : "left") : dy > 0 ? "top" : "bottom";
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
    bottom: "left-1/2 bottom-[calc(env(safe-area-inset-bottom)+12rem)] -translate-x-1/2 flex-row",
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
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-[#1b0d05]/88 px-3 py-2 text-xs font-black text-orange-100 ring-1 ring-orange-300/35 backdrop-blur-xl"
              style={{ boxShadow: "0 12px 36px rgba(0,0,0,0.42), 0 0 18px rgba(255,90,47,0.16)" }}
              aria-label={`Show ${marker.title || marker.kind} on map`}
            >
              <span className="text-orange-300">
                {edge === "left" ? "‹" : edge === "right" ? "›" : edge === "top" ? "⌃" : "⌄"}
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
  const img = truck.coverImageUrl ?? truck.heroImageUrl ?? truck.imageUrl ?? truck.logoUrl ?? null;

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
  const freshnessMeta: FreshnessMeta = {
    kind: "truck",
    updatedAt: readStringField(truck, ["updatedAt", "lastUpdatedAt"]),
    confirmedAt: readStringField(truck, ["confirmedAt", "lastConfirmedAt"]),
    hasDeal: Boolean(truck.activeDealCount && truck.activeDealCount > 0),
    hasDistance: Boolean(distLabel),
    isOpen: true,
  };
  const badges = getOperationalBadges(freshnessMeta).slice(0, 3);
  const canEdit = isOwnedByCurrentUser(truck, currentUserId);
  const truckStatusLabel = (() => {
    if (isTruckServingNow(truck)) return "Posted up now";
    const status = readStringField(truck, ["serviceStatus", "status", "operatingStatus"]);
    if (status) {
      const normalized = status.toLowerCase();
      if (normalized.includes("scheduled")) return "Scheduled";
      if (normalized.includes("claim")) return "Claimed truck";
      if (normalized.includes("serving area")) return "Serving area";
    }
    return "Serving area";
  })();
  const truckStatusClass = isTruckServingNow(truck) ? "bg-red-500/90" : "bg-amber-500/90";
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
      href={`/truck/${truck.id}`}
      onClick={(event) => {
        if (!onSelect) return;
        event.preventDefault();
        onSelect(truck);
      }}
      className="block rounded-2xl overflow-hidden bg-white/5 ring-1 ring-white/10 hover:ring-orange-500/40 transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300/70"
    >
      {/* Hero image */}
      <div className="relative aspect-[4/3] w-full bg-[#120805]/40 overflow-hidden">
        {img ? (
          <img
            src={img}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <Flame className="h-8 w-8 text-orange-500/40" aria-hidden="true" />
          </div>
        )}
        <div
          className="absolute inset-0"
          style={{ backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75) 100%)" }}
          aria-hidden="true"
        />
        {/* Serving badge */}
        <span className={`absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-white shadow ${truckStatusClass}`}>
          <span className={`h-1.5 w-1.5 rounded-full bg-white ${isTruckServingNow(truck) ? "animate-pulse" : ""}`} aria-hidden="true" />
          {truckStatusLabel}
        </span>
        {truck.activeDealCount && truck.activeDealCount > 0 ? (
          <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide text-white bg-orange-600 shadow">
            <Tag className="h-2.5 w-2.5" aria-hidden="true" />
            Deal
          </span>
        ) : null}
      </div>
      {/* Info */}
      <div className="px-3 py-2.5">
        <p className="text-white font-semibold text-sm leading-snug truncate">{name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          {cuisine && <span className="text-orange-300/80 text-[11px]">{cuisine}</span>}
          {cuisine && (distLabel || waitLabel) && <span className="text-white/30 text-[11px]">·</span>}
          {distLabel && <span className="text-white/60 text-[11px]">{distLabel}</span>}
          {distLabel && waitLabel && <span className="text-white/30 text-[11px]">·</span>}
          {waitLabel && <span className="text-white/50 text-[11px]">{waitLabel} wait</span>}
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







