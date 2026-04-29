import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import Navigation from "@/components/navigation";
import { Button } from "@/components/ui/button";
import { BackHeader } from "@/components/back-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GoogleMapSurface } from "@/components/maps/google-map-surface";
import { usePinZoomCardMode } from "@/components/maps/usePinZoomCardMode";
import { MapErrorBoundary } from "@/components/maps/map-error-boundary";
import type {
  MapAdapterMarker,
  MapBoundsLike,
} from "@/components/maps/map-adapter.types";
import { GOOGLE_MAPS_WEB_API_KEY } from "@/lib/mapProvider";
import { apiUrl } from "@/lib/api";
import { readDeviceLocation, writeDeviceLocation } from "@/lib/device-location";
import {
  MapPin,
  Navigation as NavigationIcon,
  List,
  X,
  ArrowDownToLine,
  ChevronUp,
  ChevronDown,
  Info,
  Share2,
} from "lucide-react";
import DealCard from "@/components/deal-card";
import { SEOHead } from "@/components/seo-head";
import mealScoutIcon from "@assets/meal-scout-icon.png";
import {
  sendGeoPing,
  trackGeoAdEvent,
  trackGeoAdImpression,
} from "@/utils/geoAds";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { trackUxEvent } from "@/utils/uxTelemetry";
import { useIsStandalone } from "@/hooks/useIsStandalone";
import { getLocationTypeLabel } from "@shared/constants/locationTypes";

type DiscoveryCity = {
  id: string;
  name: string;
  slug: string;
  state?: string | null;
  cuisines: Array<{ slug: string; count: number }>;
};

type ParkingPreviewSelection = {
  hostId: string;
  markerLat: number;
  markerLng: number;
  source: "zoom-card" | "pin-tap";
};

type MapBranding = {
  appName: string;
  mapName: string;
  canonicalBaseUrl: string;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  mapSchemaDescription: string;
  exploreHeading: string;
  exploreDescription: string;
};

const resolveMapBranding = (): MapBranding => {
  return {
    appName: "MealScout",
    mapName: "MealScout Map",
    canonicalBaseUrl: "https://www.mealscout.us",
    seoTitle: "Map View - MealScout | Find Deals Near You",
    seoDescription:
      "Explore food deals on an interactive map. See nearby restaurants, view deal locations, and discover dining discounts in your area. Find the perfect meal deal near you!",
    seoKeywords:
      "food truck map near me, restaurant deals map, local food map, nearby food trucks, meal deals near me, interactive food map, food truck parking map, local dining map",
    mapSchemaDescription:
      "Interactive map of food trucks, nearby deals, host parking spots, and event locations.",
    exploreHeading: "Explore MealScout Pages",
    exploreDescription:
      "Continue browsing local food trucks, restaurants, and active deals.",
  };
};

const titleCaseSlug = (value: string) =>
  value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
const toProfileSlug = (value: string | null | undefined) => {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "business";
};

// Fix for default markers in react-leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.3.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.3.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.3.1/images/marker-shadow.png",
});

const svgToDataUrl = (svg: string) => "data:image/svg+xml;base64," + btoa(svg);

// Custom user location icon (person silhouette, not a pin)
const userLocationIcon = L.divIcon({
  className: "map-user-marker",
  html: `
    <div class="map-user-marker__pulse"></div>
    <div class="map-user-marker__logo">
      <svg class="map-user-marker__person" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="11" r="5.2" fill="#0F172A" />
        <path d="M6 28c0-5.2 4.5-9.4 10-9.4s10 4.2 10 9.4" fill="#0F172A" />
      </svg>
    </div>
  `,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

// Component to handle map controls
function MapControls({
  onZoomIn,
  onZoomOut,
  onCenterUser,
  userLocation,
  zoomLevel,
  isNightTheme,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCenterUser: () => void;
  userLocation: { lat: number; lng: number } | null;
  zoomLevel: number;
  isNightTheme: boolean;
}) {
  const map = useMap();
  const controlClassName = isNightTheme
    ? "w-11 h-11 p-0 rounded-full bg-[var(--bg-card)]/90 border border-white/20 shadow-clean-lg backdrop-blur text-[color:var(--text-primary)]"
    : "w-11 h-11 p-0 rounded-full bg-[var(--bg-card)] border border-[color:var(--border-subtle)] shadow-clean text-[color:var(--text-primary)]";

  const handleZoomIn = () => {
    map.zoomIn();
    onZoomIn();
  };

  const handleZoomOut = () => {
    map.zoomOut();
    onZoomOut();
  };

  const handleCenterUser = () => {
    if (userLocation) {
      map.setView([userLocation.lat, userLocation.lng], map.getZoom());
      onCenterUser();
    }
  };

  return (
    <div className="absolute top-5 right-5 flex flex-col space-y-2 z-[1000]">
      <Button
        variant="secondary"
        size="sm"
        className={controlClassName}
        onClick={handleZoomIn}
        data-testid="button-zoom-in"
        title="Zoom in"
        aria-label="Zoom in"
      >
        +
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className={controlClassName}
        onClick={handleZoomOut}
        data-testid="button-zoom-out"
        title="Zoom out"
        aria-label="Zoom out"
      >
        -
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className={controlClassName}
        onClick={handleCenterUser}
        disabled={!userLocation}
        data-testid="button-center-location"
        title="Center on location"
        aria-label="Center on location"
      >
        <NavigationIcon className="w-4 h-4" />
      </Button>
    </div>
  );
}

function MapViewportWatcher({
  onZoomChange,
  onBoundsChange,
  onCenterChange,
}: {
  onZoomChange: (zoom: number) => void;
  onBoundsChange: (bounds: MapBoundsLike) => void;
  onCenterChange?: (center: GeoPoint) => void;
}) {
  const toBoundsLike = (bounds: L.LatLngBounds): MapBoundsLike => {
    const north = bounds.getNorth();
    const south = bounds.getSouth();
    const east = bounds.getEast();
    const west = bounds.getWest();
    return {
      north,
      south,
      east,
      west,
      contains: ([lat, lng]) => {
        const withinLat = lat <= north && lat >= south;
        const crossesDateLine = west > east;
        const withinLng = crossesDateLine
          ? lng >= west || lng <= east
          : lng >= west && lng <= east;
        return withinLat && withinLng;
      },
    };
  };

  const map = useMapEvents({
    zoomend: (event) => {
      onZoomChange(event.target.getZoom());
      onBoundsChange(toBoundsLike(event.target.getBounds()));
      const center = event.target.getCenter();
      onCenterChange?.({ lat: center.lat, lng: center.lng });
    },
    moveend: (event) => {
      onBoundsChange(toBoundsLike(event.target.getBounds()));
      const center = event.target.getCenter();
      onCenterChange?.({ lat: center.lat, lng: center.lng });
    },
  });

  useEffect(() => {
    onZoomChange(map.getZoom());
    onBoundsChange(toBoundsLike(map.getBounds()));
    const center = map.getCenter();
    onCenterChange?.({ lat: center.lat, lng: center.lng });
  }, [map, onZoomChange, onBoundsChange, onCenterChange]);

  return null;
}

function MapCenterer({ center }: { center: GeoPoint | null }) {
  const map = useMap();

  useEffect(() => {
    if (!center) return;
    map.setView([center.lat, center.lng], map.getZoom(), { animate: true });
  }, [center?.lat, center?.lng, map]);

  return null;
}

interface Restaurant {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  cuisineType: string;
  phone: string;
  isActive: boolean;
}

interface LiveTruck {
  id: string;
  name: string;
  address?: string | null;
  currentLatitude?: string | number | null;
  currentLongitude?: string | number | null;
  distance?: number;
  isVerified?: boolean;
}

type CommunityTruckSighting = {
  id: string;
  truckName: string;
  photoUrl: string;
  notes?: string | null;
  latitude: number;
  longitude: number;
  locationLabel?: string | null;
  reportCount: number;
  lastReportedAt: string;
  expiresAt: string;
  status: string;
};

interface Deal {
  id: string;
  restaurantId: string;
  title: string;
  description: string;
  dealType: string;
  discountValue: string;
  minOrderAmount: string;
  imageUrl: string;
  isFeatured?: boolean;
  restaurant: Restaurant;
}

interface GeoAd {
  id: string;
  title: string;
  body?: string | null;
  mediaUrl?: string | null;
  targetUrl: string;
  ctaText?: string | null;
  pinLat?: number | null;
  pinLng?: number | null;
}

type HostLocation = {
  id: string;
  hostId?: string | null;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  spotImageUrl?: string | null;
  locationType: string;
  expectedFootTraffic?: number;
  notes?: string | null;
  preferredDates?: string[];
  latitude?: number | string | null;
  longitude?: number | string | null;
  status?: string | null;
  // Google profile enrichment
  description?: string | null;
  googlePlaceId?: string | null;
  googlePriceLevel?: number | null;
  googleBusinessStatus?: string | null;
  googlePhotos?: any | null;
  googleCategories?: any | null;
  googleFormattedPhone?: string | null;
  businessHours?: any | null;
  businessWebsite?: string | null;
  menuUrl?: string | null;
};

type HostProfile = {
  id: string;
  businessName?: string | null;
  description?: string | null;
  phone?: string | null;
  website?: string | null;
  businessHours?: any | null;
  googlePriceLevel?: number | null;
  googleCategories?: any | null;
  menuUrl?: string | null;
  photos?: Array<{ url?: string | null; attribution?: string | null }>;
  profileSource?: string | null;
};

type HostCluster = {
  id: string;
  lat: number;
  lng: number;
  count: number;
  hosts: HostLocation[];
};

const resolveHostImageUrl = (host?: HostLocation | null): string | null => {
  if (!host) return null;
  const candidates = [
    host.spotImageUrl,
    (host as any).imageUrl,
    (host as any).photoUrl,
    (host as any).mediaUrl,
    (host as any).coverImageUrl,
    (host as any).thumbnailUrl,
  ];
  for (const value of candidates) {
    const next = String(value || "").trim();
    if (next) return next;
  }
  // Fallback: use first Google photo if available
  if (host.googlePhotos) {
    try {
      const photos = typeof host.googlePhotos === 'string' ? JSON.parse(host.googlePhotos) : host.googlePhotos;
      if (Array.isArray(photos) && photos.length > 0) {
        const firstPhoto = photos[0];
        const photoUrl = firstPhoto?.url || firstPhoto?.photoUrl || firstPhoto?.photoReference;
        if (photoUrl) return String(photoUrl);
      }
    } catch { /* ignore parse errors */ }
  }
  return null;
};

const parseGoogleCategories = (value: any): string[] => {
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
};

const formatGoogleCategory = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

type EventLocation = {
  id: string;
  name: string;
  description?: string | null;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  hostName?: string | null;
  hostAddress?: string | null;
  hostCity?: string | null;
  hostState?: string | null;
  hostLatitude?: number | string | null;
  hostLongitude?: number | string | null;
};

type MapLocationsResponse = {
  hostLocations: HostLocation[];
  eventLocations: EventLocation[];
};

type MapViewportOverlaysResponse = {
  version: string;
  zoom?: number;
  hostLocations: HostLocation[];
  eventLocations: EventLocation[];
};

type MapRuntimeResponse = {
  hasGoogleMapsKey?: boolean;
  googleMapsApiKey?: string | null;
  hasGoogleMapsMapId?: boolean;
  googleMapsMapId?: string | null;
};

type MapRouteSummaryResponse = {
  distanceMeters: number;
  durationSeconds: number;
  travelMode: "DRIVE" | "WALK" | "BICYCLE";
  source: "google_routes";
};

type BusinessPopularityEntry = {
  tier: "hot" | "rising" | "steady" | "new";
  label: string;
  color: string;
  score: number;
};

type BusinessPopularityResponse = {
  generatedAt: string;
  restaurants: Record<string, BusinessPopularityEntry>;
};

type HostUpcomingBooking = {
  eventId: string;
  date: string;
  startTime: string;
  endTime: string;
  truck: {
    id: string;
    name: string;
    cuisineType?: string | null;
  };
};

type HostUpcomingBookingsResponse = {
  hostId: string;
  generatedAt: string;
  rangeDays: number;
  count: number;
  bookings: HostUpcomingBooking[];
};

type GeoPoint = { lat: number; lng: number };
type GeocodeCacheEntry = { lat: number; lng: number; ts: number };
type GeocodeFailureEntry = { ts: number };

const toNumberOrNull = (value?: number | string | null) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildFullAddress = (
  address?: string | null,
  city?: string | null,
  state?: string | null,
) =>
  (() => {
    const base = (address ?? "").trim();
    if (!base) return "";
    const baseLower = base.toLowerCase();
    const normalizedCity = (city ?? "").trim();
    const normalizedState = (state ?? "").trim();

    const parts: string[] = [base];
    if (normalizedCity && !baseLower.includes(normalizedCity.toLowerCase())) {
      parts.push(normalizedCity);
    }
    if (normalizedState && !baseLower.includes(normalizedState.toLowerCase())) {
      parts.push(normalizedState);
    }
    parts.push("USA");
    return parts.join(", ");
  })();

const formatDurationLabel = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return "<1 min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
};

const formatRoadDistance = (meters: number) => {
  if (!Number.isFinite(meters) || meters <= 0) return null;
  if (meters < 1000) return `${Math.round(meters)} m road`;
  return `${(meters / 1000).toFixed(1)} km road`;
};

const haversineKm = (a: GeoPoint, b: GeoPoint) => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
};

const areBoundsEqual = (a: MapBoundsLike | null, b: MapBoundsLike | null) => {
  if (!a || !b) return false;
  const epsilon = 0.0005;
  return (
    Math.abs(a.north - b.north) < epsilon &&
    Math.abs(a.south - b.south) < epsilon &&
    Math.abs(a.east - b.east) < epsilon &&
    Math.abs(a.west - b.west) < epsilon
  );
};

const overlapKey = (coords: GeoPoint) =>
  `${coords.lat.toFixed(6)}:${coords.lng.toFixed(6)}`;

const formatBookingDate = (isoDate: string) => {
  const value = new Date(isoDate);
  if (Number.isNaN(value.getTime())) return "Upcoming";
  return value.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

const formatBookingTimeRange = (startTime?: string, endTime?: string) => {
  const start = String(startTime || "").trim();
  const end = String(endTime || "").trim();
  if (start && end) return `${start} - ${end}`;
  return start || end || "Time TBD";
};

const offsetOverlappingCoords = (
  coords: GeoPoint,
  index: number,
  count: number,
  zoomLevel: number,
): GeoPoint => {
  if (count <= 1) return coords;
  const radiusMeters =
    zoomLevel >= 17 ? 9 : zoomLevel >= 15 ? 13 : zoomLevel >= 13 ? 20 : 28;
  const angle = (2 * Math.PI * index) / count;
  const metersPerLat = 111_320;
  const metersPerLng = Math.max(
    111_320 * Math.cos((coords.lat * Math.PI) / 180),
    1,
  );
  return {
    lat: coords.lat + (Math.sin(angle) * radiusMeters) / metersPerLat,
    lng: coords.lng + (Math.cos(angle) * radiusMeters) / metersPerLng,
  };
};

const hostPinIcon = new L.Icon({
  iconUrl: mealScoutIcon,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -30],
});

const hostPinActiveIcon = hostPinIcon;
const hostPinBookableIcon = hostPinIcon;
const hostPinFullIcon = hostPinIcon;
const hostPinUnpricedIcon = hostPinIcon;

