import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { useEffect, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MapPin,
  Phone,
  Globe,
  Store,
  Navigation,
  Share2,
  Sparkles,
  Clock3,
  ExternalLink,
  UtensilsCrossed,
} from "lucide-react";
import { SEOHead } from "@/components/seo-head";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

type PublicProfile = {
  entity: "restaurant" | "host" | "supplier";
  id: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  websiteUrl?: string | null;
  menuUrl?: string | null;
  orderUrl?: string | null;
  imageUrl?: string | null;
  businessHours?: Record<string, { open?: string; close?: string }> | null;
  canonicalUrl: string;
  profilePath: string;
  profileSettings?: {
    templatePreset?: "classic" | "story" | "bold" | "minimal";
    theme?: "sunset" | "slate" | "forest" | "amber";
    accentColor?: string;
    fontFamily?: "system" | "serif" | "display" | "mono";
    heroLayout?: "center" | "left" | "split";
    heroTitle?: string;
    heroSubtitle?: string;
    ctaLabel?: string;
    ctaUrl?: string;
    about?: string;
    highlights?: string[];
    featuredLinks?: Array<{ label: string; url: string }>;
    merchItems?: Array<{
      name: string;
      price?: string;
      buyUrl?: string;
      imageUrl?: string;
      description?: string;
    }>;
    galleryUrls?: string[];
    sectionOrder?: Array<
      "about" | "highlights" | "links" | "gallery" | "contact" | "location" | "metrics"
    >;
    showAddress?: boolean;
    showContact?: boolean;
    showHours?: boolean;
    hideProfileBadge?: boolean;
  };
  metrics?: {
    activeProductCount?: number;
  };
  social?: {
    instagramUrl?: string | null;
    facebookPageUrl?: string | null;
    xUrl?: string | null;
  };
};

type PublicCanonical = {
  machineReadiness: string;
  freshness: string;
  freshnessHours: number | null;
  updatedAt?: string | null;
  verified?: boolean;
  knowledgeGaps?: string[];
  sourceTruthStatements?: string[];
};

type PublicEvidence = {
  windowHours: number;
  externalPressure?: {
    crawlerHits?: number;
    humanPageHits?: number;
    topBots?: Array<{ label: string; count: number }>;
  };
  demand?: {
    matchingSearchQueries?: number;
    topQueries?: Array<{ query: string; count: number }>;
  };
  distribution?: {
    affiliateShares?: number;
    outboundSocialPosts?: number;
  };
};

type RestaurantEngagementState = {
  counts: {
    favorites: number;
    follows: number;
    likes: number;
    recommendations: number;
  };
  viewer: {
    isFavorited: boolean;
    isFollowing: boolean;
    isLiked: boolean;
    hasRecommended: boolean;
  };
};

type PublicDeal = {
  id: string;
  restaurantId?: string | null;
  title?: string | null;
  description?: string | null;
  dealType?: string | null;
  discountValue?: string | null;
  imageUrl?: string | null;
  isActive?: boolean | null;
};

const labelByEntity: Record<string, string> = {
  restaurant: "Restaurant Profile",
  host: "Host Profile",
  supplier: "Supplier Profile",
};

const dayOrder = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const dayLabel = (day: string) => day.charAt(0).toUpperCase() + day.slice(1, 3);

const formatBusinessHours = (
  hours?: Record<string, { open?: string; close?: string }> | null,
) => {
  if (!hours || typeof hours !== "object") return [];
  return dayOrder
    .map((day) => {
      const value = hours[day];
      if (!value?.open || !value?.close) return null;
      return `${dayLabel(day)} ${value.open}-${value.close}`;
    })
    .filter((value): value is string => Boolean(value));
};

const toSlug = (value: string | null | undefined) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);

const toExternalUrl = (value: string | null | undefined) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
};

