import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

export type EffectiveLocationContext = {
  marketKey: string;
  source:
    | "admin_override"
    | "session_device"
    | "session_saved"
    | "user_default"
    | "super_admin_default"
    | "platform_default";
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  updatedAt: string | null;
};

type LocationContextResponse = {
  effectiveLocationContext: EffectiveLocationContext;
  adminMarketSelection?: EffectiveLocationContext | null;
  deviceLocationContext?: EffectiveLocationContext | null;
};

export function useEffectiveLocationContext() {
  const query = useQuery<LocationContextResponse | null>({
    queryKey: ["/api/location/context"],
    queryFn: getQueryFn({ on401: "returnNull", timeoutMs: 6000 }),
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
  });

  return {
    ...query,
    effectiveLocationContext: query.data?.effectiveLocationContext ?? null,
    adminMarketSelection: query.data?.adminMarketSelection ?? null,
    deviceLocationContext: query.data?.deviceLocationContext ?? null,
  };
}

