import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import type {
  PublicCta,
  PublicLocationProfile,
  PublicRestaurantProfile,
  PublicSupplierProfile,
} from "@shared/publicProfiles";
import { SEOHead } from "@/components/seo-head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Clock3,
  ExternalLink,
  MapPin,
  MenuSquare,
  Phone,
  Route,
  Star,
  Truck,
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

const pickPrimaryCta = (profile: PublicProfilePayload, ctas: PublicCta[]) => {
  const nonSelfInternal = ctas.find(
    (cta) => cta.type === "internal" && cta.href !== profile.profilePath,
  );

  if (profile.entity === "restaurant") {
    return (
      ctas.find(
        (cta) =>
          cta.type === "menu" ||
          /menu/i.test(cta.label || "") ||
          /\/menu\//i.test(cta.href || ""),
      ) ||
      ctas.find((cta) => cta.type === "map") ||
      ctas.find((cta) => cta.type === "phone") ||
      ctas.find((cta) => cta.type === "external") ||
      nonSelfInternal ||
      null
    );
  }

  return (
    ctas.find((cta) => cta.type === "map") ||
    ctas.find((cta) => cta.type === "phone") ||
    ctas.find((cta) => cta.type === "external") ||
    nonSelfInternal ||
    null
  );
};

const locationLine = (profile: { addressPublicLabel?: string | null; city?: string | null; state?: string | null }) =>
  profile.addressPublicLabel ||
  [profile.city, profile.state].filter(Boolean).join(", ") ||
  null;

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
    target={ctaTarget(cta)}
    rel={ctaRel(cta)}
    className={
      variant === "default"
        ? "inline-flex items-center rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-black hover:bg-orange-400"
        : "inline-flex items-center rounded-md border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"
    }
  >
    {cta.label}
  </a>
);

function HeroBlock({ profile, safeCtas }: { profile: PublicProfilePayload; safeCtas: PublicCta[] }) {
  const filteredCtas = safeCtas.filter(
    (cta) =>
      !(cta.type === "internal" && cta.href === profile.profilePath) &&
      !/view details/i.test(cta.label || ""),
  );
  const primary = pickPrimaryCta(profile, filteredCtas);
  const secondary = filteredCtas.find((cta) => cta !== primary) || null;
  const heroImage =
    profile.entity === "host"
      ? profile.spotImageUrl || profile.coverImageUrl || profile.logoUrl || profile.imageUrl
      : profile.entity === "restaurant"
        ? profile.coverImageUrl || profile.logoUrl || profile.imageUrl
        : profile.logoUrl || profile.imageUrl;
  const initials = String(profile.displayName || "MS")
    .split(" ")
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f0d0b]">
      {heroImage ? (
        <div
          className="h-52 w-full bg-cover bg-center md:h-64"
          style={{
            backgroundImage: `linear-gradient(180deg, rgba(0,0,0,.16), rgba(0,0,0,.78)), url('${heroImage}')`,
          }}
        />
      ) : (
        <div className="relative h-52 w-full bg-[radial-gradient(circle_at_22%_24%,rgba(255,96,35,0.34),transparent_48%),linear-gradient(145deg,#1d100a_0%,#120d09_48%,#0d0a08_100%)] md:h-64">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-orange-300/35 bg-black/30 text-2xl font-black text-orange-100">
              {initials}
            </div>
          </div>
        </div>
      )}
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-orange-400/50 text-orange-200">
            {profile.profileType === "location"
              ? "Location"
              : profile.profileType === "truck"
                ? "Food Truck"
                : profile.profileType === "bar"
                  ? "Bar"
                  : profile.profileType === "supplier"
                    ? "Supplier"
                    : "Restaurant"}
          </Badge>
          {profile.entity === "restaurant" && profile.openStatus ? (
            <Badge variant="secondary">{profile.openStatus}</Badge>
          ) : null}
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">{profile.displayName}</h1>
        <p className="text-sm text-white/80">
          {profile.entity === "host"
            ? "Food trucks, pop-ups, and local eats here"
            : profile.entity === "restaurant"
              ? "Open near you, menu updates, and local favorites."
              : "Local supply and support for nearby food businesses."}
        </p>
        <div className="flex flex-wrap items-center gap-3 text-sm text-white/75">
          {locationLine(profile) ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {locationLine(profile)}
            </span>
          ) : null}
          {phoneLine(profile) ? (
            <span className="inline-flex items-center gap-1">
              <Phone className="h-4 w-4" />
              {phoneLine(profile)}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {primary ? renderCtaButton(primary, "default", "primary") : null}
          {secondary ? renderCtaButton(secondary, "outline", "secondary") : null}
        </div>
      </div>
    </section>
  );
}