export default function PublicProfilePage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { profileType, profileId, profileSlug } = useParams<{
    profileType: string;
    profileId: string;
    profileSlug?: string;
  }>();
  const isStaffOrAdmin =
    user?.userType === "staff" ||
    user?.userType === "admin" ||
    user?.userType === "super_admin";
  const [restaurantTab, setRestaurantTab] = useState<"overview" | "specials" | "merch">("overview");

  const { data, isLoading } = useQuery<PublicProfile>({
    queryKey: ["/api/public/profiles", profileType, profileId],
    enabled: !!profileType && !!profileId,
    queryFn: async () => {
      const res = await fetch(
        `/api/public/profiles/${encodeURIComponent(String(profileType || ""))}/${encodeURIComponent(String(profileId || ""))}`,
      );
      if (!res.ok) {
        throw new Error("Profile not found");
      }
      return res.json();
    },
  });

  const { data: canonical } = useQuery<PublicCanonical>({
    queryKey: ["/api/public/canonical", profileType, profileId],
    enabled:
      !!profileType &&
      !!profileId &&
      isStaffOrAdmin &&
      (profileType === "host" || profileType === "restaurant"),
    queryFn: async () => {
      const res = await fetch(
        `/api/public/canonical/${encodeURIComponent(String(profileType || ""))}/${encodeURIComponent(String(profileId || ""))}`,
      );
      if (!res.ok) {
        throw new Error("Canonical record not found");
      }
      return res.json();
    },
  });

  const { data: evidence } = useQuery<PublicEvidence>({
    queryKey: ["/api/public/evidence", profileType, profileId],
    enabled:
      !!profileType &&
      !!profileId &&
      isStaffOrAdmin &&
      (profileType === "host" || profileType === "restaurant"),
    queryFn: async () => {
      const res = await fetch(
        `/api/public/evidence/${encodeURIComponent(String(profileType || ""))}/${encodeURIComponent(String(profileId || ""))}`,
      );
      if (!res.ok) {
        throw new Error("Evidence not found");
      }
      return res.json();
    },
  });

  const isRestaurantProfile = data?.entity === "restaurant" && !!profileId;

  const { data: engagementState } = useQuery<RestaurantEngagementState>({
    queryKey: ["/api/restaurants", profileId, "engagement-state"],
    enabled: isRestaurantProfile,
    queryFn: async () => {
      const res = await fetch(
        `/api/restaurants/${encodeURIComponent(String(profileId || ""))}/engagement-state`,
        { credentials: "include" },
      );
      if (!res.ok) {
        throw new Error("Failed to fetch engagement state");
      }
      return res.json();
    },
  });

  const { data: featuredDeals = [] } = useQuery<PublicDeal[]>({
    queryKey: ["/api/deals/featured"],
    enabled: data?.entity === "restaurant",
    queryFn: async () => {
      const res = await fetch("/api/deals/featured");
      if (!res.ok) return [];
      const rows = await res.json();
      return Array.isArray(rows) ? rows : [];
    },
  });

  const runEngagementAction = async (
    type: "like" | "follow" | "favorite" | "recommend",
    method: "POST" | "DELETE" = "POST",
  ) => {
    if (!profileId) return;
    const res = await fetch(
      `/api/restaurants/${encodeURIComponent(String(profileId))}/${type}`,
      {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.message || `Failed to ${type}`);
    }
    return res.json().catch(() => ({ success: true }));
  };

  const invalidateEngagementState = () =>
    queryClient.invalidateQueries({
      queryKey: ["/api/restaurants", profileId, "engagement-state"],
    });

  const likeMutation = useMutation({
    mutationFn: () =>
      runEngagementAction(
        "like",
        engagementState?.viewer?.isLiked ? "DELETE" : "POST",
      ),
    onSuccess: invalidateEngagementState,
    onError: (error: any) => {
      toast({
        title: "Could not update like",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const followMutation = useMutation({
    mutationFn: () =>
      runEngagementAction(
        "follow",
        engagementState?.viewer?.isFollowing ? "DELETE" : "POST",
      ),
    onSuccess: invalidateEngagementState,
    onError: (error: any) => {
      toast({
        title: "Could not update follow",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: () =>
      runEngagementAction(
        "favorite",
        engagementState?.viewer?.isFavorited ? "DELETE" : "POST",
      ),
    onSuccess: invalidateEngagementState,
    onError: (error: any) => {
      toast({
        title: "Could not update favorite",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const recommendMutation = useMutation({
    mutationFn: () => runEngagementAction("recommend", "POST"),
    onSuccess: invalidateEngagementState,
    onError: (error: any) => {
      toast({
        title: "Could not submit recommendation",
        description: error?.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!profileType || !profileId || !data?.title) return;
    const expectedSlug = toSlug(data.title) || profileId;
    if (profileSlug === expectedSlug) return;
    const canonicalPath = `/p/${encodeURIComponent(profileType)}/${encodeURIComponent(profileId)}/${encodeURIComponent(expectedSlug)}`;
    setLocation(canonicalPath);
  }, [profileType, profileId, profileSlug, data?.title, setLocation]);

  if (isLoading) {
    return <div className="mx-auto max-w-3xl px-4 py-10">Loading profile...</div>;
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold">Profile not found</h1>
        <div className="mt-4">
          <Link href="/">
            <Button variant="outline">Back to home</Button>
          </Link>
        </div>
      </div>
    );
  }

  const locationLine = [data.address, data.city, data.state].filter(Boolean).join(", ");
  const profile = data.profileSettings || {};
  const presetDefaults =
    profile.templatePreset === "story"
      ? { theme: "forest", heroLayout: "split", fontFamily: "serif" }
      : profile.templatePreset === "bold"
        ? { theme: "amber", heroLayout: "center", fontFamily: "display" }
        : profile.templatePreset === "minimal"
          ? { theme: "slate", heroLayout: "left", fontFamily: "system" }
          : { theme: "sunset", heroLayout: "left", fontFamily: "system" };
  const heroTitle = profile.heroTitle || data.title;
  const heroSubtitle = profile.heroSubtitle || data.subtitle || data.description || "";
  const about = profile.about || data.description || "";
  const highlights = Array.isArray(profile.highlights) ? profile.highlights : [];
  const featuredLinks = Array.isArray(profile.featuredLinks) ? profile.featuredLinks : [];
  const merchItems = Array.isArray(profile.merchItems) ? profile.merchItems : [];
  const galleryUrls = Array.isArray(profile.galleryUrls) ? profile.galleryUrls : [];
  const businessHours = formatBusinessHours(data.businessHours);
  const ctaLabel = profile.ctaLabel || (data.websiteUrl ? "Visit website" : "");
  const ctaUrl = profile.ctaUrl || data.websiteUrl || "";
  const orderUrl = toExternalUrl((data as any).orderUrl);
  const menuUrl = toExternalUrl((data as any).menuUrl);
  const websiteUrl = toExternalUrl(data.websiteUrl);
  const phoneHref = data.phone ? `tel:${String(data.phone).replace(/\s+/g, "")}` : "";
  const conciergeEditPath = `/edit-restaurant/${encodeURIComponent(String(profileId || ""))}?src=concierge&focus=description`;
  const conciergeDealPath = `/deal-creation?restaurantId=${encodeURIComponent(String(profileId || ""))}&src=concierge`;
  const directionsUrl = locationLine
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationLine)}`
    : "";
  const socialLinks = [
    { label: "Instagram", url: toExternalUrl(data.social?.instagramUrl) },
    { label: "Facebook", url: toExternalUrl(data.social?.facebookPageUrl) },
    { label: "X", url: toExternalUrl(data.social?.xUrl) },
  ].filter((item) => item.url);
  const restaurantDeals = featuredDeals
    .filter(
      (deal) =>
        String(deal.restaurantId || "") === data.id && deal.isActive !== false,
    )
    .slice(0, 6);

  useEffect(() => {
    setRestaurantTab("overview");
  }, [data?.id]);

  const title = `${data.title} | ${labelByEntity[data.entity] || "Public Profile"} | MealScout`;
  const description =
    data.description ||
    `${data.title} on MealScout. View profile details, location info, and business links.`;

  const schemaData = {
    "@context": "https://schema.org",
    "@type":
      data.entity === "supplier"
        ? "Organization"
        : data.entity === "host"
          ? "LocalBusiness"
          : "Restaurant",
    name: data.title,
    description,
    url: data.canonicalUrl,
    telephone: data.phone || undefined,
    image: data.imageUrl || undefined,
    address: locationLine
      ? {
          "@type": "PostalAddress",
          streetAddress: data.address || undefined,
          addressLocality: data.city || undefined,
          addressRegion: data.state || undefined,
        }
      : undefined,
  };

  const resolvedTheme = profile.theme || presetDefaults.theme;
  const resolvedHeroLayout = profile.heroLayout || presetDefaults.heroLayout;
  const resolvedFontFamily = profile.fontFamily || presetDefaults.fontFamily;
  const themePalette =
    resolvedTheme === "forest"
      ? { bg: "from-emerald-900 to-emerald-700", panel: "bg-emerald-950/70", chip: "bg-emerald-400/20 text-emerald-100" }
      : resolvedTheme === "slate"
        ? { bg: "from-slate-900 to-slate-700", panel: "bg-slate-950/70", chip: "bg-slate-300/20 text-slate-100" }
        : resolvedTheme === "amber"
          ? { bg: "from-amber-900 to-amber-700", panel: "bg-amber-950/70", chip: "bg-amber-300/20 text-amber-100" }
          : { bg: "from-rose-900 to-orange-700", panel: "bg-rose-950/70", chip: "bg-rose-300/20 text-rose-100" };
  const accentStyle = profile.accentColor
    ? ({ borderColor: profile.accentColor, color: profile.accentColor } as any)
    : undefined;
  const fontClass =
    resolvedFontFamily === "serif"
      ? "font-serif"
      : resolvedFontFamily === "mono"
        ? "font-mono"
        : resolvedFontFamily === "display"
          ? "font-[Georgia]"
          : "font-sans";
  const heroLayoutClass =
    resolvedHeroLayout === "center"
      ? "text-center"
      : resolvedHeroLayout === "split"
        ? "grid gap-2 md:grid-cols-2 md:items-end"
        : "text-left";

  const sections = new Map<string, ReactNode>();
  sections.set("about", about ? <p className="text-base leading-relaxed">{about}</p> : null);
  sections.set(
    "location",
    locationLine ? (
      <div className="flex items-start gap-2 text-sm">
        <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <span>{locationLine}</span>
      </div>
    ) : null,
  );
  sections.set(
    "contact",
    data.phone || (profile.showHours !== false && businessHours.length > 0) ? (
      <div className="space-y-2 text-sm">
        {data.phone ? (
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-muted-foreground" />
            <span>{data.phone}</span>
          </div>
        ) : null}
        {profile.showHours !== false && businessHours.length > 0 ? (
          <div className="rounded-md border p-3 text-xs text-muted-foreground">
            <div className="mb-1 font-medium text-foreground">Hours</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {businessHours.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    ) : null,
  );
  sections.set(
    "metrics",
    data.entity === "supplier" && typeof data.metrics?.activeProductCount === "number" ? (
      <div className="text-sm text-muted-foreground">
        Active products: <span className="font-medium text-foreground">{data.metrics.activeProductCount}</span>
      </div>
    ) : null,
  );
  sections.set(
    "highlights",
    highlights.length > 0 ? (
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Highlights</h2>
        <div className="flex flex-wrap gap-2">
          {highlights.map((item, idx) => (
            <Badge key={`${item}-${idx}`} variant="outline" style={accentStyle}>
              {item}
            </Badge>
          ))}
        </div>
      </div>
    ) : null,
  );
  sections.set(
    "links",
    featuredLinks.length > 0 ? (
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Links</h2>
        <div className="grid gap-2">
          {featuredLinks.map((link, idx) => (
            <a
              key={`${link.url}-${idx}`}
              href={link.url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    ) : null,
  );
  sections.set(
    "gallery",
    galleryUrls.length > 0 ? (
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Gallery</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {galleryUrls.map((url, idx) => (
            <img
              key={`${url}-${idx}`}
              src={url}
              alt={`${data.title} gallery ${idx + 1}`}
              className="h-28 w-full rounded-md object-cover"
              loading="lazy"
            />
          ))}
        </div>
      </div>
    ) : null,
  );
  const defaultOrder = ["about", "location", "contact", "metrics", "highlights", "links", "gallery"];
  const order = Array.isArray(profile.sectionOrder) && profile.sectionOrder.length > 0
    ? profile.sectionOrder
    : defaultOrder;
  const renderedSections = order
    .map((key) => sections.get(key))
    .filter(Boolean);

  const handleAuthRequiredAction = (action: () => void) => {
    if (!user) {
      window.location.href = "/login";
      return;
    }
    action();
  };

  const handleShareProfile = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: data.title,
          text: `Check out ${data.title} on MealScout`,
          url: data.canonicalUrl,
        });
        return;
      }
      await navigator.clipboard.writeText(data.canonicalUrl);
      toast({
        title: "Profile link copied",
        description: "Share this page anywhere.",
      });
    } catch {
      // Ignore canceled share flow.
    }
  };

  const restaurantActionCards = [
    orderUrl
      ? { label: "Order Online", href: orderUrl, icon: UtensilsCrossed }
      : null,
    menuUrl
      ? { label: "View Menu", href: menuUrl, icon: Sparkles }
      : null,
    phoneHref ? { label: "Call", href: phoneHref, icon: Phone } : null,
    directionsUrl
      ? { label: "Directions", href: directionsUrl, icon: Navigation }
      : null,
  ].filter(Boolean) as Array<{ label: string; href: string; icon: any }>;

  return (
    <div
      className={`mx-auto max-w-3xl px-4 py-8 ${data.entity === "restaurant" ? "pb-28" : ""} ${fontClass}`}
    >
      <SEOHead
        title={title}
        description={description}
        canonicalUrl={data.canonicalUrl}
        ogType="profile"
        ogImage={data.imageUrl || "/og-default.jpg"}
        schemaData={schemaData}
      />

      <Card className="overflow-hidden">
        <div className={`bg-gradient-to-br ${themePalette.bg} p-8 text-white`}>
          <div className={`mb-3 flex items-center gap-2 ${profile.hideProfileBadge ? "hidden" : ""}`}>
            <Store className="h-5 w-5" />
            <Badge className={themePalette.chip}>{labelByEntity[data.entity] || "Public Profile"}</Badge>
          </div>
          <div className={heroLayoutClass}>
            <div>
              <h1 className="text-4xl font-bold tracking-tight">{heroTitle}</h1>
              {heroSubtitle ? (
                <p className="mt-2 max-w-2xl text-sm text-white/85">{heroSubtitle}</p>
              ) : null}

              {data.entity === "restaurant" ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  {orderUrl ? (
                    <a href={orderUrl} target="_blank" rel="noreferrer noopener">
                      <Button className="h-9 bg-emerald-600 text-white hover:bg-emerald-700">
                        Order Online
                      </Button>
                    </a>
                  ) : null}
                  {menuUrl ? (
                    <a href={menuUrl} target="_blank" rel="noreferrer noopener">
                      <Button className="h-9 bg-orange-600 text-white hover:bg-orange-700">
                        View Menu
                      </Button>
                    </a>
                  ) : null}
                  {phoneHref ? (
                    <a href={phoneHref}>
                      <Button
                        variant="outline"
                        className="h-9 border-white/40 bg-white/10 text-white hover:bg-white/20"
                      >
                        Call
                      </Button>
                    </a>
                  ) : null}
                  {websiteUrl ? (
                    <a href={websiteUrl} target="_blank" rel="noreferrer noopener">
                      <Button
                        variant="outline"
                        className="h-9 border-white/40 bg-white/10 text-white hover:bg-white/20"
                      >
                        Website
                      </Button>
                    </a>
                  ) : null}
                </div>
              ) : null}

              {data.entity === "restaurant" ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={engagementState?.viewer?.isLiked ? "default" : "outline"}
                    className="border-white/40 bg-white/10 text-white hover:bg-white/20"
                    onClick={() => handleAuthRequiredAction(() => likeMutation.mutate())}
                  >
                    {engagementState?.viewer?.isLiked ? "Liked" : "Like"} · {engagementState?.counts?.likes ?? 0}
                  </Button>
                  <Button
                    size="sm"
                    variant={engagementState?.viewer?.isFollowing ? "default" : "outline"}
                    className="border-white/40 bg-white/10 text-white hover:bg-white/20"
                    onClick={() =>
                      handleAuthRequiredAction(() => followMutation.mutate())
                    }
                  >
                    {engagementState?.viewer?.isFollowing ? "Following" : "Follow"} · {engagementState?.counts?.follows ?? 0}
                  </Button>
                  <Button
                    size="sm"
                    variant={engagementState?.viewer?.isFavorited ? "default" : "outline"}
                    className="border-white/40 bg-white/10 text-white hover:bg-white/20"
                    onClick={() =>
                      handleAuthRequiredAction(() => favoriteMutation.mutate())
                    }
                  >
                    {engagementState?.viewer?.isFavorited ? "Favorited" : "Favorite"} · {engagementState?.counts?.favorites ?? 0}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-white/40 bg-white/10 text-white hover:bg-white/20"
                    onClick={() =>
                      handleAuthRequiredAction(() => recommendMutation.mutate())
                    }
                  >
                    {engagementState?.viewer?.hasRecommended ? "Update Recommendation" : "Recommend"} · {engagementState?.counts?.recommendations ?? 0}
                  </Button>
                </div>
              ) : null}
            </div>
            {ctaLabel && ctaUrl ? (
              <div className={resolvedHeroLayout === "split" ? "md:justify-self-end" : "mt-5"}>
                <a
                  href={ctaUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center rounded-md border border-white/40 bg-white/10 px-4 py-2 text-sm font-medium backdrop-blur hover:bg-white/20"
                >
                  {ctaLabel}
                </a>
              </div>
            ) : null}
          </div>
        </div>

        <CardHeader>
          <CardTitle className="text-2xl">{data.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isStaffOrAdmin && data.entity === "restaurant" ? (
            <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface-muted)] p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Managed Profile Controls
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={conciergeEditPath as any}>
                  <Button size="sm" variant="outline">Manage Profile For Owner</Button>
                </Link>
                <Link href={conciergeDealPath as any}>
                  <Button size="sm" variant="outline">Manage Specials</Button>
                </Link>
              </div>
            </div>
          ) : null}

          {data.entity === "restaurant" && engagementState ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Likes</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{engagementState.counts.likes}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Follows</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{engagementState.counts.follows}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Favorites</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{engagementState.counts.favorites}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Recs</div>
                <div className="mt-1 text-xl font-semibold text-foreground">{engagementState.counts.recommendations}</div>
              </div>
            </div>
          ) : null}

          {data.entity === "restaurant" ? (
            <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-surface-muted)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Website Actions
                  </div>
                  <div className="text-sm font-semibold text-foreground">
                    Everything guests need, in one profile
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={handleShareProfile}>
                  <Share2 className="mr-1.5 h-3.5 w-3.5" />
                  Share
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {restaurantActionCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <a
                      key={card.label}
                      href={card.href}
                      target={card.href.startsWith("http") ? "_blank" : undefined}
                      rel={card.href.startsWith("http") ? "noreferrer noopener" : undefined}
                      className="rounded-lg border bg-[var(--bg-card)] px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span>{card.label}</span>
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          ) : null}

          {data.entity === "restaurant" ? (
            <div className="flex flex-wrap gap-2 rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-2">
              <Button
                size="sm"
                variant={restaurantTab === "overview" ? "default" : "ghost"}
                onClick={() => setRestaurantTab("overview")}
              >
                Overview
              </Button>
              <Button
                size="sm"
                variant={restaurantTab === "specials" ? "default" : "ghost"}
                onClick={() => setRestaurantTab("specials")}
              >
                Specials
              </Button>
              <Button
                size="sm"
                variant={restaurantTab === "merch" ? "default" : "ghost"}
                onClick={() => setRestaurantTab("merch")}
              >
                Merch
              </Button>
            </div>
          ) : null}

          {isStaffOrAdmin && canonical ? (
            <div className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Source of Truth
                  </div>
                  <div className="text-sm font-semibold">Canonical MealScout record</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{canonical.machineReadiness}</Badge>
                  <Badge variant="secondary">{canonical.freshness}</Badge>
                  {canonical.verified ? <Badge>verified</Badge> : null}
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  Updated{" "}
                  <span className="font-medium text-foreground">
                    {canonical.updatedAt
                      ? new Date(canonical.updatedAt).toLocaleString()
                      : "Unknown"}
                  </span>
                </div>
                <div>
                  Freshness window{" "}
                  <span className="font-medium text-foreground">
                    {canonical.freshnessHours != null
                      ? `${canonical.freshnessHours}h ago`
                      : "Unknown"}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {isStaffOrAdmin && evidence ? (
            <div className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    External Evidence
                  </div>
                  <div className="text-sm font-semibold">
                    Discovery and distribution signals
                  </div>
                </div>
                <Badge variant="outline">
                  {evidence.windowHours ? `${Math.round(evidence.windowHours / 24)}d window` : "window"}
                </Badge>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  Crawler hits{" "}
                  <span className="font-medium text-foreground">
                    {evidence.externalPressure?.crawlerHits ?? 0}
                  </span>
                </div>
                <div>
                  Search demand{" "}
                  <span className="font-medium text-foreground">
                    {evidence.demand?.matchingSearchQueries ?? 0}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {data.entity === "restaurant" ? (
            <div className="grid gap-6 lg:grid-cols-[1.65fr_1fr]">
              <div className="space-y-5">
                {about ? (
                  <div className="rounded-xl border p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      About
                    </div>
                    <p className="text-sm leading-relaxed text-foreground">{about}</p>
                  </div>
                ) : null}

                {restaurantTab === "specials" && restaurantDeals.length > 0 ? (
                  <div className="rounded-xl border p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-orange-500" />
                      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Current Specials
                      </h2>
                    </div>
                    <div className="space-y-3">
                      {restaurantDeals.map((deal) => (
                        <div key={deal.id} className="rounded-lg border p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-foreground">
                                {deal.title || "Special"}
                              </p>
                              {deal.description ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {deal.description}
                                </p>
                              ) : null}
                            </div>
                            {(deal.discountValue || deal.dealType) ? (
                              <Badge variant="secondary" className="shrink-0">
                                {deal.discountValue
                                  ? `${deal.discountValue}${deal.dealType === "percentage" ? "%" : ""}`
                                  : String(deal.dealType || "deal")}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {restaurantTab === "merch" ? (
                  <div className="rounded-xl border p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-emerald-500" />
                      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Merch Shop
                      </h2>
                    </div>
                    {merchItems.length > 0 ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {merchItems.map((item, idx) => (
                          <div key={`${item.name}-${idx}`} className="rounded-lg border p-3">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt={item.name}
                                className="mb-3 h-32 w-full rounded-md object-cover"
                                loading="lazy"
                              />
                            ) : null}
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-semibold text-foreground">
                                {item.name}
                              </p>
                              {item.price ? (
                                <Badge variant="secondary">{item.price}</Badge>
                              ) : null}
                            </div>
                            {item.description ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {item.description}
                              </p>
                            ) : null}
                            {item.buyUrl ? (
                              <a
                                href={item.buyUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="mt-3 inline-flex items-center text-xs font-medium text-primary underline"
                              >
                                Buy now
                              </a>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                        No merch listed yet. Restaurant owners can add merch items in Profile Settings.
                      </div>
                    )}
                  </div>
                ) : null}

                {restaurantTab === "overview" && highlights.length > 0 ? (
                  <div className="rounded-xl border p-4">
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Highlights
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {highlights.map((item, idx) => (
                        <Badge key={`${item}-${idx}`} variant="outline" style={accentStyle}>
                          {item}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}

                {restaurantTab === "overview" && galleryUrls.length > 0 ? (
                  <div className="rounded-xl border p-4">
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Gallery
                    </h2>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                      {galleryUrls.map((url, idx) => (
                        <img
                          key={`${url}-${idx}`}
                          src={url}
                          alt={`${data.title} gallery ${idx + 1}`}
                          className="h-32 w-full rounded-md object-cover"
                          loading="lazy"
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {restaurantTab === "overview" && featuredLinks.length > 0 ? (
                  <div className="rounded-xl border p-4">
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Useful Links
                    </h2>
                    <div className="grid gap-2">
                      {featuredLinks.map((link, idx) => (
                        <a
                          key={`${link.url}-${idx}`}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted"
                        >
                          <span>{link.label}</span>
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-4">
                {(locationLine || data.phone || businessHours.length > 0) ? (
                  <div className="rounded-xl border p-4">
                    <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Contact & Visit
                    </h2>
                    <div className="space-y-3 text-sm">
                      {locationLine ? (
                        <div className="flex items-start gap-2">
                          <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          <span>{locationLine}</span>
                        </div>
                      ) : null}
                      {data.phone ? (
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          <span>{data.phone}</span>
                        </div>
                      ) : null}
                      {businessHours.length > 0 ? (
                        <div className="rounded-md border p-3">
                          <div className="mb-1 inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                            <Clock3 className="h-3.5 w-3.5" />
                            Hours
                          </div>
                          <div className="space-y-1 text-xs text-muted-foreground">
                            {businessHours.map((item) => (
                              <div key={item}>{item}</div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {socialLinks.length > 0 ? (
                  <div className="rounded-xl border p-4">
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      Social
                    </h2>
                    <div className="grid gap-2">
                      {socialLinks.map((item) => (
                        <a
                          key={item.label}
                          href={item.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted"
                        >
                          <span>{item.label}</span>
                          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                {websiteUrl ? (
                  <div className="rounded-xl border p-4">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      External Website
                    </div>
                    <a
                      href={websiteUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-2 text-sm text-primary underline"
                    >
                      <Globe className="h-4 w-4" />
                      Visit external site
                    </a>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            renderedSections
          )}

          <div className="border-t pt-4 text-xs text-muted-foreground">
            Permanent profile link: {data.canonicalUrl}
          </div>
        </CardContent>
      </Card>

      {data.entity === "restaurant" ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-[hsl(var(--background))/0.96] p-3 backdrop-blur md:hidden">
          <div className="mx-auto grid max-w-3xl grid-cols-3 gap-2">
            <Button
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={!orderUrl}
              onClick={() => {
                if (orderUrl) window.open(orderUrl, "_blank", "noopener,noreferrer");
              }}
            >
              Order
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!menuUrl}
              onClick={() => {
                if (menuUrl) window.open(menuUrl, "_blank", "noopener,noreferrer");
              }}
            >
              Menu
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!phoneHref}
              onClick={() => {
                if (phoneHref) window.location.href = phoneHref;
              }}
            >
              Call
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
