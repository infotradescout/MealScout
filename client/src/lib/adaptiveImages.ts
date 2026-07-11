export const adaptiveImagePlacementIds = [
  "business_profile_hero",
  "vendor_card",
  "menu_item_card",
  "welcome_card_1200x630",
  "social_share_1200x630",
  "mobile_banner",
  "square_thumbnail",
] as const;

export type AdaptiveImagePlacementId = (typeof adaptiveImagePlacementIds)[number];

export type AdaptiveImageFocalPoint = {
  x: number;
  y: number;
};

export type AdaptiveImagePlacement = {
  placementId: AdaptiveImagePlacementId;
  url: string;
  width?: number;
  height?: number;
  objectPosition?: string;
};

export type AdaptiveImageSource = {
  originalUrl: string;
  focalPoint?: AdaptiveImageFocalPoint;
  placements?: Partial<Record<AdaptiveImagePlacementId, AdaptiveImagePlacement>>;
};

export type AdaptiveImageRequest = AdaptiveImageSource | string | null | undefined;

export type AdaptiveImageResult = {
  url: string;
  placementId: AdaptiveImagePlacementId;
  objectPosition: string;
  width?: number;
  height?: number;
  usedFallback: boolean;
};

function clampUnit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function objectPositionFromFocalPoint(focalPoint?: AdaptiveImageFocalPoint): string {
  const x = Math.round(clampUnit(focalPoint?.x) * 100);
  const y = Math.round(clampUnit(focalPoint?.y) * 100);
  return `${x}% ${y}%`;
}

function createAdaptiveImageFromUrl(url: string): AdaptiveImageSource {
  return {
    originalUrl: url,
    focalPoint: { x: 0.5, y: 0.5 },
    placements: {},
  };
}

export function createAdaptiveImageMetadata(
  originalUrl: string | null | undefined,
  focalPoint: AdaptiveImageFocalPoint = { x: 0.5, y: 0.5 },
): AdaptiveImageSource | null {
  const trimmed = typeof originalUrl === "string" ? originalUrl.trim() : "";
  if (!trimmed) return null;

  return {
    originalUrl: trimmed,
    focalPoint: {
      x: clampUnit(focalPoint.x),
      y: clampUnit(focalPoint.y),
    },
    placements: {},
  };
}

// This helper lets a component ask for the best image for a placement while falling back to the original image.
export function getAdaptiveImageForPlacement(
  image: AdaptiveImageRequest,
  placementId: AdaptiveImagePlacementId,
  fallbackUrl = "",
): AdaptiveImageResult {
  const source =
    typeof image === "string"
      ? createAdaptiveImageFromUrl(image)
      : image ?? createAdaptiveImageMetadata(fallbackUrl);
  const placement = source?.placements?.[placementId];
  const placementUrl = placement?.url;
  const originalUrl = source?.originalUrl;
  const url = placementUrl || originalUrl || fallbackUrl;

  return {
    url,
    placementId,
    objectPosition:
      placement?.objectPosition || objectPositionFromFocalPoint(source?.focalPoint),
    width: placement?.width,
    height: placement?.height,
    usedFallback: !placementUrl,
  };
}
