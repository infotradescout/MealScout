import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MapPin, Phone, Globe, Store } from "lucide-react";
import { SEOHead } from "@/components/seo-head";

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
  imageUrl?: string | null;
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

const labelByEntity: Record<string, string> = {
  restaurant: "Restaurant Profile",
  host: "Host Profile",
  supplier: "Supplier Profile",
};

export default function PublicProfilePage() {
  const { profileType, profileId } = useParams<{
    profileType: string;
    profileId: string;
  }>();

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
  const galleryUrls = Array.isArray(profile.galleryUrls) ? profile.galleryUrls : [];
  const ctaLabel = profile.ctaLabel || (data.websiteUrl ? "Visit website" : "");
  const ctaUrl = profile.ctaUrl || data.websiteUrl || "";

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
    data.phone ? (
      <div className="flex items-center gap-2 text-sm">
        <Phone className="h-4 w-4 text-muted-foreground" />
        <span>{data.phone}</span>
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

  return (
    <div className={`mx-auto max-w-3xl px-4 py-8 ${fontClass}`}>
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
          {data.websiteUrl ? (
            <div className="flex items-center gap-2 text-sm">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <a
                href={data.websiteUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline"
              >
                {data.websiteUrl}
              </a>
            </div>
          ) : null}

          {renderedSections}

          <div className="border-t pt-4 text-xs text-muted-foreground">
            Permanent profile link: {data.canonicalUrl}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
