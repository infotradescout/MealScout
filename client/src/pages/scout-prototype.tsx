import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Link, useLocation as useWouterLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Bookmark, Compass, Search, Heart, User,
  Navigation2, MapPin, Truck,
  Clock, Award, Flame,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAuth } from "@/hooks/useAuth";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import { apiUrl } from "@/lib/api";
import { buildPublicProfilePath } from "@/lib/public-profile-path";
import type {
  ScoutSurfaceCard,
  ScoutSurfaceResponse,
} from "@shared/constants/scoutSurface";

/* ─── styles ─── */
const customStyles = `
  @keyframes pulse {
    0% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.5); opacity: 0.2; }
    100% { transform: scale(1); opacity: 0.8; }
  }
  .sp-pin { background: none !important; border: none !important; }
  .sp-user { background: none !important; border: none !important; }
  .no-scrollbar::-webkit-scrollbar { width: 0; height: 0; background: transparent; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
  .leaflet-container { background: #0d0d0d !important; }
`;

/* ─── map pin builder ─── */
const pinHtml = (color: string, svg: string) => `
  <div style="background:${color};width:32px;height:32px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    border:2px solid rgba(255,255,255,0.2);
    box-shadow:0 0 12px ${color}99,0 2px 8px rgba(0,0,0,0.6);">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white"
      stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>
  </div>`;

const PIN_SVGS: Record<string, string> = {
  truck: '<rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v4h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  restaurant: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
  event: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  deal: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
};

/* ─── types ─── */
interface Restaurant {
  id: string;
  businessId?: string | null;
  restaurantId?: string | null;
  truckId?: string | null;
  profileId?: string | null;
  publicProfileId?: string | null;
  canonicalBusinessId?: string | null;
  businessName?: string | null;
  name?: string | null;
  cuisineType?: string | null;
  logoUrl?: string | null;
  profileImageUrl?: string | null;
  truckPhotoLogo?: string | null;
  galleryImages?: string[] | null;
  coverImageUrl?: string | null;
  heroImageUrl?: string | null;
  imageUrl?: string | null;
  city?: string | null;
  state?: string | null;
  neighborhood?: string | null;
  distanceMiles?: number | null;
  distance?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
  activeDealsCount?: number;
  activeDealCount?: number;
  homeRankingScore?: number | null;
  homeRankingReason?: string | null;
  businessType?: string | null;
  isFoodTruck?: boolean | null;
  isVerified?: boolean | null;
  isActive?: boolean | null;
  menuItemCount?: number | null;
  canonicalMenuCount?: number | null;
  emailVerified?: boolean | null;
  adminVerified?: boolean | null;
  insuranceVerified?: boolean | null;
  isSuspended?: boolean | null;
  isBanned?: boolean | null;
  serviceArea?: unknown;
  serviceAreas?: unknown;
}

interface Truck {
  id: string;
  businessId?: string | null;
  restaurantId?: string | null;
  truckId?: string | null;
  profileId?: string | null;
  publicProfileId?: string | null;
  canonicalBusinessId?: string | null;
  name?: string | null;
  cuisineType?: string | null;
  logoUrl?: string | null;
  profileImageUrl?: string | null;
  truckPhotoLogo?: string | null;
  galleryImages?: string[] | null;
  coverImageUrl?: string | null;
  heroImageUrl?: string | null;
  imageUrl?: string | null;
  distanceMiles?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
  mobileOnline?: boolean;
  liveUntilAt?: string | null;
  currentStop?: unknown;
  schedule?: unknown;
  truckSchedule?: {
    currentStop?: unknown;
    todayStop?: unknown;
    nextStop?: unknown;
    status?: string | null;
    statusLabel?: string | null;
  } | null;
  liveNow?: boolean;
  liveSource?: "location_update" | "scheduled_now" | "not_live";
  source?: "live" | "discoverable";
  menuAvailable?: boolean;
  photosAvailable?: boolean;
  insuranceVerified?: boolean;
  verifiedTruck?: boolean;
  scheduledToday?: boolean;
  hasServiceArea?: boolean;
}

/* ─── scene lanes ─── */
const SCENE_LANES = [
  { id: "for_you", label: "For You", icon: <Compass size={14} />, color: "#ff5c00" },
  { id: "community", label: "Community", icon: <User size={14} />, color: "#9333ea" },
  { id: "nearby_now", label: "Nearby", icon: <Navigation2 size={14} />, color: "#3b82f6" },
  { id: "food_trucks", label: "Food Trucks", icon: <Truck size={14} />, color: "#ff5c00" },
  { id: "late_night", label: "Late Night", icon: <Clock size={14} />, color: "#6366f1" },
  { id: "worth_discovering", label: "Worth Discovering", icon: <Award size={14} />, color: "#eab308" },
];

/* ─── explore tiles ─── */
const EXPLORE_TILES = [
  { id: "community", label: "Community", count: "", icon: <User size={18} />, color: "#9333ea", href: "/scout?scene=community" },
  { id: "food_trucks", label: "Food Trucks", count: "", icon: <Truck size={18} />, color: "#ff5c00", href: "/scout?scene=food_trucks" },
  { id: "nearby_now", label: "Nearby", count: "", icon: <Navigation2 size={18} />, color: "#3b82f6", href: "/scout?scene=nearby_now" },
  { id: "late_night", label: "Late Night", count: "", icon: <Clock size={18} />, color: "#6366f1", href: "/scout?scene=late_night" },
  { id: "worth_discovering", label: "Worth Discovering", count: "", icon: <Award size={18} />, color: "#eab308", href: "/scout?scene=worth_discovering" },
];

const CONTAINED_SCOUT_SCENE_IDS = new Set(SCENE_LANES.map((lane) => lane.id));

/* ─── helpers ─── */
function distLabel(r: Restaurant | Truck) {
  const d = (r as Restaurant).distanceMiles ?? (r as Restaurant).distance;
  if (typeof d === "number" && d > 0) return `${d.toFixed(1)} mi`;
  return null;
}

function routeUrl(lat?: number | null, lng?: number | null, name?: string | null) {
  if (!lat || !lng) return null;
  const dest = `${lat},${lng}`;
  const label = encodeURIComponent(name || "");
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&destination_place_id=${label}&travelmode=driving`;
}

function canonicalScoutEntityKey(entity: {
  canonicalBusinessId?: string | null;
  businessId?: string | null;
  profileId?: string | null;
  publicProfileId?: string | null;
  restaurantId?: string | null;
  truckId?: string | null;
  id?: string | null;
  businessName?: string | null;
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
}) {
  const idCandidates = [
    entity.canonicalBusinessId,
    entity.businessId,
    entity.profileId,
    entity.publicProfileId,
    entity.restaurantId,
    entity.truckId,
    entity.id,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  if (idCandidates.length > 0) return idCandidates[0];
  const name = String(entity.businessName || entity.name || "")
    .trim()
    .toLowerCase();
  const lat = Number(entity.latitude ?? entity.lat);
  const lng = Number(entity.longitude ?? entity.lng);
  if (name && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${name}:${lat.toFixed(4)}:${lng.toFixed(4)}`;
  }
  return name || "";
}

function getBestBusinessImage(r: {
  logoUrl?: string | null;
  profileImageUrl?: string | null;
  coverImageUrl?: string | null;
  truckPhotoLogo?: string | null;
  heroImageUrl?: string | null;
  imageUrl?: string | null;
  galleryImages?: string[] | null;
}) {
  const galleryFirst = Array.isArray(r.galleryImages) ? r.galleryImages[0] : null;
  return (
    r.logoUrl ||
    r.profileImageUrl ||
    r.coverImageUrl ||
    r.truckPhotoLogo ||
    r.heroImageUrl ||
    r.imageUrl ||
    galleryFirst ||
    null
  );
}

function imgSrc(r: {
  logoUrl?: string | null;
  profileImageUrl?: string | null;
  coverImageUrl?: string | null;
  truckPhotoLogo?: string | null;
  heroImageUrl?: string | null;
  imageUrl?: string | null;
  galleryImages?: string[] | null;
}) {
  return getBestBusinessImage(r);
}

function isDiscoverableTruckProfile(restaurant: Restaurant) {
  const businessType = String(restaurant.businessType || "").toLowerCase();
  const isFoodTruckType = businessType === "food_truck" || restaurant.isFoodTruck === true;
  const active = restaurant.isActive !== false;
  const notSuspended = restaurant.isSuspended !== true && restaurant.isBanned !== true;
  const verified =
    restaurant.adminVerified === true ||
    restaurant.emailVerified === true ||
    restaurant.isVerified === true;
  const insured = restaurant.insuranceVerified !== false;
  const hasCoords = [restaurant.latitude, restaurant.lat].some((v) => Number.isFinite(Number(v))) &&
    [restaurant.longitude, restaurant.lng].some((v) => Number.isFinite(Number(v)));
  const hasServiceArea =
    Boolean(restaurant.city && String(restaurant.city).trim()) ||
    Boolean(restaurant.state && String(restaurant.state).trim()) ||
    Boolean(restaurant.serviceArea) ||
    (Array.isArray(restaurant.serviceAreas) && restaurant.serviceAreas.length > 0);
  return isFoodTruckType && active && notSuspended && verified && insured && (hasCoords || hasServiceArea);
}

function distanceMilesBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const aa =
    s1 * s1 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

function truckScheduleIndicatesLiveNow(truck: Truck) {
  if (truck.currentStop) return true;
  if (truck.truckSchedule?.currentStop) return true;
  const status = String(truck.truckSchedule?.status || "").toLowerCase();
  return status === "live";
}

function truckScheduleIndicatesScheduledToday(truck: Truck) {
  if (truck.liveNow) return false;
  if (truck.truckSchedule?.todayStop) return true;
  const statusLabel = String(truck.truckSchedule?.statusLabel || "").toLowerCase();
  const status = String(truck.truckSchedule?.status || "").toLowerCase();
  return statusLabel.includes("today") || status.includes("scheduled");
}

function truckIsLiveNow(truck: Truck, nowMs: number) {
  const liveUntilMs = truck.liveUntilAt ? Date.parse(truck.liveUntilAt) : NaN;
  const locationUpdateLive =
    truck.mobileOnline === true && Number.isFinite(liveUntilMs) && liveUntilMs > nowMs;
  const scheduleLive = truckScheduleIndicatesLiveNow(truck);
  if (locationUpdateLive) return { liveNow: true, liveSource: "location_update" as const };
  if (scheduleLive) return { liveNow: true, liveSource: "scheduled_now" as const };
  return { liveNow: false, liveSource: "not_live" as const };
}

