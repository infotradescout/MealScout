import {
  getAdaptiveImageForPlacement,
  type AdaptiveImagePlacementId,
  type AdaptiveImageSource,
} from "@/lib/adaptiveImages";

export type BusinessMediaKind =
  | "cover"
  | "hero"
  | "logo"
  | "gallery"
  | "menu_item"
  | "legacy"
  | "placeholder";

export type BusinessMediaAsset = {
  id?: string | null;
  kind: BusinessMediaKind;
  image: AdaptiveImageSource | string;
  publicApproved: boolean;
};

export type BusinessMediaPlacement =
  | "scout_card"
  | "scout_map_preview"
  | "search_result"
  | "profile_hero"
  | "profile_gallery"
  | "owner_preview"
  | "deal_card"
  | "menu_item_card"
  | "social_share";

export type ResolvedBusinessMedia = {
  asset: BusinessMediaAsset;
  url: string;
  objectPosition: string;
  usedDerivedPlacement: boolean;
  fallbackReason: string | null;
};

const PLACEMENT_ID: Record<BusinessMediaPlacement, AdaptiveImagePlacementId> = {
  scout_card: "scout_card",
  scout_map_preview: "scout_map_preview",
  search_result: "search_result",
  profile_hero: "business_profile_hero",
  profile_gallery: "profile_gallery",
  owner_preview: "owner_preview",
  deal_card: "deal_card",
  menu_item_card: "menu_item_card",
  social_share: "social_share",
};

const PRIORITY: Record<BusinessMediaPlacement, BusinessMediaKind[]> = {
  scout_card: ["cover", "hero", "gallery", "logo", "legacy", "placeholder"],
  scout_map_preview: ["cover", "hero", "gallery", "logo", "legacy", "placeholder"],
  search_result: ["cover", "hero", "gallery", "logo", "legacy", "placeholder"],
  profile_hero: ["cover", "hero", "gallery", "logo", "legacy", "placeholder"],
  profile_gallery: ["gallery"],
  owner_preview: ["cover", "hero", "gallery", "logo", "legacy", "placeholder"],
  deal_card: ["hero", "cover", "gallery", "logo", "legacy", "placeholder"],
  menu_item_card: ["menu_item", "cover", "hero", "placeholder"],
  social_share: ["hero", "cover", "gallery", "logo", "placeholder"],
};

export function resolveBusinessMedia(
  assets: BusinessMediaAsset[],
  placement: BusinessMediaPlacement,
  options: { ownerView?: boolean; fallbackUrl?: string } = {},
): ResolvedBusinessMedia | null {
  const ownerView = options.ownerView === true;
  const eligible = assets.filter(
    (asset) =>
      ownerView ||
      asset.publicApproved ||
      asset.kind === "logo" ||
      asset.kind === "placeholder",
  );
  const selected = PRIORITY[placement]
    .flatMap((kind) => eligible.filter((asset) => asset.kind === kind))
    .find(Boolean);

  if (!selected) return null;

  const resolved = getAdaptiveImageForPlacement(
    selected.image,
    PLACEMENT_ID[placement],
    options.fallbackUrl,
  );
  if (!resolved.url) return null;

  return {
    asset: selected,
    url: resolved.url,
    objectPosition: resolved.objectPosition,
    usedDerivedPlacement: !resolved.usedFallback,
    fallbackReason:
      selected.kind === "placeholder"
        ? "placeholder"
        : resolved.usedFallback
          ? "original_asset"
          : null,
  };
}
