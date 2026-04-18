import type { MapProvider } from "@/components/maps/map-adapter.types";

export const GOOGLE_MAPS_WEB_API_KEY = String(
  import.meta.env.VITE_GOOGLE_MAPS_WEB_API_KEY || "",
).trim();

const rawProvider = String(import.meta.env.VITE_MAP_PROVIDER || "auto")
  .trim()
  .toLowerCase();

export const MAP_PROVIDER: MapProvider =
  rawProvider === "legacy-force"
    ? "legacy"
    : GOOGLE_MAPS_WEB_API_KEY.length > 0
      ? "google"
      : "legacy";

export const isGoogleMapsEnabled = MAP_PROVIDER === "google";
