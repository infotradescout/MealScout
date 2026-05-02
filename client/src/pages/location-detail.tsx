import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { apiUrl } from "@/lib/api";
import { SEOHead } from "@/components/seo-head";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import PublicVideoGallery from "@/components/PublicVideoGallery";
import { extractUuidFromSlug } from "@/lib/seo-slug";
import { generatePlaceSchema } from "@/lib/schema-helpers";

type HostProfile = {
  entity: "host";
  id: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  imageUrl?: string | null;
  profilePath?: string | null;
  canonicalUrl?: string | null;
};

function minStartingPriceCents(event: any): number | null {
  const centsValues: number[] = [];
  for (const [key, raw] of Object.entries(event || {})) {
    if (!key.toLowerCase().endsWith("pricecents")) continue;
    const num = Number(raw);
    if (Number.isFinite(num) && num > 0) centsValues.push(Math.floor(num));
  }
  if (centsValues.length === 0) return null;
  return Math.min(...centsValues);
}

function formatMoney(cents?: number | null) {
  if (!Number.isFinite(cents) || !cents) return null;
  return `$${(Number(cents) / 100).toFixed(0)}`;
}

export default function LocationDetailPage() {
  const params = useParams() as Record<string, string | undefined>;
  const hostId = extractUuidFromSlug(params.slug);

  const { data: profile, isLoading: profileLoading, error: profileError } = useQuery({
    queryKey: ["public-profile", "host", hostId],
    enabled: Boolean(hostId),
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/public/profiles/host/${encodeURIComponent(String(hostId || ""))}`),
        { credentials: "include" },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.message || `Failed to load location (status=${res.status})`);
      }
      return (await res.json()) as HostProfile;
    },
    staleTime: 60_000,
  });

  const { data: parkingPassFeed, isLoading: passLoading } = useQuery({
    queryKey: ["/api/parking-pass", "location", hostId],
    enabled: Boolean(hostId),
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/parking-pass"), { credentials: "include" });
      if (!res.ok) return [];
      return (await res.json()) as any[];
    },
    staleTime: 30_000,
  });

  const upcoming = useMemo(() => {
    const rows = Array.isArray(parkingPassFeed) ? parkingPassFeed : [];
    const matches = rows.filter((row) => String(row?.host?.id || "") === String(hostId || ""));
    const uniqueByEventId = new Map<string, any>();
    for (const row of matches) {
      const id = String(row?.id || "").trim();
      if (!id) continue;
      const existing = uniqueByEventId.get(id);
      if (!existing) uniqueByEventId.set(id, row);
    }
    return Array.from(uniqueByEventId.values())
      .map((row) => {
        const price = formatMoney(minStartingPriceCents(row));
        const dateText = row?.date ? new Date(row.date).toLocaleDateString() : null;
        const timeText =
          row?.startTime && row?.endTime ? `${row.startTime}–${row.endTime}` : null;
        return {
          passId: String(row?.id || ""),
          name: String(row?.name || "Parking pass"),
          price,
          dateText,
          timeText,
        };
      })
      .sort((a, b) => String(a.dateText || "").localeCompare(String(b.dateText || "")));
  }, [parkingPassFeed, hostId]);

  const title = profile?.title ? `${profile.title} · Food truck location` : "Food truck location";
  const description =
    profile?.description ||
    "Book food truck parking pass slots at this location on MealScout.";

  const cityText = profile?.city ? String(profile.city) : "";
  const stateText = profile?.state ? String(profile.state) : "";
  const citySlug = useMemo(() => {
    // Best-effort: many city slugs already exist in /food-trucks/:citySlug.
    // If the profile city already matches a known slug, this will work; otherwise the link still helps discovery.
    return cityText
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");
  }, [cityText]);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={title}
        description={description}
        canonicalUrl={profile?.canonicalUrl || undefined}
        schemaData={
          profile?.id
            ? generatePlaceSchema({
                id: profile.id,
                name: profile.title,
                url: profile.canonicalUrl || undefined,
                address: profile.address || undefined,
                city: profile.city || undefined,
                state: profile.state || undefined,
              })
            : undefined
        }
      />

      <div className="max-w-4xl mx-auto px-4 py-10">
        {profileError ? (
          <div className="text-sm text-destructive">
            {(profileError as any)?.message || "Failed to load location."}
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-bold">
            {profileLoading ? "Loading..." : profile?.title || "Location"}
          </h1>
          <p className="text-muted-foreground">
            {profile?.address ? (
              <>
                {profile.address}
                {cityText ? `, ${cityText}` : ""}
                {stateText ? `, ${stateText}` : ""}
              </>
            ) : (
              <>
                {cityText || "City"} {stateText ? `, ${stateText}` : ""}
              </>
            )}
          </p>

          <div className="flex gap-2 flex-wrap items-center">
            <Button asChild>
              <a href="/parking-pass">Browse parking passes</a>
            </Button>
            {citySlug ? (
              <Button variant="outline" asChild>
                <a href={`/city/${encodeURIComponent(citySlug)}`}>Explore {cityText || "city"}</a>
              </Button>
            ) : null}
            {profile?.profilePath ? (
              <Button variant="outline" asChild>
                <a href={profile.profilePath}>Public profile</a>
              </Button>
            ) : null}
          </div>
        </div>

        {hostId ? (
          <div className="mt-8">
            <PublicVideoGallery
              ownerType="host"
              ownerId={String(hostId)}
              title="Host Videos"
              description={`Watch featured videos from ${profile?.title || "this location"}.`}
            />
          </div>
        ) : null}

        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle>
                {passLoading ? "Loading availability..." : "Upcoming parking pass slots"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {upcoming.length === 0 && !passLoading ? (
                <div className="text-sm text-muted-foreground">
                  No public-ready parking pass slots found yet for this location.
                </div>
              ) : null}

              <div className="flex flex-col gap-3">
                {upcoming.map((row) => (
                  <Card key={row.passId}>
                    <CardContent className="pt-5 flex flex-col gap-2">
                      <div className="font-semibold">{row.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {row.dateText ? row.dateText : ""}
                        {row.timeText ? ` · ${row.timeText}` : ""}
                        {row.price ? ` · From ${row.price}` : ""}
                      </div>
                      <div className="mt-2 flex gap-2 flex-wrap">
                        <Button asChild>
                          <a
                            href={`/parking-pass?pass=${encodeURIComponent(String(row.passId || ""))}`}
                          >
                            View & book
                          </a>
                        </Button>
                        {hostId ? (
                          <>
                            <Button variant="outline" asChild>
                              <a href={`/location/${encodeURIComponent(params.slug || "")}/food-trucks-now`}>
                                Trucks here now
                              </a>
                            </Button>
                            <Button variant="outline" asChild>
                              <a href={`/location/${encodeURIComponent(params.slug || "")}/food-trucks-tonight`}>
                                Trucks here tonight
                              </a>
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
