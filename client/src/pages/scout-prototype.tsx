import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Link, useLocation as useWouterLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Bookmark, Bell, Compass, Search, Heart, User,
  Navigation2, MapPin, Truck, Utensils, DollarSign,
  Clock, Star, Award, Flame, CalendarDays, Tag,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAuth } from "@/hooks/useAuth";
import { getReverseGeocodedLocationName } from "@/utils/locationUtils";
import { isBarBusinessType } from "@shared/businessTypes";
import { apiUrl } from "@/lib/api";
import { buildPublicProfilePath } from "@/lib/public-profile-path";

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

interface Deal {
  id: string;
  title?: string | null;
  description?: string | null;
  restaurantName?: string | null;
  imageUrl?: string | null;
  discountText?: string | null;
}

interface ScoutEvent {
  id: string;
  title?: string | null;
  name?: string | null;
  startsAt?: string | null;
  venueName?: string | null;
  imageUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
}

/* ─── scene lanes ─── */
const SCENE_LANES = [
  { id: "for_you", label: "For You", icon: <Compass size={14} />, color: "#ff5c00" },
  { id: "community", label: "Community", icon: <User size={14} />, color: "#9333ea" },
  { id: "nearby_now", label: "Nearby", icon: <Navigation2 size={14} />, color: "#3b82f6" },
  { id: "food_trucks", label: "Food Trucks", icon: <Truck size={14} />, color: "#ff5c00" },
  { id: "restaurants", label: "Restaurants", icon: <Utensils size={14} />, color: "#ff5c00" },
  { id: "deals", label: "Deals", icon: <DollarSign size={14} />, color: "#10b981" },
  { id: "events", label: "Events", icon: <CalendarDays size={14} />, color: "#3b82f6" },
  { id: "new_menus", label: "New Menus", icon: <Star size={14} />, color: "#ec4899" },
  { id: "late_night", label: "Late Night", icon: <Clock size={14} />, color: "#6366f1" },
  { id: "worth_discovering", label: "Worth Discovering", icon: <Award size={14} />, color: "#eab308" },
];

/* ─── explore tiles ─── */
const EXPLORE_TILES = [
  { id: "community", label: "Community", count: "", icon: <User size={18} />, color: "#9333ea", href: "/scout?scene=community" },
  { id: "food_trucks", label: "Food Trucks", count: "", icon: <Truck size={18} />, color: "#ff5c00", href: "/scout?scene=food_trucks" },
  { id: "restaurants", label: "Restaurants", count: "", icon: <Utensils size={18} />, color: "#ff5c00", href: "/scout?scene=restaurants" },
  { id: "deals", label: "Deals", count: "", icon: <DollarSign size={18} />, color: "#10b981", href: "/scout?scene=deals" },
  { id: "events", label: "Events", count: "", icon: <CalendarDays size={18} />, color: "#3b82f6", href: "/scout?scene=events" },
  { id: "new_menus", label: "New Menus", count: "", icon: <Star size={18} />, color: "#ec4899", href: "/scout?scene=new_menus" },
  { id: "late_night", label: "Late Night", count: "", icon: <Clock size={18} />, color: "#6366f1", href: "/scout?scene=late_night" },
  { id: "worth_discovering", label: "Worth Discovering", count: "", icon: <Award size={18} />, color: "#eab308", href: "/scout?scene=worth_discovering" },
];

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

function hasRestaurantScheduleData(restaurant: Restaurant) {
  const candidate = restaurant as Restaurant & {
    operatingHours?: unknown;
    hours?: unknown;
    businessHours?: unknown;
    schedule?: unknown;
    isOpen?: unknown;
    openNow?: unknown;
  };
  const schedule =
    candidate.operatingHours ??
    candidate.hours ??
    candidate.businessHours ??
    candidate.schedule;
  if (Array.isArray(schedule)) return schedule.length > 0;
  if (schedule && typeof schedule === "object") return Object.keys(schedule as object).length > 0;
  if (typeof schedule === "string" && schedule.trim().length > 0) return true;
  if (typeof candidate.isOpen === "boolean" || typeof candidate.openNow === "boolean") return true;
  return false;
}

