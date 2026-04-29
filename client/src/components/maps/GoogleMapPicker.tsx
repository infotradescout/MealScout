/**
 * GoogleMapPicker
 *
 * A reusable map component that renders Google Maps when a key is available
 * and automatically falls back to Leaflet/OpenStreetMap when no key is present.
 *
 * Supports:
 *  - Click-to-place a draggable pin
 *  - Optional circle overlay (for geo-ad radius visualisation)
 *  - Read-only multi-pin view (for parking-pass browse maps)
 *  - Controlled center + zoom
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { useQuery } from "@tanstack/react-query";
import mealScoutIcon from "@assets/meal-scout-icon.png";
import { GOOGLE_MAPS_WEB_API_KEY } from "@/lib/mapProvider";
import type { MapTrafficCell } from "./map-adapter.types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GeoPoint = { lat: number; lng: number };
export type MapPickerBounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export interface MapPickerPin {
  key: string;
  position: GeoPoint;
  /** If provided the pin is draggable and calls onPinDrag when released */
  draggable?: boolean;
  /** Popup content rendered inside a Leaflet Popup / Google InfoWindow */
  popup?: React.ReactNode;
  /** Whether this pin uses the "occupied" (dot) variant */
  occupied?: boolean;
}

export interface GoogleMapPickerProps {
  center: GeoPoint;
  zoom?: number;
  /** Called when the user clicks the map (for pin-picker mode) */
  onMapClick?: (point: GeoPoint) => void;
  /** Called when a draggable pin is released */
  onPinDrag?: (key: string, point: GeoPoint) => void;
  /** Called when a pin marker is clicked (key = MapPickerPin.key) */
  onPinClick?: (key: string) => void;
  /** Pins to render on the map */
  pins?: MapPickerPin[];
  /** If set, draws a circle around `center` with this radius in metres */
  circleRadiusMetres?: number;
  /** Extra CSS classes applied to the outer wrapper div */
  className?: string;
  /** Disable scroll/drag interactions (e.g. when a popup is open) */
  interactionsEnabled?: boolean;
  /** Google Maps Map ID — required for Advanced Markers; from VITE_GOOGLE_MAPS_MAP_ID */
  mapId?: string;
  /** Optional heat overlay cells rendered as soft circles */
  trafficCells?: MapTrafficCell[];
  /** Viewport callback for map-bounds-aware overlays */
  onBoundsChanged?: (bounds: MapPickerBounds) => void;
  /** Zoom callback used for zoom-threshold UI behaviors */
  onZoomChanged?: (zoom: number) => void;
}

// ─── Shared assets ────────────────────────────────────────────────────────────

const pinIcon = new L.Icon({
  iconUrl: mealScoutIcon,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -30],
});

const pinIconOccupied = new L.DivIcon({
  className: "pp-pin",
  html: `<div class="pp-pin__wrap"><img class="pp-pin__img" src="${mealScoutIcon}" alt="" /><span class="pp-pin__dot" aria-hidden="true"></span></div>`,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -30],
});

// ─── Leaflet helpers ──────────────────────────────────────────────────────────

function LeafletCenterer({
  center,
  zoom,
}: {
  center: GeoPoint;
  zoom?: number;
}) {
  const map = useMap();
  const lastCenterRef = useRef<GeoPoint | null>(null);
  const lastZoomRef = useRef<number | null>(null);

  useEffect(() => {
    const previous = lastCenterRef.current;
    const centerChanged =
      !previous ||
      Math.abs(previous.lat - center.lat) > 0.000001 ||
      Math.abs(previous.lng - center.lng) > 0.000001;
    if (!centerChanged) return;
    lastCenterRef.current = center;

    const currentCenter = map.getCenter();
    const shouldPan =
      Math.abs(currentCenter.lat - center.lat) > 0.000001 ||
      Math.abs(currentCenter.lng - center.lng) > 0.000001;
    if (shouldPan) {
      map.panTo([center.lat, center.lng], { animate: true });
    }
  }, [center, map]);

  useEffect(() => {
    if (typeof zoom !== "number" || !Number.isFinite(zoom)) return;
    if (lastZoomRef.current === zoom) return;
    lastZoomRef.current = zoom;

    const currentZoom = map.getZoom();
    if (currentZoom !== zoom) {
      map.setZoom(zoom, { animate: false });
    }
  }, [map, zoom]);

  return null;
}

