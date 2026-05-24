import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { apiUrl } from "@/lib/api";
import { SEOHead } from "@/components/seo-head";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type LocationProfile = {
  id: string;
  displayName?: string;
  title?: string;
  canonicalUrl?: string | null;
  seo?: {
    canonicalUrl?: string | null;
    seoTitle?: string | null;
    seoDescription?: string | null;
    ogImageUrl?: string | null;
  };
  address?: string | null;
  city?: string | null;
  state?: string | null;
  addressPublicLabel?: string | null;
};

type DiscoveryPayload = {
  totalTrucks?: number;
  trucks?: Array<{
    id: string;
    name: string;
    cuisineType?: string | null;
    truckPath?: string;
  }>;
};

type ResolvePayload = {
  exists: boolean;
  canonicalUrl: string;
};

const toPathFromCanonical = (canonicalUrl?: string | null) => {
  const value = String(canonicalUrl || "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search || ""}${url.hash || ""}`;
  } catch {
    return value.startsWith("/") ? value : null;
  }
};

export default function LocationDetailPage() {
  const params = useParams() as Record<string, string | undefined>;
  const slug = String(params.slug || "").trim();
  const hostId = useMemo(() => {
    const match = slug.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    return match?.[0] || "";
  }, [slug]);

  const { data: resolveData } = useQuery<ResolvePayload>({
    queryKey: ["/api/public/resolve", "location", slug],
    enabled: Boolean(slug),
    queryFn: async () => {
      const res = await fetch(
        `/api/public/resolve/location/${encodeURIComponent(slug)}`,
      );
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
  });

  useEffect(() => {
    const target = toPathFromCanonical(resolveData?.canonicalUrl);
    if (!target || typeof window === "undefined") return;
    const current = `${window.location.pathname}${window.location.search || ""}`;
    if (target !== current) {
      window.location.replace(target);
    }
  }, [resolveData?.canonicalUrl]);

  const { data: profile } = useQuery<LocationProfile>({
    queryKey: ["public-profile", "location", hostId],
    enabled: Boolean(hostId),
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/public/profiles/location/${encodeURIComponent(hostId)}`),
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load location");
      return res.json();
    },
  });

  const { data: nowData, isLoading: nowLoading } = useQuery<DiscoveryPayload>({
    queryKey: ["/api/public/discovery/location", hostId, "now"],
    enabled: Boolean(hostId),
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/public/discovery/location/${encodeURIComponent(hostId)}/time/now`),
        { credentials: "include" },
      );
      if (!res.ok) return { totalTrucks: 0, trucks: [] };
      return res.json();
    },
  });

  const { data: tonightData, isLoading: tonightLoading } = useQuery<DiscoveryPayload>({
    queryKey: ["/api/public/discovery/location", hostId, "tonight"],
    enabled: Boolean(hostId),
    queryFn: async () => {
      const res = await fetch(
        apiUrl(
          `/api/public/discovery/location/${encodeURIComponent(hostId)}/time/tonight`,
        ),
        { credentials: "include" },
      );
      if (!res.ok) return { totalTrucks: 0, trucks: [] };
      return res.json();
    },
  });

  const title = profile?.seo?.seoTitle || profile?.title || "Location | MealScout";
  const description =
    profile?.seo?.seoDescription ||
    "See nearby food trucks and local activity for this location on MealScout.";
  const canonicalUrl =
    profile?.seo?.canonicalUrl || profile?.canonicalUrl || undefined;
  const ogImage = profile?.seo?.ogImageUrl || undefined;
  const locationLabel =
    profile?.addressPublicLabel ||
    [profile?.address, profile?.city, profile?.state].filter(Boolean).join(", ");

  const nowTrucks = Array.isArray(nowData?.trucks) ? nowData!.trucks! : [];
  const tonightTrucks = Array.isArray(tonightData?.trucks)
    ? tonightData!.trucks!
    : [];
  const upcoming = [...nowTrucks, ...tonightTrucks].filter(
    (truck, idx, arr) =>
      arr.findIndex((candidate) => String(candidate.id) === String(truck.id)) === idx,
  );

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={title}
        description={description}
        canonicalUrl={canonicalUrl}
        ogImage={ogImage}
      />
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1 className="text-3xl font-bold">{profile?.displayName || profile?.title || "Location"}</h1>
        {locationLabel ? (
          <p className="mt-2 text-sm text-muted-foreground">{locationLabel}</p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <a href={`/location/${encodeURIComponent(slug)}/food-trucks-now`}>Trucks now</a>
          </Button>
          <Button variant="outline" asChild>
            <a href={`/location/${encodeURIComponent(slug)}/food-trucks-tonight`}>
              Trucks tonight
            </a>
          </Button>
          <Link href="/">
            <Button variant="ghost">Back to home</Button>
          </Link>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Now</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {nowLoading ? "Loading..." : `${Number(nowData?.totalTrucks || 0)} trucks`}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tonight</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {tonightLoading
                ? "Loading..."
                : `${Number(tonightData?.totalTrucks || 0)} trucks`}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Upcoming</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {upcoming.length} truck{upcoming.length === 1 ? "" : "s"}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
