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
  businessName?: string | null;
  name?: string | null;
  cuisineType?: string | null;
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
}

interface Truck {
  id: string;
  name?: string | null;
  cuisineType?: string | null;
  coverImageUrl?: string | null;
  heroImageUrl?: string | null;
  imageUrl?: string | null;
  distanceMiles?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  lat?: number | null;
  lng?: number | null;
  mobileOnline?: boolean;
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

function imgSrc(r: { coverImageUrl?: string | null; heroImageUrl?: string | null; imageUrl?: string | null }) {
  return r.coverImageUrl || r.heroImageUrl || r.imageUrl || null;
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
  const [, navigate] = useWouterLocation();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const [activeScene, setActiveScene] = useState("for_you");
  const [deviceCoords, setDeviceCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationName, setLocationName] = useState("Pensacola");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  /* ─── location ─── */
  const location = useMemo(() => {
    if (deviceCoords) return { lat: deviceCoords.lat, lng: deviceCoords.lng, label: locationName };
    // Default to Pensacola downtown
    return { lat: 30.4213, lng: -87.2169, label: "Pensacola" };
  }, [deviceCoords, locationName]);

  /* ─── suppress global nav on this page ─── */
  useEffect(() => {
    document.body.classList.add("mealscout-map-fullscreen");
    return () => document.body.classList.remove("mealscout-map-fullscreen");
  }, []);

  useEffect(() => {
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
  }, []);

  /* ─── API queries ─── */
  const { data: trucksRaw = [] } = useQuery<Truck[]>({
    queryKey: ["/api/trucks/live", location.lat, location.lng],
    queryFn: async () => {
      const r = await fetch(`/api/trucks/live?lat=${location.lat}&lng=${location.lng}&radiusKm=25`, { credentials: "include" });
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
      const r = await fetch(`/api/restaurants/subscribed/${location.lat}/${location.lng}?radius=25`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 120_000,
  });

  const { data: dealsRaw = [] } = useQuery<Deal[]>({
    queryKey: ["/api/deals/nearby", location.lat, location.lng],
    queryFn: async () => {
      const r = await fetch(`/api/deals/nearby/${location.lat}/${location.lng}?radius=25`, { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : (d?.deals ?? []);
    },
    staleTime: 60_000,
  });

  const { data: eventsRaw = [] } = useQuery<ScoutEvent[]>({
    queryKey: ["/api/events/public"],
    queryFn: async () => {
      const r = await fetch("/api/events/public", { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : (d?.events ?? []);
    },
    staleTime: 60_000,
  });

  /* ─── derived counts for tiles ─── */
  const trucks = trucksRaw.slice(0, 20);
  const restaurants = restaurantsRaw.slice(0, 20);
  const deals = dealsRaw.slice(0, 10);
  const events = eventsRaw.slice(0, 10);

  const tileCounts = useMemo(() => ({
    food_trucks: trucks.length > 0 ? `${trucks.length} now` : "",
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
    }> = [];

    if (activeScene === "food_trucks" || activeScene === "for_you" || activeScene === "nearby_now") {
      trucks.forEach(t => {
        const name = t.name || "Food Truck";
        items.push({
          id: `truck-${t.id}`, type: "FOOD TRUCK", typeColor: "#9333ea",
          image: imgSrc(t), title: name,
          subtitle: [t.cuisineType, t.mobileOnline ? "Serving now" : "Posted up"].filter(Boolean).join(" • "),
          tag: t.mobileOnline ? "Serving now" : "Posted up",
          tagColor: t.mobileOnline ? "#10b981" : "#9333ea",
          distance: distLabel(t),
          href: `/truck/${t.id}`,
          routeHref: routeUrl(t.latitude ?? t.lat, t.longitude ?? t.lng, name),
        });
      });
    }

    if (activeScene === "restaurants" || activeScene === "for_you" || activeScene === "nearby_now") {
      restaurants.forEach(r => {
        const name = r.businessName || r.name || "Restaurant";
        const hasDeals = (r.activeDealsCount ?? r.activeDealCount ?? 0) > 0;
        items.push({
          id: `rest-${r.id}`, type: "RESTAURANT", typeColor: "#ff5c00",
          image: imgSrc(r), title: name,
          subtitle: [r.cuisineType, r.neighborhood || r.city].filter(Boolean).join(" • "),
          tag: hasDeals ? "Deal available" : (r.homeRankingReason ?? undefined),
          tagColor: hasDeals ? "#10b981" : "#ff5c00",
          distance: distLabel(r),
          href: `/restaurant/${r.id}`,
          routeHref: routeUrl(r.latitude ?? r.lat, r.longitude ?? r.lng, name),
          restaurantId: r.id,
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
        });
      });
    }

    return items.slice(0, 15);
  }, [activeScene, trucks, restaurants, deals, events]);

  /* ─── toggle saved ─── */
  const toggleSaved = useCallback(async (id: string) => {
    setSavedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    try {
      await fetch(`/api/favorites/restaurants/${id}`, {
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

    return () => { map.current?.remove(); map.current = null; };
  }, []);

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

    // Truck pins
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

    // Restaurant pins
    restaurants.slice(0, 8).forEach(r => {
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
    if (activeScene === "for_you") return "A live mix of what locals love, what's open, what's new, and what's nearby.";
    if (activeScene === "food_trucks") return `${trucks.length || "No"} food trucks near ${location.label}.`;
    if (activeScene === "restaurants") return `${restaurants.length || "No"} restaurants near ${location.label}.`;
    if (activeScene === "deals") return `${deals.length || "No"} active deals near you.`;
    if (activeScene === "events") return `${events.length || "No"} events happening soon.`;
    return `Showing ${sectionTitle.toLowerCase()} near ${location.label}.`;
  }, [activeScene, trucks, restaurants, deals, events, location, sectionTitle]);

  /* ─── empty state ─── */
  const isEmpty = feedItems.length === 0;

  return (
    <div className="h-screen w-full bg-[#0d0d0d] text-white flex flex-col overflow-hidden font-sans">
      <style>{customStyles}</style>

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-3 bg-[#0d0d0d] border-b border-white/5 shrink-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-orange-500 rounded-xl flex items-center justify-center shrink-0">
            <Utensils size={16} className="text-white" />
          </div>
          <span className="text-base font-black tracking-tight">MealScout</span>
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
            {location.label}
          </div>
        </div>
      </div>



      {/* ── Explore the Scene — fixed above global nav ── */}
      <div className="fixed left-0 right-0 z-[1050] bg-[#0d0d0d]/95 backdrop-blur-xl border-t border-white/8" style={{ bottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}>
        <div className="flex gap-2 overflow-x-auto no-scrollbar px-3 pt-2 pb-2">
          {EXPLORE_TILES.map(tile => {
            const count = tileCounts[tile.id as keyof typeof tileCounts] || tile.count;
            return (
              <button
                key={tile.id}
                onClick={() => setActiveScene(tile.id)}
                className={`shrink-0 flex flex-col items-center text-center rounded-xl px-2.5 py-2 border transition-all duration-200 w-[68px] ${
                  activeScene === tile.id
                    ? "bg-[#1e1e1e] border-orange-500/40"
                    : "bg-[#161616] border-white/5 hover:border-orange-500/20"
                }`}
              >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-1" style={{ backgroundColor: `${tile.color}20` }}>
                  <span style={{ color: tile.color }}>{tile.icon}</span>
                </div>
                <span className="text-[8px] font-black text-white leading-tight w-full truncate">{tile.label}</span>
                {count && <span className="text-[8px] font-bold mt-0.5" style={{ color: tile.color }}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Feed ── */}
      <div className="flex-1 overflow-y-auto px-4 pb-[160px] no-scrollbar">
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
      </div>




    </div>
  );
}
