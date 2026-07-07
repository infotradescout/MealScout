import type {
  PublicCta,
  PublicMenuItem,
  PublicMenuSection,
  PublicRestaurantProfile,
} from "@shared/publicProfiles";
import { normalizeBusinessTypeLabel } from "@/lib/publicMenuCompleteness";
import { getTruckSchedulePrimaryStop } from "./truckScheduleTruth";
import { Clock3, ExternalLink, MapPin, MenuSquare, Route, Truck, Utensils } from "lucide-react";

type DecisionAction = {
  label: string;
  href: string;
  type: PublicCta["type"];
};

const hasText = (value: unknown) => String(value || "").trim().length > 0;

const clean = (value: unknown) => String(value || "").trim();

const uniqueMenuItems = (sections: PublicMenuSection[] | null | undefined) => {
  const seen = new Set<string>();
  const items: PublicMenuItem[] = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    for (const item of Array.isArray(section?.items) ? section.items : []) {
      const name = clean(item?.name);
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items;
};

const getProfileMenuSections = (profile: PublicRestaurantProfile) => {
  const activeVariant =
    Array.isArray(profile.menuVariants) && profile.menuVariants.length > 0
      ? profile.menuVariants.find((variant) => String(variant.id) === String(profile.activeMenuId || "")) ||
        profile.menuVariants[0]
      : null;
  return activeVariant?.menuSections?.length ? activeVariant.menuSections : profile.menuSections;
};

const pickMenuAnswer = (profile: PublicRestaurantProfile) => {
  const featuredNames = new Set(
    (profile.featuredMenuItems || []).map((name) => clean(name).toLowerCase()).filter(Boolean),
  );
  const items = uniqueMenuItems(getProfileMenuSections(profile));
  const ranked = items
    .map((item) => ({
      item,
      score:
        (item.featured ? 50 : 0) +
        (featuredNames.has(clean(item.name).toLowerCase()) ? 40 : 0) +
        (item.imageUrl ? 15 : 0) +
        (item.priceLabel ? 10 : 0) +
        (item.description ? 5 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.item || null;
};

const pickDecisionAction = (
  profile: PublicRestaurantProfile,
  safeCtas: PublicCta[],
): DecisionAction | null => {
  const wanted: PublicCta["type"][] =
    profile.profileType === "truck"
      ? ["map", "menu", "order", "phone", "external"]
      : ["order", "menu", "map", "phone", "external", "booking"];

  for (const type of wanted) {
    const cta = safeCtas.find((candidate) => candidate.type === type && hasText(candidate.href));
    if (cta) return { label: cta.label, href: cta.href, type: cta.type };
  }
  return null;
};

const locationAnswer = (profile: PublicRestaurantProfile) => {
  if (profile.profileType === "truck") {
    const primary = getTruckSchedulePrimaryStop(profile.truckSchedule);
    if (primary.stop) {
      const place = clean(primary.stop.locationName || primary.stop.addressPublicLabel);
      const time = clean(primary.stop.timeWindowLabel);
      if (place || time) {
        return {
          label: primary.label,
          value: place || time,
          detail: place && time ? time : clean(primary.stop.addressPublicLabel),
        };
      }
    }
  }

  const address = clean(profile.addressPublicLabel);
  const cityState = [profile.city, profile.state].map(clean).filter(Boolean).join(", ");
  return {
    label: profile.profileType === "truck" ? "Base area" : "Location",
    value: address || cityState || "Location not posted yet",
    detail: address && cityState ? cityState : null,
  };
};

const availabilityAnswer = (profile: PublicRestaurantProfile) => {
  if (profile.profileType === "truck") {
    const primary = getTruckSchedulePrimaryStop(profile.truckSchedule);
    if (primary.kind === "current") return { label: "Live now", value: "Here right now" };
    if (primary.kind === "today") return { label: "Serving today", value: "Scheduled today" };
    if (primary.kind === "next" || primary.kind === "upcoming") {
      return { label: "Scheduled", value: primary.label };
    }
    return null;
  }

  const openStatus = clean(profile.openStatus);
  if (!openStatus && !clean(profile.hours)) return null;
  return {
    label: "Open status",
    value: openStatus,
    detail: clean(profile.hours) || null,
  };
};

export function PublicProfileDecisionBar({
  profile,
  safeCtas,
}: {
  profile: PublicRestaurantProfile;
  safeCtas: PublicCta[];
}) {
  const menuItem = pickMenuAnswer(profile);
  const action = pickDecisionAction(profile, safeCtas);
  const availability = availabilityAnswer(profile);
  const location = locationAnswer(profile);
  const typeLabel =
    profile.profileType === "truck"
      ? "Food truck"
      : normalizeBusinessTypeLabel(profile.profileType);
  const orderValue = menuItem
    ? clean(menuItem.name)
    : profile.menuUrl || profile.menuImageUrl || profile.menuPdfUrl
      ? "Menu link available"
      : "Menu not posted yet";
  const orderDetail = menuItem?.priceLabel || menuItem?.description || null;
  const ActionIcon = action?.type === "map" ? Route : action?.type === "menu" ? MenuSquare : ExternalLink;
  const tiles = [
    {
      icon: profile.profileType === "truck" ? Truck : Utensils,
      label: "Type",
      value: typeLabel,
    },
    availability
      ? {
          icon: Clock3,
          label: availability.label,
          value: availability.value,
          detail: availability.detail,
        }
      : null,
    {
      icon: MapPin,
      label: location.label,
      value: location.value,
      detail: location.detail,
    },
    {
      icon: MenuSquare,
      label: "What to order",
      value: orderValue,
      detail: orderDetail,
    },
  ].filter(Boolean);

  return (
    <section
      aria-label="Profile decision summary"
      className="rounded-2xl border border-white/10 bg-[#100d0b] p-3 shadow-[0_18px_50px_rgba(0,0,0,0.24)]"
      data-public-profile-decision-bar="true"
      data-profile-kind={profile.profileType}
    >
      <div className="grid gap-2 md:grid-cols-4">
        {tiles.map((tile) => (
          <DecisionTile
            key={`${tile!.label}:${tile!.value}`}
            icon={tile!.icon}
            label={tile!.label}
            value={tile!.value}
            detail={tile!.detail}
          />
        ))}
        {action ? (
          <div className="rounded-xl border border-orange-300/25 bg-orange-500/10 p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-100/70">
              Best action
            </p>
            <a
              href={action.href}
              target={action.type === "external" || action.type === "map" ? "_blank" : undefined}
              rel={action.type === "external" || action.type === "map" ? "noopener noreferrer" : undefined}
              data-analytics-action="decision_bar_cta"
              data-analytics-target-type={action.type}
              className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-3 text-sm font-bold text-black hover:bg-orange-400"
            >
              <ActionIcon className="h-4 w-4" />
              <span className="truncate">{action.label}</span>
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DecisionTile({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
  detail?: string | null;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 flex-none text-orange-200/70" />
        <p className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
          {label}
        </p>
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-white">
        {value}
      </p>
      {detail ? (
        <p className="mt-1 line-clamp-2 text-xs leading-snug text-white/55">{detail}</p>
      ) : null}
    </div>
  );
}