function LeafletSizeSync() {
  const map = useMap();

  useEffect(() => {
    const sync = () => {
      map.invalidateSize(false);
    };

    const container = map.getContainer();
    const observer =
      typeof ResizeObserver === "function" && container
        ? new ResizeObserver(() => {
            sync();
          })
        : null;
    if (observer && container) {
      observer.observe(container);
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        sync();
      }
    };

    const t1 = window.setTimeout(sync, 0);
    const t2 = window.setTimeout(sync, 250);
    const t3 = window.setTimeout(sync, 700);
    window.addEventListener("resize", sync);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      observer?.disconnect();
      window.removeEventListener("resize", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [map]);

  return null;
}

function LeafletClickHandler({
  onMapClick,
}: {
  onMapClick: (p: GeoPoint) => void;
}) {
  useMapEvents({
    click: (e) => onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  return null;
}

function LeafletBoundsReporter({
  onBoundsChanged,
  onZoomChanged,
}: {
  onBoundsChanged?: (bounds: MapPickerBounds) => void;
  onZoomChanged?: (zoom: number) => void;
}) {
  useMapEvents({
    moveend: (event) => {
      if (!onBoundsChanged) return;
      const bounds = event.target.getBounds();
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      onBoundsChanged({
        north: ne.lat,
        south: sw.lat,
        east: ne.lng,
        west: sw.lng,
      });
    },
    zoomend: (event) => {
      onZoomChanged?.(event.target.getZoom());
      if (!onBoundsChanged) return;
      const bounds = event.target.getBounds();
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      onBoundsChanged({
        north: ne.lat,
        south: sw.lat,
        east: ne.lng,
        west: sw.lng,
      });
    },
  });
  return null;
}

const trafficCellColor = (source: MapTrafficCell["source"]) =>
  source === "google_places"
    ? "#60A5FA"
    : source === "supply_signal"
      ? "#EF4444"
      : "#F97316";

const trafficCellFillOpacity = (source: MapTrafficCell["source"]) =>
  source === "google_places" ? 0.14 : source === "supply_signal" ? 0.22 : 0.18;

// ─── Google Maps loader (shared singleton) ────────────────────────────────────

type GoogleMapsWindow = Window & {
  google?: any;
  __mealScoutGoogleMapsPromise?: Promise<void>;
  gm_authFailure?: () => void;
};

async function loadGoogleMaps(apiKey: string): Promise<void> {
  if (!apiKey) throw new Error("Missing Google Maps API key");
  const w = window as GoogleMapsWindow;
  if (w.google?.maps) return;
  if (w.__mealScoutGoogleMapsPromise) {
    try {
      await w.__mealScoutGoogleMapsPromise;
      if (w.google?.maps) return;
    } catch {
      w.__mealScoutGoogleMapsPromise = undefined;
    }
  }
  w.__mealScoutGoogleMapsPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-mealscout-google-maps="1"]',
    );
    if (existing) {
      if ((window as GoogleMapsWindow).google?.maps) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => {
          existing.remove();
          reject(new Error("Failed to load Google Maps script"));
        },
        { once: true },
      );
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&libraries=marker`;
    script.async = true;
    script.defer = true;
    script.dataset.mealscoutGoogleMaps = "1";
    script.onload = () => {
      if ((window as GoogleMapsWindow).google?.maps) {
        resolve();
      } else {
        script.remove();
        reject(new Error("Google Maps API unavailable after script load"));
      }
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("Failed to load Google Maps script"));
    };
    document.head.appendChild(script);
  });
  try {
    await w.__mealScoutGoogleMapsPromise;
  } catch (err) {
    w.__mealScoutGoogleMapsPromise = undefined;
    throw err;
  }
}

function removeMarkerFromMap(marker: any): void {
  if (!marker) return;
  if (typeof marker.setMap === "function") {
    marker.setMap(null);
    return;
  }
  if ("map" in marker) {
    marker.map = null;
  }
}

// ─── Google Maps renderer ─────────────────────────────────────────────────────

function GoogleMapRenderer({
  apiKey,
  mapId,
  center,
  zoom = 13,
  pins = [],
  trafficCells = [],
  circleRadiusMetres,
  onMapClick,
  onPinDrag,
  onPinClick,
  onBoundsChanged,
  onZoomChanged,
  onFatalError,
  interactionsEnabled = true,
}: {
  apiKey: string;
  mapId?: string;
  center: GeoPoint;
  zoom?: number;
  pins?: MapPickerPin[];
  trafficCells?: MapTrafficCell[];
  circleRadiusMetres?: number;
  onMapClick?: (p: GeoPoint) => void;
  onPinDrag?: (key: string, p: GeoPoint) => void;
  onPinClick?: (key: string) => void;
  onBoundsChanged?: (bounds: MapPickerBounds) => void;
  onZoomChanged?: (zoom: number) => void;
  onFatalError?: (message: string) => void;
  interactionsEnabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const circleRef = useRef<any>(null);
  const trafficCircleRefs = useRef<Map<string, any>>(new Map());
  const infoWindowRef = useRef<any>(null);
  const lastReportedZoomRef = useRef<number | null>(null);
  const lastReportedBoundsRef = useRef<MapPickerBounds | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Portal state: the DOM node injected into the InfoWindow + the ReactNode to render there
  const [infoPortalContainer, setInfoPortalContainer] =
    useState<HTMLDivElement | null>(null);
  const [infoPortalContent, setInfoPortalContent] =
    useState<React.ReactNode>(null);

  // Load SDK + initialise map
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then(async () => {
        if (cancelled || !containerRef.current) return;
        const g = (window as GoogleMapsWindow).google;
        if (!g?.maps) return;

        let MapConstructor = g.maps.Map;
        if (
          typeof MapConstructor !== "function" &&
          typeof g.maps.importLibrary === "function"
        ) {
          const mapsLibrary = await g.maps.importLibrary("maps");
          MapConstructor = mapsLibrary?.Map;
        }

        if (typeof MapConstructor !== "function") {
          throw new Error("Google Maps constructor unavailable");
        }

        const map = new MapConstructor(containerRef.current, {
          center: { lat: center.lat, lng: center.lng },
          zoom,
          disableDefaultUI: true,
          zoomControl: true,
          // Use greedy so touch users can pan with one finger instead of the
          // cooperative two-finger requirement.
          gestureHandling: interactionsEnabled ? "greedy" : "none",
          mapTypeId: "roadmap",
          ...(mapId ? { mapId } : {}),
        });
        mapRef.current = map;
        const iw = new g.maps.InfoWindow({
          maxWidth: 340,
          disableAutoPan: false,
        });
        infoWindowRef.current = iw;
        // Create a persistent DOM node that React will portal into
        const portalDiv = document.createElement("div");
        portalDiv.className = "gmp-infowindow-portal";
        iw.setContent(portalDiv);
        if (!cancelled) setInfoPortalContainer(portalDiv);

        if (onMapClick) {
          map.addListener("click", (e: any) => {
            const lat = e.latLng.lat();
            const lng = e.latLng.lng();
            onMapClick({ lat, lng });
          });
        }

        map.addListener("idle", () => {
          const nextZoom = Number(map.getZoom?.());
          if (
            onZoomChanged &&
            Number.isFinite(nextZoom) &&
            lastReportedZoomRef.current !== nextZoom
          ) {
            lastReportedZoomRef.current = nextZoom;
            onZoomChanged(nextZoom);
          }

          if (!onBoundsChanged) return;
          const bounds = map.getBounds?.();
          if (!bounds) return;
          const ne = bounds.getNorthEast();
          const sw = bounds.getSouthWest();
          const nextBounds: MapPickerBounds = {
            north: Number(ne.lat()),
            south: Number(sw.lat()),
            east: Number(ne.lng()),
            west: Number(sw.lng()),
          };
          const prev = lastReportedBoundsRef.current;
          const epsilon = 0.0005;
          const changed =
            !prev ||
            Math.abs(prev.north - nextBounds.north) >= epsilon ||
            Math.abs(prev.south - nextBounds.south) >= epsilon ||
            Math.abs(prev.east - nextBounds.east) >= epsilon ||
            Math.abs(prev.west - nextBounds.west) >= epsilon;
          if (changed) {
            lastReportedBoundsRef.current = nextBounds;
            onBoundsChanged(nextBounds);
          }
        });
      })
      .catch((err) => {
        if (!cancelled) {
          const message = String(err?.message || "Map failed to load");
          setLoadError(message);
          onFatalError?.(message);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  // Re-center only when center changes.
  useEffect(() => {
    if (!mapRef.current) return;
    const g = (window as GoogleMapsWindow).google;
    if (!g?.maps) return;
    const currentCenter = mapRef.current.getCenter?.();
    const currentLat =
      currentCenter && typeof currentCenter.lat === "function"
        ? Number(currentCenter.lat())
        : NaN;
    const currentLng =
      currentCenter && typeof currentCenter.lng === "function"
        ? Number(currentCenter.lng())
        : NaN;
    const epsilon = 0.000001;
    const shouldPan =
      !Number.isFinite(currentLat) ||
      !Number.isFinite(currentLng) ||
      Math.abs(currentLat - center.lat) > epsilon ||
      Math.abs(currentLng - center.lng) > epsilon;
    if (shouldPan) {
      mapRef.current.panTo({ lat: center.lat, lng: center.lng });
    }
  }, [center.lat, center.lng]);

  // Keep zoom in sync without forcing a center snap.
  useEffect(() => {
    if (!mapRef.current) return;
    const g = (window as GoogleMapsWindow).google;
    if (!g?.maps) return;
    const targetZoom = zoom ?? 13;
    const currentZoom = Number(mapRef.current.getZoom?.());
    if (!Number.isFinite(currentZoom) || currentZoom !== targetZoom) {
      mapRef.current.setZoom(targetZoom);
    }
  }, [zoom]);

  // Keep Google map tiles in sync with container size changes.
  useEffect(() => {
    const g = (window as GoogleMapsWindow).google;
    if (!g?.maps || !mapRef.current || !containerRef.current) return;

    const sync = () => {
      if (!mapRef.current) return;
      g.maps.event.trigger(mapRef.current, "resize");
      mapRef.current.setCenter({ lat: center.lat, lng: center.lng });
    };

    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => {
            sync();
          })
        : null;
    if (observer) {
      observer.observe(containerRef.current);
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        sync();
      }
    };

    const t1 = window.setTimeout(sync, 0);
    const t2 = window.setTimeout(sync, 250);
    const t3 = window.setTimeout(sync, 700);
    window.addEventListener("resize", sync);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      observer?.disconnect();
      window.removeEventListener("resize", sync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [center.lat, center.lng]);

  // Sync pins
  useEffect(() => {
    const g = (window as GoogleMapsWindow).google;
    if (!g?.maps || !mapRef.current) return;
    const map = mapRef.current;
    const infoWindow = infoWindowRef.current;
    const existing = markersRef.current;

    const setMarkerPosition = (marker: any, next: GeoPoint) => {
      if (!marker) return;
      if (typeof marker.setPosition === "function") {
        marker.setPosition(next);
        return;
      }
      marker.position = next;
    };

    const positionToGeoPoint = (pos: any): GeoPoint | null => {
      if (!pos) return null;
      const lat = typeof pos.lat === "function" ? pos.lat() : pos.lat;
      const lng = typeof pos.lng === "function" ? pos.lng() : pos.lng;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat: Number(lat), lng: Number(lng) };
    };

    // Remove stale markers
    const incomingKeys = new Set(pins.map((p) => p.key));
    for (const [key, marker] of existing) {
      if (!incomingKeys.has(key)) {
        removeMarkerFromMap(marker);
        existing.delete(key);
      }
    }

    // Add / update markers
    for (const pin of pins) {
      if (existing.has(pin.key)) {
        setMarkerPosition(existing.get(pin.key), {
          lat: pin.position.lat,
          lng: pin.position.lng,
        });
      } else {
        const AdvancedMarkerElement = g.maps.marker?.AdvancedMarkerElement;
        const useAdvanced = Boolean(AdvancedMarkerElement && mapId);
        let marker: any;
        if (useAdvanced) {
          const img = document.createElement("img");
          img.src = mealScoutIcon;
          img.style.width = "36px";
          img.style.height = "36px";
          img.style.display = "block";
          marker = new AdvancedMarkerElement({
            position: { lat: pin.position.lat, lng: pin.position.lng },
            map,
            content: img,
            gmpDraggable: pin.draggable ?? false,
          });
        } else {
          marker = new g.maps.Marker({
            position: { lat: pin.position.lat, lng: pin.position.lng },
            map,
            draggable: pin.draggable ?? false,
            icon: {
              url: mealScoutIcon,
              scaledSize: new g.maps.Size(36, 36),
              anchor: new g.maps.Point(18, 36),
            },
          });
        }
        const handlePinClick = () => {
          if (onPinClick) onPinClick(pin.key);
          if (infoWindow) {
            // Render the React popup node into the persistent portal container,
            // then open the InfoWindow anchored to this marker.
            setInfoPortalContent(
              pin.popup ? (
                <div className="gmp-popup-card">{pin.popup}</div>
              ) : null,
            );
            infoWindow.open(map, marker);
          }
        };
        if (typeof marker.addEventListener === "function") {
          marker.addEventListener("gmp-click", handlePinClick);
        } else if (typeof marker.addListener === "function") {
          marker.addListener("click", handlePinClick);
        }
        if (pin.draggable && onPinDrag) {
          if (useAdvanced) {
            // AdvancedMarkerElement uses 'gmp-dragend' and exposes position directly
            const handleAdvancedDragEnd = () => {
              const next = positionToGeoPoint(marker.position);
              if (next) onPinDrag(pin.key, next);
            };
            if (typeof marker.addEventListener === "function") {
              marker.addEventListener("gmp-dragend", handleAdvancedDragEnd);
            } else if (typeof marker.addListener === "function") {
              marker.addListener("gmp-dragend", handleAdvancedDragEnd);
            }
          } else {
            marker.addListener("dragend", (e: any) => {
              onPinDrag(pin.key, { lat: e.latLng.lat(), lng: e.latLng.lng() });
            });
          }
        }
        existing.set(pin.key, marker);
      }
    }
  }, [pins, onPinDrag, onPinClick, mapId]);

  useEffect(() => {
    const g = (window as GoogleMapsWindow).google;
    if (!g?.maps || !mapRef.current) return;

    const usedIds = new Set<string>();
    trafficCells.forEach((cell) => {
      usedIds.add(cell.id);
      const existing = trafficCircleRefs.current.get(cell.id);
      const radius = Math.max(140, Math.min(1800, (cell.weight || 1) * 15));
      const style = {
        strokeOpacity: 0,
        strokeWeight: 0,
        fillColor: trafficCellColor(cell.source),
        fillOpacity: trafficCellFillOpacity(cell.source),
      };
      if (existing) {
        existing.setCenter({ lat: cell.lat, lng: cell.lng });
        existing.setRadius(radius);
        existing.setOptions(style);
        return;
      }
      const circle = new g.maps.Circle({
        map: mapRef.current,
        center: { lat: cell.lat, lng: cell.lng },
        radius,
        ...style,
      });
      trafficCircleRefs.current.set(cell.id, circle);
    });

    Array.from(trafficCircleRefs.current.entries()).forEach(
      ([id, instance]) => {
        if (usedIds.has(id)) return;
        instance.setMap(null);
        trafficCircleRefs.current.delete(id);
      },
    );
  }, [trafficCells]);

  // Circle overlay
  useEffect(() => {
    const g = (window as GoogleMapsWindow).google;
    if (!g?.maps || !mapRef.current) return;
    if (circleRef.current) {
      circleRef.current.setMap(null);
      circleRef.current = null;
    }
    if (circleRadiusMetres && circleRadiusMetres > 0) {
      circleRef.current = new g.maps.Circle({
        map: mapRef.current,
        center: { lat: center.lat, lng: center.lng },
        radius: circleRadiusMetres,
        strokeColor: "#f97316",
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: "#f97316",
        fillOpacity: 0.15,
      });
    }
  }, [center.lat, center.lng, circleRadiusMetres]);

  if (loadError) return null; // caller falls back to Leaflet

  return (
    <>
      <div ref={containerRef} className="h-full w-full" />
      {/* Portal: renders the React popup node into the Google Maps InfoWindow DOM node */}
      {infoPortalContainer && infoPortalContent
        ? createPortal(infoPortalContent, infoPortalContainer)
        : null}
    </>
  );
}

// ─── Leaflet fallback renderer ────────────────────────────────────────────────

function LeafletRenderer({
  center,
  zoom = 13,
  pins = [],
  trafficCells = [],
  circleRadiusMetres,
  onMapClick,
  onPinDrag,
  onPinClick,
  onBoundsChanged,
  onZoomChanged,
  interactionsEnabled = true,
}: {
  center: GeoPoint;
  zoom?: number;
  pins?: MapPickerPin[];
  trafficCells?: MapTrafficCell[];
  circleRadiusMetres?: number;
  onMapClick?: (p: GeoPoint) => void;
  onPinDrag?: (key: string, p: GeoPoint) => void;
  onPinClick?: (key: string) => void;
  onBoundsChanged?: (bounds: MapPickerBounds) => void;
  onZoomChanged?: (zoom: number) => void;
  interactionsEnabled?: boolean;
}) {
  const isNightTheme =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("theme-night");
  const tileUrl = isNightTheme
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  const attribution =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

  return (
    <MapContainer
      center={[center.lat, center.lng]}
      zoom={zoom}
      zoomControl={false}
      zoomAnimation={true}
      markerZoomAnimation={true}
      scrollWheelZoom={interactionsEnabled}
      dragging={interactionsEnabled}
      touchZoom={interactionsEnabled}
      doubleClickZoom={interactionsEnabled}
      boxZoom={interactionsEnabled}
      keyboard={interactionsEnabled}
      className="h-full w-full"
    >
      <LeafletSizeSync />
      <TileLayer attribution={attribution} url={tileUrl} />
      <LeafletCenterer center={center} zoom={zoom} />
      {onMapClick && <LeafletClickHandler onMapClick={onMapClick} />}
      {onBoundsChanged && (
        <LeafletBoundsReporter
          onBoundsChanged={onBoundsChanged}
          onZoomChanged={onZoomChanged}
        />
      )}
      {trafficCells.map((cell) => {
        const radius = Math.max(140, Math.min(1800, (cell.weight || 1) * 15));
        const fillColor = trafficCellColor(cell.source);
        const fillOpacity = trafficCellFillOpacity(cell.source);
        return (
          <Circle
            key={`traffic-${cell.id}`}
            center={[cell.lat, cell.lng]}
            radius={radius}
            pathOptions={{
              color: fillColor,
              fillColor,
              fillOpacity,
              opacity: 0,
              weight: 0,
            }}
          />
        );
      })}
      {pins.map((pin) => (
        <Marker
          key={pin.key}
          position={[pin.position.lat, pin.position.lng]}
          icon={pin.occupied ? pinIconOccupied : pinIcon}
          draggable={pin.draggable ?? false}
          eventHandlers={{
            click: () => {
              if (onPinClick) onPinClick(pin.key);
            },
            ...(pin.draggable && onPinDrag
              ? {
                  dragend: (e: any) => {
                    const m = e.target as L.Marker;
                    const ll = m.getLatLng();
                    onPinDrag(pin.key, { lat: ll.lat, lng: ll.lng });
                  },
                }
              : {}),
          }}
        >
          {pin.popup && (
            <Popup
              maxWidth={320}
              minWidth={240}
              keepInView
              autoPan
              autoPanPadding={[16, 16]}
            >
              {pin.popup}
            </Popup>
          )}
        </Marker>
      ))}
      {circleRadiusMetres && circleRadiusMetres > 0 && (
        <Circle
          center={[center.lat, center.lng]}
          radius={circleRadiusMetres}
          pathOptions={{
            color: "#f97316",
            fillColor: "#f97316",
            fillOpacity: 0.15,
          }}
        />
      )}
    </MapContainer>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

type MapRuntimeResponse = {
  hasGoogleMapsKey: boolean;
  googleMapsApiKey?: string | null;
};

export function GoogleMapPicker({
  center,
  zoom = 13,
  onMapClick,
  onPinDrag,
  onPinClick,
  pins = [],
  trafficCells = [],
  circleRadiusMetres,
  className = "",
  interactionsEnabled = true,
  mapId: mapIdProp,
  onBoundsChanged,
  onZoomChanged,
}: GoogleMapPickerProps) {
  const { data: mapRuntime } = useQuery<MapRuntimeResponse>({
    queryKey: ["/api/map/runtime"],
    queryFn: async () => {
      const res = await fetch("/api/map/runtime");
      if (!res.ok) return { hasGoogleMapsKey: false, googleMapsApiKey: null };
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Build-time key takes priority; runtime key is a fallback for server-injected keys
  const buildTimeKey = GOOGLE_MAPS_WEB_API_KEY;
  const runtimeKey = String(mapRuntime?.googleMapsApiKey || "").trim();
  const apiKey = buildTimeKey || runtimeKey;

  // Map ID: caller-provided prop takes priority, then build-time env var
  const envMapId = String(
    (import.meta as any).env?.VITE_GOOGLE_MAPS_MAP_ID || "",
  ).trim();
  const mapId = mapIdProp || envMapId || undefined;

  const [googleFailureMessage, setGoogleFailureMessage] = useState<
    string | null
  >(null);
  const useGoogle = apiKey.length > 0;
  const shouldUseGoogleRenderer = useGoogle && !googleFailureMessage;

  useEffect(() => {
    // Clear transient failures when runtime/build keys update.
    setGoogleFailureMessage(null);
  }, [apiKey, mapId]);

  return (
    <div className={`relative h-full w-full ${className}`}>
      {shouldUseGoogleRenderer ? (
        <GoogleMapRenderer
          apiKey={apiKey}
          mapId={mapId}
          center={center}
          zoom={zoom}
          pins={pins}
          trafficCells={trafficCells}
          circleRadiusMetres={circleRadiusMetres}
          onMapClick={onMapClick}
          onPinDrag={onPinDrag}
          onPinClick={onPinClick}
          onBoundsChanged={onBoundsChanged}
          onZoomChanged={onZoomChanged}
          onFatalError={(message) =>
            setGoogleFailureMessage(
              message || "Google Maps failed to load in this environment.",
            )
          }
          interactionsEnabled={interactionsEnabled}
        />
      ) : (
        <LeafletRenderer
          center={center}
          zoom={zoom}
          pins={pins}
          trafficCells={trafficCells}
          circleRadiusMetres={circleRadiusMetres}
          onMapClick={onMapClick}
          onPinDrag={onPinDrag}
          onPinClick={onPinClick}
          onBoundsChanged={onBoundsChanged}
          onZoomChanged={onZoomChanged}
          interactionsEnabled={interactionsEnabled}
        />
      )}
      {googleFailureMessage && (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 rounded-md border border-amber-200 bg-amber-50/95 px-3 py-2 text-xs text-amber-900 shadow-clean">
          {googleFailureMessage}
        </div>
      )}
    </div>
  );
}
