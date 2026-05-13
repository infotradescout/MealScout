import { useQuery } from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";

export type DiscoverableTruck = {
  id: string;
  name: string;
  lat?: number | string | null;
  lng?: number | string | null;
  currentLatitude?: number | string | null;
  currentLongitude?: number | string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  cuisineType?: string | null;
  businessType?: string | null;
  status?: string | null;
  isOpenNow?: boolean | null;
  lastBroadcastAt?: string | null;
  liveBroadcasting?: boolean | null;
  locationSource?: string | null;
  [key: string]: unknown;
};

type LatLng = { lat: number; lng: number } | null | undefined;

type DiscoverableTrucksResponse = {
  trucks: DiscoverableTruck[];
};

type UseDiscoverableTrucksOptions = {
  radiusKm?: number;
  limit?: number;
  enabled?: boolean;
  staleTime?: number;
  refetchInterval?: number | false;
  refetchIntervalInBackground?: boolean;
  refetchOnWindowFocus?: boolean;
};

export function useDiscoverableTrucks(
  location: LatLng,
  options: UseDiscoverableTrucksOptions = {},
) {
  const {
    radiusKm = 12,
    limit = 500,
    enabled = true,
    staleTime = 15_000,
    refetchInterval = 15_000,
    refetchIntervalInBackground = false,
    refetchOnWindowFocus = true,
  } = options;

  return useQuery<DiscoverableTrucksResponse>({
    queryKey: location
      ? ["/api/trucks/live", "discoverable", location.lat, location.lng, radiusKm, limit]
      : ["/api/trucks/live", "discoverable", "no-location", radiusKm, limit],
    enabled: Boolean(location && enabled),
    queryFn: async () => {
      if (!location) return { trucks: [] };
      const query = new URLSearchParams({
        lat: String(location.lat),
        lng: String(location.lng),
        radiusKm: String(radiusKm),
        limit: String(limit),
      });
      const response = await fetch(apiUrl(`/api/trucks/live?${query.toString()}`), {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to load discoverable trucks");
      }
      const payload = await response.json();
      if (Array.isArray(payload)) return { trucks: payload as DiscoverableTruck[] };
      if (Array.isArray(payload?.trucks)) {
        return { trucks: payload.trucks as DiscoverableTruck[] };
      }
      return { trucks: [] };
    },
    staleTime,
    refetchInterval,
    refetchIntervalInBackground,
    refetchOnWindowFocus,
  });
}
