import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import type {
  PublicCta,
  PublicLocationProfile,
  PublicRestaurantProfile,
  PublicSupplierProfile,
} from "@shared/publicProfiles";
import {
  buildCleanPublicBusinessPath,
  isLikelyCleanAffiliateTagSegment,
  parseCleanAffiliateBusinessRoute,
} from "@shared/cleanAffiliateLinks";
import {
  assessPublicMenuCompleteness,
  normalizeBusinessTypeLabel,
} from "@/lib/publicMenuCompleteness";
import { extractUuidFromSlug } from "@/lib/seo-slug";
import { resolveCanonicalShareUrl } from "@/lib/share";
import { setAffiliateRef } from "@/lib/share";
import { SEOHead } from "@/components/seo-head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  MapPin,
  MenuSquare,
  Phone,
  Route,
  Share2,
} from "lucide-react";

type PublicProfilePayload =
  | (PublicRestaurantProfile & {
      entity: "restaurant";
      title: string;
      subtitle: string | null;
      imageUrl: string | null;
      profilePath: string;
      canonicalUrl: string;
      phone: string | null;
    })
  | (PublicLocationProfile & {
      entity: "host";
      title: string;
      subtitle: string | null;
      imageUrl: string | null;
      profilePath: string;
      canonicalUrl: string;
      phone: string | null;
    })
  | (PublicSupplierProfile & {
      entity: "supplier";
      title: string;
      subtitle: string | null;
      imageUrl: string | null;
      profilePath: string;
      canonicalUrl: string;
      phone: string | null;
      metrics?: {
        activeProductCount?: number;
      };
    });

const DEFAULT_IMAGE = "/og-default.jpg";

const normalizePublicProfileEntity = (value: string | null | undefined) => {
  const normalized = String(value || "").toLowerCase().trim();
  if (normalized === "food_truck" || normalized === "food-truck" || normalized === "foodtruck") {
    return "truck";
  }
  return normalized;
};

const isRestaurantLikeEntity = (entity: string | null | undefined) =>
  entity === "restaurant" || entity === "truck";

type LocationDiscoveryTruck = {
  id: string;
  name: string;
  cuisineType?: string | null;
  truckPath?: string;
  logoUrl?: string | null;
  coverImageUrl?: string | null;
  imageUrl?: string | null;
  schedules?: Array<{
    date?: string;
    startTime?: string;
    endTime?: string;
  }>;
};

type LocationDiscoveryPayload = {
  totalTrucks?: number;
  trucks?: LocationDiscoveryTruck[];
};

const asSafeCtas = (ctas: PublicCta[] | undefined) =>
  (Array.isArray(ctas) ? ctas : []).filter((cta) => Boolean(cta?.safe && cta?.href));

const ctaTarget = (cta: PublicCta) =>
  cta.type === "internal" || cta.type === "phone" ? undefined : "_blank";

const ctaRel = (cta: PublicCta) =>
  cta.type === "internal" || cta.type === "phone" ? undefined : "noopener noreferrer";

const isSelfProfileCta = (profile: PublicProfilePayload, cta: PublicCta) =>
  cta.type === "internal" && cta.href === profile.profilePath;

const isDetailsCta = (cta: PublicCta) => /details/i.test(String(cta.label || ""));

const uniqueByHref = (ctas: PublicCta[]) => {
  const seen = new Set<string>();
  return ctas.filter((cta) => {
    const href = String(cta.href || "").trim();
    if (!href || seen.has(href)) return false;
    seen.add(href);
    return true;
  });
};

const ctaPriorityForProfile = (profile: PublicProfilePayload, cta: PublicCta) => {
  if (typeof cta.priority === "number" && Number.isFinite(cta.priority)) return cta.priority;
  const label = String(cta.label || "").toLowerCase();
  if (profile.entity === "restaurant") {
    if (cta.type === "order" || label.includes("order")) return 100;
    if (cta.type === "menu" || label.includes("menu")) return 96;
    if (cta.type === "map") return 92;
    if (cta.type === "phone") return 90;
    if (cta.type === "external") return 85;
  }
  if (profile.entity === "host") {
    if (cta.type === "map") return 100;
    if (label.includes("food")) return 95;
    if (cta.type === "external") return 86;
    if (cta.type === "phone") return 84;
  }
  if (profile.entity === "supplier") {
    if (cta.type === "external") return 92;
    if (cta.type === "phone") return 88;
    if (cta.type === "map") return 86;
  }
  if (cta.type === "map") return 90;
  if (cta.type === "menu") return 88;
  if (cta.type === "order") return 86;
  if (cta.type === "phone") return 84;
  if (cta.type === "social") return 76;
  if (cta.type === "share") return 74;
  if (cta.type === "external") return 72;
  if (cta.type === "internal" && !isSelfProfileCta(profile, cta)) return 60;
  return 0;
};

const pickActionCtas = (profile: PublicProfilePayload, safeCtas: PublicCta[], limit = 6) =>
  uniqueByHref(
    safeCtas.filter((cta) => !isSelfProfileCta(profile, cta) && !isDetailsCta(cta)),
  )
    .sort((a, b) => ctaPriorityForProfile(profile, b) - ctaPriorityForProfile(profile, a))
    .slice(0, limit);

const locationLine = (profile: { addressPublicLabel?: string | null; city?: string | null; state?: string | null }) =>
  profile.addressPublicLabel ||
  [profile.city, profile.state].filter(Boolean).join(", ") ||
  null;

const decisionLocationLine = (profile: PublicProfilePayload) => {
  if (isRestaurantLikeEntity(profile.entity) && profile.profileType === "truck") {
    const schedule = (profile as PublicRestaurantProfile).truckSchedule;
    const stop = schedule?.currentStop || schedule?.todayStop || schedule?.nextStop || null;
    const stopLabel = stop
      ? stop.addressPublicLabel ||
        stop.locationName ||
        [stop.city, stop.state].filter(Boolean).join(", ")
      : null;
    if (stopLabel) return stopLabel;
  }
  return locationLine(profile);
};

const phoneLine = (profile: PublicProfilePayload) =>
  profile.entity === "supplier"
    ? profile.phonePublic
    : profile.entity === "restaurant"
      ? profile.phonePublic
      : profile.phone || null;

const renderCtaButton = (cta: PublicCta, variant: "default" | "outline", key: string) => (
  <a
    key={key}
    href={cta.href}
    data-analytics-action={
      cta.type === "menu"
        ? "menu_click"
        : cta.type === "map"
          ? "directions_click"
          : cta.type === "phone"
            ? "call_click"
            : cta.type === "order"
              ? "order_click"
              : cta.type === "catering"
                ? "catering_click"
                : cta.type === "booking"
                  ? "truck_booking_click"
                  : cta.type === "social"
                    ? "social_click"
                    : cta.type === "share"
                      ? "share_click"
                      : "website_click"
    }
    data-analytics-target-type={cta.type || "unknown"}
    target={ctaTarget(cta)}
    rel={ctaRel(cta)}
    className={
      variant === "default"
        ? "inline-flex items-center justify-center rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-black hover:bg-orange-400"
        : "inline-flex items-center justify-center rounded-md border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
    }
  >
    {cta.label}
  </a>
);

