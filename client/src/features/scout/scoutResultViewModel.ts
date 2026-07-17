import type {
  ScoutDiscoveryResult,
  ScoutDiscoveryResultKind,
} from "@shared/scoutDiscoveryResult";
import {
  resolveBusinessMedia,
  type BusinessMediaAsset,
  type BusinessMediaPlacement,
} from "@/lib/businessMedia";

export type ScoutResultCardVariant =
  "truck" | "place" | "dish" | "deal" | "event" | "host";

export type ScoutResultViewModel = {
  key: string;
  title: string;
  subtitle: string | null;
  href: string;
  primaryActionLabel: string;
  imageUrl: string | null;
  imageObjectPosition: string;
  locationLabel: string | null;
  scopeLabel: string | null;
  variant: ScoutResultCardVariant;
};

export type ScoutResultViewModelOptions = {
  href?: string | null;
  subtitle?: string | null;
  primaryActionLabel?: string;
  placement?: BusinessMediaPlacement;
  variant?: ScoutResultCardVariant;
  fallbackImageUrl?: string;
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readString(
  source: Record<string, unknown>,
  fields: string[],
): string | null {
  for (const field of fields) {
    const value = source[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function defaultVariant(result: ScoutDiscoveryResult): ScoutResultCardVariant {
  if (result.kind === "food_truck") return "truck";
  if (result.kind === "dish") return "dish";
  if (result.kind === "deal") return "deal";
  if (result.kind === "event") return "event";
  return "place";
}

function defaultActionLabel(kind: ScoutDiscoveryResultKind): string {
  if (kind === "food_truck") return "View truck";
  if (kind === "dish") return "View dish";
  if (kind === "deal") return "View deal";
  if (kind === "event") return "View event";
  return "View profile";
}

function defaultPlacement(
  kind: ScoutDiscoveryResultKind,
): BusinessMediaPlacement {
  if (kind === "dish") return "menu_item_card";
  if (kind === "deal") return "deal_card";
  return "scout_card";
}

function locationLabelFor(result: ScoutDiscoveryResult): string | null {
  if (result.location.distanceMiles !== null) {
    const distance = result.location.distanceMiles;
    return `${distance < 10 ? distance.toFixed(1) : Math.round(distance)} mi away`;
  }
  return result.location.label;
}

function mediaAssetsFor(result: ScoutDiscoveryResult): BusinessMediaAsset[] {
  const raw = recordOf(result.raw);
  const assets: BusinessMediaAsset[] = [];
  const add = (kind: BusinessMediaAsset["kind"], fields: string[]) => {
    const image = readString(raw, fields);
    if (!image || assets.some((asset) => asset.image === image)) return;
    assets.push({ kind, image, publicApproved: true });
  };

  if (result.kind === "dish") {
    add("menu_item", ["imageUrl", "photoUrl"]);
  } else if (result.kind === "deal" || result.kind === "event") {
    add("hero", ["heroImageUrl", "imageUrl", "photoUrl"]);
  }
  add("cover", ["coverImageUrl", "restaurantCoverImageUrl"]);
  add("hero", ["heroImageUrl"]);
  add("gallery", ["galleryImageUrl", "spotImageUrl"]);
  add("logo", ["logoUrl", "restaurantLogoUrl"]);
  add("legacy", ["imageUrl", "truckPhotoLogo"]);

  if (
    result.imageUrl &&
    !assets.some((asset) => asset.image === result.imageUrl)
  ) {
    assets.push({
      kind: result.kind === "dish" ? "menu_item" : "legacy",
      image: result.imageUrl,
      publicApproved: true,
    });
  }
  return assets;
}

export function buildScoutResultViewModel(
  result: ScoutDiscoveryResult,
  options: ScoutResultViewModelOptions = {},
): ScoutResultViewModel {
  const media = resolveBusinessMedia(
    mediaAssetsFor(result),
    options.placement || defaultPlacement(result.kind),
    { fallbackUrl: options.fallbackImageUrl },
  );
  const isNetworkResult = result.location.scope === "network";

  return {
    key: result.key,
    title: result.title,
    subtitle: options.subtitle ?? result.subtitle ?? result.description,
    href: options.href || result.href || "/search",
    primaryActionLabel:
      options.primaryActionLabel || defaultActionLabel(result.kind),
    imageUrl: media?.url || null,
    imageObjectPosition: media?.objectPosition || "50% 50%",
    locationLabel: locationLabelFor(result),
    scopeLabel: isNetworkResult
      ? result.location.label
        ? `More options in ${result.location.label}`
        : "More options on MealScout"
      : null,
    variant: options.variant || defaultVariant(result),
  };
}
