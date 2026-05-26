export type OwnerValueAttributionWindow = "7d" | "30d";

export interface OwnerValueAttributionSource {
  source: string;
  count: number;
}

export interface OwnerValueAttributionEntity {
  ownerId: string;
  entityId: string;
  entityType: string;
  profileViews: number;
  discoveryImpressions: number;
  ctaClicks: number;
  shareOpens: number;
  highIntentActions: number;
  topSources: OwnerValueAttributionSource[];
  lastActivityAt: string | null;
}

export interface OwnerValueAttributionResponse {
  window: OwnerValueAttributionWindow;
  generatedAt: string;
  ownerId: string;
  entities: OwnerValueAttributionEntity[];
}

export async function fetchOwnerValueAttribution(
  window: OwnerValueAttributionWindow,
): Promise<OwnerValueAttributionResponse> {
  const response = await fetch(`/api/owner/value-attribution?window=${window}`);
  if (!response.ok) {
    throw new Error("Owner analytics could not be loaded right now.");
  }
  return response.json();
}