function normalizeScoutSearchText(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ScoutSearchableRecord = {
  title: string;
  subtitle?: string;
  type?: string;
  tag?: string;
  city?: string;
  description?: string;
};

type SurfaceScoutCard = ScoutSurfaceCard & {
  sectionId: string;
  sectionTitle: string;
};

type ScoutFeedItem = {
  id: string;
  type: string;
  typeColor: string;
  image: string | null;
  title: string;
  subtitle: string;
  tag?: string;
  tagColor?: string;
  distance: string | null;
  href: string;
  routeHref: string | null;
  restaurantId?: string;
  searchCity?: string;
  searchDescription?: string;
  searchOrder?: number;
  ctaLabel?: string;
};

type ScoutProfileContext = {
  entityType: "truck" | "restaurant";
  verifiedProfile: boolean;
  hasMenu: boolean;
  hasPhoto: boolean;
  liveNow: boolean;
  scheduledToday: boolean;
};

type SurfaceProfileSignals = {
  verifiedProfile: boolean;
  hasMenu: boolean;
  hasPhoto: boolean;
  liveConfidence: boolean;
  scheduledConfidence: boolean;
  communitySource: boolean;
  unverifiedCommunity: boolean;
  missingSchedule: boolean;
  thinProfile: boolean;
  associatedRestaurantId?: string;
};

function scoreScoutSearchResult(record: ScoutSearchableRecord, query: string): number {
  const q = normalizeScoutSearchText(query);
  if (!q) return 0;

  const normalizedTitle = normalizeScoutSearchText(record.title);
  const normalizedSubtitle = normalizeScoutSearchText(record.subtitle);
  const normalizedType = normalizeScoutSearchText(record.type);
  const normalizedTag = normalizeScoutSearchText(record.tag);
  const normalizedCity = normalizeScoutSearchText(record.city);
  const normalizedDescription = normalizeScoutSearchText(record.description);
  const haystack = [
    normalizedSubtitle,
    normalizedType,
    normalizedTag,
    normalizedCity,
    normalizedDescription,
  ]
    .filter(Boolean)
    .join(" ");

  if (normalizedTitle === q) return 1200;
  if (normalizedTitle.startsWith(`${q} `) || normalizedTitle.startsWith(q)) return 1000;
  if (normalizedTitle.includes(q)) return 850;
  if (haystack.includes(q)) return 550;

  const qTokens = q.split(" ").filter(Boolean);
  if (qTokens.length === 0) return 0;
  const titleTokenHits = qTokens.filter((token) => normalizedTitle.includes(token)).length;
  const metaTokenHits = qTokens.filter((token) => haystack.includes(token)).length;
  if (titleTokenHits > 0) return 400 + titleTokenHits * 40 + metaTokenHits * 10;
  if (metaTokenHits > 0) return 200 + metaTokenHits * 20;
  return 0;
}

function surfaceCardKey(card: Pick<ScoutSurfaceCard, "entityType" | "entityId">) {
  return `${card.entityType}:${card.entityId}`;
}

function buildEntityAliases(entity: {
  canonicalBusinessId?: string | null;
  businessId?: string | null;
  profileId?: string | null;
  publicProfileId?: string | null;
  restaurantId?: string | null;
  truckId?: string | null;
  id?: string | null;
}) {
  return Array.from(
    new Set(
      [
        entity.id,
        entity.canonicalBusinessId,
        entity.businessId,
        entity.profileId,
        entity.publicProfileId,
        entity.restaurantId,
        entity.truckId,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function dedupeSurfaceCards(cards: SurfaceScoutCard[]) {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = surfaceCardKey(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getSurfaceTypeLabel(card: ScoutSurfaceCard) {
  if (card.source === "community" || card.source === "recommendation") {
    return "COMMUNITY PICK";
  }
  switch (card.entityType) {
    case "truck":
      return "FOOD TRUCK";
    case "restaurant":
      return "RESTAURANT";
    case "deal":
      return "DEAL";
    case "event":
      return "EVENT";
    case "host_spot":
      return "HOST SPOT";
    default:
      return "LOCAL FOOD";
  }
}

function getSurfaceTypeColor(card: ScoutSurfaceCard) {
  if (card.source === "community" || card.source === "recommendation") {
    return "#9333ea";
  }
  switch (card.entityType) {
    case "truck":
      return "#ff5c00";
    case "restaurant":
      return "#3b82f6";
    case "deal":
      return "#10b981";
    case "event":
      return "#f59e0b";
    case "host_spot":
      return "#14b8a6";
    default:
      return "#f97316";
  }
}

function getAssociatedRestaurantId(card: SurfaceScoutCard) {
  const metadata = (card.metadata || {}) as { restaurantId?: unknown };
  if (card.entityType === "restaurant") return String(card.entityId || "").trim();
  if (card.entityType === "deal") return String(metadata.restaurantId || "").trim();
  return "";
}

function getSurfaceProfileSignals(
  card: SurfaceScoutCard,
  profileContextById: Map<string, ScoutProfileContext>,
): SurfaceProfileSignals {
  const restaurantId = getAssociatedRestaurantId(card);
  const profileContext =
    profileContextById.get(card.entityId) ||
    (restaurantId ? profileContextById.get(restaurantId) : undefined);
  const communitySource = card.source === "community" || card.source === "recommendation";
  const hasPhoto = Boolean(card.imageUrl) || Boolean(profileContext?.hasPhoto);
  const hasMenu = Boolean(profileContext?.hasMenu);
  const verifiedProfile = Boolean(profileContext?.verifiedProfile);
  const liveConfidence =
    card.availability === "serving_now" ||
    card.availability === "open_now" ||
    card.availability === "deal_today" ||
    card.availability === "event_today" ||
    Boolean(profileContext?.liveNow);
  const scheduledConfidence = Boolean(profileContext?.scheduledToday);
  const missingSchedule = card.statusLabel === "No schedule";
  const thinProfile =
    (card.entityType === "restaurant" || card.entityType === "truck") &&
    (!hasMenu || !hasPhoto || missingSchedule);

  return {
    verifiedProfile,
    hasMenu,
    hasPhoto,
    liveConfidence,
    scheduledConfidence,
    communitySource,
    unverifiedCommunity: communitySource && !verifiedProfile,
    missingSchedule,
    thinProfile,
    associatedRestaurantId: restaurantId || undefined,
  };
}

function getSurfaceTag(
  card: SurfaceScoutCard,
  signals: SurfaceProfileSignals,
) {
  if (card.availability === "serving_now") return "Serving now";
  if (card.availability === "open_now") return "Open now";
  if (card.availability === "deal_today") return "Deal today";
  if (card.availability === "event_today") return "Today";
  if (card.availability === "upcoming") return "Upcoming";
  if (card.statusLabel === "No schedule") return "Hours not posted";
  if (signals.unverifiedCommunity) {
    return "Community";
  }
  if (signals.communitySource) {
    return "Community pick";
  }
  return card.statusLabel || "Nearby";
}

function getSurfaceTagColor(
  card: SurfaceScoutCard,
  signals: SurfaceProfileSignals,
) {
  if (card.availability === "serving_now" || card.availability === "open_now") {
    return "#10b981";
  }
  if (card.availability === "deal_today") return "#10b981";
  if (card.availability === "event_today" || card.availability === "upcoming") {
    return "#f59e0b";
  }
  if (signals.communitySource) {
    return "#9333ea";
  }
  if (card.statusLabel === "No schedule") return "#f97316";
  return getSurfaceTypeColor(card);
}

function buildSurfaceRouteHref(card: ScoutSurfaceCard) {
  const lat = Number((card.metadata as { lat?: number } | undefined)?.lat);
  const lng = Number((card.metadata as { lng?: number } | undefined)?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return routeUrl(lat, lng, card.title);
}

function buildSurfaceSubtitle(
  card: SurfaceScoutCard,
  signals: SurfaceProfileSignals,
) {
  const honestProfileLabels = [
    signals.unverifiedCommunity ? "Community" : "",
    signals.verifiedProfile &&
    (card.entityType === "restaurant" || card.entityType === "truck")
      ? "Verified profile"
      : "",
    signals.hasMenu || !(card.entityType === "restaurant" || card.entityType === "truck")
      ? ""
      : "Menu not posted yet",
    signals.missingSchedule ? "Hours not posted" : "",
    signals.hasPhoto || !(card.entityType === "restaurant" || card.entityType === "truck")
      ? ""
      : "Photo coming soon",
  ].filter(Boolean);
  return [
    card.subtitle,
    ...card.reasons.slice(0, 1),
    ...honestProfileLabels.slice(0, 2),
  ]
    .filter(Boolean)
    .join(" • ");
}

function buildSurfaceSearchDescription(card: SurfaceScoutCard) {
  return [
    card.source,
    card.sectionTitle,
    card.statusLabel,
    ...card.badges,
    ...card.reasons,
  ]
    .filter(Boolean)
    .join(" ");
}

function getSurfaceQualityScore(
  card: SurfaceScoutCard,
  signals: SurfaceProfileSignals,
  laneId: string,
) {
  let score = Number(card.score || 0);

  if (signals.verifiedProfile) score += 8;
  if (signals.hasMenu) score += 6;
  if (signals.hasPhoto) score += 4;
  if (signals.liveConfidence) score += 8;
  if (signals.scheduledConfidence) score += 2;
  if (card.entityType === "truck" || card.entityType === "restaurant" || card.entityType === "deal") {
    score += 4;
  }
  if (signals.unverifiedCommunity) score -= 6;
  if (signals.missingSchedule) score -= 5;
  if (signals.thinProfile) score -= 2;
  if (!signals.hasPhoto && (card.entityType === "restaurant" || card.entityType === "truck")) {
    score -= 2;
  }
  if (!signals.hasMenu && (card.entityType === "restaurant" || card.entityType === "truck")) {
    score -= 3;
  }

  if (laneId === "community") {
    if (signals.communitySource) score += 12;
    if (signals.verifiedProfile) score += 4;
  } else if (laneId === "nearby_now" || laneId === "for_you") {
    if (signals.liveConfidence) score += 10;
    if (card.availability === "upcoming") score -= 6;
  } else if (laneId === "late_night") {
    if (card.availability === "open_now") score += 12;
    if (card.availability === "upcoming") score -= 8;
  } else if (laneId === "worth_discovering") {
    if (card.sectionId === "more-nearby") score += 8;
    if (signals.communitySource) score -= 2;
  } else if (laneId === "food_trucks") {
    if (card.entityType === "truck") score += 12;
  }

  return score;
}

function prioritizeSurfaceCards(
  cards: SurfaceScoutCard[],
  options: {
    laneId: string;
    profileContextById: Map<string, ScoutProfileContext>;
    suppressKeys?: Set<string>;
    suppressLimit?: number;
  },
) {
  const {
    laneId,
    profileContextById,
    suppressKeys = new Set<string>(),
    suppressLimit = 0,
  } = options;
  const ranked = [...cards].sort((a, b) => {
    const aSignals = getSurfaceProfileSignals(a, profileContextById);
    const bSignals = getSurfaceProfileSignals(b, profileContextById);
    const aScore = getSurfaceQualityScore(a, aSignals, laneId);
    const bScore = getSurfaceQualityScore(b, bSignals, laneId);
    if (aScore !== bScore) return bScore - aScore;
    const aDistance = typeof a.distanceMiles === "number" ? a.distanceMiles : Number.POSITIVE_INFINITY;
    const bDistance = typeof b.distanceMiles === "number" ? b.distanceMiles : Number.POSITIVE_INFINITY;
    if (aDistance !== bDistance) return aDistance - bDistance;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });

  const seen = new Set<string>();
  const preferred: SurfaceScoutCard[] = [];
  const suppressed: SurfaceScoutCard[] = [];
  let repeatedCount = 0;

  for (const card of ranked) {
    const key = surfaceCardKey(card);
    if (seen.has(key)) continue;
    seen.add(key);

    if (suppressKeys.has(key) && repeatedCount >= suppressLimit) {
      suppressed.push(card);
      continue;
    }
    if (suppressKeys.has(key)) repeatedCount += 1;
    preferred.push(card);
  }

  return [...preferred, ...suppressed];
}

function buildSurfaceFeedItem(
  card: SurfaceScoutCard,
  searchOrder: number,
  profileContextById: Map<string, ScoutProfileContext>,
): ScoutFeedItem {
  const signals = getSurfaceProfileSignals(card, profileContextById);
  return {
    id: `surface-${card.id}`,
    type: getSurfaceTypeLabel(card),
    typeColor: getSurfaceTypeColor(card),
    image: card.imageUrl || null,
    title: card.title,
    subtitle: buildSurfaceSubtitle(card, signals),
    tag: getSurfaceTag(card, signals),
    tagColor: getSurfaceTagColor(card, signals),
    distance:
      typeof card.distanceMiles === "number" && card.distanceMiles > 0
        ? `${card.distanceMiles.toFixed(1)} mi`
        : null,
    href: card.cta.href,
    routeHref: buildSurfaceRouteHref(card),
    restaurantId:
      card.entityType === "restaurant"
        ? card.entityId
        : signals.associatedRestaurantId,
    searchCity: "",
    searchDescription: buildSurfaceSearchDescription(card),
    searchOrder,
    ctaLabel: card.cta.label,
  };
}

/* ─── feed card ─── */
function FeedCard({
  type, typeColor, image, title, subtitle, tag, tagColor,
  distance, href, routeHref, restaurantId, isFavorited, onToggleFavorite, ctaLabel,
}: {
  type: string; typeColor: string; image: string | null;
  title: string; subtitle: string; tag?: string; tagColor?: string;
  distance: string | null; href: string; routeHref: string | null;
  restaurantId?: string; isFavorited?: boolean; onToggleFavorite?: (id: string) => void;
  ctaLabel?: string;
}) {
  return (
    <div className="flex gap-3 bg-[#1a1a1a] rounded-2xl p-3 border border-white/5 hover:border-orange-500/20 transition-all duration-300">
      <Link href={href} className="w-24 h-24 shrink-0">
        {image ? (
          <img src={image} className="w-full h-full object-cover rounded-xl" alt={title} />
        ) : (
          <div className="w-full h-full rounded-xl bg-[#252525] flex items-center justify-center">
            <Flame size={20} className="text-orange-500/30" />
          </div>
        )}
      </Link>
      <div className="flex-1 flex flex-col min-w-0 py-0.5">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[9px] font-black tracking-widest uppercase" style={{ color: typeColor }}>{type}</span>
          {distance && <span className="text-[10px] font-bold text-gray-400 shrink-0 ml-2">{distance}</span>}
        </div>
        <Link href={href}>
          <h3 className="text-sm font-bold text-white truncate leading-tight mb-0.5 hover:text-orange-400 transition-colors">{title}</h3>
        </Link>
        <p className="text-[10px] text-gray-500 font-medium truncate mb-1.5">{subtitle}</p>
        {tag && (
          <div className="mb-2">
            <span className="inline-block px-2 py-0.5 rounded-full text-[8px] font-bold"
              style={{ backgroundColor: `${tagColor}18`, color: tagColor }}>{tag}</span>
          </div>
        )}
        <div className="flex items-center gap-3 mt-auto">
          <Link href={href} className="text-[10px] font-black text-orange-500 uppercase tracking-widest hover:text-orange-400">
            {ctaLabel || "View"}
          </Link>
          {routeHref && (
            <a href={routeHref} target="_blank" rel="noopener noreferrer"
              className="bg-[#1e1e1e] border border-white/10 text-white/80 text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-lg hover:border-orange-500/40 transition-colors">
              Route
            </a>
          )}
          {restaurantId ? (
            <button
              onClick={() => onToggleFavorite?.(restaurantId)}
              className="ml-auto"
              aria-label={isFavorited ? "Remove from saved" : "Save"}
            >
              <Bookmark size={15} className={isFavorited ? "text-orange-500 fill-orange-500" : "text-gray-600 hover:text-orange-500 transition-colors"} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ─── main component ─── */
export default function ScoutPrototype() {
  const { user } = useAuth();
  const [routePath, navigate] = useWouterLocation();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const [activeScene, setActiveScene] = useState("for_you");
  const [deviceCoords, setDeviceCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationName, setLocationName] = useState("Pensacola");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [adminPreviewLocked, setAdminPreviewLocked] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const scoutLayoutVars = {
    "--scout-safe-bottom": "env(safe-area-inset-bottom, 0px)",
    "--scout-nav-height": "58px",
    "--scout-search-height": "46px",
    "--scout-chip-height": "50px",
    "--scout-dock-gap": "12px",
    "--scout-bottom-dock-height":
      "calc(var(--scout-safe-bottom) + var(--scout-nav-height) + var(--scout-search-height) + var(--scout-chip-height) + var(--scout-dock-gap))",
    "--scout-help-bottom-clearance":
      "calc(var(--scout-bottom-dock-height) + 16px)",
  } as React.CSSProperties;
  const scoutDockBottom = "calc(var(--scout-safe-bottom) + var(--scout-nav-height) + var(--scout-dock-gap))";
  const feedBottomClearance =
    "calc(var(--scout-nav-height) + var(--scout-dock-gap) + var(--scout-bottom-dock-height) + 28px)";

  const scoutPreviewCity = useMemo(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return (params.get("scoutPreview") || params.get("previewCity") || "")
      .trim()
      .toLowerCase();
  }, [routePath]);
  const routeScene = useMemo(() => {
    if (typeof window === "undefined") return "";
    return String(new URLSearchParams(window.location.search).get("scene") || "")
      .trim()
      .toLowerCase();
  }, [routePath]);
  const isAdminPreviewEligible = useMemo(() => {
    const userType = String(user?.userType || "").toLowerCase();
    const rolesRaw = (user as { roles?: unknown } | null | undefined)?.roles;
    const roles = new Set<string>();
    if (Array.isArray(rolesRaw)) {
      rolesRaw.forEach((role) => {
        const normalized = String(role || "").trim().toLowerCase();
        if (normalized) roles.add(normalized);
      });
    }
    return (
      ["super_admin", "duper_admin", "admin", "staff"].includes(userType) ||
      roles.has("super_admin") ||
      roles.has("duper_admin") ||
      roles.has("admin") ||
      roles.has("staff")
    );
  }, [user]);
  useEffect(() => {
    if (scoutPreviewCity === "pensacola" && isAdminPreviewEligible) {
      setAdminPreviewLocked(true);
    }
  }, [scoutPreviewCity, isAdminPreviewEligible]);
  useEffect(() => {
    if (routeScene && CONTAINED_SCOUT_SCENE_IDS.has(routeScene)) {
      setActiveScene(routeScene);
      return;
    }
    if (!routeScene) {
      setActiveScene("for_you");
    }
  }, [routeScene]);

  // Admin lane is hard-locked to Pensacola for Scout prototype consistency.
  const isPensacolaScoutPreview =
    isAdminPreviewEligible ||
    (scoutPreviewCity === "pensacola" && adminPreviewLocked);
  const hasKnownUserLocation = useMemo(() => {
    const candidate = user as
      | {
          latitude?: unknown;
          longitude?: unknown;
          lat?: unknown;
          lng?: unknown;
          city?: unknown;
          state?: unknown;
          locationName?: unknown;
        }
      | null
      | undefined;
    if (!candidate) return false;

    const latCandidates = [candidate.latitude, candidate.lat];
    const lngCandidates = [candidate.longitude, candidate.lng];
    const hasCoords =
      latCandidates.some((value) => Number.isFinite(Number(value))) &&
      lngCandidates.some((value) => Number.isFinite(Number(value)));

    if (hasCoords) return true;

    const city = String(candidate.city ?? "").trim();
    const state = String(candidate.state ?? "").trim();
    const locationLabel = String(candidate.locationName ?? "").trim();
    return city.length > 0 || state.length > 0 || locationLabel.length > 0;
  }, [user]);
  const shouldUseDeviceLocation = Boolean(user?.id) && hasKnownUserLocation;
  const resolvedLocationLabel = isPensacolaScoutPreview
    ? "Pensacola"
    : locationName;

  /* ─── location ─── */
  const location = useMemo(() => {
    if (isPensacolaScoutPreview) {
      return { lat: 30.4213, lng: -87.2169, label: "Pensacola" };
    }
    if (deviceCoords)
      return {
        lat: deviceCoords.lat,
        lng: deviceCoords.lng,
        label: resolvedLocationLabel,
      };
    // Default to Pensacola downtown
    return { lat: 30.4213, lng: -87.2169, label: "Pensacola" };
  }, [deviceCoords, resolvedLocationLabel, isPensacolaScoutPreview]);

  const recenterMapToLocation = useCallback(() => {
    if (!map.current) return;
    map.current.invalidateSize({ pan: false, animate: false });
    map.current.setView([location.lat, location.lng], map.current.getZoom(), {
      animate: false,
    });
  }, [location.lat, location.lng]);

  /* Global nav suppression removed - we want the real nav visible at the bottom */

  useEffect(() => {
    if (isPensacolaScoutPreview) {
      setLocationName("Pensacola");
      return;
    }
    if (!shouldUseDeviceLocation) {
      setDeviceCoords(null);
      setLocationName("Pensacola");
      return;
    }
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDeviceCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        getReverseGeocodedLocationName(pos.coords.latitude, pos.coords.longitude, (name) => {
          if (name) setLocationName(name);
        });
      },
      () => { /* use default Pensacola */ },
      { timeout: 8000 }
    );
  }, [isPensacolaScoutPreview, shouldUseDeviceLocation]);

  /* ─── API queries ─── */
  const { data: trucksRaw = [] } = useQuery<Truck[]>({
    queryKey: ["/api/trucks/live", location.lat, location.lng],
    queryFn: async () => {
      const r = await fetch(apiUrl(`/api/trucks/live?lat=${location.lat}&lng=${location.lng}&radiusKm=25`), { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : (d?.trucks ?? []);
    },
    staleTime: 20_000,
    refetchInterval: 30_000,
  });

  const { data: restaurantsRaw = [] } = useQuery<Restaurant[]>({
    queryKey: ["/api/restaurants/subscribed", location.lat, location.lng],
    queryFn: async () => {
      const r = await fetch(apiUrl(`/api/restaurants/subscribed/${location.lat}/${location.lng}?radius=25`), { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 120_000,
  });

  const { data: scoutSurfaceData } = useQuery<ScoutSurfaceResponse>({
    queryKey: ["/api/scout/surface", location.lat, location.lng],
    queryFn: async () => {
      const r = await fetch(
        apiUrl(`/api/scout/surface?lat=${location.lat}&lng=${location.lng}&radiusMiles=20&limit=30`),
        { credentials: "include" },
      );
      if (!r.ok) {
        return {
          generatedAt: new Date(0).toISOString(),
          mode: "quiet" as const,
          location: {
            lat: location.lat,
            lng: location.lng,
            radiusMiles: 20,
          },
          map: { markers: [] },
          sections: [],
        };
      }
      return r.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  /* ─── derived counts for tiles ─── */
  const filterByResolvedLocation = useCallback(
    <T extends { latitude?: number | null; longitude?: number | null; lat?: number | null; lng?: number | null; distanceMiles?: number | null }>(
      items: T[],
    ) => {
      return items.filter((item) => {
        const lat = item.latitude ?? item.lat;
        const lng = item.longitude ?? item.lng;
        if (lat == null || lng == null) return true;
        if (typeof item.distanceMiles === "number" && item.distanceMiles > 40)
          return false;
        const d = distanceMilesBetween(location.lat, location.lng, lat, lng);
        return d <= 40;
      });
    },
    [location.lat, location.lng],
  );

  const nowMs = Date.now();
  const liveTrucks = filterByResolvedLocation(trucksRaw).map((truck) => {
    const liveState = truckIsLiveNow(truck, nowMs);
    const menuCount = Number((truck as unknown as { menuItemCount?: number; canonicalMenuCount?: number }).menuItemCount ??
      (truck as unknown as { menuItemCount?: number; canonicalMenuCount?: number }).canonicalMenuCount ??
      0);
    const photosAvailable = Boolean(imgSrc(truck));
    const hasServiceArea =
      Boolean((truck as unknown as { city?: string; state?: string; serviceArea?: unknown }).city) ||
      Boolean((truck as unknown as { city?: string; state?: string; serviceArea?: unknown }).state) ||
      Boolean((truck as unknown as { city?: string; state?: string; serviceArea?: unknown }).serviceArea);
    return {
      ...truck,
      ...liveState,
      canonicalBusinessId:
        truck.canonicalBusinessId ||
        truck.businessId ||
        truck.profileId ||
        truck.publicProfileId ||
        truck.restaurantId ||
        truck.truckId ||
        truck.id,
      source: "live" as const,
      menuAvailable: Number.isFinite(menuCount) && menuCount > 0,
      photosAvailable,
      verifiedTruck: true,
      insuranceVerified: true,
      scheduledToday: false,
      hasServiceArea,
    };
  });
  const discoverableTruckProfiles = filterByResolvedLocation(restaurantsRaw)
    .filter((restaurant) => isDiscoverableTruckProfile(restaurant))
    .map<Truck>((restaurant) => {
      const truckDraft: Truck = {
        id: restaurant.id,
        businessId: restaurant.businessId || restaurant.id,
        restaurantId: restaurant.restaurantId || restaurant.id,
        truckId: restaurant.truckId || restaurant.id,
        profileId: restaurant.profileId || restaurant.id,
        publicProfileId: restaurant.publicProfileId || restaurant.profileId || restaurant.id,
        canonicalBusinessId:
          restaurant.canonicalBusinessId ||
          restaurant.businessId ||
          restaurant.profileId ||
          restaurant.publicProfileId ||
          restaurant.restaurantId ||
          restaurant.truckId ||
          restaurant.id,
        name: restaurant.businessName || restaurant.name || "Food Truck",
        cuisineType: restaurant.cuisineType || null,
        logoUrl: restaurant.logoUrl || null,
        profileImageUrl: restaurant.profileImageUrl || null,
        truckPhotoLogo: restaurant.truckPhotoLogo || null,
        galleryImages: restaurant.galleryImages || null,
        coverImageUrl: restaurant.coverImageUrl || null,
        heroImageUrl: restaurant.heroImageUrl || null,
        imageUrl: restaurant.imageUrl || null,
        distanceMiles: restaurant.distanceMiles ?? restaurant.distance ?? null,
        latitude: restaurant.latitude ?? restaurant.lat ?? null,
        longitude: restaurant.longitude ?? restaurant.lng ?? null,
        lat: restaurant.lat ?? restaurant.latitude ?? null,
        lng: restaurant.lng ?? restaurant.longitude ?? null,
        mobileOnline: false,
        source: "discoverable",
        menuAvailable: Number(restaurant.menuItemCount ?? restaurant.canonicalMenuCount ?? 0) > 0,
        photosAvailable: Boolean(imgSrc(restaurant)),
        verifiedTruck:
          restaurant.adminVerified === true ||
          restaurant.emailVerified === true ||
          restaurant.isVerified === true,
        insuranceVerified: restaurant.insuranceVerified !== false,
        hasServiceArea:
          Boolean(restaurant.city && String(restaurant.city).trim()) ||
          Boolean(restaurant.state && String(restaurant.state).trim()) ||
          Boolean(restaurant.serviceArea) ||
          (Array.isArray(restaurant.serviceAreas) && restaurant.serviceAreas.length > 0),
      };
      const liveState = truckIsLiveNow(truckDraft, nowMs);
      return {
        ...truckDraft,
        ...liveState,
        scheduledToday: truckScheduleIndicatesScheduledToday({
          ...truckDraft,
          ...liveState,
        }),
      };
    });
  const trucksById = new Map<string, Truck>();
  discoverableTruckProfiles.forEach((truck) => {
    const key = canonicalScoutEntityKey(truck);
    if (!key) return;
    trucksById.set(key, truck);
  });
  liveTrucks.forEach((truck) => {
    const key = canonicalScoutEntityKey(truck);
    if (!key) return;
    const existing = trucksById.get(key);
    if (!existing) {
      trucksById.set(key, truck);
      return;
    }
    const existingImage = getBestBusinessImage(existing);
    const incomingImage = getBestBusinessImage(truck);
    trucksById.set(key, {
      ...existing,
      ...truck,
      id: existing.id || truck.id,
      canonicalBusinessId: existing.canonicalBusinessId || truck.canonicalBusinessId || key,
      liveNow: Boolean(existing.liveNow || truck.liveNow),
      liveSource:
        truck.liveSource === "location_update" ||
        existing.liveSource !== "location_update"
          ? truck.liveSource
          : existing.liveSource,
      scheduledToday: Boolean(existing.scheduledToday || truck.scheduledToday),
      menuAvailable: Boolean(existing.menuAvailable || truck.menuAvailable),
      photosAvailable: Boolean(existing.photosAvailable || truck.photosAvailable),
      source: truck.source === "live" || existing.source === "live" ? "live" : "discoverable",
      logoUrl: existing.logoUrl || truck.logoUrl || null,
      profileImageUrl: existing.profileImageUrl || truck.profileImageUrl || null,
      coverImageUrl: existing.coverImageUrl || truck.coverImageUrl || null,
      truckPhotoLogo: existing.truckPhotoLogo || truck.truckPhotoLogo || null,
      heroImageUrl: existing.heroImageUrl || truck.heroImageUrl || null,
      imageUrl: existingImage || incomingImage,
      galleryImages: existing.galleryImages || truck.galleryImages || null,
    });
  });
  const trucks = Array.from(trucksById.values())
    .sort((a, b) => {
      const aLiveRank = a.liveNow ? (a.liveSource === "location_update" ? 2 : 1) : 0;
      const bLiveRank = b.liveNow ? (b.liveSource === "location_update" ? 2 : 1) : 0;
      if (aLiveRank !== bLiveRank) return bLiveRank - aLiveRank;
      const aScheduledRank = a.scheduledToday ? 1 : 0;
      const bScheduledRank = b.scheduledToday ? 1 : 0;
      if (aScheduledRank !== bScheduledRank) return bScheduledRank - aScheduledRank;
      const aDistance = Number(a.distanceMiles ?? Number.POSITIVE_INFINITY);
      const bDistance = Number(b.distanceMiles ?? Number.POSITIVE_INFINITY);
      if (aDistance !== bDistance) return aDistance - bDistance;
      const aCompleteness = (a.menuAvailable ? 1 : 0) + (a.photosAvailable ? 1 : 0);
      const bCompleteness = (b.menuAvailable ? 1 : 0) + (b.photosAvailable ? 1 : 0);
      if (aCompleteness !== bCompleteness) return bCompleteness - aCompleteness;
      return String(a.name || "").localeCompare(String(b.name || ""));
    })
    .slice(0, 20);

  const surfaceProfileContextById = useMemo(() => {
    const map = new Map<string, ScoutProfileContext>();
    const indexContext = (aliases: string[], context: ScoutProfileContext) => {
      aliases.forEach((alias) => {
        if (!alias) return;
        map.set(alias, context);
      });
    };

    restaurantsRaw.forEach((restaurant) => {
      const aliases = buildEntityAliases(restaurant);
      if (aliases.length === 0) return;
      indexContext(aliases, {
        entityType:
          restaurant.isFoodTruck === true ||
          String(restaurant.businessType || "").toLowerCase() === "food_truck"
            ? "truck"
            : "restaurant",
        verifiedProfile:
          restaurant.adminVerified === true ||
          restaurant.emailVerified === true ||
          restaurant.isVerified === true,
        hasMenu: Number(restaurant.menuItemCount ?? restaurant.canonicalMenuCount ?? 0) > 0,
        hasPhoto: Boolean(imgSrc(restaurant)),
        liveNow: false,
        scheduledToday: false,
      });
    });

    trucks.forEach((truck) => {
      const aliases = buildEntityAliases(truck);
      if (aliases.length === 0) return;
      indexContext(aliases, {
        entityType: "truck",
        verifiedProfile: truck.verifiedTruck === true,
        hasMenu: truck.menuAvailable === true,
        hasPhoto: Boolean(imgSrc(truck)),
        liveNow: truck.liveNow === true,
        scheduledToday: truck.scheduledToday === true,
      });
    });

    return map;
  }, [restaurantsRaw, trucks]);

  const surfaceCards = useMemo<SurfaceScoutCard[]>(() => {
    const sections = scoutSurfaceData?.sections ?? [];
    return sections.flatMap((section) =>
      (section.cards || []).map((card) => ({
        ...card,
        sectionId: section.id,
        sectionTitle: section.title,
      })),
    );
  }, [scoutSurfaceData]);

  const todayAroundYouCards = useMemo(
    () =>
      prioritizeSurfaceCards(
        surfaceCards.filter((card) => card.sectionId === "nearby-now"),
        {
          laneId: "for_you",
          profileContextById: surfaceProfileContextById,
        },
      ),
    [surfaceCards, surfaceProfileContextById],
  );
  const communitySurfaceCards = useMemo(
    () =>
      prioritizeSurfaceCards(
        dedupeSurfaceCards(
          surfaceCards.filter(
            (card) =>
              card.sectionId === "recommended-nearby" ||
              card.source === "community" ||
              card.source === "recommendation",
          ),
        ),
        {
          laneId: "community",
          profileContextById: surfaceProfileContextById,
        },
      ),
    [surfaceCards, surfaceProfileContextById],
  );
  const nearbyNowSurfaceCards = useMemo(
    () =>
      prioritizeSurfaceCards(
        dedupeSurfaceCards(
          surfaceCards.filter(
            (card) =>
              ["serving_now", "open_now", "deal_today", "event_today"].includes(card.availability) ||
              ["open-near-you", "deals-today", "happening-today"].includes(card.sectionId),
          ),
        ),
        {
          laneId: "nearby_now",
          profileContextById: surfaceProfileContextById,
        },
      ),
    [surfaceCards, surfaceProfileContextById],
  );
  const worthDiscoveringSurfaceCards = useMemo(
    () =>
      prioritizeSurfaceCards(
        dedupeSurfaceCards(
          surfaceCards.filter(
            (card) =>
              card.sectionId === "more-nearby" ||
              card.availability === "nearby" ||
              card.availability === "upcoming" ||
              card.statusLabel === "No schedule",
          ),
        ),
        {
          laneId: "worth_discovering",
          profileContextById: surfaceProfileContextById,
        },
      ),
    [surfaceCards, surfaceProfileContextById],
  );
  const lateNightSurfaceCards = useMemo(
    () =>
      prioritizeSurfaceCards(
        nearbyNowSurfaceCards.filter((card) => card.availability === "open_now"),
        {
          laneId: "late_night",
          profileContextById: surfaceProfileContextById,
        },
      ),
    [nearbyNowSurfaceCards, surfaceProfileContextById],
  );
  const foodTruckSurfaceCards = useMemo(
    () =>
      prioritizeSurfaceCards(
        dedupeSurfaceCards(surfaceCards.filter((card) => card.entityType === "truck")),
        {
          laneId: "food_trucks",
          profileContextById: surfaceProfileContextById,
        },
      ),
    [surfaceCards, surfaceProfileContextById],
  );
  const featuredTodayKeys = useMemo(
    () => new Set(todayAroundYouCards.slice(0, 4).map((card) => surfaceCardKey(card))),
    [todayAroundYouCards],
  );
  const featuredCommunityKeys = useMemo(
    () => new Set(communitySurfaceCards.slice(0, 3).map((card) => surfaceCardKey(card))),
    [communitySurfaceCards],
  );
  const fallbackSurfaceCards = useMemo(
    () =>
      prioritizeSurfaceCards(
        dedupeSurfaceCards([
          ...todayAroundYouCards,
          ...nearbyNowSurfaceCards,
          ...communitySurfaceCards,
          ...worthDiscoveringSurfaceCards,
        ]),
        {
          laneId: "for_you",
          profileContextById: surfaceProfileContextById,
          suppressKeys: featuredTodayKeys,
          suppressLimit: 3,
        },
      ),
    [
      communitySurfaceCards,
      nearbyNowSurfaceCards,
      featuredTodayKeys,
      surfaceProfileContextById,
      todayAroundYouCards,
      worthDiscoveringSurfaceCards,
    ],
  );
  const sceneSurfaceCards = useMemo(() => {
    if (activeScene === "community") {
      return prioritizeSurfaceCards(
        dedupeSurfaceCards([
          ...communitySurfaceCards,
          ...nearbyNowSurfaceCards,
          ...worthDiscoveringSurfaceCards,
        ]),
        {
          laneId: "community",
          profileContextById: surfaceProfileContextById,
          suppressKeys: featuredTodayKeys,
          suppressLimit: 2,
        },
      );
    }
    if (activeScene === "nearby_now") {
      return prioritizeSurfaceCards(
        dedupeSurfaceCards([
          ...nearbyNowSurfaceCards,
          ...todayAroundYouCards,
          ...worthDiscoveringSurfaceCards,
        ]),
        {
          laneId: "nearby_now",
          profileContextById: surfaceProfileContextById,
          suppressKeys: featuredTodayKeys,
          suppressLimit: 2,
        },
      );
    }
    if (activeScene === "late_night") {
      return prioritizeSurfaceCards(
        dedupeSurfaceCards([
          ...lateNightSurfaceCards,
          ...nearbyNowSurfaceCards,
          ...worthDiscoveringSurfaceCards,
        ]),
        {
          laneId: "late_night",
          profileContextById: surfaceProfileContextById,
          suppressKeys: featuredTodayKeys,
          suppressLimit: 1,
        },
      );
    }
    if (activeScene === "worth_discovering") {
      return prioritizeSurfaceCards(
        dedupeSurfaceCards([
          ...worthDiscoveringSurfaceCards,
          ...communitySurfaceCards,
          ...nearbyNowSurfaceCards,
        ]),
        {
          laneId: "worth_discovering",
          profileContextById: surfaceProfileContextById,
          suppressKeys: new Set([...featuredTodayKeys, ...featuredCommunityKeys]),
          suppressLimit: 1,
        },
      );
    }
    if (activeScene === "food_trucks") {
      return foodTruckSurfaceCards;
    }
    return prioritizeSurfaceCards(
      dedupeSurfaceCards([
        ...todayAroundYouCards,
        ...communitySurfaceCards,
        ...nearbyNowSurfaceCards,
        ...worthDiscoveringSurfaceCards,
      ]),
      {
        laneId: "for_you",
        profileContextById: surfaceProfileContextById,
      },
    );
  }, [
    activeScene,
    communitySurfaceCards,
    featuredCommunityKeys,
    featuredTodayKeys,
    foodTruckSurfaceCards,
    lateNightSurfaceCards,
    nearbyNowSurfaceCards,
    surfaceProfileContextById,
    todayAroundYouCards,
    worthDiscoveringSurfaceCards,
  ]);

  const truckFeedItems = useMemo<ScoutFeedItem[]>(
    () =>
      trucks.map((t) => {
        const name = t.name || "Food Truck";
        const hasExactLocation =
          Number.isFinite(Number(t.latitude ?? t.lat)) &&
          Number.isFinite(Number(t.longitude ?? t.lng));
        const nonLiveLocationLabel = hasExactLocation ? "Serving area" : "Location not posted";
        return {
          id: `truck-${t.id}`,
          type: "FOOD TRUCK",
          typeColor: "#9333ea",
          image: imgSrc(t),
          title: name,
          subtitle: [
            t.cuisineType,
            t.liveNow
              ? t.liveSource === "scheduled_now"
                ? "Live now · Scheduled"
                : "Live now"
              : t.scheduledToday
                ? "Scheduled today"
                : nonLiveLocationLabel,
            t.liveNow ? null : "Not live now",
            t.menuAvailable ? "Menu available" : "Menu: none found",
            t.photosAvailable ? null : "Photos coming soon",
            t.verifiedTruck ? "Verified truck" : null,
          ]
            .filter(Boolean)
            .join(" • "),
          tag: t.liveNow
            ? t.liveSource === "scheduled_now"
              ? "Live now · Scheduled"
              : "Live now"
            : t.scheduledToday
              ? "Scheduled today"
              : "Not live now",
          tagColor: t.liveNow ? "#10b981" : "#9333ea",
          distance: distLabel(t),
          href:
            buildPublicProfilePath({
              entityType: "truck",
              id: t.id,
              name,
            }) || `/truck/${t.id}`,
          routeHref: t.liveNow
            ? routeUrl(t.latitude ?? t.lat, t.longitude ?? t.lng, name)
            : null,
          searchCity: "",
          searchDescription: [t.cuisineType, t.liveSource, t.source].filter(Boolean).join(" "),
          ctaLabel: t.liveNow ? "Go now" : "View details",
        };
      }),
    [trucks],
  );

  const tileCounts = useMemo(
    () => ({
      community:
        communitySurfaceCards.length > 0 ? `${communitySurfaceCards.length} picks` : "",
      food_trucks:
        trucks.length > 0
          ? `${trucks.length} nearby`
          : foodTruckSurfaceCards.length > 0
            ? `${foodTruckSurfaceCards.length} nearby`
            : "",
      nearby_now:
        nearbyNowSurfaceCards.length > 0 ? `${nearbyNowSurfaceCards.length} live` : "",
      late_night:
        lateNightSurfaceCards.length > 0 ? `${lateNightSurfaceCards.length} open` : "",
      worth_discovering:
        worthDiscoveringSurfaceCards.length > 0
          ? `${worthDiscoveringSurfaceCards.length} to try`
          : "",
    }),
    [
      communitySurfaceCards.length,
      foodTruckSurfaceCards.length,
      lateNightSurfaceCards.length,
      nearbyNowSurfaceCards.length,
      trucks.length,
      worthDiscoveringSurfaceCards.length,
    ],
  );

  /* ─── feed items based on active scene ─── */
  const feedItems = useMemo(() => {
    const items: ScoutFeedItem[] = [];
    const seen = new Set<string>();
    let sourceOrder = 0;

    const addFeedItem = (item: ScoutFeedItem) => {
      const key = item.href || item.id;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({
        ...item,
        searchOrder: sourceOrder++,
      });
    };

    const addSurfaceCards = (cards: SurfaceScoutCard[], maxItems: number) => {
      for (const card of cards) {
        addFeedItem(buildSurfaceFeedItem(card, sourceOrder, surfaceProfileContextById));
        if (items.length >= maxItems) break;
      }
    };

    const addTruckCards = (maxItems: number) => {
      for (const item of truckFeedItems) {
        addFeedItem(item);
        if (items.length >= maxItems) break;
      }
    };

    if (activeScene === "food_trucks") {
      addTruckCards(10);
      if (items.length < 12) addSurfaceCards(foodTruckSurfaceCards, 12);
    } else {
      addSurfaceCards(sceneSurfaceCards, 12);
      if (items.length < 6) addTruckCards(8);
      if (items.length < 10) addSurfaceCards(fallbackSurfaceCards, 12);
      if (items.length < 12 && CONTAINED_SCOUT_SCENE_IDS.has(activeScene)) addTruckCards(12);
    }

    const query = submittedQuery.trim();
    if (!query) return items.slice(0, 15);

    const withScores = items.map((item) => ({
      item,
      score: scoreScoutSearchResult(
        {
          title: item.title,
          subtitle: item.subtitle,
          type: item.type,
          tag: item.tag,
          city: item.searchCity,
          description: item.searchDescription,
        },
        query,
      ),
    }));

    const relevant = withScores
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        const aDistance = Number(a.item.distance?.replace(" mi", "") || Number.POSITIVE_INFINITY);
        const bDistance = Number(b.item.distance?.replace(" mi", "") || Number.POSITIVE_INFINITY);
        if (aDistance !== bDistance) return aDistance - bDistance;
        return Number(a.item.searchOrder || 0) - Number(b.item.searchOrder || 0);
      })
      .map((entry) => entry.item);

    if (relevant.length > 0) return relevant.slice(0, 15);
    return items.slice(0, 15);
  }, [
    activeScene,
    fallbackSurfaceCards,
    foodTruckSurfaceCards,
    sceneSurfaceCards,
    surfaceProfileContextById,
    submittedQuery,
    truckFeedItems,
  ]);

  /* ─── toggle saved ─── */
  const toggleSaved = useCallback(async (id: string) => {
    setSavedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    try {
      await fetch(apiUrl(`/api/favorites/restaurants/${id}`), {
        method: savedIds.has(id) ? "DELETE" : "POST",
        credentials: "include",
      });
    } catch { /* optimistic — ignore */ }
  }, [savedIds]);

  /* ─── map ─── */
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = L.map(mapContainer.current, {
      zoomControl: false, attributionControl: false,
    }).setView([location.lat, location.lng], 14);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
    }).addTo(map.current);

    // Give Leaflet one frame after mount to measure and center correctly.
    requestAnimationFrame(() => {
      recenterMapToLocation();
    });

    return () => { map.current?.remove(); map.current = null; };
  }, [recenterMapToLocation]);

  useEffect(() => {
    recenterMapToLocation();
  }, [recenterMapToLocation]);

  useEffect(() => {
    const onResize = () => {
      recenterMapToLocation();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.addEventListener("focus", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("focus", onResize);
    };
  }, [recenterMapToLocation]);

  /* ─── map pins update when data changes ─── */
  useEffect(() => {
    if (!map.current) return;
    map.current.eachLayer(layer => {
      if (layer instanceof L.Marker) map.current!.removeLayer(layer);
    });

    // User location
    const userIcon = L.divIcon({
      className: "sp-user",
      html: `<div style="position:relative;width:18px;height:18px;">
        <div style="position:absolute;inset:-8px;border-radius:50%;background:#3b82f633;animation:pulse 2s infinite;"></div>
        <div style="width:18px;height:18px;border-radius:50%;background:#3b82f6;border:2.5px solid white;box-shadow:0 0 18px #3b82f6aa;"></div>
      </div>`,
      iconSize: [18, 18], iconAnchor: [9, 9],
    });
    L.marker([location.lat, location.lng], { icon: userIcon }).addTo(map.current);

    const addSurfaceMarkers = (cards: SurfaceScoutCard[], maxItems: number) => {
      let count = 0;
      cards.forEach((card) => {
        if (count >= maxItems) return;
        const lat = Number((card.metadata as { lat?: number } | undefined)?.lat);
        const lng = Number((card.metadata as { lng?: number } | undefined)?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const iconSvg =
          card.entityType === "truck"
            ? PIN_SVGS.truck
            : card.entityType === "deal"
              ? PIN_SVGS.deal
              : card.entityType === "event" || card.entityType === "host_spot"
                ? PIN_SVGS.event
                : card.source === "community" || card.source === "recommendation"
                  ? PIN_SVGS.star
                  : PIN_SVGS.restaurant;
        const icon = L.divIcon({
          className: "sp-pin",
          html: pinHtml(
            getSurfaceTagColor(
              card,
              getSurfaceProfileSignals(card, surfaceProfileContextById),
            ),
            iconSvg,
          ),
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        const marker = L.marker([lat, lng], { icon }).addTo(map.current!);
        marker.on("click", () => navigate(card.cta.href));
        count += 1;
      });
      return count;
    };

    const addTruckMarkers = (maxItems: number) => {
      let count = 0;
      trucks.forEach((t) => {
        if (count >= maxItems) return;
        const lat = t.latitude ?? t.lat;
        const lng = t.longitude ?? t.lng;
        if (!lat || !lng) return;
        const icon = L.divIcon({
          className: "sp-pin",
          html: pinHtml("#9333ea", PIN_SVGS.truck),
          iconSize: [32, 32], iconAnchor: [16, 16],
        });
        const marker = L.marker([lat, lng], { icon }).addTo(map.current!);
        marker.on("click", () =>
          navigate(
            buildPublicProfilePath({
              entityType: "truck",
              id: t.id,
              name: t.name || "Food Truck",
            }) || `/truck/${t.id}`,
          ),
        );
        count += 1;
      });
      return count;
    };

    if (activeScene === "food_trucks") {
      addTruckMarkers(8);
      return;
    }

    const sceneMarkerCount = addSurfaceMarkers(sceneSurfaceCards, 8);
    if (sceneMarkerCount < 4) {
      addTruckMarkers(8 - sceneMarkerCount);
    }
  }, [activeScene, location, navigate, sceneSurfaceCards, surfaceProfileContextById, trucks]);

  /* ─── section title based on scene ─── */
  const sectionTitle = useMemo(() => {
    const lane = SCENE_LANES.find(l => l.id === activeScene);
    return lane?.label ?? "Today Around You";
  }, [activeScene]);

  const scoutSurfaceMode = scoutSurfaceData?.mode || "quiet";
  const coverageBadgeLabel =
    scoutSurfaceMode === "activity"
      ? "Live"
      : scoutSurfaceMode === "discovery"
        ? "Discovery"
        : "Low coverage";
  const sectionSubtitle = useMemo(() => {
    if (activeScene === "for_you") {
      return scoutSurfaceMode === "quiet"
        ? `Nearby food, trucks, deals, and events around ${location.label}.`
        : `Restaurants, trucks, deals, and events near ${location.label}.`;
    }
    if (activeScene === "community") {
      return communitySurfaceCards.length > 0
        ? `${communitySurfaceCards.length} local picks near ${location.label}.`
        : `Explore nearby food and local favorites around ${location.label}.`;
    }
    if (activeScene === "nearby_now") {
      return nearbyNowSurfaceCards.length > 0
        ? `${nearbyNowSurfaceCards.length} nearby places with live, open, or today signals near ${location.label}.`
        : `Nearby food options around ${location.label}.`;
    }
    if (activeScene === "food_trucks") {
      return `${trucks.length || "No"} food trucks near ${location.label}.`;
    }
    if (activeScene === "late_night") {
      return lateNightSurfaceCards.length > 0
        ? `${lateNightSurfaceCards.length} open-now options with current hours signals near ${location.label}.`
        : `Late-night food options near ${location.label}.`;
    }
    if (activeScene === "worth_discovering") {
      return worthDiscoveringSurfaceCards.length > 0
        ? `${worthDiscoveringSurfaceCards.length} nearby spots worth checking.`
        : `More nearby spots worth checking around ${location.label}.`;
    }
    return `Local food near ${location.label}.`;
  }, [
    activeScene,
    communitySurfaceCards.length,
    lateNightSurfaceCards.length,
    location,
    nearbyNowSurfaceCards.length,
    scoutSurfaceMode,
    trucks.length,
    worthDiscoveringSurfaceCards.length,
  ]);

  /* ─── empty state ─── */
  const isEmpty = feedItems.length === 0;
  const quickSearchChips = ["Tacos", "BBQ", "Dessert", "Food Trucks", "Late Night"];
  const handleSearchSubmit = () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSubmittedQuery(q);
    setSearchOpen(false);
  };

  return (
    <div
      data-scout-layout-contract="true"
      className="h-screen w-full bg-[#0d0d0d] text-white flex flex-col overflow-hidden font-sans"
      style={scoutLayoutVars}
    >
      <style>{customStyles}</style>

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-3 bg-[#0d0d0d] border-b border-white/5 shrink-0 z-30">
        <div className="flex items-center">
          <img
            src="/brand/meal-scout-icon.png"
            alt="MealScout"
            className="h-8 w-8 object-contain"
            loading="eager"
          />
          <span className="ml-2 rounded-full border border-orange-500/25 bg-[#1d130d] px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-orange-200">
            Early access
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="text-white/70 hover:text-white transition-colors"
            aria-label="Open Scout search"
          >
            <Search size={22} />
          </button>
          <Link href={user ? "/profile" : "/login"}>
            {user ? (
              <div className="w-8 h-8 rounded-full bg-orange-500/20 border border-orange-500/30 flex items-center justify-center">
                <User size={16} className="text-orange-400" />
              </div>
            ) : (
              <User size={22} className="text-white/70 hover:text-white transition-colors" />
            )}
          </Link>
        </div>
      </header>

      {/* ── Map — 25vh ── */}
      <div className="relative shrink-0 overflow-hidden" style={{ height: "25vh" }}>
        <div ref={mapContainer} className="h-full w-full" />
        {/* Map controls */}
        <div className="absolute top-3 right-3 flex flex-col gap-2 z-[400]">
          <button
            onClick={() => map.current?.locate({ setView: true, maxZoom: 15 })}
            className="w-9 h-9 bg-[#1a1a1a]/90 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white/70 shadow-xl hover:text-white transition-colors"
            aria-label="Center on my location"
          >
            <Navigation2 size={16} />
          </button>
          <button
            onClick={() => map.current?.setView([location.lat, location.lng], 14)}
            className="w-9 h-9 bg-[#1a1a1a]/90 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10 text-white/70 shadow-xl hover:text-white transition-colors"
            aria-label="Reset map view"
          >
            <MapPin size={16} />
          </button>
        </div>
        {/* Location label */}
        <div className="absolute bottom-3 left-3 z-[400]">
          <div className="bg-[#0d0d0d]/80 backdrop-blur-md px-3 py-1 rounded-full border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/70">
            {resolvedLocationLabel}
          </div>
        </div>
      </div>

      {/* ── Unified Scout bottom control dock ── */}
      <div
        data-scout-search-dock="true"
        className="fixed inset-x-0 z-[1000] pointer-events-none"
        style={{ bottom: scoutDockBottom }}
      >
        <div className="w-full px-0 pointer-events-auto">
          {searchOpen && (
            <section
              className="mx-2 mb-2 rounded-2xl border border-white/10 bg-[#0f0d0b]/96 px-3 py-3 shadow-[0_-12px_24px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
              aria-label="Scout search sheet"
            >
              <div className="flex items-center gap-2">
                <Search size={16} className="text-orange-400 shrink-0" />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearchSubmit();
                  }}
                  placeholder="Search truck names, cuisine, or nearby food"
                  className="h-9 flex-1 rounded-xl border border-white/10 bg-[#171412] px-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-orange-400/45"
                />
                <button
                  type="button"
                  onClick={() => setSearchOpen(false)}
                  className="h-9 rounded-xl border border-white/10 bg-[#171412] px-3 text-xs font-semibold text-white/80 hover:text-white"
                >
                  Close
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {quickSearchChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setSearchQuery(chip)}
                    className="h-7 rounded-full border border-white/10 bg-[#171412] px-2.5 text-[11px] font-medium text-white/80 hover:border-orange-500/30 hover:text-white"
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleSearchSubmit}
                  disabled={!searchQuery.trim()}
                  className="h-8 rounded-lg border border-orange-500/30 bg-[#1d130d] px-3 text-xs font-semibold text-orange-200 disabled:opacity-45"
                >
                  Search
                </button>
              </div>
            </section>
          )}
          <div className="overflow-hidden rounded-t-2xl rounded-b-none border border-b-0 border-white/8 bg-[#0f0d0b]/95 backdrop-blur-xl">
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar px-2 py-2">
              {EXPLORE_TILES.map(tile => {
                const count = tileCounts[tile.id as keyof typeof tileCounts] || tile.count;
                return (
                  <button
                    key={tile.id}
                    onClick={() => {
                      setActiveScene(tile.id);
                      navigate(`/scout?scene=${encodeURIComponent(tile.id)}`);
                    }}
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 border transition-all duration-200 min-w-[84px] h-8 ${
                      activeScene === tile.id
                        ? "bg-[#1f1a15] border-orange-500/35 text-orange-200"
                        : "bg-[#171412] border-white/5 hover:border-orange-500/18"
                    }`}
                  >
                    <div className="w-4 h-4 flex items-center justify-center shrink-0" style={{ color: tile.color }}>
                      <span className="scale-[0.85]">{tile.icon}</span>
                    </div>
                    <span className="text-[10px] font-bold text-white/95 leading-none truncate">{tile.label}</span>
                    {count && <span className="text-[9px] font-semibold leading-none text-white/60">{count}</span>}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex h-[46px] w-full items-center gap-2 border-0 border-t border-white/8 bg-transparent px-4 text-left text-[13px] font-semibold text-white/88"
              aria-label="Search truck names, cuisine, or nearby food"
            >
              <Search size={16} className="text-orange-400 shrink-0" />
              <span className="truncate">Search truck names, cuisine, or nearby food</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Feed ── */}
      <div
        data-scout-feed="true"
        className="flex-1 overflow-y-auto px-4 no-scrollbar"
        style={{ paddingBottom: feedBottomClearance }}
      >
        {submittedQuery.trim().length > 0 && (
          <section className="mb-3 mt-3 rounded-2xl border border-white/8 bg-[#151210] px-4 py-3">
            <h3 className="text-sm font-bold text-white">Results for "{submittedQuery}"</h3>
            <p className="mt-1 text-xs text-white/70">
              Local matches use nearby, live, and community-backed discovery signals when available.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(true);
                  setSearchQuery(submittedQuery);
                }}
                className="h-8 rounded-lg border border-white/12 bg-[#1a1714] px-3 text-xs font-semibold text-white/85"
              >
                Refine
              </button>
              <button
                type="button"
                onClick={() => map.current?.setView([location.lat, location.lng], 14)}
                className="h-8 rounded-lg border border-orange-500/28 bg-[#1d130d] px-3 text-xs font-semibold text-orange-200"
              >
                View map
              </button>
            </div>
          </section>
        )}
        {/* Section header */}
        <div className="flex items-center justify-between mb-3 mt-3">
          <div>
            <h2 className="text-lg font-black uppercase tracking-tighter leading-none mb-0.5">{sectionTitle}</h2>
            <p className="text-[11px] leading-tight text-gray-400 font-medium">{sectionSubtitle}</p>
          </div>
          <span className="text-orange-500 font-bold text-xs uppercase tracking-wider shrink-0 ml-3">
            {coverageBadgeLabel}
          </span>
        </div>

        {/* Feed cards */}
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Flame size={32} className="text-orange-500/30 mb-3" />
            <p className="text-white/40 text-sm font-semibold">No strong local signals yet</p>
            <p className="text-white/25 text-xs mt-1">Try another lane or search a wider nearby area</p>
          </div>
        ) : (
          <div className="space-y-3">
            {feedItems.map(item => (
              <FeedCard
                key={item.id}
                {...item}
                isFavorited={item.restaurantId ? savedIds.has(item.restaurantId) : false}
                onToggleFavorite={toggleSaved}
              />
            ))}
          </div>
        )}
        <div aria-hidden="true" className="h-3" />
      </div>

    </div>
  );
}