const DEFAULT_BUSINESS_PIN_COLOR = "#F59E0B";
const BUSINESS_PIN_STROKE = "#7C2D12";
const BUSINESS_PIN_CENTER = "#FFFBEB";
const buildBusinessPinIcon = (fillColor: string, markerText?: string) =>
  new L.Icon({
    iconUrl: svgToDataUrl(`
      <svg width="34" height="42" viewBox="0 0 34 42" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M17 1C10.373 1 5 6.373 5 13c0 9.5 12 27 12 27s12-17.5 12-27C29 6.373 23.627 1 17 1z" fill="${fillColor}" stroke="${BUSINESS_PIN_STROKE}" stroke-width="2"/>
        <circle cx="17" cy="13" r="7" fill="${BUSINESS_PIN_CENTER}"/>
        ${
          markerText
            ? `<text x="17" y="17" text-anchor="middle" font-size="9" font-weight="800" fill="${BUSINESS_PIN_STROKE}">${markerText}</text>`
            : ""
        }
      </svg>
    `),
    iconSize: [34, 42],
    iconAnchor: [17, 40],
    popupAnchor: [0, -34],
  });
const dealPinIconCache = new Map<string, L.Icon>();
const truckPinIconCache = new Map<string, L.Icon>();
const getDealPinIcon = (color?: string | null) => {
  const key = String(color || DEFAULT_BUSINESS_PIN_COLOR);
  const cached = dealPinIconCache.get(key);
  if (cached) return cached;
  const created = buildBusinessPinIcon(key);
  dealPinIconCache.set(key, created);
  return created;
};
const getTruckPinIcon = (color?: string | null) => {
  const key = String(color || DEFAULT_BUSINESS_PIN_COLOR);
  const cached = truckPinIconCache.get(key);
  if (cached) return cached;
  const created = buildBusinessPinIcon(key, "T");
  truckPinIconCache.set(key, created);
  return created;
};

const eventPinIcon = new L.Icon({
  iconUrl: svgToDataUrl(`
    <svg width="34" height="42" viewBox="0 0 34 42" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 1C10.373 1 5 6.373 5 13c0 9.5 12 27 12 27s12-17.5 12-27C29 6.373 23.627 1 17 1z" fill="#F59E0B" stroke="#B45309" stroke-width="2"/>
      <circle cx="17" cy="13" r="7" fill="#FFFBEB"/>
      <text x="17" y="17" text-anchor="middle" font-size="9" font-weight="800" fill="#7C2D12">E</text>
    </svg>
  `),
  iconSize: [34, 42],
  iconAnchor: [17, 40],
  popupAnchor: [0, -34],
});

const geoAdPinIcon = new L.Icon({
  iconUrl: svgToDataUrl(`
    <svg width="34" height="42" viewBox="0 0 34 42" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17 1C10.373 1 5 6.373 5 13c0 9.5 12 27 12 27s12-17.5 12-27C29 6.373 23.627 1 17 1z" fill="#F59E0B" stroke="#B45309" stroke-width="2"/>
      <circle cx="17" cy="13" r="7" fill="#FFFBEB"/>
      <text x="17" y="17" text-anchor="middle" font-size="8" font-weight="800" fill="#7C2D12">AD</text>
    </svg>
  `),
  iconSize: [34, 42],
  iconAnchor: [17, 40],
  popupAnchor: [0, -34],
});