function restaurantServingStatus(restaurant: Restaurant): "open_now" | "closed_now" | "no_schedule" {
  const candidate = restaurant as Restaurant & {
    isOpen?: unknown;
    openNow?: unknown;
    currentlyOpen?: unknown;
    isCurrentlyOpen?: unknown;
    openStatus?: unknown;
    status?: unknown;
    hoursStatus?: unknown;
  };
  if (!hasRestaurantScheduleData(restaurant)) return "no_schedule";
  const explicit = [
    candidate.isOpen,
    candidate.openNow,
    candidate.currentlyOpen,
    candidate.isCurrentlyOpen,
  ].find((value) => typeof value === "boolean");
  if (typeof explicit === "boolean") return explicit ? "open_now" : "closed_now";
  const statusText = String(
    candidate.openStatus ?? candidate.status ?? candidate.hoursStatus ?? "",
  )
    .trim()
    .toLowerCase();
  if (statusText.includes("open") && !statusText.includes("closed")) return "open_now";
  return "closed_now";
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

/* ─── feed card ─── */
function FeedCard({
  type, typeColor, image, title, subtitle, tag, tagColor,
  distance, href, routeHref, restaurantId, isFavorited, onToggleFavorite,
}: {
  type: string; typeColor: string; image: string | null;
  title: string; subtitle: string; tag?: string; tagColor?: string;
  distance: string | null; href: string; routeHref: string | null;
  restaurantId?: string; isFavorited?: boolean; onToggleFavorite?: (id: string) => void;
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
            View
          </Link>
          {routeHref && (
            <a href={routeHref} target="_blank" rel="noopener noreferrer"
              className="bg-[#1e1e1e] border border-white/10 text-white/80 text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-lg hover:border-orange-500/40 transition-colors">
              Route
            </a>
          )}
          <button
            onClick={() => restaurantId && onToggleFavorite?.(restaurantId)}
            className="ml-auto"
            aria-label={isFavorited ? "Remove from saved" : "Save"}
          >
            <Bookmark size={15} className={isFavorited ? "text-orange-500 fill-orange-500" : "text-gray-600 hover:text-orange-500 transition-colors"} />
          </button>
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
  const feedBottomClearance = "calc(var(--scout-bottom-dock-height) + 28px)";

  const scoutPreviewCity = useMemo(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return (params.get("scoutPreview") || params.get("previewCity") || "")
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

  const { data: dealsRaw = [] } = useQuery<Deal[]>({
    queryKey: ["/api/deals/nearby", location.lat, location.lng],
    queryFn: async () => {
      const r = await fetch(apiUrl(`/api/deals/nearby/${location.lat}/${location.lng}?radius=25`), { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : (d?.deals ?? []);
    },
    staleTime: 60_000,
  });

  const { data: eventsRaw = [] } = useQuery<ScoutEvent[]>({
    queryKey: ["/api/events/public"],
    queryFn: async () => {
      const r = await fetch(apiUrl("/api/events/public"), { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : (d?.events ?? []);
    },
    staleTime: 60_000,
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
  const truckCanonicalKeys = new Set(
    trucks.map((truck) => canonicalScoutEntityKey(truck)).filter(Boolean),
  );
  const restaurants = filterByResolvedLocation(restaurantsRaw)
    .filter((restaurant) => {
      const restaurantKey = canonicalScoutEntityKey(restaurant);
      const isTruckType =
        String(restaurant.businessType || "").toLowerCase() === "food_truck" ||
        restaurant.isFoodTruck === true;
      if (isTruckType && truckCanonicalKeys.has(restaurantKey)) return false;
      return true;
    })
    .slice(0, 20);
  const deals = dealsRaw.slice(0, 10);
  const events = eventsRaw.slice(0, 10);

  const tileCounts = useMemo(() => ({
    food_trucks: trucks.length > 0 ? `${trucks.length} nearby` : "",
    restaurants: restaurants.length > 0 ? `${restaurants.length} nearby` : "",
    deals: deals.length > 0 ? `${deals.length} today` : "",
    events: events.length > 0 ? `${events.length} tonight` : "",
  }), [trucks, restaurants, deals, events]);

  /* ─── feed items based on active scene ─── */
  const feedItems = useMemo(() => {
    const items: Array<{
      id: string; type: string; typeColor: string; image: string | null;
      title: string; subtitle: string; tag?: string; tagColor?: string;
      distance: string | null; href: string; routeHref: string | null; restaurantId?: string;
      searchCity?: string;
      searchDescription?: string;
      searchOrder?: number;
    }> = [];
    let sourceOrder = 0;

    if (activeScene === "food_trucks" || activeScene === "for_you" || activeScene === "nearby_now") {
      trucks.forEach(t => {
        const name = t.name || "Food Truck";
        items.push({
          id: `truck-${t.id}`, type: "FOOD TRUCK", typeColor: "#9333ea",
          image: imgSrc(t), title: name,
          subtitle: [
            t.cuisineType,
            t.liveNow
              ? t.liveSource === "scheduled_now"
                ? "Live now · Scheduled"
                : "Live now"
              : t.scheduledToday
                ? "Scheduled today"
              : "Serving area",
            t.liveNow ? null : "Not live now",
            t.menuAvailable ? "Menu available" : "Menu coming soon",
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
          href: `/truck/${t.id}`,
          routeHref: routeUrl(t.latitude ?? t.lat, t.longitude ?? t.lng, name),
          searchCity: "",
          searchDescription: [t.cuisineType, t.liveSource, t.source].filter(Boolean).join(" "),
          searchOrder: sourceOrder++,
        });
      });
    }

    if (activeScene === "restaurants" || activeScene === "for_you" || activeScene === "nearby_now") {
      restaurants.forEach(r => {
        const isBar = isBarBusinessType(r.businessType);
        const name = r.businessName || r.name || (isBar ? "Bar" : "Restaurant");
        const hasDeals = (r.activeDealsCount ?? r.activeDealCount ?? 0) > 0;
        const serviceStatus = restaurantServingStatus(r);
        const statusTag =
          serviceStatus === "open_now"
            ? "Open now"
            : serviceStatus === "closed_now"
              ? "Closed now"
              : "No schedule";
        const statusColor =
          serviceStatus === "open_now"
            ? "#10b981"
            : serviceStatus === "closed_now"
              ? "#f59e0b"
              : "#94a3b8";
        items.push({
          id: `rest-${r.id}`, type: isBar ? "BAR" : "RESTAURANT", typeColor: "#ff5c00",
          image: imgSrc(r), title: name,
          subtitle: [isBar ? "Bar" : r.cuisineType, r.neighborhood || r.city, statusTag].filter(Boolean).join(" • "),
          tag: hasDeals ? "Deal available" : statusTag,
          tagColor: hasDeals ? "#10b981" : statusColor,
          distance: distLabel(r),
          href:
            buildPublicProfilePath({
              entityType: isBar ? "bar" : "restaurant",
              id: r.id,
              name,
            }) || (isBar ? `/bar/${r.id}` : `/restaurant/${r.id}`),
          routeHref: routeUrl(r.latitude ?? r.lat, r.longitude ?? r.lng, name),
          restaurantId: r.id,
          searchCity: String(r.city || r.state || ""),
          searchDescription: [r.cuisineType, r.neighborhood, r.businessType].filter(Boolean).join(" "),
          searchOrder: sourceOrder++,
        });
      });
    }

    if (activeScene === "deals" || activeScene === "for_you") {
      deals.forEach(d => {
        items.push({
          id: `deal-${d.id}`, type: "DEAL", typeColor: "#10b981",
          image: d.imageUrl || null, title: d.title || "Deal",
          subtitle: [d.restaurantName, d.discountText || d.description].filter(Boolean).join(" • "),
          tag: d.discountText || "Deal today", tagColor: "#10b981",
          distance: null, href: `/search?q=deals`, routeHref: null,
          searchCity: "",
          searchDescription: [d.restaurantName, d.description, d.discountText].filter(Boolean).join(" "),
          searchOrder: sourceOrder++,
        });
      });
    }

    if (activeScene === "events" || activeScene === "for_you") {
      events.forEach(e => {
        const name = e.title || e.name || "Event";
        items.push({
          id: `event-${e.id}`, type: "EVENT", typeColor: "#3b82f6",
          image: e.imageUrl || null, title: name,
          subtitle: [e.venueName, e.startsAt ? new Date(e.startsAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : null].filter(Boolean).join(" • "),
          tag: "Happening soon", tagColor: "#3b82f6",
          distance: null,
          href: `/event/${e.id}`,
          routeHref: routeUrl(e.latitude ?? e.lat, e.longitude ?? e.lng, name),
          searchCity: "",
          searchDescription: [e.venueName].filter(Boolean).join(" "),
          searchOrder: sourceOrder++,
        });
      });
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
  }, [activeScene, trucks, restaurants, deals, events, submittedQuery]);

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

    // Truck pins (live and discoverable truck profiles)
    trucks.slice(0, 8).forEach(t => {
      const lat = t.latitude ?? t.lat;
      const lng = t.longitude ?? t.lng;
      if (!lat || !lng) return;
      const icon = L.divIcon({
        className: "sp-pin",
        html: pinHtml("#9333ea", PIN_SVGS.truck),
        iconSize: [32, 32], iconAnchor: [16, 16],
      });
      const marker = L.marker([lat, lng], { icon }).addTo(map.current!);
      marker.on("click", () => navigate(`/truck/${t.id}`));
    });

    // Restaurant pins (must have schedule status, or stay off map)
    restaurants
      .filter((restaurant) => restaurantServingStatus(restaurant) !== "no_schedule")
      .slice(0, 8)
      .forEach(r => {
      const lat = r.latitude ?? r.lat;
      const lng = r.longitude ?? r.lng;
      if (!lat || !lng) return;
      const icon = L.divIcon({
        className: "sp-pin",
        html: pinHtml("#ff5c00", PIN_SVGS.restaurant),
        iconSize: [32, 32], iconAnchor: [16, 16],
      });
      const marker = L.marker([lat, lng], { icon }).addTo(map.current!);
      marker.on("click", () => navigate(`/restaurant/${r.id}`));
      });

    // Event pins
    events.slice(0, 4).forEach(e => {
      const lat = e.latitude ?? e.lat;
      const lng = e.longitude ?? e.lng;
      if (!lat || !lng) return;
      const icon = L.divIcon({
        className: "sp-pin",
        html: pinHtml("#3b82f6", PIN_SVGS.event),
        iconSize: [32, 32], iconAnchor: [16, 16],
      });
      L.marker([lat, lng], { icon }).addTo(map.current!);
    });

    // Deal pins
    deals.slice(0, 4).forEach(d => {
      // deals don't always have coords — skip if missing
    });

  }, [trucks, restaurants, events, location, navigate]);

  /* ─── section title based on scene ─── */
  const sectionTitle = useMemo(() => {
    const lane = SCENE_LANES.find(l => l.id === activeScene);
    return lane?.label ?? "Today Around You";
  }, [activeScene]);

  const sectionSubtitle = useMemo(() => {
    if (activeScene === "for_you") return "A local mix of what people are finding, with clear open/closed/schedule status.";
    if (activeScene === "food_trucks") return `${trucks.length || "No"} food trucks near ${location.label}.`;
    if (activeScene === "restaurants") return `${restaurants.length || "No"} restaurants near ${location.label}.`;
    if (activeScene === "deals") return `${deals.length || "No"} active deals near you.`;
    if (activeScene === "events") return `${events.length || "No"} events happening soon.`;
    return `Showing ${sectionTitle.toLowerCase()} near ${location.label}.`;
  }, [activeScene, trucks, restaurants, deals, events, location, sectionTitle]);

  /* ─── empty state ─── */
  const isEmpty = feedItems.length === 0;
  const quickSearchChips = ["Burgers", "Tacos", "Food Trucks", "Deals", "Events", "Late Night"];
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
        </div>
        <div className="flex items-center gap-3">
          <Link href="/alerts" className="relative">
            <Bell size={22} className="text-white/70 hover:text-white transition-colors" />
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-orange-500 rounded-full border-2 border-[#0d0d0d]" />
          </Link>
          <Link href="/profile">
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
                  placeholder="Search food, places, trucks, events"
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
                    onClick={() => setActiveScene(tile.id)}
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
              aria-label="Search food, places, trucks, events"
            >
              <Search size={16} className="text-orange-400 shrink-0" />
              <span className="truncate">Search food, places, trucks, events</span>
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
              Local matches will include places, dishes, trucks, deals, and events.
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
          <Link href="/search" className="text-orange-500 font-bold text-xs uppercase tracking-wider shrink-0 ml-3 hover:text-orange-400">
            See all
          </Link>
        </div>

        {/* Feed cards */}
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Flame size={32} className="text-orange-500/30 mb-3" />
            <p className="text-white/40 text-sm font-semibold">Nothing here yet</p>
            <p className="text-white/25 text-xs mt-1">Check back soon or try a different category</p>
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