function HeroBlock({ profile }: { profile: PublicProfilePayload }) {
  const heroImage =
    profile.entity === "host"
      ? profile.spotImageUrl ||
        profile.coverImageUrl ||
        profile.logoUrl ||
        (profile as any).profileImageUrl ||
        (profile as any).truckPhotoLogo ||
        profile.imageUrl
      : isRestaurantLikeEntity(profile.entity)
        ? (profile as any).coverImageUrl ||
          (profile as any).logoUrl ||
          (profile as any).profileImageUrl ||
          (profile as any).truckPhotoLogo ||
          (profile as any).imageUrl
        : (profile as any).logoUrl || (profile as any).profileImageUrl || (profile as any).imageUrl;
  const initials = String(profile.displayName || "MS")
    .split(" ")
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const decisionLocation = decisionLocationLine(profile);
  const hours = isRestaurantLikeEntity(profile.entity)
    ? String((profile as PublicRestaurantProfile).hours || "").trim()
    : "";
  const truckSchedule = isRestaurantLikeEntity(profile.entity)
    ? (profile as PublicRestaurantProfile).truckSchedule
    : null;
  const liveStatus =
    profile.entity === "restaurant" && profile.openStatus
      ? profile.openStatus
      : truckSchedule?.statusLabel || null;
  const profileTypeLabel =
    profile.profileType === "location"
      ? "Location"
      : profile.profileType === "truck"
        ? "Food Truck"
        : profile.profileType === "bar"
          ? "Bar"
          : profile.profileType === "supplier"
            ? "Supplier"
            : "Restaurant";

  return (
    <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0f0d0b]">
      {heroImage ? (
        <div
          className="h-28 w-full bg-cover bg-center md:h-48"
          style={{
            backgroundImage: `linear-gradient(180deg, rgba(0,0,0,.16), rgba(0,0,0,.78)), url('${heroImage}')`,
          }}
        />
      ) : (
        <div className="relative h-28 w-full bg-[radial-gradient(circle_at_22%_24%,rgba(255,96,35,0.34),transparent_48%),linear-gradient(145deg,#1d100a_0%,#120d09_48%,#0d0a08_100%)] md:h-48">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-orange-300/35 bg-black/30 text-xl font-black text-orange-100">
              {initials}
            </div>
          </div>
        </div>
      )}
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {liveStatus ? <Badge variant="secondary">{liveStatus}</Badge> : null}
          <Badge variant="outline" className="border-orange-400/45 text-orange-200">
            {profileTypeLabel}
          </Badge>
          {"verifiedProfile" in profile && profile.verifiedProfile ? (
            <Badge variant="outline" className="border-white/20 text-white/65">
              Verified
            </Badge>
          ) : null}
          {"locallyOwned" in profile && profile.locallyOwned ? (
            <Badge variant="outline" className="border-emerald-300/35 text-emerald-200/85">
              Locally owned
            </Badge>
          ) : null}
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {profile.displayName}
          </h1>
          {profile.entity === "restaurant" && (profile.cuisineTags?.length || profile.serviceType) ? (
            <p className="text-sm font-medium text-orange-100/85">
              {[...(profile.cuisineTags || []).slice(0, 2), profile.serviceType]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="space-y-2 text-sm text-white/78">
          {decisionLocation ? (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 flex-none text-orange-200" />
              <span>{decisionLocation}</span>
            </p>
          ) : null}
          {hours ? (
            <p className="flex items-start gap-2">
              <Clock3 className="mt-0.5 h-4 w-4 flex-none text-orange-200" />
              <span>{hours}</span>
            </p>
          ) : null}
          {phoneLine(profile) ? (
            <p className="flex items-start gap-2">
              <Phone className="mt-0.5 h-4 w-4 flex-none text-orange-200" />
              <span>{phoneLine(profile)}</span>
            </p>
          ) : null}
        </div>
        {profile.description ? (
          <p className="line-clamp-3 text-sm leading-6 text-white/70">{profile.description}</p>
        ) : null}
      </div>
    </section>
  );
}

function PublicProfileShareControls({
  profile,
  sharePath,
  title,
  description,
  onShareAction,
}: {
  profile: PublicProfilePayload;
  sharePath?: string | null;
  title: string;
  description: string;
  onShareAction: (actionType: string, targetType?: string | null, href?: string | null) => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const targetPath = sharePath || profile.profilePath || (() => {
    try {
      return new URL(profile.canonicalUrl).pathname;
    } catch {
      return typeof window !== "undefined" ? window.location.pathname : "/";
    }
  })();

  const resolveShareUrl = async () => resolveCanonicalShareUrl(targetPath);

  const copyShareUrl = async () => {
    const shareUrl = await resolveShareUrl();
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
    onShareAction("share_copy", "copy", shareUrl);
    toast({
      title: "Link copied",
      description: "Public profile link copied to clipboard.",
    });
    return shareUrl;
  };

  const handleShare = async () => {
    try {
      const shareUrl = await resolveShareUrl();
      if (navigator.share) {
        await navigator.share({
          title,
          text: description,
          url: shareUrl,
        });
        onShareAction("share_open", "native_share", shareUrl);
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      onShareAction("share_copy", "copy_fallback", shareUrl);
      toast({
        title: "Link copied",
        description: "Sharing is not available here, so the profile link was copied.",
      });
    } catch {
      toast({
        title: "Share failed",
        description: "Could not prepare the profile share link.",
        variant: "destructive",
      });
    }
  };

  const handleCopy = async () => {
    try {
      await copyShareUrl();
    } catch {
      toast({
        title: "Copy failed",
        description: "Could not copy the profile share link.",
        variant: "destructive",
      });
    }
  };

  return (
    <section
      aria-label="Share public profile"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#0f0d0b] p-3"
    >
      <Button
        type="button"
        onClick={handleShare}
        className="bg-orange-500 text-black hover:bg-orange-400"
        data-testid="button-public-profile-share"
      >
        <Share2 className="mr-2 h-4 w-4" />
        Share
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={handleCopy}
        className="border-white/20 text-white hover:bg-white/10"
        data-testid="button-public-profile-copy-link"
      >
        {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
        Copy Link
      </Button>
    </section>
  );
}

function LocationNowSection({ profile }: { profile: PublicLocationProfile }) {
  const now = Number(profile.foodTrucksNow || 0);
  const tonight = Number(profile.foodTrucksTonight || 0);
  const upcoming = Number(profile.upcomingFoodTruckSlots || 0);
  const hasAny = now > 0 || tonight > 0 || upcoming > 0;

  return (
    <Card id="menu" className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Food here now</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasAny ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-white/60">Trucks here now</p>
              <p className="mt-1 text-2xl font-semibold text-white">{now}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-white/60">Trucks tonight</p>
              <p className="mt-1 text-2xl font-semibold text-white">{tonight}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs uppercase tracking-wide text-white/60">Upcoming</p>
              <p className="mt-1 text-2xl font-semibold text-white">{upcoming}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-white/75">
            No trucks listed right now. Check back soon.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickActionRow({
  profile,
  safeCtas,
}: {
  profile: PublicProfilePayload;
  safeCtas: PublicCta[];
}) {
  const preferredOrder: PublicCta["type"][] = [
    "menu",
    "map",
    "order",
    "phone",
    "catering",
    "booking",
  ];
  const actionPool = pickActionCtas(profile, safeCtas, 16).filter(
    (cta) =>
      cta.type !== "social" &&
      cta.type !== "share" &&
      !(cta.type === "external" && /instagram|facebook|x\.com|twitter/i.test(cta.href)),
  );
  const actions = preferredOrder
    .flatMap((type) =>
      actionPool.filter((cta) => cta.type === type),
    )
    .reduce((acc, cta) => {
      if (acc.find((existing) => existing.href === cta.href)) return acc;
      acc.push(cta);
      return acc;
    }, [] as PublicCta[])
    .slice(0, 7);
  if (actions.length === 0) return null;
  return (
    <Card id="actions" className="border-white/10 bg-[#0f0d0b]">
      <CardContent className="space-y-3 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-white/60">
          Get food
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {actions.map((cta, idx) =>
            renderCtaButton(
              cta,
              idx === 0 ? "default" : "outline",
              `${cta.href}-${idx}`,
            ),
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function formatScheduleLabel(truck: LocationDiscoveryTruck) {
  const first = Array.isArray(truck.schedules) ? truck.schedules[0] : null;
  if (!first) return null;
  const start = String(first.startTime || "").trim();
  const end = String(first.endTime || "").trim();
  if (start && end) return `${start} - ${end}`;
  return start || end || null;
}

function LocationTruckOptionsSection({
  profile,
}: {
  profile: PublicLocationProfile;
}) {
  const hostId = String(profile.id || "").trim();
  const { data: nowData, isLoading: nowLoading } = useQuery<LocationDiscoveryPayload>({
    queryKey: ["/api/public/discovery/location", hostId, "now"],
    enabled: Boolean(hostId),
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/public/discovery/location/${encodeURIComponent(hostId)}/time/now`),
      );
      if (!res.ok) return { totalTrucks: 0, trucks: [] };
      return res.json();
    },
  });

  const { data: tonightData, isLoading: tonightLoading } =
    useQuery<LocationDiscoveryPayload>({
      queryKey: ["/api/public/discovery/location", hostId, "tonight"],
      enabled: Boolean(hostId),
      queryFn: async () => {
        const res = await fetch(apiUrl(`/api/public/discovery/location/${encodeURIComponent(hostId)}/time/tonight`),
        );
        if (!res.ok) return { totalTrucks: 0, trucks: [] };
        return res.json();
      },
    });

  const nowTrucks = Array.isArray(nowData?.trucks) ? nowData!.trucks! : [];
  const tonightTrucks = Array.isArray(tonightData?.trucks)
    ? tonightData!.trucks!
    : [];

  const tonightOnly = useMemo(() => {
    const nowIds = new Set(nowTrucks.map((truck) => String(truck.id)));
    return tonightTrucks.filter((truck) => !nowIds.has(String(truck.id)));
  }, [nowTrucks, tonightTrucks]);

  const hasCards = nowTrucks.length > 0 || tonightOnly.length > 0;
  const loading = nowLoading || tonightLoading;
  const featuredCurrent = nowTrucks.length > 0 ? nowTrucks[0] : null;
  const remainingCurrent = nowTrucks.length > 1 ? nowTrucks.slice(1) : [];

  const renderTruckCard = (
    truck: LocationDiscoveryTruck,
    status: "here_now" | "tonight",
    key: string,
    featured = false,
  ) => {
    const image = truck.coverImageUrl || truck.logoUrl || truck.imageUrl || null;
    const scheduleLabel = formatScheduleLabel(truck);
    return (
      <div
        key={key}
        className={
          featured
            ? "rounded-xl border border-orange-400/35 bg-[linear-gradient(140deg,#20130d_0%,#17110d_55%,#120f0d_100%)] p-3"
            : "rounded-xl border border-white/10 bg-black/20 p-3"
        }
      >
        <div className="flex gap-3">
          <div className="h-16 w-16 flex-none overflow-hidden rounded-lg bg-[#1a1714]">
            {image ? (
              <img
                src={image}
                alt={truck.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-white/75">
                {String(truck.name || "Truck").slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{truck.name}</p>
            {truck.cuisineType ? (
              <p className="truncate text-xs text-white/70">{truck.cuisineType}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {status === "here_now" ? "Here now" : "Tonight"}
              </Badge>
              {scheduleLabel ? (
                <Badge variant="outline" className="border-white/15 text-white/80">
                  {scheduleLabel}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          {truck.truckPath ? (
            <a
              href={truck.truckPath}
              data-analytics-action="profile_view"
              data-analytics-target-type="internal"
              className="inline-flex items-center rounded-md bg-orange-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-orange-400"
            >
              View
            </a>
          ) : null}
          {locationLine(profile) ? (
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(String(locationLine(profile) || ""))}`}
              data-analytics-action="directions_click"
              data-analytics-target-type="map"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-white/20 px-3 py-1.5 text-xs text-white/90 hover:bg-white/10"
            >
              <Route className="h-3.5 w-3.5" />
              Route
            </a>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Food options here</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-white/75">
            Loading nearby trucks...
          </div>
        ) : null}

        {!loading && hasCards ? (
          <div className="space-y-4">
            {featuredCurrent ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-orange-200/90">
                  Happening now
                </p>
                {renderTruckCard(featuredCurrent, "here_now", `featured:${featuredCurrent.id}`, true)}
              </div>
            ) : null}
            {remainingCurrent.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/65">
                  Here now
                </p>
                <div className="space-y-2">
                  {remainingCurrent.map((truck) =>
                    renderTruckCard(truck, "here_now", `now:${truck.id}`),
                  )}
                </div>
              </div>
            ) : null}
            {tonightOnly.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/65">
                  Tonight
                </p>
                <div className="space-y-2">
                  {tonightOnly.map((truck) =>
                    renderTruckCard(truck, "tonight", `tonight:${truck.id}`),
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {!loading && !hasCards ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-white/75">
            <p>No trucks listed right now.</p>
            <p className="mt-1">Check back soon or explore nearby food.</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LocationMapSection({ profile }: { profile: PublicLocationProfile }) {
  const hasCoords =
    typeof profile.latitude === "number" && typeof profile.longitude === "number";
  const mapHref = hasCoords
    ? `https://maps.google.com/?q=${profile.latitude},${profile.longitude}`
    : null;

  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Map and directions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasCoords ? (
          <div className="rounded-xl border border-white/10 bg-gradient-to-br from-[#17120f] to-[#0f0d0b] p-3">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium text-white">Map preview</p>
              <Badge variant="outline" className="border-white/20 text-white/70">
                {profile.latitude?.toFixed(4)}, {profile.longitude?.toFixed(4)}
              </Badge>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="mb-2 h-16 rounded-md bg-[linear-gradient(135deg,#1b1713_0%,#13100d_55%,#100f0d_100%)]" />
              <p className="text-xs text-white/70">
                Nearby streets and food activity around this location.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white/75">
            Map coordinates are not available yet.
          </div>
        )}
        {locationLine(profile) ? <p className="text-sm text-white/80">{locationLine(profile)}</p> : null}
        {mapHref ? (
            <a
              href={mapHref}
              data-analytics-action="directions_click"
              data-analytics-target-type="map"
              target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-orange-300 hover:text-orange-200"
          >
            Get directions <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LocationAmenitiesSection({ profile }: { profile: PublicLocationProfile }) {
  const amenities = Array.isArray(profile.amenities) ? profile.amenities : [];
  const notes = profile.publicRules || profile.publicParkingSummary;
  if (amenities.length === 0 && !notes) return null;
  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Amenities and notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {amenities.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {amenities.map((item) => (
              <Badge key={item} variant="outline" className="border-white/20 text-white/80">
                {item}
              </Badge>
            ))}
          </div>
        ) : null}
        {notes ? <p className="text-sm text-white/75">{notes}</p> : null}
      </CardContent>
    </Card>
  );
}

function RestaurantSignals({ profile }: { profile: PublicRestaurantProfile }) {
  const signals: string[] = [];
  const menuCompleteness = assessPublicMenuCompleteness({
    menuSections: profile.menuSections,
    featuredMenuItems: profile.featuredMenuItems,
    menuUrl: profile.menuUrl,
    menuImageUrl: profile.menuImageUrl,
    menuPdfUrl: profile.menuPdfUrl,
  });
  if (profile.openStatus) signals.push(profile.openStatus);
  if (profile.deals.totalActive > 0) signals.push("Deal today");
  if (menuCompleteness.state === "complete") signals.push("Menu available");
  if (menuCompleteness.state === "partial") signals.push("Partial menu evidence");
  if (profile.profileType === "truck" && profile.truckSchedule?.nextWindowLabel) {
    signals.push("Truck schedule available");
  }
  if (profile.recommendations.total > 0) signals.push("Local favorite");

  if (signals.length === 0) return null;
  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Why go now</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {signals.map((signal) => (
            <Badge key={signal} variant="secondary">
              {signal}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AboutFoodStyle({ profile }: { profile: PublicRestaurantProfile }) {
  const normalizedServiceType = normalizeBusinessTypeLabel(profile.serviceType || "");
  const tags = [
    ...profile.cuisineTags,
    normalizedServiceType || "",
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, 10);
  const hasAbout = Boolean(profile.description) || tags.length > 0;
  if (!hasAbout) return null;
  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">About</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {profile.description ? <p className="text-sm text-white/85">{profile.description}</p> : null}
        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge key={tag} variant="outline" className="border-white/20 text-white/80">
                {tag}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MenuSection({
  profile,
  safeCtas,
}: {
  profile: PublicRestaurantProfile;
  safeCtas: PublicCta[];
}) {
  const [recommendingKey, setRecommendingKey] = useState<string | null>(null);
  const [recommendComment, setRecommendComment] = useState("");
  const [recommendRating, setRecommendRating] = useState("5");
  const [recommendPhoto, setRecommendPhoto] = useState<File | null>(null);
  const [submitStateByItem, setSubmitStateByItem] = useState<Record<string, string>>({});
  const [submittingItemId, setSubmittingItemId] = useState<string | null>(null);
  const menuVariants = Array.isArray(profile.menuVariants)
    ? profile.menuVariants.filter((variant) => String(variant?.id || "").trim().length > 0)
    : [];
  const [selectedMenuId, setSelectedMenuId] = useState<string>(
    String(profile.activeMenuId || menuVariants[0]?.id || ""),
  );
  useEffect(() => {
    setSelectedMenuId(String(profile.activeMenuId || menuVariants[0]?.id || ""));
  }, [profile.activeMenuId, profile.id, menuVariants]);
  const activeVariant =
    (selectedMenuId && menuVariants.find((variant) => String(variant.id) === selectedMenuId)) ||
    menuVariants[0] ||
    null;
  const menuCta = safeCtas.find(
    (cta) =>
      cta.type === "menu" ||
      /menu/i.test(String(cta.label || "")) ||
      /\/menu\//i.test(String(cta.href || "")),
  );
  const featuredItems = Array.isArray(profile.featuredMenuItems)
    ? profile.featuredMenuItems.filter(Boolean)
    : [];
  const structuredSections = Array.isArray(activeVariant?.menuSections)
    ? activeVariant!.menuSections.filter(
        (section) =>
          section &&
          String(section.name || "").trim().length > 0 &&
          Array.isArray(section.items) &&
          section.items.length > 0,
      )
    : [];
  const hasStructuredMenu = structuredSections.length > 0;
  const menuCompleteness = assessPublicMenuCompleteness({
    menuSections: structuredSections,
    featuredMenuItems: featuredItems,
    menuUrl: activeVariant?.menuUrl || profile.menuUrl,
    menuImageUrl: profile.menuImageUrl,
    menuPdfUrl: profile.menuPdfUrl,
  });
  const pricedSections = structuredSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => Boolean(String(item.priceLabel || "").trim())),
    }))
    .filter((section) => section.items.length > 0);
  const unpricedItems = structuredSections.flatMap((section) =>
    section.items
      .filter((item) => !String(item.priceLabel || "").trim())
      .map((item) => ({ sectionName: section.name, name: item.name })),
  );
  const hasSection =
    hasStructuredMenu ||
    Boolean(menuCta) ||
    Boolean(profile.menuUrl) ||
    Boolean(profile.menuImageUrl) ||
    Boolean(profile.menuPdfUrl) ||
    featuredItems.length > 0;
  if (!hasSection) return null;

  const fallbackMenuLink =
    profile.menuPdfUrl || profile.menuImageUrl || activeVariant?.menuUrl || profile.menuUrl || null;
  const updatedLabel = (activeVariant?.menuLastUpdatedAt || profile.menuLastUpdatedAt)
    ? new Date(activeVariant?.menuLastUpdatedAt || profile.menuLastUpdatedAt || "").toLocaleDateString()
    : null;
  const submitRecommendation = async (menuItemId: string) => {
    if (!menuItemId) return;
    setSubmittingItemId(menuItemId);
    try {
      const formData = new FormData();
      formData.append("comment", recommendComment);
      formData.append("rating", recommendRating);
      if (recommendPhoto) formData.append("image", recommendPhoto);
      const res = await fetch(apiUrl(`/api/menu-items/${encodeURIComponent(menuItemId)}/recommend`), {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitStateByItem((prev) => ({
          ...prev,
          [menuItemId]:
            String(data?.message || "").trim() ||
            "Unable to submit recommendation right now.",
        }));
        return;
      }
      setSubmitStateByItem((prev) => ({
        ...prev,
        [menuItemId]: data?.photoStatus?.status === "pending"
          ? "Recommendation submitted. Photo is pending business review."
          : "Recommendation submitted.",
      }));
      setRecommendComment("");
      setRecommendPhoto(null);
      setRecommendingKey(null);
    } catch {
      setSubmitStateByItem((prev) => ({
        ...prev,
        [menuItemId]: "Unable to submit recommendation right now.",
      }));
    } finally {
      setSubmittingItemId(null);
    }
  };

  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Menu</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {menuVariants.length > 1 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Select menu</p>
            <div className="flex flex-wrap gap-2">
              {menuVariants.map((variant) => {
                const active = String(variant.id) === String(selectedMenuId || activeVariant?.id || "");
                return (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => setSelectedMenuId(String(variant.id))}
                    className={`rounded-md border px-2 py-1 text-xs ${
                      active
                        ? "border-orange-300/60 bg-orange-500/15 text-orange-100"
                        : "border-white/20 bg-black/15 text-white/75"
                    }`}
                  >
                    {variant.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {profile.menuContextNote ? (
          <p className="rounded-md border border-sky-300/35 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
            {profile.menuContextNote}
          </p>
        ) : null}
        {menuCompleteness.state === "partial" ? (
          <p className="rounded-md border border-amber-300/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            Partial menu from available evidence. More items may be available from this business directly.
          </p>
        ) : null}
        {menuCompleteness.state === "unavailable" ? (
          <p className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/75">
            Menu unavailable right now.
          </p>
        ) : null}
        {updatedLabel ? (
          <p className="text-xs text-white/65">Menu last updated {updatedLabel}</p>
        ) : null}

        {pricedSections.length > 0 ? (
          <div className="space-y-4">
            {pricedSections.map((section) => (
              <div key={section.name} className="space-y-2">
                <p className="text-sm font-semibold text-white/90">{section.name}</p>
                <div className="space-y-2">
                  {section.items.map((item, index) => (
                    <div
                      key={`${section.name}:${item.name}:${index}`}
                      className="rounded-lg border border-white/10 bg-black/20 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">{item.name}</p>
                          {item.description ? (
                            <p className="mt-1 text-xs text-white/70">{item.description}</p>
                          ) : null}
                        </div>
                        {item.priceLabel ? (
                          <p className="text-sm font-semibold text-orange-200">{item.priceLabel}</p>
                        ) : null}
                      </div>
                      {item.menuItemId ? (
                        <div className="mt-3 space-y-2">
                          <button
                            type="button"
                            onClick={() =>
                              setRecommendingKey((current) =>
                                current === item.menuItemId ? null : item.menuItemId || null,
                              )
                            }
                            className="text-xs font-medium text-orange-300 hover:text-orange-200"
                          >
                            Recommend this item
                          </button>
                          {submitStateByItem[item.menuItemId] ? (
                            <p className="text-xs text-white/70">
                              {submitStateByItem[item.menuItemId]}
                            </p>
                          ) : null}
                          {recommendingKey === item.menuItemId ? (
                            <div className="space-y-2 rounded-md border border-white/10 bg-black/30 p-2">
                              <textarea
                                value={recommendComment}
                                onChange={(event) => setRecommendComment(event.target.value)}
                                placeholder="Why do you recommend this dish?"
                                className="min-h-[64px] w-full rounded border border-white/20 bg-black/40 px-2 py-1 text-xs text-white"
                              />
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-white/70">Rating</label>
                                <select
                                  value={recommendRating}
                                  onChange={(event) => setRecommendRating(event.target.value)}
                                  className="rounded border border-white/20 bg-black/40 px-2 py-1 text-xs text-white"
                                >
                                  <option value="5">5</option>
                                  <option value="4">4</option>
                                  <option value="3">3</option>
                                  <option value="2">2</option>
                                  <option value="1">1</option>
                                </select>
                              </div>
                              <div className="space-y-1">
                                <p className="text-xs text-white/65">
                                  Got a photo of this dish? Add it so others know what to expect.
                                </p>
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(event) =>
                                    setRecommendPhoto(event.target.files?.[0] || null)
                                  }
                                  className="text-xs text-white/80"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => submitRecommendation(String(item.menuItemId || ""))}
                                  disabled={submittingItemId === item.menuItemId}
                                >
                                  {submittingItemId === item.menuItemId
                                    ? "Submitting..."
                                    : "Submit recommendation"}
                                </Button>
                                <button
                                  type="button"
                                  className="text-xs text-white/60 hover:text-white/80"
                                  onClick={() => setRecommendingKey(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {unpricedItems.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-white/90">Unpriced items from evidence</p>
            <div className="space-y-1">
              {unpricedItems.map((item, index) => (
                <p key={`${item.sectionName}:${item.name}:${index}`} className="text-xs text-white/75">
                  {item.sectionName}: {item.name}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        {featuredItems.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-white/90">Featured items</p>
            <div className="flex flex-wrap gap-2">
              {featuredItems.map((item) => (
                <Badge key={item} variant="outline" className="border-white/20 text-white/80">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        {menuCta ? (
          renderCtaButton(menuCta, "default", "menu-cta")
        ) : fallbackMenuLink ? (
              <a
                href={fallbackMenuLink}
                data-analytics-action="menu_click"
                data-analytics-target-type="menu"
                target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-orange-300 hover:text-orange-200"
          >
            See menu <MenuSquare className="h-4 w-4" />
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DealsSection({ profile }: { profile: PublicRestaurantProfile }) {
  const dealItems = Array.isArray(profile.deals.items)
    ? profile.deals.items.filter(
        (item) =>
          Boolean(
            String(item?.id || "").trim() &&
              String(item?.title || "").trim() &&
              String(item?.actionHref || "").trim(),
          ),
      )
    : [];
  if (dealItems.length === 0) return null;
  const formatDealDate = (value: string | null) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString();
  };
  const dateWindowLabel = (item: (typeof dealItems)[number]) => {
    const start = formatDealDate(item.startAt);
    const end = formatDealDate(item.endAt);
    if (start && end && start !== end) return `${start} - ${end}`;
    if (start && end && start === end) return "Today";
    if (end) return `Ends ${end}`;
    if (start) return start;
    return null;
  };
  const dealTypeLabel = (dealType: string) => {
    if (dealType === "happy_hour") return "Happy hour";
    if (dealType === "limited_time") return "Limited-time";
    if (dealType === "family_meal") return "Family meal";
    if (dealType === "daily") return "Daily";
    if (dealType === "lunch") return "Lunch";
    if (dealType === "coupon") return "Coupon";
    return "Special";
  };
  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Deals and specials</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {dealItems.map((deal) => (
          <div key={deal.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">{deal.title}</p>
              <Badge variant="outline" className="border-white/20 text-white/80">
                {dealTypeLabel(deal.dealType)}
              </Badge>
            </div>
            {deal.description ? (
              <p className="mt-1 text-xs text-white/75">{deal.description}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {dateWindowLabel(deal) ? (
                <Badge variant="secondary">{dateWindowLabel(deal)}</Badge>
              ) : null}
              {deal.timeWindowLabel ? (
                <Badge variant="outline" className="border-white/15 text-white/80">
                  {deal.timeWindowLabel}
                </Badge>
              ) : null}
            </div>
            <div className="mt-3">
              <a
                href={deal.actionHref}
                data-analytics-action="deal_click"
                data-analytics-target-type={deal.actionType || "deal"}
                target={
                  deal.actionType === "internal" || deal.actionType === "show_this_deal"
                    ? undefined
                    : "_blank"
                }
                rel={
                  deal.actionType === "internal" || deal.actionType === "show_this_deal"
                    ? undefined
                    : "noopener noreferrer"
                }
                className="inline-flex items-center rounded-md bg-orange-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-orange-400"
              >
                {deal.actionLabel}
              </a>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EventsSection({
  profile,
}: {
  profile: Pick<PublicRestaurantProfile, "events"> | Pick<PublicLocationProfile, "events">;
}) {
  const eventItems = Array.isArray(profile.events?.items)
    ? profile.events.items.filter(
        (item) =>
          Boolean(
            String(item?.id || "").trim() &&
              String(item?.title || "").trim() &&
              String(item?.actionHref || "").trim(),
          ),
      )
    : [];
  if (eventItems.length === 0) return null;
  const typeLabel = (value: string) => {
    if (value === "live_music") return "Live music";
    if (value === "food_truck_night") return "Food truck night";
    if (value === "watch_party") return "Watch party";
    if (value === "pop_up") return "Pop-up";
    return value.replace(/_/g, " ");
  };
  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Events</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {eventItems.map((event) => (
          <div key={event.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">{event.title}</p>
              <Badge variant="outline" className="border-white/20 text-white/80 capitalize">
                {typeLabel(event.eventType)}
              </Badge>
            </div>
            {event.description ? (
              <p className="mt-1 text-xs text-white/75">{event.description}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {event.dateLabel ? (
                <Badge variant="secondary">{event.dateLabel}</Badge>
              ) : null}
              {event.timeWindowLabel ? (
                <Badge variant="outline" className="border-white/15 text-white/80">
                  {event.timeWindowLabel}
                </Badge>
              ) : null}
            </div>
            {event.locationName || event.addressPublicLabel ? (
              <p className="mt-2 text-xs text-white/70">
                {[event.locationName, event.addressPublicLabel].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            <div className="mt-3">
              <a
                href={event.actionHref}
                data-analytics-action="event_click"
                data-analytics-target-type={event.actionType || "event"}
                target={event.actionType === "internal" || event.actionType === "rsvp" ? undefined : "_blank"}
                rel={event.actionType === "internal" || event.actionType === "rsvp" ? undefined : "noopener noreferrer"}
                className="inline-flex items-center gap-1 rounded-md bg-orange-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-orange-400"
              >
                <CalendarDays className="h-3.5 w-3.5" />
                {event.actionLabel}
              </a>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function FeaturedBartendersSection({ profile }: { profile: PublicRestaurantProfile }) {
  if (profile.profileType !== "bar") return null;
  const raw = Array.isArray((profile as any).featuredBartenders)
    ? (profile as any).featuredBartenders
    : [];
  const featured = raw
    .filter(
      (entry: any) =>
        entry &&
        (entry.isActive ?? true) &&
        Boolean(String(entry.name || "").trim()),
    )
    .sort((a: any, b: any) => Number(a?.displayOrder || 0) - Number(b?.displayOrder || 0));
  if (featured.length === 0) return null;

  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Featured bartenders</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {featured.map((entry: any, index: number) => (
          <div
            key={`${String(entry?.name || "bartender")}:${index}`}
            className="rounded-lg border border-white/10 bg-black/20 p-3"
          >
            <div className="flex items-center gap-3">
              {entry.photo ? (
                <img
                  src={String(entry.photo)}
                  alt={String(entry.name)}
                  loading="lazy"
                  className="h-12 w-12 rounded-full object-cover border border-white/15"
                />
              ) : null}
              <div>
                <p className="text-sm font-semibold text-white">{String(entry.name)}</p>
                {entry.role || entry.title ? (
                  <p className="text-xs text-white/70">{String(entry.role || entry.title)}</p>
                ) : null}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {entry.featuredNights ? <Badge variant="secondary">{String(entry.featuredNights)}</Badge> : null}
              {entry.signatureDrink ? (
                <Badge variant="outline" className="border-white/15 text-white/80">
                  Signature: {String(entry.signatureDrink)}
                </Badge>
              ) : null}
              {entry.specialty ? (
                <Badge variant="outline" className="border-white/15 text-white/80">
                  {String(entry.specialty)}
                </Badge>
              ) : null}
            </div>
            {entry.bio || entry.tagline ? (
              <p className="mt-2 text-xs text-white/75">{String(entry.bio || entry.tagline)}</p>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ProofSection({ profile }: { profile: PublicRestaurantProfile }) {
  const metrics = [
    { label: "Recommendations", value: Number(profile.recommendations.total || 0) },
    { label: "Reviews", value: Number(profile.reviewSummary.count || 0) },
  ].filter((metric) => metric.value > 0);
  if (metrics.length === 0) return null;
  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Local proof</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-xs uppercase tracking-wide text-white/60">{metric.label}</p>
            <p className="mt-1 text-2xl font-semibold text-white">{metric.value}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function GalleryStrip({ profile }: { profile: PublicRestaurantProfile }) {
  if (!Array.isArray(profile.galleryImages) || profile.galleryImages.length === 0) {
    return null;
  }
  const images = profile.galleryImages
    .filter((image) => image.publicApproved && image.url)
    .slice(0, 12);
  if (images.length === 0) return null;
  const imageTypeLabel = (source: string) => {
    if (source === "cover_image") return "Cover";
    if (source === "logo") return "Logo";
    if (source === "spot_image") return "Storefront";
    if (source === "google_photo") return "Atmosphere";
    if (source === "gallery") return "Food";
    return "Photo";
  };

  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-white/90">Gallery</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2.5 overflow-x-auto pb-1">
          {images.map((image, idx) => (
            <div key={`${image.url}-${idx}`} className="relative h-24 w-36 flex-none overflow-hidden rounded-md border border-white/10">
              <img
                src={image.url}
                alt={`${profile.displayName} ${idx + 1}`}
                loading="lazy"
                className="h-full w-full object-cover"
              />
              <span className="absolute bottom-1 left-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
                {imageTypeLabel(image.source)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RestaurantSchedule({ profile }: { profile: PublicRestaurantProfile }) {
  const hasHours = Boolean(String(profile.hours || "").trim());
  const schedule = profile.profileType === "truck" ? profile.truckSchedule : null;
  const currentStop = schedule?.currentStop || null;
  const todayStop = schedule?.todayStop || null;
  const nextStop = schedule?.nextStop || null;
  const upcomingStops = Array.isArray(schedule?.upcomingStops)
    ? schedule!.upcomingStops.slice(0, 6)
    : [];
  const hasTruckSchedule =
    Boolean(currentStop) ||
    Boolean(todayStop) ||
    Boolean(nextStop) ||
    upcomingStops.length > 0 ||
    Boolean(String(schedule?.statusLabel || "").trim()) ||
    Boolean(String(schedule?.nextWindowLabel || "").trim()) ||
    Number(schedule?.upcomingCount || 0) > 0;
  if (!hasHours && !hasTruckSchedule) return null;

  const stopRow = (
    label: string,
    stop: NonNullable<typeof currentStop>,
    emphasize = false,
  ) => (
    <div
      className={
        emphasize
          ? "rounded-lg border border-orange-400/35 bg-[#1b120d] p-3"
          : "rounded-lg border border-white/10 bg-black/20 p-3"
      }
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-white/65">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">
        {stop.locationName || stop.addressPublicLabel || "Location update"}
      </p>
      <p className="text-xs text-white/70">
        {[stop.date, stop.timeWindowLabel].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {stop.status ? <Badge variant="secondary">{String(stop.status).replace(/_/g, " ")}</Badge> : null}
        {stop.directionsUrl ? (
          <a
            href={stop.directionsUrl}
            data-analytics-action="directions_click"
            data-analytics-target-type="map"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-white/20 px-2.5 py-1 text-xs text-white/85 hover:bg-white/10"
          >
            <Route className="h-3.5 w-3.5" />
            Get directions
          </a>
        ) : null}
      </div>
    </div>
  );

  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Hours and schedule</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-white/80">
        {hasHours ? (
          <p className="inline-flex items-center gap-1">
            <Clock3 className="h-4 w-4" />
            {profile.hours}
          </p>
        ) : null}
        {profile.profileType === "truck" && hasTruckSchedule ? (
          <div className="space-y-3">
            {schedule?.statusLabel ? (
              <Badge variant="outline" className="border-orange-300/35 text-orange-200">
                {schedule.statusLabel}
              </Badge>
            ) : null}
            {currentStop ? stopRow("Here now", currentStop, true) : null}
            {!currentStop && todayStop ? stopRow("Today's stop", todayStop) : null}
            {!currentStop && !todayStop && nextStop ? stopRow("Next stop", nextStop) : null}
            {upcomingStops.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/65">
                  Upcoming schedule
                </p>
                <div className="space-y-2">
                  {upcomingStops.map((stop, index) => (
                    <div
                      key={`${stop.stopId || stop.date || "stop"}:${index}`}
                      className="rounded-lg border border-white/10 bg-black/20 p-2.5"
                    >
                      <p className="text-sm font-medium text-white">
                        {stop.locationName || stop.addressPublicLabel || "Scheduled stop"}
                      </p>
                      <p className="text-xs text-white/70">
                        {[stop.date, stop.timeWindowLabel].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {schedule?.notice ? (
              <div className="rounded-md border border-white/10 bg-black/20 p-2.5 text-xs text-white/80">
                {schedule.notice}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RestaurantSocial({
  profile,
  safeCtas,
}: {
  profile: PublicRestaurantProfile;
  safeCtas: PublicCta[];
}) {
  const grouped = {
    website: safeCtas.filter(
      (cta) =>
        cta.type === "external" &&
        !/instagram|facebook|x\.com|twitter/i.test(String(cta.href || "")),
    ),
    follow: safeCtas.filter((cta) => cta.type === "social" || cta.type === "share"),
  };
  const unique = (ctas: PublicCta[]) =>
    ctas.reduce((acc, cta) => {
      if (acc.some((x) => x.href === cta.href)) return acc;
      acc.push(cta);
      return acc;
    }, [] as PublicCta[]);
  const websiteActions = unique(grouped.website);
  const followActions = unique(grouped.follow);
  if (websiteActions.length === 0 && followActions.length === 0) {
    return null;
  }
  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Social links</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {websiteActions.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Website</p>
            <div className="flex flex-wrap gap-2">
              {websiteActions.map((cta, idx) =>
                renderCtaButton(cta, "outline", `website-${cta.href}-${idx}`),
              )}
            </div>
          </div>
        ) : null}
        {followActions.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/60">Follow</p>
            <div className="flex flex-wrap gap-2">
              {followActions.map((cta, idx) =>
                renderCtaButton(cta, "outline", `follow-${cta.href}-${idx}`),
              )}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RelatedLocalDiscovery({
  data,
  citySlug,
  restaurantProfile,
}: {
  data: PublicProfilePayload;
  citySlug: string | null;
  restaurantProfile: PublicRestaurantProfile | null;
}) {
  if (!data.city || !citySlug) return null;
  const cuisineTag = restaurantProfile?.cuisineTags?.find((tag) =>
    String(tag || "").trim().length > 0,
  );
  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-base text-white">
          Keep exploring {data.city}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
        <a
          href={`/city/${encodeURIComponent(citySlug)}/food`}
          className="rounded-md border border-white/10 px-3 py-2 text-white/85 hover:bg-white/10"
        >
          Places to eat nearby
        </a>
        <a
          href={`/food-trucks-today/${encodeURIComponent(citySlug)}`}
          className="rounded-md border border-white/10 px-3 py-2 text-white/85 hover:bg-white/10"
        >
          Food trucks today
        </a>
        <a
          href={`/deals-today/${encodeURIComponent(citySlug)}`}
          className="rounded-md border border-white/10 px-3 py-2 text-white/85 hover:bg-white/10"
        >
          Deals today
        </a>
        <a
          href={`/events-today/${encodeURIComponent(citySlug)}`}
          className="rounded-md border border-white/10 px-3 py-2 text-white/85 hover:bg-white/10"
        >
          Local food events
        </a>
        {cuisineTag ? (
          <a
            href={`/cuisine/${encodeURIComponent(String(cuisineTag).toLowerCase().replace(/[^a-z0-9]+/g, "-"))}/${encodeURIComponent(citySlug)}`}
            className="rounded-md border border-white/10 px-3 py-2 text-white/85 hover:bg-white/10 sm:col-span-2"
          >
            Find similar spots nearby
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function PublicProfilePage() {
  const params = useParams<Record<string, string | undefined>>();
  const pathname =
    typeof window !== "undefined" ? window.location.pathname : "";
  const cleanBusinessRoute = useMemo(
    () => parseCleanAffiliateBusinessRoute(pathname),
    [pathname],
  );
  const inferredProfileType = (() => {
    if (pathname.startsWith("/truck/")) return "truck";
    if (pathname.startsWith("/bar/")) return "bar";
    if (pathname.startsWith("/location/")) return "location";
    if (pathname.startsWith("/supplier/")) return "supplier";
    if (pathname.startsWith("/restaurant/")) return "restaurant";
    return String(params.profileType || "").trim();
  })();
  const cleanBusinessSlug = cleanBusinessRoute?.businessSlug || null;
  const isCleanBusinessRoute = !inferredProfileType && Boolean(cleanBusinessSlug);
  const { data: cleanBusinessResolution, isLoading: cleanBusinessLoading } = useQuery<{
    entityType: "restaurant" | "truck" | "bar" | "location" | "supplier";
    id: string;
    businessSlug: string;
  }>({
    queryKey: ["/api/public/resolve-business", cleanBusinessSlug],
    enabled: Boolean(isCleanBusinessRoute && cleanBusinessSlug),
    queryFn: async () => {
      const res = await fetch(
        apiUrl(
          `/api/public/resolve-business/${encodeURIComponent(
            String(cleanBusinessSlug || ""),
          )}`,
        ),
      );
      if (!res.ok) throw new Error("Profile not found");
      return res.json();
    },
  });
  const rawProfileId = String(
    params.profileId || params.id || params.slug || cleanBusinessResolution?.id || "",
  ).trim();
  const resolvedProfileId = extractUuidFromSlug(rawProfileId) || rawProfileId;
  const normalizedProfileType = normalizePublicProfileEntity(
    inferredProfileType || cleanBusinessResolution?.entityType,
  );

  const locationSearch =
    typeof window !== "undefined" ? window.location.search : "";
  const { data, isLoading } = useQuery<PublicProfilePayload>({
    queryKey: ["/api/public/profiles", normalizedProfileType, resolvedProfileId, locationSearch],
    enabled: !!normalizedProfileType && !!resolvedProfileId,
    queryFn: async () => {
      const res = await fetch(apiUrl(`/api/public/profiles/${encodeURIComponent(String(normalizedProfileType || ""))}/${encodeURIComponent(String(resolvedProfileId || ""))}${locationSearch || ""}`),
      );
      if (!res.ok) throw new Error("Profile not found");
      return res.json();
    },
  });

  const safeCtas = useMemo(() => asSafeCtas(data?.cta), [data?.cta]);
  const sentViewRef = useRef<string>("");
  const querySource = useMemo(() => {
    if (typeof window === "undefined") return "public_profile";
    const params = new URLSearchParams(window.location.search);
    const raw = String(params.get("utm_source") || "").toLowerCase();
    if (raw.startsWith("discovery_")) return raw;
    return raw.includes("qr") ? "qr" : "public_profile";
  }, []);

  const trackProfileEvent = useCallback(
    (actionType: string, targetType?: string | null, href?: string | null) => {
      if (!data?.id || !data?.profileType) return;
      const hrefCategory = (() => {
        const raw = String(href || "").trim();
        if (!raw) return null;
        if (raw.startsWith("tel:")) return "phone";
        if (raw.includes("maps.google.com")) return "map";
        if (raw.includes("/menu/")) return "menu";
        if (raw.includes("doordash") || raw.includes("ubereats") || raw.includes("grubhub")) {
          return "delivery";
        }
        if (raw.startsWith("/")) return "internal";
        try {
          return new URL(raw).hostname.toLowerCase();
        } catch {
          return "external";
        }
      })();

      void fetch(apiUrl("/api/public/profile-analytics"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          profileEntity: data.profileType,
          profileId: data.id,
          actionType,
          targetType: targetType || null,
          targetHrefCategory: hrefCategory,
          source: querySource,
        }),
      }).catch(() => {});
    },
    [data?.id, data?.profileType, querySource],
  );

  useEffect(() => {
    if (!data?.id || !data?.profileType) return;
    const key = `${data.profileType}:${data.id}`;
    if (sentViewRef.current === key) return;
    sentViewRef.current = key;
    trackProfileEvent("profile_view", "page", window.location.pathname);
    if (querySource === "qr") {
      const params = new URLSearchParams(window.location.search);
      const qrType = String(params.get("type") || "").toLowerCase();
      if (qrType === "menu") trackProfileEvent("qr_menu_open", "qr", window.location.href);
      else if (qrType === "specials") trackProfileEvent("qr_specials_open", "qr", window.location.href);
      else trackProfileEvent("qr_profile_open", "qr", window.location.href);
    }
  }, [data?.id, data?.profileType, querySource, trackProfileEvent]);

  if (isLoading || cleanBusinessLoading) {
    return <div className="mx-auto max-w-4xl px-4 py-10">Loading profile...</div>;
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Profile not found</h1>
        <div className="mt-4">
          <Link href="/">
            <Button variant="outline">Back to home</Button>
          </Link>
        </div>
      </div>
    );
  }

  const title = data.seo?.seoTitle || `${data.displayName} on MealScout`;
  const description =
    data.seo?.seoDescription ||
    data.description ||
    "Find local food activity, menus, deals, and nearby places on MealScout.";
  const cleanProfilePath = cleanBusinessSlug
    ? buildCleanPublicBusinessPath(`/${cleanBusinessSlug}`)
    : null;
  const resolvedCleanBusinessPath =
    String((data as any)?.cleanBusinessPath || "").trim() || cleanProfilePath;

  useEffect(() => {
    const routeRef = String(cleanBusinessRoute?.affiliateTag || "").trim();
    if (!routeRef || !resolvedCleanBusinessPath) return;
    if (!isLikelyCleanAffiliateTagSegment(routeRef)) return;
    setAffiliateRef(routeRef);
  }, [cleanBusinessRoute?.affiliateTag, resolvedCleanBusinessPath]);
  const canonicalUrl =
    (resolvedCleanBusinessPath && typeof window !== "undefined"
      ? new URL(resolvedCleanBusinessPath, window.location.origin).toString()
      : null) ||
    data.seo?.canonicalUrl ||
    data.canonicalUrl;
  const citySlug = String((data as any).citySlug || "").trim() || null;
  const restaurantProfile = isRestaurantLikeEntity(data.entity)
    ? (data as PublicRestaurantProfile)
    : null;
  const ogImage =
    data.seo?.ogImageUrl ||
    (data.entity === "host"
      ? data.spotImageUrl ||
        data.coverImageUrl ||
        data.logoUrl ||
        (data as any).profileImageUrl ||
        (data as any).truckPhotoLogo
      : isRestaurantLikeEntity(data.entity)
        ? (data as any).coverImageUrl ||
          (data as any).logoUrl ||
          (data as any).profileImageUrl ||
          (data as any).truckPhotoLogo
        : data.logoUrl || (data as any).profileImageUrl) ||
    DEFAULT_IMAGE;

  return (
    <div className="min-h-screen bg-[#070605]">
      <SEOHead
        title={title}
        description={description}
        canonicalUrl={canonicalUrl}
        ogType="profile"
        ogImage={ogImage}
      />

      <header className="border-b border-white/10 bg-[#0b0908]/95">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-base font-semibold tracking-tight text-white">
            MealScout
          </Link>
          <div className="flex items-center gap-3 text-xs sm:text-sm">
            <Link href="/scout" className="text-white/75 hover:text-white">
              Find local food
            </Link>
            <Link href="/claim-truck" className="text-orange-200 hover:text-orange-100">
              Claim or update
            </Link>
          </div>
        </div>
      </header>

      <main
        className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:py-8"
        onClickCapture={(event) => {
          const target = event.target as HTMLElement | null;
          const anchor = target?.closest("a[data-analytics-action]") as HTMLAnchorElement | null;
          if (!anchor) return;
          const action = String(anchor.dataset.analyticsAction || "").trim();
          if (!action) return;
          trackProfileEvent(
            action,
            String(anchor.dataset.analyticsTargetType || "").trim() || null,
            anchor.getAttribute("href"),
          );
        }}
      >
        <HeroBlock profile={data} />
        <PublicProfileShareControls
          profile={data}
          sharePath={resolvedCleanBusinessPath}
          title={title}
          description={description}
          onShareAction={trackProfileEvent}
        />
        <QuickActionRow profile={data} safeCtas={safeCtas} />

        {data.entity === "host" ? (
          <>
            <LocationNowSection profile={data} />
            <LocationTruckOptionsSection profile={data} />
            <EventsSection profile={data} />
            <LocationMapSection profile={data} />
            <LocationAmenitiesSection profile={data} />
          </>
        ) : restaurantProfile ? (
          <>
            <MenuSection profile={restaurantProfile} safeCtas={safeCtas} />
            <RestaurantSchedule profile={restaurantProfile} />
            <DealsSection profile={restaurantProfile} />
            <RestaurantSignals profile={restaurantProfile} />
            <AboutFoodStyle profile={restaurantProfile} />
            <EventsSection profile={restaurantProfile} />
            <GalleryStrip profile={restaurantProfile} />
            <FeaturedBartendersSection profile={restaurantProfile} />
            <ProofSection profile={restaurantProfile} />
            <RestaurantSocial profile={restaurantProfile} safeCtas={safeCtas} />
          </>
        ) : (
          <Card className="border-white/10 bg-[#0f0d0b]">
            <CardHeader>
              <CardTitle className="text-xl text-white">Supplier profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-white/80">
              {data.description ? <p>{data.description}</p> : null}
              {typeof (data as any).metrics?.activeProductCount === "number" ? (
                <p>Active products: {(data as any).metrics.activeProductCount}</p>
              ) : null}
            </CardContent>
          </Card>
        )}
        <RelatedLocalDiscovery
          data={data}
          citySlug={citySlug}
          restaurantProfile={restaurantProfile}
        />
      </main>

      <footer className="mt-8 border-t border-white/10 bg-[#0b0908]">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-5 text-sm text-white/70 sm:flex-row sm:items-center sm:justify-between">
          <p>MealScout</p>
          <div className="flex items-center gap-4">
            <Link href="/scout" className="hover:text-white">
              Find local food
            </Link>
            <Link href="/claim-truck" className="hover:text-white">
              Business owner?
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