const clusterIcon = (count: number) =>
  L.divIcon({
    className: "map-host-cluster",
    html: `
      <div style="width:40px;height:40px;border-radius:9999px;background:rgba(15,23,42,0.92);border:2px solid rgba(255,255,255,0.85);display:flex;align-items:center;justify-content:center;box-shadow:0 10px 22px rgba(2,6,23,0.25);">
        <div style="color:#fff;font-weight:800;font-size:12px;line-height:1;">${count}</div>
      </div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -18],
  });

function HostMarkerLayer({
  hosts,
  zoomLevel,
  resolveHostCoords,
  findNearbyTruck,
  formatDistance,
  cachedHostStatusById,
  bookableHostIds,
  isStaffOrAdmin,
  qualityFlagsByHostId,
  onClusterSelect,
  onHostSelect,
}: {
  hosts: HostLocation[];
  zoomLevel: number;
  resolveHostCoords: (host: HostLocation) => GeoPoint | null;
  findNearbyTruck: (
    coords: GeoPoint,
    radiusKm?: number,
  ) => { truck: LiveTruck; distance: number } | null;
  formatDistance: (coords: GeoPoint) => string | null;
  cachedHostStatusById: Record<
    string,
    {
      hostId: string;
      availableCount: number;
      spotCount: number;
      reservedCount: number;
      isFull: boolean;
    }
  >;
  bookableHostIds: Set<string>;
  isStaffOrAdmin: boolean;
  qualityFlagsByHostId: Map<string, string[]>;
  onClusterSelect?: (cluster: HostCluster) => void;
  onHostSelect?: (
    host: HostLocation,
    markerCoords: GeoPoint,
    source: ParkingPreviewSelection["source"],
  ) => void;
}) {
  const map = useMap();

  const positionedHosts = useMemo(() => {
    const groups = new Map<
      string,
      Array<{ host: HostLocation; coords: GeoPoint }>
    >();
    hosts.forEach((host) => {
      const coords = resolveHostCoords(host);
      if (!coords) return;
      const key = overlapKey(coords);
      const prev = groups.get(key) || [];
      prev.push({ host, coords });
      groups.set(key, prev);
    });

    const next: Array<{
      host: HostLocation;
      coords: GeoPoint;
      markerCoords: GeoPoint;
      overlapCount: number;
    }> = [];
    groups.forEach((items) => {
      const count = items.length;
      items.forEach((item, index) => {
        next.push({
          host: item.host,
          coords: item.coords,
          markerCoords: offsetOverlappingCoords(
            item.coords,
            index,
            count,
            zoomLevel,
          ),
          overlapCount: count,
        });
      });
    });
    return next;
  }, [hosts, resolveHostCoords, zoomLevel]);

  const overlapStats = useMemo(() => {
    const buckets = new Map<string, number>();
    positionedHosts.forEach(({ coords }) => {
      // ~110m buckets to detect visually overlapping markers.
      const key = `${coords.lat.toFixed(3)}:${coords.lng.toFixed(3)}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    });
    let overlappingMarkers = 0;
    let maxBucketSize = 0;
    buckets.forEach((count) => {
      if (count > 1) {
        overlappingMarkers += count;
      }
      if (count > maxBucketSize) maxBucketSize = count;
    });
    return { overlappingMarkers, maxBucketSize };
  }, [positionedHosts]);

  const useClusters =
    zoomLevel < 14 &&
    (overlapStats.overlappingMarkers >= 2 || overlapStats.maxBucketSize >= 2);
  const cellSize = zoomLevel < 10 ? 0.2 : zoomLevel < 12 ? 0.1 : 0.04;

  const clusters = useMemo(() => {
    if (!useClusters) return null;
    const groups = new Map<
      string,
      { latSum: number; lngSum: number; count: number; hosts: HostLocation[] }
    >();
    hosts.forEach((host) => {
      const coords = resolveHostCoords(host);
      if (!coords) return;
      const key = `${Math.round(coords.lat / cellSize)}:${Math.round(
        coords.lng / cellSize,
      )}`;
      const prev = groups.get(key) || {
        latSum: 0,
        lngSum: 0,
        count: 0,
        hosts: [],
      };
      prev.latSum += coords.lat;
      prev.lngSum += coords.lng;
      prev.count += 1;
      prev.hosts.push(host);
      groups.set(key, prev);
    });
    return Array.from(groups.entries()).map(([key, item]) => ({
      id: `cluster:${key}`,
      lat: item.latSum / Math.max(1, item.count),
      lng: item.lngSum / Math.max(1, item.count),
      count: item.count,
      hosts: item.hosts,
    })) satisfies HostCluster[];
  }, [hosts, resolveHostCoords, useClusters, cellSize]);

  if (useClusters && clusters) {
    return (
      <>
        {clusters.map((cluster) => (
          <Marker
            key={cluster.id}
            position={[cluster.lat, cluster.lng]}
            icon={clusterIcon(cluster.count)}
            eventHandlers={{
              click: () => {
                onClusterSelect?.(cluster);
              },
            }}
          >
            <Popup>
              <div className="min-w-52 space-y-1 rounded-xl bg-[var(--bg-card)] text-[color:var(--text-primary)] p-3 shadow-clean-lg">
                <div className="font-semibold text-sm">
                  {cluster.count} host parking locations
                </div>
                <div className="text-xs text-[color:var(--text-muted)]">
                  Zoom in to see individual spots.
                </div>
                <div className="pt-2">
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() =>
                      map.setView(
                        [cluster.lat, cluster.lng],
                        Math.min(18, map.getZoom() + 2),
                      )
                    }
                  >
                    Zoom in
                  </Button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </>
    );
  }

  return (
    <>
      {positionedHosts.map(({ host, coords, markerCoords, overlapCount }) => {
        const hostedTruck = findNearbyTruck(coords);
        const title = hostedTruck ? hostedTruck.truck.name : host.name;
        const subtitle = hostedTruck ? `At ${host.name}` : "Hosts food trucks";
        const hostId = host.hostId ? String(host.hostId) : "";
        const hostStatus = hostId ? cachedHostStatusById[hostId] : undefined;
        const isFullToday = Boolean(hostStatus?.isFull);
        const isBookable = hostId ? bookableHostIds.has(hostId) : false;
        const availableLabel = !isBookable
          ? "No active spot listing yet"
          : hostStatus
            ? hostStatus.isFull
              ? "Fully booked today"
              : `${hostStatus.availableCount}/${hostStatus.spotCount} spots open today`
            : "Availability updating...";
        const qualityFlags = hostId
          ? qualityFlagsByHostId.get(hostId) || []
          : [];
        const distanceLabel = formatDistance(coords);
        const hostImageUrl = resolveHostImageUrl(host);
        const hostIsVerified =
          String(host.status || "").toLowerCase() === "verified";
        const publicProfileHref = hostId
          ? `/p/host/${encodeURIComponent(hostId)}/${toProfileSlug(host.name)}`
          : `/p/host/${encodeURIComponent(host.id)}/${toProfileSlug(host.name)}`;

        return (
          <Marker
            key={`host-${host.id}`}
            position={[markerCoords.lat, markerCoords.lng]}
            icon={
              hostedTruck
                ? hostPinActiveIcon
                : isFullToday
                  ? hostPinFullIcon
                  : isBookable
                    ? hostPinBookableIcon
                    : hostPinUnpricedIcon
            }
            eventHandlers={{
              click: () => {
                onHostSelect?.(host, markerCoords, "pin-tap");
              },
            }}
          >
            <Popup>
              <div className="min-w-56 space-y-1 rounded-xl bg-[var(--bg-card)] text-[color:var(--text-primary)] p-3 shadow-clean-lg">
                <div className="font-semibold text-sm">{title}</div>
                <div className="text-xs text-[color:var(--text-muted)]">
                  {subtitle}
                </div>
                <div className="inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide border border-[color:var(--border-subtle)]">
                  {availableLabel}
                </div>
                {hostIsVerified && (
                  <div className="inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide border border-[color:var(--status-success)]/40 text-[color:var(--status-success)]">
                    Verified host
                  </div>
                )}
                {overlapCount > 1 && (
                  <div className="text-xs text-[color:var(--text-muted)]">
                    {overlapCount} host locations share this same spot.
                  </div>
                )}
                {isStaffOrAdmin && qualityFlags.length > 0 && (
                  <div className="inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide border border-[color:var(--border-subtle)] text-[color:var(--status-warning)]">
                    Data issues: {qualityFlags.slice(0, 4).join(", ")}
                    {qualityFlags.length > 4 ? ", ..." : ""}
                  </div>
                )}
                <div className="text-xs text-[color:var(--text-muted)]">
                  {host.address}
                </div>
                {hostImageUrl && (
                  <img
                    src={hostImageUrl}
                    alt={`${host.name} parking spot`}
                    className="mt-2 h-28 w-full rounded-lg border border-border/50 object-cover"
                    loading="lazy"
                  />
                )}
                {distanceLabel && (
                  <div className="text-xs text-[color:var(--text-muted)]">
                    {distanceLabel} away
                  </div>
                )}
                {hostedTruck ? (
                  <div className="space-y-2 pt-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          trackUxEvent("map_restaurant_nav_click", {
                            restaurantId: hostedTruck.truck.id,
                            source: "host_popup",
                          });
                          window.location.href = `/restaurant/${hostedTruck.truck.id}`;
                        }}
                      >
                        View menu
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          window.open(
                            `https://maps.google.com/?q=${coords.lat},${coords.lng}`,
                            "_blank",
                          );
                        }}
                      >
                        Directions
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      onClick={() => {
                        window.location.href = publicProfileHref;
                      }}
                    >
                      View details
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2 pt-2">
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        window.open(
                          `https://maps.google.com/?q=${coords.lat},${coords.lng}`,
                          "_blank",
                        );
                      }}
                    >
                      Directions
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      onClick={() => {
                        window.location.href = publicProfileHref;
                      }}
                    >
                      View details
                    </Button>
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  if (!address) return null;
  const res = await fetch(
    apiUrl(`/api/location/search?limit=1&q=${encodeURIComponent(address)}`),
  );
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

export default function MapPage() {
  // Touch update to trigger deployment rebuild after map styling configuration changes.
  const mapBranding = useMemo(resolveMapBranding, []);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isStandalone = useIsStandalone();
  const { user } = useAuth();
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({
    // Neutral default center (approximate center of continental US)
    lat: 39.8283,
    lng: -98.5795,
  });
  const [showList, setShowList] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [selectedParkingPreview, setSelectedParkingPreview] =
    useState<ParkingPreviewSelection | null>(null);
  const [selectedHostCluster, setSelectedHostCluster] =
    useState<HostCluster | null>(null);
  const [selectedSighting, setSelectedSighting] =
    useState<CommunityTruckSighting | null>(null);
  const [showReportTruckDialog, setShowReportTruckDialog] = useState(false);
  const [reportTruckName, setReportTruckName] = useState("");
  const [reportTruckPhotoDataUrl, setReportTruckPhotoDataUrl] = useState("");
  const [reportTruckPhotoName, setReportTruckPhotoName] = useState("");
  const [reportTruckNotes, setReportTruckNotes] = useState("");
  const [reportLocationLabel, setReportLocationLabel] = useState("");
  const [isSubmittingTruckSighting, setIsSubmittingTruckSighting] =
    useState(false);
  const truckSightingPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationAccuracyM, setLocationAccuracyM] = useState<number | null>(
    null,
  );
  const [zoomLevel, setZoomLevel] = useState(16);
  const lastZoomLevelRef = useRef(16);
  const hasSeenInitialZoomRef = useRef(false);
  const [shouldAutoOpenZoomCard, setShouldAutoOpenZoomCard] = useState(false);
  const [mapBounds, setMapBounds] = useState<MapBoundsLike | null>(null);
  const [debouncedMapBounds, setDebouncedMapBounds] =
    useState<MapBoundsLike | null>(null);
  const [appliedMapBounds, setAppliedMapBounds] =
    useState<MapBoundsLike | null>(null);
  const [hasPendingAreaSearch, setHasPendingAreaSearch] = useState(false);
  const [pendingMapCenter, setPendingMapCenter] = useState<GeoPoint | null>(
    null,
  );
  const [locationError, setLocationError] = useState<string | null>(null);
  const [forceLegacyMap, setForceLegacyMap] = useState(false);
  const [googleMapRetryNonce, setGoogleMapRetryNonce] = useState(0);
  const [googleMapAutoRetryCount, setGoogleMapAutoRetryCount] = useState(0);
  const [googleMapsRuntimeError, setGoogleMapsRuntimeError] = useState<
    string | null
  >(null);
  const [hostCoords, setHostCoords] = useState<Record<string, GeoPoint>>({});
  const [eventCoords, setEventCoords] = useState<Record<string, GeoPoint>>({});
  const geocodeInFlight = useRef(false);
  const [geocodeCache, setGeocodeCache] = useState<
    Record<string, GeocodeCacheEntry>
  >({});
  const [geocodeFailures, setGeocodeFailures] = useState<
    Record<string, GeocodeFailureEntry>
  >({});
  const [mapProviderGraceExpired, setMapProviderGraceExpired] = useState(false);
  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const locationWatchIdRef = useRef<number | null>(null);
  const locationWatchStopTimerRef = useRef<number | null>(null);
  const bestLocationAccuracyRef = useRef<number | null>(null);
  const hasCenteredFromLiveLocationRef = useRef(false);
  const enableClientGeocode = false;
  const [legendOpen, setLegendOpen] = useState(true);
  const urlStateHydratedRef = useRef(false);
  const [hoverPreview, setHoverPreview] = useState<{
    marker: MapAdapterMarker;
    x: number;
    y: number;
  } | null>(null);
  const [mapCalloutAnchorPosition, setMapCalloutAnchorPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [drawingActive, setDrawingActive] = useState(false);
  const [areaFilterBounds, setAreaFilterBounds] = useState<{
    north: number;
    south: number;
    east: number;
    west: number;
  } | null>(null);

  const handleTruckSightingPhotoChange = useCallback(
    async (file: File | null) => {
      if (!file) {
        setReportTruckPhotoDataUrl("");
        setReportTruckPhotoName("");
        return;
      }

      if (!file.type.startsWith("image/")) {
        toast({
          title: "Invalid file",
          description: "Please choose an image file.",
          variant: "destructive",
        });
        return;
      }

      const maxBytes = 6 * 1024 * 1024;
      if (file.size > maxBytes) {
        toast({
          title: "Image too large",
          description: "Use an image smaller than 6MB.",
          variant: "destructive",
        });
        return;
      }

      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(new Error("Failed to read image file"));
          reader.readAsDataURL(file);
        });
        setReportTruckPhotoDataUrl(dataUrl);
        setReportTruckPhotoName(file.name || "truck-photo");
      } catch {
        toast({
          title: "Unable to read image",
          description: "Please try selecting the photo again.",
          variant: "destructive",
        });
      }
    },
    [toast],
  );

  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  const stopLocationWatch = useCallback(() => {
    if (
      locationWatchIdRef.current !== null &&
      navigator.geolocation &&
      typeof navigator.geolocation.clearWatch === "function"
    ) {
      navigator.geolocation.clearWatch(locationWatchIdRef.current);
      locationWatchIdRef.current = null;
    }
    if (locationWatchStopTimerRef.current !== null) {
      window.clearTimeout(locationWatchStopTimerRef.current);
      locationWatchStopTimerRef.current = null;
    }
  }, []);

  const requestUserLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not available on this device.");
      setIsLocating(false);
      return;
    }

    stopLocationWatch();
    bestLocationAccuracyRef.current = null;
    hasCenteredFromLiveLocationRef.current = false;
    setIsLocating(true);
    setLocationError(null);

    const applyLocation = (
      position: GeolocationPosition,
      options?: { centerMap?: boolean },
    ) => {
      const accuracy = Number(position.coords.accuracy || 0);
      if (Number.isFinite(accuracy) && accuracy > 0) {
        const previous = bestLocationAccuracyRef.current;
        if (previous == null || accuracy < previous) {
          bestLocationAccuracyRef.current = accuracy;
          setLocationAccuracyM(accuracy);
        }
      }

      const previousUserLocation = userLocationRef.current;
      const currentLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      const movedEnough =
        previousUserLocation == null
          ? true
          : haversineKm(previousUserLocation, currentLocation) > 0.03;

      if (previousUserLocation == null || movedEnough) {
        const currentLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setUserLocation(currentLocation);
        const shouldCenter =
          options?.centerMap === true ||
          !hasCenteredFromLiveLocationRef.current ||
          previousUserLocation == null;
        if (shouldCenter) {
          setMapCenter(currentLocation);
          hasCenteredFromLiveLocationRef.current = true;
        }
        try {
          writeDeviceLocation({
            ...currentLocation,
            accuracy: Number.isFinite(accuracy) ? accuracy : null,
          });
        } catch {
          // ignore localStorage issues
        }
      }
      setLocationError(null);
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        applyLocation(position, { centerMap: true });
      },
      (error) => {
        console.log("Location error:", error);
        setLocationError(
          "Location is off or imprecise. Enable precise location to see what's nearby.",
        );
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );

    // Desktop geolocation is often coarse on first read; watch briefly to refine.
    locationWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        applyLocation(position, { centerMap: false });
        const best = bestLocationAccuracyRef.current;
        if (typeof best === "number" && best <= 75) {
          setIsLocating(false);
          stopLocationWatch();
        }
      },
      (error) => {
        console.log("Location watch error:", error);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );

    locationWatchStopTimerRef.current = window.setTimeout(() => {
      setIsLocating(false);
      stopLocationWatch();
      if (!userLocationRef.current) {
        setLocationError(
          "Could not lock exact location. Check browser location permission and precision settings.",
        );
      }
    }, 25000);
  }, [stopLocationWatch]);

  const isStaffOrAdmin =
    user?.userType === "staff" ||
    user?.userType === "admin" ||
    user?.userType === "super_admin";
  const showMapDiagnostics = isStaffOrAdmin;

  const getLocalDateKey = () => {
    const now = new Date();
    const localMidnightIso = new Date(
      now.getTime() - now.getTimezoneOffset() * 60_000,
    )
      .toISOString()
      .slice(0, 10);
    return localMidnightIso;
  };
  const todayKey = getLocalDateKey();

  useEffect(() => {
    try {
      const cached = localStorage.getItem("mealscout_geocode_cache");
      if (cached) {
        setGeocodeCache(JSON.parse(cached));
      }
    } catch {
      // ignore localStorage issues
    }
    try {
      const failed = localStorage.getItem("mealscout_geocode_failures");
      if (failed) {
        setGeocodeFailures(JSON.parse(failed));
      }
    } catch {
      // ignore localStorage issues
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        "mealscout_geocode_cache",
        JSON.stringify(geocodeCache),
      );
    } catch {
      // ignore localStorage issues
    }
  }, [geocodeCache]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "mealscout_geocode_failures",
        JSON.stringify(geocodeFailures),
      );
    } catch {
      // ignore localStorage issues
    }
  }, [geocodeFailures]);

  // Get user location
  useEffect(() => {
    // Start from this device's last viewed area if location was previously shared.
    // Important: do NOT treat this as "you are here" because it can be stale.
    try {
      const stored = readDeviceLocation();
      if (stored) {
        setMapCenter({ lat: stored.lat, lng: stored.lng });
      }
    } catch {
      // ignore localStorage issues
    }

    // URL state takes precedence over stored device location so deep-links work.
    try {
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const latRaw = params.get("lat");
        const lngRaw = params.get("lng");
        const zoomRaw = params.get("z") || params.get("zoom");
        const lat = latRaw ? Number(latRaw) : NaN;
        const lng = lngRaw ? Number(lngRaw) : NaN;
        const z = zoomRaw ? Number(zoomRaw) : NaN;
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          Math.abs(lat) <= 90 &&
          Math.abs(lng) <= 180
        ) {
          setMapCenter({ lat, lng });
          if (Number.isFinite(z) && z >= 1 && z <= 20) {
            setZoomLevel(Math.round(z));
            lastZoomLevelRef.current = Math.round(z);
          }
        }
      }
    } catch {
      // ignore URL parse errors
    } finally {
      urlStateHydratedRef.current = true;
    }

    requestUserLocation();
    return () => {
      stopLocationWatch();
    };
  }, [requestUserLocation, stopLocationWatch]);

  // Persist current map center + zoom to URL (debounced) so views are shareable.
  useEffect(() => {
    if (!urlStateHydratedRef.current) return;
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      try {
        const params = new URLSearchParams(window.location.search);
        params.set("lat", mapCenter.lat.toFixed(5));
        params.set("lng", mapCenter.lng.toFixed(5));
        params.set("z", String(zoomLevel));
        const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
        window.history.replaceState(null, "", next);
      } catch {
        // ignore history API errors
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [mapCenter.lat, mapCenter.lng, zoomLevel]);

  // Fetch nearby deals based on user location
  const { data: dealsData = [], isLoading } = useQuery({
    queryKey: userLocation
      ? ["/api/deals/nearby", userLocation.lat, userLocation.lng]
      : ["/api/deals/featured"],
    queryFn: userLocation
      ? async () => {
          const response = await fetch(
            apiUrl(`/api/deals/nearby/${userLocation.lat}/${userLocation.lng}`),
          );
          if (!response.ok) throw new Error("Failed to fetch nearby deals");
          return response.json();
        }
      : undefined,
    enabled: !!userLocation,
  });

  const deals: Deal[] = Array.isArray(dealsData) ? (dealsData as Deal[]) : [];

  const { data: liveTrucksData = [] } = useQuery<LiveTruck[]>({
    queryKey: userLocation
      ? ["/api/trucks/live", userLocation.lat, userLocation.lng]
      : ["live-trucks", "none"],
    queryFn: userLocation
      ? async () => {
          const response = await fetch(
            apiUrl(
              `/api/trucks/live?lat=${userLocation.lat}&lng=${userLocation.lng}&radiusKm=5`,
            ),
          );
          if (!response.ok) throw new Error("Failed to fetch live trucks");
          return response.json();
        }
      : undefined,
    enabled: !!userLocation,
    staleTime: 5 * 1000,
    refetchInterval: 15 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const liveTrucks = Array.isArray(liveTrucksData) ? liveTrucksData : [];

  const { data: communitySightingsData = [] } = useQuery<CommunityTruckSighting[]>(
    {
      queryKey: userLocation
        ? [
            "/api/trucks/community-sightings/live",
            userLocation.lat,
            userLocation.lng,
          ]
        : ["community-truck-sightings", "none"],
      queryFn: userLocation
        ? async () => {
            const response = await fetch(
              apiUrl(
                `/api/trucks/community-sightings/live?lat=${userLocation.lat}&lng=${userLocation.lng}&radiusKm=6`,
              ),
            );
            if (!response.ok) throw new Error("Failed to fetch truck sightings");
            return response.json();
          }
        : undefined,
      enabled: !!userLocation,
      staleTime: 10 * 1000,
      refetchInterval: 30 * 1000,
      refetchOnWindowFocus: true,
    },
  );

  const communitySightings = Array.isArray(communitySightingsData)
    ? communitySightingsData
    : [];

  const adLocation = userLocation || mapCenter;
  const { data: geoAds = [] } = useQuery<GeoAd[]>({
    queryKey: ["/api/geo-ads", "map", adLocation?.lat, adLocation?.lng],
    enabled: !!adLocation,
    queryFn: async () => {
      if (!adLocation) return [];
      const res = await fetch(
        apiUrl(
          `/api/geo-ads?placement=map&lat=${adLocation.lat}&lng=${adLocation.lng}&limit=10`,
        ),
        { credentials: "include" },
      );
      if (!res.ok) return [];
      return res.json();
    },
  });

  useEffect(() => {
    if (!adLocation) return;
    sendGeoPing({ lat: adLocation.lat, lng: adLocation.lng, source: "map" });
  }, [adLocation?.lat, adLocation?.lng]);

  useEffect(() => {
    if (!geoAds.length) return;
    geoAds.forEach((ad) =>
      trackGeoAdImpression({ adId: ad.id, placement: "map" }),
    );
  }, [geoAds]);

  const truckCoords = useMemo(() => {
    return liveTrucks
      .map((truck) => {
        const lat = toNumberOrNull(truck.currentLatitude);
        const lng = toNumberOrNull(truck.currentLongitude);
        if (lat === null || lng === null) return null;
        return { id: truck.id, lat, lng };
      })
      .filter(Boolean) as Array<{ id: string; lat: number; lng: number }>;
  }, [liveTrucks]);

  const visibleDeals = useMemo(() => {
    if (!appliedMapBounds) return deals;
    return deals.filter((deal) => {
      const lat = toNumberOrNull(deal.restaurant?.latitude);
      const lng = toNumberOrNull(deal.restaurant?.longitude);
      if (lat === null || lng === null) return false;
      return appliedMapBounds.contains([lat, lng]);
    });
  }, [deals, appliedMapBounds]);

  const visibleGeoAds = useMemo(() => {
    if (!appliedMapBounds) return geoAds;
    return geoAds.filter((ad) => {
      const lat = ad.pinLat ?? null;
      const lng = ad.pinLng ?? null;
      if (lat === null || lng === null) return false;
      return appliedMapBounds.contains([lat, lng]);
    });
  }, [geoAds, appliedMapBounds]);

  const visibleLiveTrucks = useMemo(() => {
    if (!appliedMapBounds) return liveTrucks;
    return liveTrucks.filter((truck) => {
      const lat = toNumberOrNull(truck.currentLatitude);
      const lng = toNumberOrNull(truck.currentLongitude);
      if (lat === null || lng === null) return false;
      return appliedMapBounds.contains([lat, lng]);
    });
  }, [liveTrucks, appliedMapBounds]);

  const visibleCommunitySightings = useMemo(() => {
    if (!appliedMapBounds) return communitySightings;
    return communitySightings.filter((sighting) => {
      const lat = toNumberOrNull(sighting.latitude);
      const lng = toNumberOrNull(sighting.longitude);
      if (lat === null || lng === null) return false;
      return appliedMapBounds.contains([lat, lng]);
    });
  }, [communitySightings, appliedMapBounds]);

  const popularityRestaurantIds = useMemo(() => {
    const ids = new Set<string>();
    deals.forEach((deal) => {
      const id = String(deal.restaurantId || "").trim();
      if (id) ids.add(id);
    });
    visibleLiveTrucks.forEach((truck) => {
      const id = String(truck.id || "").trim();
      if (id) ids.add(id);
    });
    return Array.from(ids).sort();
  }, [deals, visibleLiveTrucks]);

  const { data: businessPopularityData } = useQuery<BusinessPopularityResponse>(
    {
      queryKey: [
        "/api/map/business-popularity",
        popularityRestaurantIds.join(","),
      ],
      enabled: popularityRestaurantIds.length > 0,
      queryFn: async () => {
        const params = new URLSearchParams({
          restaurantIds: popularityRestaurantIds.join(","),
        });
        const res = await fetch(
          apiUrl(`/api/map/business-popularity?${params}`),
        );
        if (!res.ok) throw new Error("Failed to load business popularity");
        return res.json();
      },
      staleTime: 3 * 60 * 1000,
      refetchInterval: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  );

  const businessPopularityByRestaurant = useMemo(() => {
    return businessPopularityData?.restaurants || {};
  }, [businessPopularityData]);

  const hostedRadiusKm = 0.12;
  const liveTruckById = useMemo(() => {
    return new Map(liveTrucks.map((truck) => [truck.id, truck]));
  }, [liveTrucks]);

  const findNearbyTruck = (coords: GeoPoint, radiusKm = hostedRadiusKm) => {
    let nearest: { truck: LiveTruck; distance: number } | null = null;
    for (const truck of truckCoords) {
      const distance = haversineKm(coords, { lat: truck.lat, lng: truck.lng });
      if (distance > radiusKm) continue;
      const truckData = liveTruckById.get(truck.id);
      if (!truckData) continue;
      if (!nearest || distance < nearest.distance) {
        nearest = { truck: truckData, distance };
      }
    }
    return nearest;
  };

  const getPublicProfileHrefForHost = useCallback((host: HostLocation) => {
    const profileHostId = String(host.hostId || host.id || "").trim();
    return `/p/host/${encodeURIComponent(profileHostId)}/${toProfileSlug(host.name)}`;
  }, []);

  const resolveHostCoords = (host: HostLocation) => {
    const lat = toNumberOrNull(host.latitude);
    const lng = toNumberOrNull(host.longitude);
    if (lat !== null && lng !== null) {
      return { lat, lng };
    }
    return hostCoords[host.id] ?? null;
  };

  const resolveEventCoords = (event: EventLocation) => {
    const lat = toNumberOrNull(event.hostLatitude);
    const lng = toNumberOrNull(event.hostLongitude);
    if (lat !== null && lng !== null) {
      return { lat, lng };
    }
    return eventCoords[event.id] ?? null;
  };

  const formatDistance = (coords: GeoPoint) => {
    if (!userLocation) return null;
    const distanceKm = haversineKm(userLocation, coords);
    if (distanceKm < 1) {
      return `${Math.round(distanceKm * 1000)} m`;
    }
    return `${distanceKm.toFixed(1)} km`;
  };

  const handleGeoAdClick = (ad: GeoAd) => {
    trackGeoAdEvent({ adId: ad.id, eventType: "click", placement: "map" });
    window.open(ad.targetUrl, "_blank", "noopener,noreferrer");
  };

  // Fetch host + event locations for map
  const MAP_LOCATIONS_CACHE_KEY = "mealscout:map:locations:v2";
  const MAP_LOCATIONS_CACHE_TTL_MS = 30 * 60 * 1000;
  const [cachedMapLocations, setCachedMapLocations] =
    useState<MapLocationsResponse | null>(() => {
      try {
        const raw = localStorage.getItem(MAP_LOCATIONS_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const maybeData = (parsed as any)?.data ?? parsed;
        const cachedAt = Number((parsed as any)?.cachedAt ?? 0);
        if (
          maybeData &&
          typeof maybeData === "object" &&
          Array.isArray((maybeData as any).hostLocations) &&
          Array.isArray((maybeData as any).eventLocations)
        ) {
          if (
            cachedAt > 0 &&
            Date.now() - cachedAt > MAP_LOCATIONS_CACHE_TTL_MS
          ) {
            localStorage.removeItem(MAP_LOCATIONS_CACHE_KEY);
            return null;
          }
          return maybeData as MapLocationsResponse;
        }
        return null;
      } catch {
        return null;
      }
    });
  const { data: mapLocationsData } = useQuery<MapLocationsResponse>({
    queryKey: ["/api/map/locations"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/map/locations"));
      if (!res.ok) throw new Error("Failed to load map locations");
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (!mapLocationsData) return;
    setCachedMapLocations(mapLocationsData);
    try {
      localStorage.setItem(
        MAP_LOCATIONS_CACHE_KEY,
        JSON.stringify({
          cachedAt: Date.now(),
          data: mapLocationsData,
        }),
      );
    } catch {
      // ignore localStorage issues
    }
  }, [mapLocationsData]);

  const { data: mapRuntime, isLoading: mapRuntimeLoading } =
    useQuery<MapRuntimeResponse>({
      queryKey: ["/api/map/runtime"],
      queryFn: async () => {
        try {
          const res = await fetch(apiUrl("/api/map/runtime"));
          if (!res.ok) {
            return { hasGoogleMapsKey: false, googleMapsApiKey: null };
          }
          return res.json();
        } catch {
          return { hasGoogleMapsKey: false, googleMapsApiKey: null };
        }
      },
      retry: 4,
      retryDelay: 800,
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: true,
      refetchInterval: (query) => {
        const key = String(
          (query.state.data as MapRuntimeResponse | undefined)
            ?.googleMapsApiKey || "",
        ).trim();
        if (GOOGLE_MAPS_WEB_API_KEY.length > 0 || key.length > 0) return false;
        return 2000;
      },
    });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMapProviderGraceExpired(true);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, []);

  const mapLocations: MapLocationsResponse = useMemo(() => {
    return (
      mapLocationsData ??
      cachedMapLocations ?? {
        hostLocations: [],
        eventLocations: [],
      }
    );
  }, [mapLocationsData, cachedMapLocations]);

  const { data: viewportOverlaysData } = useQuery<MapViewportOverlaysResponse>({
    queryKey: [
      "/api/map/overlays",
      debouncedMapBounds
        ? [
            Number(debouncedMapBounds.north.toFixed(4)),
            Number(debouncedMapBounds.south.toFixed(4)),
            Number(debouncedMapBounds.east.toFixed(4)),
            Number(debouncedMapBounds.west.toFixed(4)),
          ]
        : null,
      zoomLevel,
    ],
    enabled: Boolean(debouncedMapBounds),
    queryFn: async () => {
      const bounds = debouncedMapBounds;
      if (!bounds) {
        return {
          version: "none",
          zoom: zoomLevel,
          hostLocations: [],
          eventLocations: [],
        };
      }
      const params = new URLSearchParams({
        north: String(bounds.north),
        south: String(bounds.south),
        east: String(bounds.east),
        west: String(bounds.west),
        zoom: String(zoomLevel),
      });
      const res = await fetch(apiUrl(`/api/map/overlays?${params.toString()}`));
      if (!res.ok) throw new Error("Failed to load map overlays");
      return res.json();
    },
    staleTime: 20 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });

  const activeMapLocations: MapLocationsResponse = useMemo(() => {
    if (
      viewportOverlaysData &&
      Array.isArray(viewportOverlaysData.hostLocations) &&
      Array.isArray(viewportOverlaysData.eventLocations)
    ) {
      return {
        hostLocations: viewportOverlaysData.hostLocations,
        eventLocations: viewportOverlaysData.eventLocations,
      };
    }
    return mapLocations;
  }, [viewportOverlaysData, mapLocations]);

  // Hosts with unpriced/unbookable Parking Pass listings must not appear on maps.
  // Use a lightweight host-id endpoint + localStorage cache so the map can render immediately.
  const BOOKABLE_HOST_CACHE_KEY = "mealscout:map:bookableHostIds:v1";
  const [cachedBookableHostIds, setCachedBookableHostIds] = useState<
    Set<string>
  >(() => {
    try {
      const raw = localStorage.getItem(BOOKABLE_HOST_CACHE_KEY);
      if (!raw) return new Set<string>();
      const parsed = JSON.parse(raw);
      const hostIds = Array.isArray(parsed?.hostIds) ? parsed.hostIds : [];
      return new Set(hostIds.map((id: any) => String(id)));
    } catch {
      return new Set<string>();
    }
  });
  const [cachedBookableHostMeta, setCachedBookableHostMeta] = useState<{
    updatedAt?: number;
    generatedAt?: string;
  } | null>(() => {
    try {
      const raw = localStorage.getItem(BOOKABLE_HOST_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return {
        updatedAt:
          typeof parsed?.updatedAt === "number" ? parsed.updatedAt : undefined,
        generatedAt:
          typeof parsed?.generatedAt === "string"
            ? parsed.generatedAt
            : undefined,
      };
    } catch {
      return null;
    }
  });

  const {
    data: bookableHostIdPayload,
    isLoading: isBookableHostIdsLoading,
    isError: isBookableHostIdsError,
  } = useQuery<{ generatedAt: string; hostIds: string[] }>({
    queryKey: ["/api/parking-pass/host-ids"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/parking-pass/host-ids"));
      if (!res.ok) throw new Error("Failed to load bookable hosts");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!bookableHostIdPayload) return;
    const next = new Set(bookableHostIdPayload.hostIds.map((id) => String(id)));
    setCachedBookableHostIds(next);
    try {
      localStorage.setItem(
        BOOKABLE_HOST_CACHE_KEY,
        JSON.stringify({
          hostIds: Array.from(next),
          generatedAt: bookableHostIdPayload.generatedAt,
          updatedAt: Date.now(),
        }),
      );
    } catch {
      // ignore
    }
    setCachedBookableHostMeta({
      generatedAt: bookableHostIdPayload.generatedAt,
      updatedAt: Date.now(),
    });
  }, [bookableHostIdPayload]);

  const bookableHostIds = useMemo(() => {
    if (bookableHostIdPayload && Array.isArray(bookableHostIdPayload.hostIds)) {
      return new Set(bookableHostIdPayload.hostIds.map((id) => String(id)));
    }
    return cachedBookableHostIds;
  }, [bookableHostIdPayload, cachedBookableHostIds]);

  const HOST_STATUS_CACHE_KEY = `mealscout:map:parkingPassHostStatus:${todayKey}`;
  const [cachedHostStatusById, setCachedHostStatusById] = useState<
    Record<
      string,
      {
        hostId: string;
        availableCount: number;
        spotCount: number;
        reservedCount: number;
        isFull: boolean;
      }
    >
  >(() => {
    try {
      const raw = localStorage.getItem(HOST_STATUS_CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      const hosts = Array.isArray(parsed?.hosts) ? parsed.hosts : [];
      const map: Record<string, any> = {};
      hosts.forEach((row: any) => {
        const hostId = String(row?.hostId || "").trim();
        if (!hostId) return;
        map[hostId] = {
          hostId,
          availableCount: Number(row?.availableCount || 0),
          spotCount: Number(row?.spotCount || 0),
          reservedCount: Number(row?.reservedCount || 0),
          isFull: Boolean(row?.isFull),
        };
      });
      return map;
    } catch {
      return {};
    }
  });

  const { data: hostStatusPayload, isError: isHostStatusError } = useQuery<
    | {
        generatedAt: string;
        date: string;
        hosts: Array<{
          hostId: string;
          availableCount: number;
          spotCount: number;
          reservedCount: number;
          isFull: boolean;
        }>;
      }
    | undefined
  >({
    queryKey: ["/api/parking-pass/host-status", todayKey],
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/parking-pass/host-status?date=${todayKey}`),
      );
      if (!res.ok) throw new Error("Failed to load parking pass availability");
      return res.json();
    },
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const rows = hostStatusPayload?.hosts;
    if (!Array.isArray(rows)) return;
    const map: Record<string, any> = {};
    rows.forEach((row) => {
      const hostId = String(row.hostId || "").trim();
      if (!hostId) return;
      map[hostId] = row;
    });
    setCachedHostStatusById(map);
    try {
      localStorage.setItem(
        HOST_STATUS_CACHE_KEY,
        JSON.stringify({
          generatedAt: hostStatusPayload?.generatedAt,
          date: hostStatusPayload?.date,
          hosts: rows,
          updatedAt: Date.now(),
        }),
      );
    } catch {
      // ignore
    }
  }, [hostStatusPayload, HOST_STATUS_CACHE_KEY]);

  const { data: adminHostStatusPayload } = useQuery<
    | {
        generatedAt: string;
        date: string;
        hosts: Array<{
          hostId: string;
          availableCount: number;
          spotCount: number;
          reservedCount: number;
          isFull: boolean;
          qualityFlags?: string[];
        }>;
      }
    | undefined
  >({
    queryKey: ["/api/admin/parking-pass/host-status", todayKey],
    enabled: Boolean(isStaffOrAdmin),
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/admin/parking-pass/host-status?date=${todayKey}`),
        { credentials: "include" },
      );
      if (!res.ok) {
        return {
          generatedAt: new Date().toISOString(),
          date: todayKey,
          hosts: [],
        };
      }
      return res.json();
    },
    staleTime: 60_000,
    gcTime: 10 * 60 * 1000,
    retry: false,
  });

  const qualityFlagsByHostId = useMemo(() => {
    const map = new Map<string, string[]>();
    const rows = adminHostStatusPayload?.hosts;
    if (!Array.isArray(rows)) return map;
    rows.forEach((row) => {
      const hostId = String(row?.hostId || "").trim();
      if (!hostId) return;
      const flags = Array.isArray(row?.qualityFlags) ? row.qualityFlags : [];
      map.set(hostId, flags);
    });
    return map;
  }, [adminHostStatusPayload]);

  const lastHostIdsUpdatedLabel = (() => {
    const fromServer = bookableHostIdPayload?.generatedAt;
    const fromCache = cachedBookableHostMeta?.generatedAt;
    const raw = fromServer || fromCache;
    if (!raw) return null;
    const dt = new Date(raw);
    if (!Number.isFinite(dt.getTime())) return null;
    return dt.toLocaleString();
  })();

  const usingCachedBookableHosts =
    isBookableHostIdsError &&
    !bookableHostIdPayload &&
    cachedBookableHostIds.size > 0;
  const usingCachedHostStatus =
    isHostStatusError &&
    !hostStatusPayload &&
    Object.keys(cachedHostStatusById).length > 0;
  const fallbackBookableHostIds = useMemo(() => {
    const ids = new Set<string>();
    if (hostStatusPayload?.hosts?.length) {
      hostStatusPayload.hosts.forEach((row) => {
        const id = String(row?.hostId || "").trim();
        if (id) ids.add(id);
      });
      return ids;
    }
    Object.keys(cachedHostStatusById).forEach((id) => {
      const hostId = String(id || "").trim();
      if (hostId) ids.add(hostId);
    });
    return ids;
  }, [hostStatusPayload, cachedHostStatusById]);
  const effectiveBookableHostIds = useMemo(() => {
    if (bookableHostIds.size > 0) return bookableHostIds;
    return fallbackBookableHostIds;
  }, [bookableHostIds, fallbackBookableHostIds]);

  const visibleHostLocations = useMemo(() => {
    if (!activeMapLocations?.hostLocations?.length) return [];
    if (effectiveBookableHostIds.size === 0) return [];
    // Host parking pins should follow the live viewport; don't require "Search this area"
    // (which is primarily for refreshing/filtering other content like deals).
    const boundsForPins = mapBounds ?? appliedMapBounds;
    return activeMapLocations.hostLocations.filter((host) => {
      const hostId = host.hostId ? String(host.hostId) : "";
      if (!hostId) return false;
      if (
        effectiveBookableHostIds.size > 0 &&
        !effectiveBookableHostIds.has(hostId)
      ) {
        return false;
      }
      const coords = resolveHostCoords(host);
      if (!coords) return false;
      if (boundsForPins && !boundsForPins.contains([coords.lat, coords.lng])) {
        return false;
      }
      return true;
    });
  }, [activeMapLocations, hostCoords, mapBounds, appliedMapBounds, effectiveBookableHostIds]);

  const getHostAvailabilityLabel = useCallback(
    (host: HostLocation) => {
      const hostId = String(host.hostId || "").trim();
      const status = hostId ? cachedHostStatusById[hostId] : undefined;
      const isBookable = hostId ? effectiveBookableHostIds.has(hostId) : false;
      const label = !isBookable
        ? "No active spot listing yet"
        : status
          ? status.isFull
            ? "Fully booked today"
            : `${status.availableCount}/${status.spotCount} spots open today`
          : "Availability updating...";
      return { isBookable, label };
    },
    [cachedHostStatusById, effectiveBookableHostIds],
  );

  const visibleEventLocations = useMemo(() => {
    if (!activeMapLocations?.eventLocations?.length) return [];
    return activeMapLocations.eventLocations.filter((event) => {
      const coords = resolveEventCoords(event);
      if (!coords) return false;
      if (!appliedMapBounds) return true;
      return appliedMapBounds.contains([coords.lat, coords.lng]);
    });
  }, [activeMapLocations, eventCoords, appliedMapBounds]);

  const hostMarkerCoordsById = useMemo(() => {
    const groups = new Map<string, Array<{ id: string; coords: GeoPoint }>>();
    visibleHostLocations.forEach((host) => {
      const coords = resolveHostCoords(host);
      if (!coords) return;
      const key = overlapKey(coords);
      const prev = groups.get(key) || [];
      prev.push({ id: host.id, coords });
      groups.set(key, prev);
    });

    const next = new Map<string, GeoPoint>();
    groups.forEach((items) => {
      const count = items.length;
      items.forEach((item, index) => {
        next.set(
          item.id,
          offsetOverlappingCoords(item.coords, index, count, zoomLevel),
        );
      });
    });
    return next;
  }, [visibleHostLocations, resolveHostCoords, zoomLevel]);

  const hostedTruckIds = useMemo(() => {
    const ids = new Set<string>();
    visibleHostLocations.forEach((host) => {
      const coords = resolveHostCoords(host);
      if (!coords) return;
      const nearby = findNearbyTruck(coords);
      if (nearby) ids.add(nearby.truck.id);
    });
    visibleEventLocations.forEach((event) => {
      const coords = resolveEventCoords(event);
      if (!coords) return;
      const nearby = findNearbyTruck(coords);
      if (nearby) ids.add(nearby.truck.id);
    });
    return ids;
  }, [
    visibleHostLocations,
    visibleEventLocations,
    resolveHostCoords,
    resolveEventCoords,
    findNearbyTruck,
  ]);

  const visibleUnhostedTrucks = useMemo(() => {
    return visibleLiveTrucks.filter((truck) => !hostedTruckIds.has(truck.id));
  }, [visibleLiveTrucks, hostedTruckIds]);

  const visibleUnhostedCommunitySightings = useMemo(() => {
    return visibleCommunitySightings.filter((sighting) => {
      const sightingCoords = {
        lat: Number(sighting.latitude),
        lng: Number(sighting.longitude),
      };
      for (const host of visibleHostLocations) {
        const hostCoords = resolveHostCoords(host);
        if (!hostCoords) continue;
        if (haversineKm(sightingCoords, hostCoords) <= hostedRadiusKm) {
          return false;
        }
      }
      return true;
    });
  }, [visibleCommunitySightings, visibleHostLocations, resolveHostCoords]);

  useEffect(() => {
    if (
      !activeMapLocations?.hostLocations?.length &&
      !activeMapLocations?.eventLocations?.length
    ) {
      return;
    }

    const nextHosts: Record<string, GeoPoint> = {};
    activeMapLocations?.hostLocations.forEach((host) => {
      const lat = toNumberOrNull(host.latitude);
      const lng = toNumberOrNull(host.longitude);
      if (lat !== null && lng !== null) {
        nextHosts[host.id] = { lat, lng };
      }
    });

    const nextEvents: Record<string, GeoPoint> = {};
    activeMapLocations?.eventLocations.forEach((event) => {
      const lat = toNumberOrNull(event.hostLatitude);
      const lng = toNumberOrNull(event.hostLongitude);
      if (lat !== null && lng !== null) {
        nextEvents[event.id] = { lat, lng };
      }
    });

    if (Object.keys(nextHosts).length) {
      setHostCoords((prev) => ({ ...prev, ...nextHosts }));
    }
    if (Object.keys(nextEvents).length) {
      setEventCoords((prev) => ({ ...prev, ...nextEvents }));
    }
  }, [activeMapLocations]);

  // Build a geocoding work list for any host/event without coordinates yet
  useEffect(() => {
    if (!enableClientGeocode) {
      return;
    }
    if (!mapBounds) {
      return;
    }
    if (geocodeInFlight.current) {
      return;
    }
    const queue: string[] = [];
    const addressByKey: Record<string, string> = {};
    const now = Date.now();
    const failureCooldownMs = 6 * 60 * 60 * 1000;
    const maxQueue = zoomLevel >= 16 ? 30 : 16;

    mapLocations?.hostLocations.forEach((host) => {
      const lat = toNumberOrNull(host.latitude);
      const lng = toNumberOrNull(host.longitude);
      if (lat !== null && lng !== null) {
        return;
      }
      if (!hostCoords[host.id]) {
        const address = buildFullAddress(host.address, host.city, host.state);
        if (!address) return;
        queue.push(`host:${host.id}`);
        addressByKey[`host:${host.id}`] = address;
      }
    });

    mapLocations?.eventLocations.forEach((event) => {
      const lat = toNumberOrNull(event.hostLatitude);
      const lng = toNumberOrNull(event.hostLongitude);
      if (lat !== null && lng !== null) {
        return;
      }
      if (!eventCoords[event.id] && event.hostAddress) {
        const address = buildFullAddress(
          event.hostAddress,
          event.hostCity,
          event.hostState,
        );
        if (!address) return;
        queue.push(`event:${event.id}`);
        addressByKey[`event:${event.id}`] = address;
      }
    });

    if (queue.length) {
      const limitedQueue = queue.slice(0, maxQueue);
      geocodeInFlight.current = true;
      (async () => {
        try {
          const newHostCoords: Record<string, GeoPoint> = {};
          const newEventCoords: Record<string, GeoPoint> = {};
          const newFailures: Record<string, GeocodeFailureEntry> = {};

          for (const key of limitedQueue) {
            const address = addressByKey[key];
            if (!address) continue;
            const cached = geocodeCache[address];
            if (cached) {
              const point = { lat: cached.lat, lng: cached.lng };
              if (key.startsWith("host:")) {
                newHostCoords[key.replace("host:", "")] = point;
              } else if (key.startsWith("event:")) {
                newEventCoords[key.replace("event:", "")] = point;
              }
              continue;
            }

            const failed = geocodeFailures[address];
            if (failed && now - failed.ts < failureCooldownMs) {
              continue;
            }

            const point = await geocodeAddress(address).catch(() => null);
            if (!point) {
              newFailures[address] = { ts: Date.now() };
              continue;
            }
            if (key.startsWith("host:")) {
              newHostCoords[key.replace("host:", "")] = point;
            } else if (key.startsWith("event:")) {
              newEventCoords[key.replace("event:", "")] = point;
            }
            setGeocodeCache((prev) => ({
              ...prev,
              [address]: { lat: point.lat, lng: point.lng, ts: Date.now() },
            }));
            // small delay to avoid hammering the free geocoder
            await new Promise((r) => setTimeout(r, 300));
          }

          if (Object.keys(newHostCoords).length) {
            setHostCoords((prev) => ({ ...prev, ...newHostCoords }));
          }
          if (Object.keys(newEventCoords).length) {
            setEventCoords((prev) => ({ ...prev, ...newEventCoords }));
          }
          if (Object.keys(newFailures).length) {
            setGeocodeFailures((prev) => ({ ...prev, ...newFailures }));
          }
        } finally {
          geocodeInFlight.current = false;
        }
      })();
    }
  }, [
    mapLocations,
    hostCoords,
    eventCoords,
    geocodeCache,
    geocodeFailures,
    mapBounds,
    zoomLevel,
  ]);

  const handleCenterOnUser = () => {
    if (userLocation) {
      setMapCenter(userLocation);
      setHasPendingAreaSearch(false);
    }
  };

  const handleDealClick = (deal: Deal) => {
    trackUxEvent("map_deal_pin_tap", {
      dealId: deal.id,
      restaurantId: deal.restaurantId || null,
    });
    setSelectedDeal(deal);
    setSelectedParkingPreview(null);
    setSelectedHostCluster(null);
    if (deal.restaurant) {
      setMapCenter({
        lat: deal.restaurant.latitude,
        lng: deal.restaurant.longitude,
      });
      setHasPendingAreaSearch(false);
    }
  };

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev + 1, 18));
  };

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev - 1, 1));
  };

  const hasLocation = !!userLocation;
  const liveTruckPins = visibleLiveTrucks.length;
  const crowdSightingPins = visibleCommunitySightings.length;
  const hostPins = visibleHostLocations.length;
  const eventPins = visibleEventLocations.length;
  const activityPins = liveTruckPins + crowdSightingPins + hostPins + eventPins;
  const totalHostParkingLocations = effectiveBookableHostIds.size;
  const mapHostParkingLocations = visibleHostLocations.length;
  const isNightTheme =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("theme-night");
  const userMapTileUrl = isNightTheme
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
  const userMapAttribution =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
  const headerSubtitle = isLocating
    ? "Locating live trucks and host spots..."
    : hasLocation && activityPins > 0
      ? "Live trucks and host locations nearby"
      : hasLocation
        ? "No live trucks or hosts nearby right now"
        : "Set your location to see live trucks and hosts.";

  const handleRefreshHostParking = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["/api/parking-pass/host-ids"],
    });
    await queryClient.invalidateQueries({
      queryKey: ["/api/parking-pass/host-status", todayKey],
    });
    await queryClient.invalidateQueries({ queryKey: ["/api/map/locations"] });
    if (isStaffOrAdmin) {
      await queryClient.invalidateQueries({
        queryKey: ["/api/admin/parking-pass/host-status", todayKey],
      });
    }
  };

  useEffect(() => {
    if (!mapBounds) return;
    if (!appliedMapBounds) {
      setAppliedMapBounds(mapBounds);
      return;
    }
    if (!areBoundsEqual(mapBounds, appliedMapBounds)) {
      setHasPendingAreaSearch(true);
    }
  }, [mapBounds, appliedMapBounds]);

  useEffect(() => {
    if (!mapBounds) {
      setDebouncedMapBounds(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setDebouncedMapBounds(mapBounds);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [mapBounds]);

  const applyCurrentArea = () => {
    if (!mapBounds) return;
    setAppliedMapBounds(mapBounds);
    if (pendingMapCenter) {
      setMapCenter(pendingMapCenter);
    }
    setSelectedDeal(null);
    setSelectedParkingPreview(null);
    setSelectedHostCluster(null);
    setHasPendingAreaSearch(false);
  };

  useEffect(() => {
    if (zoomLevel >= 14 && selectedHostCluster) {
      setSelectedHostCluster(null);
    }
  }, [zoomLevel, selectedHostCluster]);

  const runtimeGoogleMapsApiKey = String(
    mapRuntime?.googleMapsApiKey || "",
  ).trim();
  const runtimeGoogleMapsMapId = String(
    mapRuntime?.googleMapsMapId || "",
  ).trim();
  const buildGoogleMapsMapId = String(
    (import.meta as any).env?.VITE_GOOGLE_MAPS_MAP_ID || "",
  ).trim();
  const effectiveGoogleMapsMapId =
    runtimeGoogleMapsMapId || buildGoogleMapsMapId;
  const effectiveGoogleMapsApiKey =
    runtimeGoogleMapsApiKey || GOOGLE_MAPS_WEB_API_KEY;
  const shouldHoldMapProviderSelection =
    GOOGLE_MAPS_WEB_API_KEY.length === 0 &&
    runtimeGoogleMapsApiKey.length === 0 &&
    !mapProviderGraceExpired;
  const isGoogleProviderRequested = effectiveGoogleMapsApiKey.length > 0;
  const isGoogleProviderMissingKey = !isGoogleProviderRequested;
  const isUsingGoogleMap = isGoogleProviderRequested;
  const mapProviderLabel = isGoogleProviderMissingKey
    ? "Google Maps (key missing)"
    : "Google Maps";

  const handleGoogleMapsFatalError = useCallback((message: string) => {
    setGoogleMapsRuntimeError(
      message || "Google Maps failed to load for this domain.",
    );
    setForceLegacyMap(true);
  }, []);

  useEffect(() => {
    // If key provisioning completes after first render, allow Google map immediately.
    if (!isGoogleProviderRequested) return;
    setForceLegacyMap(false);
    setGoogleMapsRuntimeError(null);
    setGoogleMapAutoRetryCount(0);
  }, [effectiveGoogleMapsApiKey, isGoogleProviderRequested]);

  useEffect(() => {
    // Recover from transient script/auth races without requiring user navigation.
    if (!forceLegacyMap || !isGoogleProviderRequested) return;
    if (googleMapAutoRetryCount >= 3) return;
    const timer = window.setTimeout(() => {
      setGoogleMapAutoRetryCount((prev) => prev + 1);
      setGoogleMapsRuntimeError(null);
      setForceLegacyMap(false);
      setGoogleMapRetryNonce((prev) => prev + 1);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [forceLegacyMap, isGoogleProviderRequested, googleMapAutoRetryCount]);

  const adapterMarkers = useMemo<MapAdapterMarker[]>(() => {
    const next: MapAdapterMarker[] = [];

    if (userLocation) {
      next.push({
        id: "user:self",
        sourceId: "self",
        kind: "user",
        lat: userLocation.lat,
        lng: userLocation.lng,
        title: "You are here",
      });
    }

    visibleGeoAds.forEach((ad) => {
      const lat = toNumberOrNull(ad.pinLat);
      const lng = toNumberOrNull(ad.pinLng);
      if (lat == null || lng == null) return;
      next.push({
        id: `geo_ad:${ad.id}`,
        sourceId: ad.id,
        kind: "geo_ad",
        lat,
        lng,
        title: ad.title,
      });
    });

    visibleDeals.forEach((deal) => {
      const lat = toNumberOrNull(deal.restaurant?.latitude);
      const lng = toNumberOrNull(deal.restaurant?.longitude);
      if (lat == null || lng == null) return;
      const popularity =
        businessPopularityByRestaurant[String(deal.restaurantId || "")];
      next.push({
        id: `deal:${deal.id}`,
        sourceId: deal.id,
        kind: "deal",
        lat,
        lng,
        title: deal.title,
        subtitle: deal.restaurant?.name,
        color: popularity?.color || undefined,
      });
    });

    visibleUnhostedTrucks.forEach((truck) => {
      const lat = toNumberOrNull(truck.currentLatitude);
      const lng = toNumberOrNull(truck.currentLongitude);
      if (lat == null || lng == null) return;
      const popularity = businessPopularityByRestaurant[String(truck.id || "")];
      next.push({
        id: `truck:${truck.id}`,
        sourceId: truck.id,
        kind: "truck",
        lat,
        lng,
        title: truck.name,
        color: popularity?.color || undefined,
      });
    });

    visibleUnhostedCommunitySightings.forEach((sighting) => {
      const lat = toNumberOrNull(sighting.latitude);
      const lng = toNumberOrNull(sighting.longitude);
      if (lat == null || lng == null) return;
      next.push({
        id: `truck_sighting:${sighting.id}`,
        sourceId: `sighting:${sighting.id}`,
        kind: "truck",
        lat,
        lng,
        title: sighting.truckName,
        subtitle: "Community sighting (1h)",
      });
    });

    visibleHostLocations.forEach((host) => {
      const coords = resolveHostCoords(host);
      if (!coords) return;
      const markerCoords = hostMarkerCoordsById.get(host.id) || coords;
      next.push({
        id: `parking:${host.id}`,
        sourceId: host.id,
        kind: "parking",
        lat: markerCoords.lat,
        lng: markerCoords.lng,
        title: host.name,
        subtitle: host.address ?? undefined,
      });
    });

    visibleEventLocations.forEach((event) => {
      const coords = resolveEventCoords(event);
      if (!coords) return;
      next.push({
        id: `event:${event.id}`,
        sourceId: event.id,
        kind: "event",
        lat: coords.lat,
        lng: coords.lng,
        title: event.name,
      });
    });

    return next;
  }, [
    userLocation,
    visibleGeoAds,
    visibleDeals,
    visibleUnhostedTrucks,
    visibleUnhostedCommunitySightings,
    visibleHostLocations,
    visibleEventLocations,
    hostMarkerCoordsById,
    resolveHostCoords,
    resolveEventCoords,
    businessPopularityByRestaurant,
  ]);

  const cardCandidateMarkers = useMemo(() => {
    const candidateBounds = mapBounds ?? appliedMapBounds;
    const base = adapterMarkers.filter(
      (marker) => marker.kind === "parking",
    );
    if (!candidateBounds) return base;
    const inView = base.filter((marker) =>
      candidateBounds.contains([marker.lat, marker.lng]),
    );
    return inView.length > 0 ? inView : base;
  }, [adapterMarkers, mapBounds, appliedMapBounds]);

  // Shared reusable pin->zoom->card controller.
  // Phase 2: enabled for parking markers only.
  const enablePinZoomCardMode = true;
  const pinZoomCardMode = usePinZoomCardMode<MapAdapterMarker>({
    enabled: enablePinZoomCardMode,
    zoom: zoomLevel,
    cardsAtOrAboveZoom: 15,
    markers: cardCandidateMarkers,
    markerId: (marker) => marker.id,
    includeMarker: (marker) => marker.kind === "parking",
    dedupeKey: (marker) => `${marker.kind}:${marker.sourceId}`,
    maxCards: 8,
    hasBlockingSelection: Boolean(selectedDeal || selectedHostCluster),
  });

  const preferredParkingZoomCard = useMemo(() => {
    const cards = pinZoomCardMode.cards.filter(
      (marker) => marker.kind === "parking",
    );
    if (cards.length === 0) return null;
    const current = pinZoomCardMode.activeCardId
      ? cards.find((card) => card.id === pinZoomCardMode.activeCardId)
      : null;
    if (current) return current;
    const score = (marker: MapAdapterMarker) => {
      const dLat = marker.lat - mapCenter.lat;
      const dLng = marker.lng - mapCenter.lng;
      return dLat * dLat + dLng * dLng;
    };
    return [...cards].sort((a, b) => score(a) - score(b))[0] || null;
  }, [pinZoomCardMode.cards, pinZoomCardMode.activeCardId, mapCenter]);

  const closeParkingPreview = useCallback(() => {
    setSelectedParkingPreview(null);
    setShouldAutoOpenZoomCard(false);
    pinZoomCardMode.clearActiveCard();
  }, [pinZoomCardMode]);

  useEffect(() => {
    const current = Number(zoomLevel);
    if (!Number.isFinite(current)) return;
    const previous = lastZoomLevelRef.current;
    lastZoomLevelRef.current = current;

    if (!hasSeenInitialZoomRef.current) {
      hasSeenInitialZoomRef.current = true;
      return;
    }

    if (previous < 15 && current >= 15) {
      setShouldAutoOpenZoomCard(true);
      return;
    }
    if (current < 15) {
      setShouldAutoOpenZoomCard(false);
    }
  }, [zoomLevel]);

  useEffect(() => {
    if (!pinZoomCardMode.showCards) return;
    if (!shouldAutoOpenZoomCard) return;
    const target = preferredParkingZoomCard;
    if (!target || target.kind !== "parking") return;
    if (pinZoomCardMode.activeCardId !== target.id) {
      pinZoomCardMode.setActiveCardId(target.id);
    }
    const targetHostId = String(target.sourceId || "").trim();
    if (!targetHostId) return;
    if (
      selectedParkingPreview?.hostId === targetHostId &&
      selectedParkingPreview.source === "zoom-card"
    ) {
      return;
    }
    setSelectedDeal(null);
    setSelectedHostCluster(null);
    setSelectedParkingPreview({
      hostId: targetHostId,
      markerLat: target.lat,
      markerLng: target.lng,
      source: "zoom-card",
    });
    setShouldAutoOpenZoomCard(false);
  }, [
    pinZoomCardMode.showCards,
    shouldAutoOpenZoomCard,
    pinZoomCardMode.activeCardId,
    pinZoomCardMode.setActiveCardId,
    preferredParkingZoomCard,
    selectedParkingPreview,
  ]);

  useEffect(() => {
    if (pinZoomCardMode.showCards) return;
    if (selectedParkingPreview?.source !== "zoom-card") return;
    setSelectedParkingPreview(null);
  }, [pinZoomCardMode.showCards, selectedParkingPreview]);

  const mapMarkersForRender = useMemo(() => {
    // Dedupe markers by (kind, rounded lat, rounded lng) to avoid duplicate
    // overlapping pins from coexisting data feeds (e.g., live trucks +
    // community sightings of the same truck at the same address).
    const seen = new Set<string>();
    const out: MapAdapterMarker[] = [];
    for (const m of adapterMarkers) {
      const key = `${m.kind}|${m.lat.toFixed(5)}|${m.lng.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
    if (areaFilterBounds) {
      const { north, south, east, west } = areaFilterBounds;
      return out.filter(
        (m) =>
          m.lat <= north &&
          m.lat >= south &&
          m.lng <= east &&
          m.lng >= west,
      );
    }
    return out;
  }, [adapterMarkers, areaFilterBounds]);

  const selectParkingHost = useCallback(
    (
      host: HostLocation,
      markerCoords: Pick<GeoPoint, "lat" | "lng">,
      source: ParkingPreviewSelection["source"] = "pin-tap",
    ) => {
      setSelectedDeal(null);
      setSelectedHostCluster(null);
      setSelectedParkingPreview({
        hostId: host.id,
        markerLat: markerCoords.lat,
        markerLng: markerCoords.lng,
        source,
      });
    },
    [],
  );

  const handleAdapterMarkerTap = useCallback(
    (marker: MapAdapterMarker) => {
      if (marker.kind === "deal") {
        const deal =
          visibleDeals.find((item) => item.id === marker.sourceId) ||
          deals.find((item) => item.id === marker.sourceId);
        if (deal) handleDealClick(deal);
        return;
      }

      if (marker.kind === "geo_ad") {
        const ad =
          visibleGeoAds.find((item) => item.id === marker.sourceId) ||
          geoAds.find((item) => item.id === marker.sourceId);
        if (ad) handleGeoAdClick(ad);
        return;
      }

      if (marker.kind === "truck") {
        if (String(marker.sourceId).startsWith("sighting:")) {
          const sightingId = String(marker.sourceId).replace("sighting:", "");
          const sighting = visibleUnhostedCommunitySightings.find(
            (item) => item.id === sightingId,
          );
          if (sighting) {
            setSelectedDeal(null);
            setSelectedParkingPreview(null);
            setSelectedHostCluster(null);
            setSelectedSighting(sighting);
          }
          return;
        }
        trackUxEvent("map_restaurant_nav_click", {
          restaurantId: String(marker.sourceId),
          source: "truck_pin",
        });
        window.location.href = `/restaurant/${marker.sourceId}`;
        return;
      }

      if (marker.kind === "parking") {
        const host = visibleHostLocations.find(
          (item) => item.id === marker.sourceId,
        );
        if (!host) return;
        selectParkingHost(host, marker, "pin-tap");
        return;
      }

      if (marker.kind === "event") {
        const event = visibleEventLocations.find(
          (item) => item.id === marker.sourceId,
        );
        const coords = event ? resolveEventCoords(event) : null;
        const lat = coords?.lat ?? marker.lat;
        const lng = coords?.lng ?? marker.lng;
        window.open(`https://maps.google.com/?q=${lat},${lng}`, "_blank");
      }
    },
    [
      deals,
      geoAds,
      visibleDeals,
      visibleGeoAds,
      visibleUnhostedCommunitySightings,
      visibleHostLocations,
      visibleEventLocations,
      resolveEventCoords,
      selectParkingHost,
    ],
  );

  const selectedParkingHost = useMemo(() => {
    if (!selectedParkingPreview) return null;
    const selectedHostOverlay = visibleHostLocations.find(
      (item) => item.id === selectedParkingPreview.hostId,
    );
    const selectedHostCanonicalById = mapLocations.hostLocations.find(
      (item) => item.id === selectedParkingPreview.hostId,
    );
    const selectedHostCanonicalByHostId = selectedHostOverlay?.hostId
      ? mapLocations.hostLocations.find(
          (item) =>
            String(item.hostId || "").trim() ===
            String(selectedHostOverlay.hostId || "").trim(),
        )
      : null;
    const canonicalHost =
      selectedHostCanonicalById || selectedHostCanonicalByHostId || null;
    const hostBase = selectedHostOverlay || canonicalHost;
    if (!hostBase) return null;
    const host: HostLocation = {
      ...(canonicalHost || {}),
      ...hostBase,
      spotImageUrl:
        resolveHostImageUrl(hostBase) ||
        resolveHostImageUrl(canonicalHost || undefined),
    };
    const coords = resolveHostCoords(host);
    if (!coords) return null;
    const nearby = findNearbyTruck(coords);
    const { isBookable, label } = getHostAvailabilityLabel(host);
    return {
      host,
      coords,
      nearbyTruck: nearby?.truck || null,
      distanceLabel: formatDistance(coords),
      publicProfileHref: getPublicProfileHrefForHost(host),
      availabilityLabel: label,
      isBookable,
    };
  }, [
    selectedParkingPreview,
    visibleHostLocations,
    mapLocations.hostLocations,
    resolveHostCoords,
    findNearbyTruck,
    getHostAvailabilityLabel,
    formatDistance,
    getPublicProfileHrefForHost,
  ]);
  const selectedParkingHostId = useMemo(() => {
    if (!selectedParkingHost) return "";
    return String(
      selectedParkingHost.host.hostId || selectedParkingHost.host.id || "",
    ).trim();
  }, [selectedParkingHost]);

  const { data: selectedParkingHostProfile } = useQuery<HostProfile>({
    queryKey: ["/api/profiles/host", selectedParkingHostId],
    enabled: Boolean(selectedParkingHostId),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/profiles/host/${encodeURIComponent(selectedParkingHostId)}`),
      );
      if (!res.ok) {
        throw new Error("Failed to load host profile");
      }
      return (await res.json()) as HostProfile;
    },
  });

  const selectedParkingGoogleCategories = useMemo(
    () =>
      parseGoogleCategories(
        selectedParkingHostProfile?.googleCategories ??
          selectedParkingHost?.host.googleCategories,
      ),
    [selectedParkingHostProfile, selectedParkingHost],
  );

  const selectedParkingHasBusinessInfo = Boolean(
    selectedParkingHostProfile?.description ||
      selectedParkingHost?.host.description ||
      selectedParkingGoogleCategories.length > 0 ||
      selectedParkingHostProfile?.businessHours ||
      selectedParkingHost?.host.businessHours ||
      selectedParkingHostProfile?.phone ||
      selectedParkingHost?.host.googleFormattedPhone ||
      selectedParkingHostProfile?.website ||
      selectedParkingHost?.host.businessWebsite ||
      (selectedParkingHostProfile?.googlePriceLevel ??
        selectedParkingHost?.host.googlePriceLevel) != null,
  );

  const selectedParkingHostImageUrl = useMemo(() => {
    const uploaded = resolveHostImageUrl(selectedParkingHost?.host);
    if (uploaded) return uploaded;
    const profilePhoto = selectedParkingHostProfile?.photos?.find((photo) =>
      String(photo?.url || "").trim(),
    )?.url;
    if (profilePhoto) return profilePhoto;
    if (!selectedParkingHost || !effectiveGoogleMapsApiKey) return null;
    const host = selectedParkingHost.host;
    const addressParts = [host.address, host.city, host.state].filter(Boolean);
    const addressQuery = addressParts.length > 0 ? addressParts.join(", ") : null;
    if (!addressQuery) return null;
    const encoded = encodeURIComponent(addressQuery);
    const streetView = `https://maps.googleapis.com/maps/api/streetview?size=960x540&location=${encoded}&fov=90&pitch=5&source=outdoor&key=${encodeURIComponent(effectiveGoogleMapsApiKey)}`;
    const staticMap = `https://maps.googleapis.com/maps/api/staticmap?center=${encoded}&zoom=16&size=640x360&scale=1&maptype=roadmap&markers=color:0xF97316%7C${encoded}&key=${encodeURIComponent(effectiveGoogleMapsApiKey)}`;
    return streetView || staticMap;
  }, [selectedParkingHost, selectedParkingHostProfile, effectiveGoogleMapsApiKey]);

  const {
    data: selectedHostUpcomingBookings,
    isLoading: isLoadingSelectedHostUpcomingBookings,
  } = useQuery<HostUpcomingBookingsResponse>({
    queryKey: ["/api/map/hosts", selectedParkingHostId, "upcoming-bookings"],
    enabled: Boolean(selectedParkingHostId),
    queryFn: async () => {
      const res = await fetch(
        apiUrl(
          `/api/map/hosts/${encodeURIComponent(selectedParkingHostId)}/upcoming-bookings`,
        ),
      );
      if (!res.ok) {
        throw new Error("Failed to load upcoming host bookings");
      }
      return res.json();
    },
    staleTime: 60_000,
  });

  const selectedParkingHasUpcomingBookings = Boolean(
    Array.isArray(selectedHostUpcomingBookings?.bookings) &&
      selectedHostUpcomingBookings.bookings.length > 0,
  );

  const {
    data: selectedParkingRouteSummary,
    isLoading: isLoadingSelectedParkingRouteSummary,
  } = useQuery<MapRouteSummaryResponse>({
    queryKey: [
      "/api/map/route-summary",
      userLocation?.lat,
      userLocation?.lng,
      selectedParkingHost?.coords.lat,
      selectedParkingHost?.coords.lng,
      "DRIVE",
    ],
    enabled: Boolean(userLocation && selectedParkingHost),
    queryFn: async () => {
      if (!userLocation || !selectedParkingHost) {
        throw new Error("Route summary missing origin/destination");
      }
      const params = new URLSearchParams({
        originLat: String(userLocation.lat),
        originLng: String(userLocation.lng),
        destLat: String(selectedParkingHost.coords.lat),
        destLng: String(selectedParkingHost.coords.lng),
        travelMode: "DRIVE",
      });
      const res = await fetch(
        apiUrl(`/api/map/route-summary?${params.toString()}`),
      );
      if (!res.ok) {
        throw new Error("Failed to load route summary");
      }
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const selectedParkingEtaLabel = useMemo(
    () =>
      selectedParkingRouteSummary
        ? formatDurationLabel(selectedParkingRouteSummary.durationSeconds)
        : null,
    [selectedParkingRouteSummary],
  );

  const selectedParkingRoadDistanceLabel = useMemo(
    () =>
      selectedParkingRouteSummary
        ? formatRoadDistance(selectedParkingRouteSummary.distanceMeters)
        : null,
    [selectedParkingRouteSummary],
  );

  const {
    data: selectedSightingRouteSummary,
    isLoading: isLoadingSelectedSightingRouteSummary,
  } = useQuery<MapRouteSummaryResponse>({
    queryKey: [
      "/api/map/route-summary",
      userLocation?.lat,
      userLocation?.lng,
      selectedSighting?.latitude,
      selectedSighting?.longitude,
      "DRIVE",
    ],
    enabled: Boolean(userLocation && selectedSighting),
    queryFn: async () => {
      if (!userLocation || !selectedSighting) {
        throw new Error("Route summary missing origin/destination");
      }
      const params = new URLSearchParams({
        originLat: String(userLocation.lat),
        originLng: String(userLocation.lng),
        destLat: String(selectedSighting.latitude),
        destLng: String(selectedSighting.longitude),
        travelMode: "DRIVE",
      });
      const res = await fetch(
        apiUrl(`/api/map/route-summary?${params.toString()}`),
      );
      if (!res.ok) {
        throw new Error("Failed to load route summary");
      }
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const selectedSightingEtaLabel = useMemo(
    () =>
      selectedSightingRouteSummary
        ? formatDurationLabel(selectedSightingRouteSummary.durationSeconds)
        : null,
    [selectedSightingRouteSummary],
  );

  const selectedSightingDistanceLabel = useMemo(
    () =>
      selectedSightingRouteSummary
        ? formatRoadDistance(selectedSightingRouteSummary.distanceMeters)
        : null,
    [selectedSightingRouteSummary],
  );

  const mapSchemaData = useMemo(
    () => ({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Map",
          name: `${mapBranding.appName} Live Map`,
          description: mapBranding.mapSchemaDescription,
          url: `${mapBranding.canonicalBaseUrl}/map`,
        },
        {
          "@type": "ItemList",
          name: "Nearby Map Deals",
          numberOfItems: visibleDeals.slice(0, 12).length,
          itemListElement: visibleDeals
            .slice(0, 12)
            .map((deal: Deal, index: number) => ({
              "@type": "ListItem",
              position: index + 1,
              name: deal.title,
              url: `${mapBranding.canonicalBaseUrl}/deal/${deal.id}`,
            })),
        },
      ],
    }),
    [visibleDeals, mapBranding],
  );
  type TrendingSearchRow = { query: string; count: number };
  const { data: trendingSearches = [] } = useQuery<TrendingSearchRow[]>({
    queryKey: ["/api/search/trending", "map-discovery"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/search/trending?limit=8"));
      if (!res.ok) throw new Error("Failed to fetch trending searches");
      return res.json();
    },
    staleTime: 30_000,
  });
  const mapExploreLinks = [
    {
      href: "/search",
      title: "Search Food Deals",
      description: `Search by cuisine, restaurant, and deal type across ${mapBranding.appName}.`,
    },
    {
      href: "/events",
      title: "Food Truck Events",
      description:
        "Check upcoming public events with trucks and pop-up vendors.",
    },
    {
      href: "/faq",
      title: "Map & Deal FAQ",
      description:
        "Learn how map pins, live trucks, and deal availability work.",
    },
  ];
  const fallbackTrending = [
    "food trucks",
    "tacos",
    "bbq",
    "breakfast",
    "seafood",
    "wings",
    "pizza",
    "coffee",
  ];
  const trendingLinks = (
    Array.isArray(trendingSearches) && trendingSearches.length > 0
      ? trendingSearches.map((row) => row?.query).filter(Boolean)
      : fallbackTrending
  )
    .slice(0, 8)
    .map((query) => ({
      href: `/search?q=${encodeURIComponent(query)}`,
      title: query,
      description:
        "Jump into search results across deals, trucks, parking, and events.",
    }));

  const activeMapCalloutAnchor = useMemo<GeoPoint | null>(() => {
    if (selectedDeal) {
      const lat = toNumberOrNull(selectedDeal.restaurant?.latitude);
      const lng = toNumberOrNull(selectedDeal.restaurant?.longitude);
      if (lat !== null && lng !== null) return { lat, lng };
    }
    if (!selectedDeal && selectedSighting) {
      return {
        lat: Number(selectedSighting.latitude),
        lng: Number(selectedSighting.longitude),
      };
    }
    if (!selectedDeal && selectedParkingPreview) {
      return {
        lat: selectedParkingPreview.markerLat,
        lng: selectedParkingPreview.markerLng,
      };
    }
    if (!selectedDeal && !selectedParkingPreview && selectedHostCluster) {
      return { lat: selectedHostCluster.lat, lng: selectedHostCluster.lng };
    }
    return null;
  }, [selectedDeal, selectedSighting, selectedParkingPreview, selectedHostCluster]);

  const hasMapCalloutAnchor = Boolean(mapCalloutAnchorPosition);
  const mapCalloutShellClassName =
    "absolute left-0 top-0 z-20 -translate-x-1/2 -translate-y-[calc(100%+18px)]";
  const mapCalloutShellStyle = hasMapCalloutAnchor
    ? {
        left: mapCalloutAnchorPosition!.x,
        top: mapCalloutAnchorPosition!.y,
      }
    : undefined;

  return (
    <div className="max-w-md mx-auto bg-background min-h-screen relative pb-20">
      <SEOHead
        title={mapBranding.seoTitle}
        description={mapBranding.seoDescription}
        keywords={mapBranding.seoKeywords}
        canonicalUrl={`${mapBranding.canonicalBaseUrl}/map`}
        schemaData={mapSchemaData}
      />
      <BackHeader title="Map" fallbackHref="/" />
      {/* Header */}
      <header
        className={`px-6 py-5 border-b border-[color:var(--border-subtle)] relative z-10 ${
          isNightTheme
            ? "bg-[var(--bg-card)]/90 backdrop-blur text-[color:var(--text-primary)]"
            : "bg-[var(--bg-card)] text-[color:var(--text-primary)]"
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--bg-card)] shadow-clean flex items-center justify-center">
              <img
                src={mealScoutIcon}
                alt={mapBranding.appName}
                className="w-7 h-7"
              />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">
                {mapBranding.mapName}
              </h1>
              {showMapDiagnostics ? (
                <p className="text-sm text-muted-foreground">{headerSubtitle}</p>
              ) : null}
            </div>
          </div>
          <div className="flex space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowReportTruckDialog(true);
                setSelectedDeal(null);
                setSelectedParkingPreview(null);
                setSelectedHostCluster(null);
                setSelectedSighting(null);
              }}
              data-testid="button-report-truck-sighting"
            >
              Report Truck
            </Button>
            {!isStandalone && (
              <Link href="/install">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Install app"
                  title="Install app"
                  data-testid="button-map-install"
                  onPointerDown={() => {
                    trackUxEvent("map_install_click", {
                      surface: "map_header",
                    });
                  }}
                >
                  <ArrowDownToLine className="w-4 h-4" />
                </Button>
              </Link>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowList(!showList)}
              data-testid="button-toggle-list"
              aria-label={showList ? "Hide deals list" : "Show deals list"}
              aria-expanded={showList}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Location Status */}
        {showMapDiagnostics && locationError && (
          <div
            className="text-xs text-[color:var(--status-error)] mb-4 bg-[color:var(--status-error)]/10 border border-[color:var(--status-error)]/30 rounded p-2"
            role="alert"
          >
            Warning: {locationError}
          </div>
        )}
        {showMapDiagnostics && googleMapsRuntimeError && (
          <div
            className="mb-4 rounded border border-[color:var(--status-warning)]/40 bg-[color:var(--status-warning)]/10 p-2 text-xs text-[color:var(--text-primary)]"
            role="status"
          >
            <div>
              Using backup map mode while enhanced map services recover.
            </div>
          </div>
        )}
        {showMapDiagnostics &&
          (usingCachedBookableHosts || usingCachedHostStatus) && (
            <div className="text-xs mb-4 bg-amber-50 border border-amber-200 rounded p-2 text-amber-900">
              Using cached Parking Pass map data. Refresh may fix this.
            </div>
          )}
        {showMapDiagnostics && userLocation && (
          <div className="text-xs text-muted-foreground mb-4">
            Located: {userLocation.lat.toFixed(4)},{" "}
            {userLocation.lng.toFixed(4)}
            {typeof locationAccuracyM === "number" &&
              Number.isFinite(locationAccuracyM) && (
                <span> | ±{Math.round(locationAccuracyM)}m</span>
              )}
            {liveTruckPins > 0 &&
              ` | ${liveTruckPins} truck${
                liveTruckPins === 1 ? "" : "s"
              } nearby`}
            {crowdSightingPins > 0 &&
              ` | ${crowdSightingPins} community sighting${
                crowdSightingPins === 1 ? "" : "s"
              }`}
          </div>
        )}
        {showMapDiagnostics && (
          <>
            <div className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <div>
                Host parking locations:{" "}
                <span className="font-semibold text-foreground">
                  {mapHostParkingLocations}
                </span>
                {totalHostParkingLocations !== mapHostParkingLocations ? (
                  <span> | {totalHostParkingLocations} active total</span>
                ) : null}
                {lastHostIdsUpdatedLabel ? (
                  <span> | Updated {lastHostIdsUpdatedLabel}</span>
                ) : null}
                {showMapDiagnostics ? <span> | {mapProviderLabel}</span> : null}
                {showMapDiagnostics && isGoogleProviderMissingKey ? (
                  <span className="text-[color:var(--status-warning)]">
                    {" "}
                    | Set `VITE_GOOGLE_MAPS_WEB_API_KEY` to enable Google Maps
                  </span>
                ) : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                onClick={handleRefreshHostParking}
                data-testid="button-refresh-paid-parking"
              >
                Refresh
              </Button>
              {forceLegacyMap &&
                isGoogleProviderRequested &&
                !isGoogleProviderMissingKey && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:w-auto"
                    onClick={() => {
                      setGoogleMapsRuntimeError(null);
                      setForceLegacyMap(false);
                    }}
                    data-testid="button-retry-google-map"
                  >
                    Retry Google Map
                  </Button>
                )}
            </div>
          </>
        )}
      </header>

      {/* Map Container */}
      <div className="relative flex-1">
        <div className="relative h-[60vh] min-h-[320px]">
          {shouldHoldMapProviderSelection && (
            <div className="absolute inset-0 z-[1200] flex items-center justify-center bg-[hsl(var(--background))/0.7] backdrop-blur-sm">
              <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)] px-4 py-2 text-sm text-muted-foreground shadow-clean">
                Loading map services...
              </div>
            </div>
          )}
          {hasPendingAreaSearch && (
            <div className="absolute top-3 left-1/2 z-[1200] -translate-x-1/2">
              <Button
                size="sm"
                className="shadow-clean-lg"
                onClick={applyCurrentArea}
                data-testid="button-search-this-area"
              >
                Search this area
              </Button>
            </div>
          )}

          {/* Map legend (collapsible, top-left) */}
          <div className="absolute top-3 left-3 z-[1100] flex items-start gap-2">
            <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]/95 shadow-clean backdrop-blur">
              <button
                type="button"
                onClick={() => setLegendOpen((v) => !v)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[color:var(--text-primary)]"
                aria-expanded={legendOpen}
                aria-controls="map-legend-body"
                data-testid="button-toggle-map-legend"
              >
                <Info className="w-3.5 h-3.5" aria-hidden="true" />
                Legend
                {legendOpen ? (
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
              {legendOpen && (
                <ul
                  id="map-legend-body"
                  className="min-w-44 border-t border-[color:var(--border-subtle)] px-3 py-2 text-xs text-[color:var(--text-primary)] space-y-2"
                >
                  <li className="flex items-center gap-2">
                    <span
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white"
                      aria-hidden="true"
                    >
                      Y
                    </span>
                    <span>You are here</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white"
                      aria-hidden="true"
                    >
                      T
                    </span>
                    <span>Food truck</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-fuchsia-500 text-[9px] font-bold text-white"
                      aria-hidden="true"
                    >
                      E
                    </span>
                    <span>Event</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[9px] font-bold text-white"
                      aria-hidden="true"
                    >
                      D
                    </span>
                    <span>Deal</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span
                      className="inline-flex h-4 w-4 items-center justify-center overflow-hidden rounded-full bg-black"
                      aria-hidden="true"
                    >
                      <img src={mealScoutIcon} alt="" className="h-3.5 w-3.5" />
                    </span>
                    <span>Host parking</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-yellow-400 text-[9px] font-bold text-black"
                      aria-hidden="true"
                    >
                      $
                    </span>
                    <span>Sponsored</span>
                  </li>
                </ul>
              )}
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const url = window.location.href;
                  if (navigator.share) {
                    await navigator.share({
                      title: "MealScout map view",
                      url,
                    });
                  } else {
                    await navigator.clipboard.writeText(url);
                    toast({
                      title: "Link copied",
                      description: "Share this map view with anyone.",
                    });
                  }
                } catch {
                  // user cancelled or clipboard unavailable
                }
              }}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]/95 px-2.5 text-xs font-medium text-[color:var(--text-primary)] shadow-clean backdrop-blur"
              aria-label="Share this map view"
              data-testid="button-share-map-view"
            >
              <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
              Share
            </button>
            <button
              type="button"
              onClick={() => {
                if (areaFilterBounds) {
                  setAreaFilterBounds(null);
                  setDrawingActive(false);
                  return;
                }
                setDrawingActive((v) => !v);
              }}
              className={`flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium shadow-clean backdrop-blur ${
                drawingActive || areaFilterBounds
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-[color:var(--border-subtle)] bg-[var(--bg-card)]/95 text-[color:var(--text-primary)]"
              }`}
              aria-pressed={drawingActive || !!areaFilterBounds}
              aria-label={
                areaFilterBounds
                  ? "Clear drawn area"
                  : drawingActive
                  ? "Cancel area drawing"
                  : "Draw an area to filter pins"
              }
              data-testid="button-draw-area"
            >
              {areaFilterBounds
                ? "Clear area"
                : drawingActive
                ? "Drawing…"
                : "Draw area"}
            </button>
          </div>

          {/* Empty state when nothing visible in current bounds */}
          {appliedMapBounds &&
            !hasPendingAreaSearch &&
            activityPins === 0 &&
            !isLocating &&
            !isLoading && (
              <div
                className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 justify-center px-4"
                data-testid="empty-state-no-pins"
              >
                <div className="pointer-events-auto max-w-xs rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)]/95 px-4 py-3 text-center shadow-clean backdrop-blur">
                  <p className="text-sm font-medium text-foreground mb-1">
                    No trucks, events, or hosts in this area
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Zoom out or pan the map to explore another area.
                  </p>
                </div>
              </div>
            )}
          {mapCenter && isUsingGoogleMap ? (
            <MapErrorBoundary>
              <GoogleMapSurface
                key={`google-map-${googleMapRetryNonce}`}
                apiKey={effectiveGoogleMapsApiKey}
                mapId={effectiveGoogleMapsMapId || undefined}
                center={mapCenter}
                zoom={zoomLevel}
                markers={mapMarkersForRender}
                showRoadTrafficLayer={false}
                userLocation={userLocation}
                isNightTheme={isNightTheme}
                onBoundsChanged={setMapBounds}
                onZoomChanged={setZoomLevel}
                onMarkerTap={handleAdapterMarkerTap}
                onMarkerHover={(marker, position) => {
                  if (!marker || !position) {
                    setHoverPreview(null);
                    return;
                  }
                  if (marker.kind === "user") return;
                  setHoverPreview({
                    marker,
                    x: position.x,
                    y: position.y,
                  });
                }}
                popupAnchor={activeMapCalloutAnchor}
                onPopupAnchorPosition={setMapCalloutAnchorPosition}
                onFatalError={handleGoogleMapsFatalError}
                drawingActive={drawingActive}
                onAreaSelected={(b) => {
                  setAreaFilterBounds(b);
                  if (b) setDrawingActive(false);
                }}
              />
              {hoverPreview && (
                <div
                  className="pointer-events-none absolute z-[1300] hidden -translate-x-1/2 -translate-y-[calc(100%+12px)] md:block"
                  style={{ left: hoverPreview.x, top: hoverPreview.y }}
                  data-testid="marker-hover-preview"
                  role="tooltip"
                >
                  <div className="map-callout-card map-callout-card--hover max-w-[220px] px-3 py-2 text-xs">
                    <div className="truncate font-semibold text-foreground">
                      {hoverPreview.marker.title || hoverPreview.marker.kind}
                    </div>
                    {hoverPreview.marker.subtitle && (
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {hoverPreview.marker.subtitle}
                      </div>
                    )}
                  </div>
                  <div className="map-callout-tail map-callout-tail--hover" />
                </div>
              )}
            </MapErrorBoundary>
          ) : (
            <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-[hsl(var(--background))/0.75] backdrop-blur-sm">
              <div className="rounded-lg border border-[color:var(--status-warning)]/30 bg-[var(--bg-card)] px-4 py-3 text-sm text-[color:var(--text-muted)] shadow-clean max-w-xs text-center">
                Google Maps key is not ready yet. Map will appear automatically
                once available.
              </div>
            </div>
          )}

          {/* Paid parking state overlay */}
          {!isBookableHostIdsLoading && totalHostParkingLocations === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <div className="pointer-events-auto bg-[var(--bg-card)] rounded-xl px-4 py-3 text-center shadow-clean max-w-xs border border-[color:var(--border-subtle)]">
                <p className="text-sm font-medium text-foreground mb-1">
                  No host parking locations available yet
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  Add a host address to show parking availability on the map.
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    window.location.href = "/parking-pass?tab=host";
                  }}
                >
                  Add host location
                </Button>
              </div>
            </div>
          )}

        </div>

        {/* Selected Deal Info Card */}
        {selectedDeal && hasMapCalloutAnchor && (
          <div
            className={`${mapCalloutShellClassName} w-[min(272px,calc(100%-1rem))]`}
            style={mapCalloutShellStyle}
          >
          <Card className="map-callout-card w-full">
            <CardContent className="p-3">
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <div className="flex-1">
                  <h3 className="line-clamp-1 text-sm font-semibold text-foreground">
                    {selectedDeal.title}
                  </h3>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <p className="line-clamp-1 text-[11px] text-muted-foreground">
                      {selectedDeal.restaurant?.name}
                    </p>
                    {businessPopularityByRestaurant[
                      String(selectedDeal.restaurantId || "")
                    ] && (
                      <span
                        className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold text-white"
                        style={{
                          backgroundColor:
                            businessPopularityByRestaurant[
                              String(selectedDeal.restaurantId || "")
                            ].color,
                        }}
                      >
                        {
                          businessPopularityByRestaurant[
                            String(selectedDeal.restaurantId || "")
                          ].label
                        }
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedDeal(null)}
                  className="h-8 w-8"
                  data-testid="button-close-selected-deal"
                  aria-label="Close selected deal"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>

              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-bold text-primary">
                    {selectedDeal.discountValue
                      ? selectedDeal.dealType === "fixed"
                        ? `$${selectedDeal.discountValue} OFF`
                        : `${selectedDeal.discountValue}% OFF`
                      : "Limited Time"}
                </span>
                  {selectedDeal.discountValue && (
                    <span className="text-[11px] text-muted-foreground">
                      Min: ${selectedDeal.minOrderAmount}
                    </span>
                  )}
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  size="sm"
                  className="h-8"
                  data-testid="button-view-deal"
                  onClick={() => {
                    trackUxEvent("map_deal_view_click", {
                      dealId: selectedDeal.id,
                      restaurantId: selectedDeal.restaurantId || null,
                    });
                    window.location.href = `/deal/${selectedDeal.id}`;
                  }}
                >
                  Open
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() =>
                    window.open(
                      `https://maps.google.com/?q=${selectedDeal.restaurant?.latitude},${selectedDeal.restaurant?.longitude}`,
                      "_blank",
                    )
                  }
                >
                  Route
                </Button>
              </div>
            </CardContent>
          </Card>
          <div className="map-callout-tail" />
          </div>
        )}

        {!selectedDeal && selectedSighting && hasMapCalloutAnchor && (
          <div
            className={`${mapCalloutShellClassName} w-[min(272px,calc(100%-1rem))]`}
            style={mapCalloutShellStyle}
          >
          <Card className="map-callout-card w-full">
            <CardContent className="p-3">
              <div className="mb-1.5 flex items-start justify-between gap-2">
                <div>
                  <h3 className="line-clamp-1 text-sm font-semibold text-foreground">
                    {selectedSighting.truckName}
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Community sighting (temporary map pin)
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedSighting(null)}
                  className="h-8 w-8"
                  data-testid="button-close-selected-sighting"
                  aria-label="Close selected sighting"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
              {selectedSighting.notes && (
                <p className="mb-2 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
                  {selectedSighting.notes}
                </p>
              )}
              {selectedSighting.photoUrl && (
                <img
                  src={selectedSighting.photoUrl}
                  alt={`${selectedSighting.truckName} sighting`}
                  className="mb-2 h-16 w-full rounded-md border border-border/60 object-cover"
                  loading="lazy"
                />
              )}
              <div className="mb-2 text-[11px] text-muted-foreground">
                Reports: {selectedSighting.reportCount} · Expires from map at{" "}
                {new Date(selectedSighting.expiresAt).toLocaleTimeString()}
              </div>
              {userLocation && (
                <div
                  className="mb-2 text-[11px] text-muted-foreground"
                  data-testid="sighting-distance-eta"
                >
                  {isLoadingSelectedSightingRouteSummary
                    ? "Estimating drive time..."
                    : [
                        selectedSightingDistanceLabel,
                        selectedSightingEtaLabel,
                      ]
                        .filter(Boolean)
                        .join(" • ") || "Drive ETA unavailable"}
                </div>
              )}
              <Button
                size="sm"
                className="h-8 w-full"
                onClick={() =>
                  window.open(
                    `https://maps.google.com/?q=${selectedSighting.latitude},${selectedSighting.longitude}`,
                    "_blank",
                  )
                }
              >
                Route
              </Button>
            </CardContent>
          </Card>
          <div className="map-callout-tail" />
          </div>
        )}

        {!selectedDeal && selectedParkingHost && hasMapCalloutAnchor && (
          <div
            className={`${mapCalloutShellClassName} w-[min(280px,calc(100%-1rem))]`}
            style={mapCalloutShellStyle}
          >
          <Card className="map-callout-card w-full overflow-hidden rounded-xl">
            {selectedParkingHostImageUrl && (
              <img
                src={selectedParkingHostImageUrl}
                alt={`${selectedParkingHost.host.name} parking location`}
                className="h-24 w-full border-b border-[color:var(--border-subtle)] object-cover"
                loading="lazy"
              />
            )}
            <CardContent className="p-3">
              <div className="mb-2 flex items-start gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-0.5 h-7 w-7 shrink-0 rounded-full border border-[color:var(--border-subtle)] bg-background/95"
                  onClick={closeParkingPreview}
                  data-testid="button-close-selected-parking-preview"
                  aria-label="Close parking preview"
                >
                  <X className="h-4 w-4" />
                </Button>
                <div className="min-w-0 pt-0.5">
                  <h3 className="truncate text-sm font-semibold text-foreground">
                    {selectedParkingHost.host.name}
                  </h3>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {selectedParkingHost.host.address}
                  </p>
                </div>
              </div>
              <div className="mb-1.5 inline-flex w-fit items-center rounded-full border border-[color:var(--border-subtle)] px-2 py-0.5 text-[10px] font-semibold tracking-wide">
                {selectedParkingHost.availabilityLabel}
              </div>
              {selectedParkingHost.distanceLabel && (
                <p className="mb-1 text-[11px] text-muted-foreground">
                  {selectedParkingHost.distanceLabel} away
                </p>
              )}
              {userLocation && (
                <p className="mb-2 text-[11px] text-muted-foreground">
                  {isLoadingSelectedParkingRouteSummary
                    ? "Estimating drive time..."
                    : [
                        selectedParkingRoadDistanceLabel,
                        selectedParkingEtaLabel,
                      ]
                        .filter(Boolean)
                        .join(" • ") || "Drive ETA unavailable"}
                </p>
              )}
              {selectedParkingHost.nearbyTruck && (
                <div className="mb-2 rounded-md border border-[color:var(--border-subtle)] px-2 py-1.5 text-[11px] text-muted-foreground">
                  Live truck: <span className="font-medium text-foreground">{selectedParkingHost.nearbyTruck.name}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-full"
                  onClick={() =>
                    window.open(
                      `https://maps.google.com/?q=${selectedParkingHost.coords.lat},${selectedParkingHost.coords.lng}`,
                      "_blank",
                    )
                  }
                >
                  Route
                </Button>
                <Button
                  size="sm"
                  className="h-8 rounded-full"
                  onClick={() => {
                    window.location.href = selectedParkingHost.publicProfileHref;
                  }}
                >
                  Details
                </Button>
              </div>
            </CardContent>
          </Card>
          <div className="map-callout-tail" />
          </div>
        )}

        {!selectedDeal && !selectedParkingHost && selectedHostCluster && hasMapCalloutAnchor && (
          <div
            className={`${mapCalloutShellClassName} w-[min(272px,calc(100%-1rem))]`}
            style={mapCalloutShellStyle}
          >
          <Card className="map-callout-card w-full">
            <CardContent className="p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {selectedHostCluster.count} nearby parking locations
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    Tap a spot or zoom in.
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setSelectedHostCluster(null)}
                  data-testid="button-close-cluster-preview"
                  aria-label="Close cluster preview"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
              <div className="space-y-1.5">
                {selectedHostCluster.hosts.slice(0, 2).map((host) => {
                  const coords = resolveHostCoords(host);
                  if (!coords) return null;
                  return (
                    <div
                      key={`cluster-preview-${host.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-[color:var(--border-subtle)] p-1.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-foreground">
                          {host.name}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {host.address}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => {
                          window.open(
                            `https://maps.google.com/?q=${coords.lat},${coords.lng}`,
                            "_blank",
                          );
                        }}
                      >
                        Directions
                      </Button>
                    </div>
                  );
                })}
              </div>
              {selectedHostCluster.count > 4 && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  +{selectedHostCluster.count - 2} more in this area
                </p>
              )}
              <div className="mt-2">
                <Button
                  size="sm"
                  className="h-8 w-full"
                  onClick={() => {
                    trackUxEvent("map_cluster_zoom_in_clicked", {
                      clusterSize: selectedHostCluster.count,
                    });
                    setZoomLevel((prev) => Math.min(18, prev + 2));
                  }}
                  data-testid="button-cluster-zoom-in"
                >
                  Zoom in
                </Button>
              </div>
            </CardContent>
          </Card>
          <div className="map-callout-tail" />
          </div>
        )}
      </div>

      {/* List View Overlay */}
      {showList && (
        <div className="absolute inset-0 bg-[var(--bg-card)] z-40 overflow-y-auto">
          <header className="px-4 sm:px-6 py-6 bg-[var(--bg-card)] border-b border-[color:var(--border-subtle)] sticky top-0">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-foreground">
                Nearby on the map
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowList(false)}
                data-testid="button-close-list"
                aria-label="Close nearby list"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {visibleLiveTrucks.length} live trucks · {visibleHostLocations.length} hosts · {visibleEventLocations.length} events · {deals.length} deals
            </p>
          </header>

          <div className="px-4 sm:px-6 py-4 space-y-6">
            {visibleLiveTrucks.length > 0 && (
              <section data-testid="list-section-live-trucks">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Live trucks
                </h3>
                <ul className="divide-y divide-[color:var(--border-subtle)] rounded-xl border border-[color:var(--border-subtle)]">
                  {visibleLiveTrucks.slice(0, 50).map((truck) => (
                    <li key={truck.id}>
                      <button
                        type="button"
                        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40"
                        onClick={() => {
                          window.location.href = `/restaurant/${truck.id}`;
                        }}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {truck.name}
                          </div>
                          {truck.address && (
                            <div className="truncate text-xs text-muted-foreground">
                              {truck.address}
                            </div>
                          )}
                        </div>
                        <span className="shrink-0 self-center text-xs text-muted-foreground">
                          View →
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {visibleHostLocations.length > 0 && (
              <section data-testid="list-section-host-parking">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Host parking
                </h3>
                <ul className="divide-y divide-[color:var(--border-subtle)] rounded-xl border border-[color:var(--border-subtle)]">
                  {visibleHostLocations.slice(0, 50).map((host) => (
                    <li key={host.id}>
                      <button
                        type="button"
                        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40"
                        onClick={() => {
                          const coords = resolveHostCoords(host);
                          if (coords) {
                            selectParkingHost(host, coords, "pin-tap");
                          }
                          setShowList(false);
                        }}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {host.name}
                          </div>
                          {host.address && (
                            <div className="truncate text-xs text-muted-foreground">
                              {host.address}
                            </div>
                          )}
                        </div>
                        <span className="shrink-0 self-center text-xs text-muted-foreground">
                          Open →
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {visibleEventLocations.length > 0 && (
              <section data-testid="list-section-events">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Events
                </h3>
                <ul className="divide-y divide-[color:var(--border-subtle)] rounded-xl border border-[color:var(--border-subtle)]">
                  {visibleEventLocations.slice(0, 50).map((event) => (
                    <li key={event.id}>
                      <Link
                        href={`/events/${event.id}`}
                        className="flex w-full items-start justify-between gap-3 px-3 py-2 hover:bg-muted/40"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {event.name || (event as any).title || "Untitled event"}
                          </div>
                          {(event as any).address && (
                            <div className="truncate text-xs text-muted-foreground">
                              {(event as any).address}
                            </div>
                          )}
                        </div>
                        <span className="shrink-0 self-center text-xs text-muted-foreground">
                          Details →
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section data-testid="list-section-deals">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Deals
              </h3>
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="bg-[var(--bg-card)] rounded-2xl overflow-hidden animate-pulse shadow-clean"
                    >
                      <div className="w-full h-48 bg-muted"></div>
                      <div className="p-6 space-y-3">
                        <div className="h-6 bg-muted rounded-lg w-3/4"></div>
                        <div className="h-4 bg-muted rounded-lg w-1/2"></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : deals.length > 0 ? (
                <div className="space-y-4">
                  {deals.map((deal: Deal) => (
                    <div key={deal.id} onClick={() => handleDealClick(deal)}>
                      <DealCard
                        deal={deal}
                        popularity={
                          businessPopularityByRestaurant[
                            String(deal.restaurantId || "")
                          ] || null
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-[color:var(--border-subtle)] py-8 text-center">
                  <MapPin className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No deals nearby. Try expanding your search area.
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      <Dialog open={showReportTruckDialog} onOpenChange={setShowReportTruckDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Report a food truck sighting</DialogTitle>
            <DialogDescription>
              This crowd pin stays public for 1 hour, then drops off the map. The report stays saved in admin history for due diligence.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={reportTruckName}
              onChange={(e) => setReportTruckName(e.target.value)}
              placeholder="Truck name"
              maxLength={120}
            />
            <div className="space-y-2">
              <Input
                ref={truckSightingPhotoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  void handleTruckSightingPhotoChange(file);
                }}
              />
              <p className="text-[11px] text-muted-foreground">
                A photo is required to post this sighting.
              </p>
              {reportTruckPhotoDataUrl && (
                <img
                  src={reportTruckPhotoDataUrl}
                  alt="Truck sighting preview"
                  className="h-24 w-full rounded-md border border-border/60 object-cover"
                />
              )}
              {reportTruckPhotoName && (
                <p className="text-[11px] text-muted-foreground truncate">
                  {reportTruckPhotoName}
                </p>
              )}
            </div>
            <Input
              value={reportLocationLabel}
              onChange={(e) => setReportLocationLabel(e.target.value)}
              placeholder="Location label (optional)"
              maxLength={220}
            />
            <Textarea
              value={reportTruckNotes}
              onChange={(e) => setReportTruckNotes(e.target.value)}
              placeholder="Notes (color, cross street, cuisine, etc.)"
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowReportTruckDialog(false);
                setReportTruckPhotoDataUrl("");
                setReportTruckPhotoName("");
                if (truckSightingPhotoInputRef.current) {
                  truckSightingPhotoInputRef.current.value = "";
                }
              }}
              disabled={isSubmittingTruckSighting}
            >
              Cancel
            </Button>
            <Button
              disabled={
                isSubmittingTruckSighting ||
                !reportTruckName.trim() ||
                !reportTruckPhotoDataUrl ||
                !(userLocation || mapCenter)
              }
              onClick={async () => {
                try {
                  const coords = userLocation || mapCenter;
                  if (!coords) {
                    toast({
                      title: "Location required",
                      description: "Enable location services to submit a truck sighting.",
                      variant: "destructive",
                    });
                    return;
                  }

                  setIsSubmittingTruckSighting(true);
                  const res = await fetch(apiUrl("/api/public/truck-sightings"), {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    credentials: "include",
                    body: JSON.stringify({
                      truckName: reportTruckName.trim(),
                      photoUrl: reportTruckPhotoDataUrl,
                      latitude: coords.lat,
                      longitude: coords.lng,
                      notes: reportTruckNotes.trim() || undefined,
                      locationLabel: reportLocationLabel.trim() || undefined,
                      source: "map_user_ping",
                      seenAt: new Date().toISOString(),
                    }),
                  });

                  if (!res.ok) {
                    const payload = await res.json().catch(() => ({}));
                    throw new Error(payload?.message || "Failed to submit truck sighting");
                  }

                  setShowReportTruckDialog(false);
                  setReportTruckName("");
                  setReportTruckPhotoDataUrl("");
                  setReportTruckPhotoName("");
                  setReportTruckNotes("");
                  setReportLocationLabel("");
                  if (truckSightingPhotoInputRef.current) {
                    truckSightingPhotoInputRef.current.value = "";
                  }
                  setSelectedSighting(null);
                  queryClient.invalidateQueries({
                    queryKey: ["/api/trucks/community-sightings/live"],
                  });
                  toast({
                    title: "Truck sighting submitted",
                    description:
                      "Thanks. This temporary pin is live for 1 hour and saved for admin review.",
                  });
                } catch (error: any) {
                  toast({
                    title: "Unable to submit sighting",
                    description: error?.message || "Please try again in a moment.",
                    variant: "destructive",
                  });
                } finally {
                  setIsSubmittingTruckSighting(false);
                }
              }}
            >
              {isSubmittingTruckSighting ? "Submitting..." : "Submit sighting"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="px-4 sm:px-6 pb-4">
        <div className="mx-auto rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h2 className="text-base font-semibold text-foreground">
            {mapBranding.exploreHeading}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {mapBranding.exploreDescription}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {mapExploreLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                <Card className="h-full border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean transition-shadow hover:shadow-clean-lg">
                  <CardContent className="p-4">
                    <div className="font-medium text-foreground">
                      {link.title}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {link.description}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          {trendingLinks.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Trending Searches
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {trendingLinks.map((link) => (
                  <Link key={link.href} href={link.href}>
                    <Card className="h-full border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean transition-shadow hover:shadow-clean-lg">
                      <CardContent className="p-4">
                        <div className="font-medium text-foreground">
                          {link.title}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {link.description}
                        </p>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <Navigation />
    </div>
  );
}