function LocationNowSection({ profile }: { profile: PublicLocationProfile }) {
  const now = Number(profile.foodTrucksNow || 0);
  const tonight = Number(profile.foodTrucksTonight || 0);
  const upcoming = Number(profile.upcomingFoodTruckSlots || 0);
  const hasAny = now > 0 || tonight > 0 || upcoming > 0;

  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
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
      const res = await fetch(
        `/api/public/discovery/location/${encodeURIComponent(hostId)}/time/now`,
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
        const res = await fetch(
          `/api/public/discovery/location/${encodeURIComponent(hostId)}/time/tonight`,
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
              className="inline-flex items-center rounded-md bg-orange-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-orange-400"
            >
              View
            </a>
          ) : null}
          {locationLine(profile) ? (
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(String(locationLine(profile) || ""))}`}
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
  if (profile.openStatus) signals.push(profile.openStatus);
  if (profile.deals.totalActive > 0) signals.push("Deal today");
  if (profile.menuUrl || profile.featuredMenuItems.length > 0) signals.push("Menu available");
  if (profile.profileType === "truck" && profile.truckSchedule?.nextWindowLabel) {
    signals.push("Truck schedule available");
  }
  if (profile.recommendations.total > 0) signals.push("Local favorite");

  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Why go now</CardTitle>
      </CardHeader>
      <CardContent>
        {signals.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {signals.map((signal) => (
              <Badge key={signal} variant="secondary">
                {signal}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-white/75">Check today's location and hours before you go.</p>
        )}
      </CardContent>
    </Card>
  );
}

function RestaurantHighlights({ profile }: { profile: PublicRestaurantProfile }) {
  const metrics = [
    { label: "Deals", value: Number(profile.deals.totalActive || 0) },
    { label: "Recommendations", value: Number(profile.recommendations.total || 0) },
    { label: "Reviews", value: Number(profile.reviewSummary.count || 0) },
  ].filter((metric) => metric.value > 0);

  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Menu, deals, and highlights</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {profile.featuredMenuItems.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-white/90">Featured menu items</p>
            <div className="flex flex-wrap gap-2">
              {profile.featuredMenuItems.map((item) => (
                <Badge key={item} variant="outline" className="border-white/20 text-white/80">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        {metrics.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {metrics.map((metric) => (
              <div key={metric.label} className="rounded-lg border border-white/10 bg-black/20 p-3">
                <p className="text-xs uppercase tracking-wide text-white/60">{metric.label}</p>
                <p className="mt-1 text-2xl font-semibold text-white">{metric.value}</p>
              </div>
            ))}
          </div>
        ) : null}
        {profile.menuUrl ? (
          <a
            href={profile.menuUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-orange-300 hover:text-orange-200"
          >
            View menu <MenuSquare className="h-4 w-4" />
          </a>
        ) : null}
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

  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-white/90">Gallery</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2.5 overflow-x-auto pb-1">
          {images.map((image, idx) => (
            <img
              key={`${image.url}-${idx}`}
              src={image.url}
              alt={`${profile.displayName} ${idx + 1}`}
              loading="lazy"
              className="h-24 w-36 flex-none rounded-md object-cover"
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RestaurantSchedule({ profile }: { profile: PublicRestaurantProfile }) {
  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Hours and schedule</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-white/80">
        {profile.hours ? (
          <p className="inline-flex items-center gap-1">
            <Clock3 className="h-4 w-4" />
            {profile.hours}
          </p>
        ) : (
          <p>Hours will be posted soon.</p>
        )}
        {profile.profileType === "truck" && profile.truckSchedule ? (
          <p className="inline-flex items-center gap-1">
            <Truck className="h-4 w-4" />
            {profile.truckSchedule.nextWindowLabel || "Schedule available"}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RestaurantSocial({ profile, safeCtas }: { profile: PublicRestaurantProfile; safeCtas: PublicCta[] }) {
  const extraCtas = safeCtas.filter((cta) => cta.type !== "map").slice(0, 4);
  return (
    <Card className="border-white/10 bg-[#0f0d0b]">
      <CardHeader>
        <CardTitle className="text-xl text-white">Reviews, socials, and contact</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-white/80">
          <p className="inline-flex items-center gap-1">
            <Star className="h-4 w-4" />
            {profile.reviewSummary.count} reviews
            {typeof profile.reviewSummary.rating === "number"
              ? ` · ${profile.reviewSummary.rating.toFixed(1)} avg`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {extraCtas.map((cta, idx) => renderCtaButton(cta, "outline", `${cta.href}-${idx}`))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PublicProfilePage() {
  const { profileType, profileId } = useParams<{
    profileType: string;
    profileId: string;
  }>();

  const { data, isLoading } = useQuery<PublicProfilePayload>({
    queryKey: ["/api/public/profiles", profileType, profileId],
    enabled: !!profileType && !!profileId,
    queryFn: async () => {
      const res = await fetch(
        `/api/public/profiles/${encodeURIComponent(String(profileType || ""))}/${encodeURIComponent(String(profileId || ""))}`,
      );
      if (!res.ok) throw new Error("Profile not found");
      return res.json();
    },
  });

  const safeCtas = useMemo(() => asSafeCtas(data?.cta), [data?.cta]);

  if (isLoading) {
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
  const canonicalUrl = data.seo?.canonicalUrl || data.canonicalUrl;
  const ogImage =
    data.seo?.ogImageUrl ||
    (data.entity === "host"
      ? data.spotImageUrl || data.coverImageUrl || data.logoUrl
      : data.entity === "restaurant"
        ? data.coverImageUrl || data.logoUrl
        : data.logoUrl) ||
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

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <HeroBlock profile={data} safeCtas={safeCtas} />

        {data.entity === "host" ? (
          <>
            <LocationNowSection profile={data} />
            <LocationTruckOptionsSection profile={data} />
            <LocationMapSection profile={data} />
            <LocationAmenitiesSection profile={data} />
            <Card className="border-white/10 bg-[#0f0d0b]">
              <CardHeader>
                <CardTitle className="text-xl text-white">Local discovery</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-white/75">
                Nearby food activity and event links will appear here when available.
              </CardContent>
            </Card>
          </>
        ) : data.entity === "restaurant" ? (
          <>
            <RestaurantSignals profile={data} />
            <GalleryStrip profile={data} />
            {data.profileType === "truck" ? (
              <>
                <RestaurantSchedule profile={data} />
                <RestaurantHighlights profile={data} />
              </>
            ) : (
              <>
                <RestaurantHighlights profile={data} />
                <RestaurantSchedule profile={data} />
              </>
            )}
            <RestaurantSocial profile={data} safeCtas={safeCtas} />
          </>
        ) : (
          <Card className="border-white/10 bg-[#0f0d0b]">
            <CardHeader>
              <CardTitle className="text-xl text-white">Supplier profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-white/80">
              {data.description ? <p>{data.description}</p> : null}
              {typeof data.metrics?.activeProductCount === "number" ? (
                <p>Active products: {data.metrics.activeProductCount}</p>
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
