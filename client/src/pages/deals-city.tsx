import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { apiUrl } from "@/lib/api";
import { SEOHead } from "@/components/seo-head";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BackHeader } from "@/components/back-header";
import { useAuth } from "@/hooks/useAuth";
import { Tag, Share2, MapPin, ChevronRight } from "lucide-react";

type DealRow = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  startDate?: string | null;
  endDate?: string | null;
  discountValue?: string | null;
  dealType?: string | null;
  dealPath: string;
  restaurant: {
    id: string;
    name: string;
    cuisineType?: string | null;
    city?: string | null;
    state?: string | null;
    entityPath: string;
  };
  updatedAt?: string | null;
};

type AffiliateTag = {
  tag: string;
  sharePath: string;
};

export default function DealsCityPage() {
  const params = useParams() as Record<string, string | undefined>;
  const citySlug = String(params.city || "").trim();
  const { user } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["deals-city", citySlug],
    enabled: Boolean(citySlug),
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/public/deals/city/${encodeURIComponent(citySlug)}`),
        { credentials: "include" },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.message || `Failed to load deals (status=${res.status})`);
      }
      return res.json() as any;
    },
    staleTime: 60_000,
  });

  const { data: affiliateTagData } = useQuery<AffiliateTag>({
    queryKey: ["affiliate-tag"],
    enabled: Boolean(user),
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/affiliate/tag"), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load affiliate tag");
      return res.json();
    },
    staleTime: 300_000,
  });

  const cityName = String(data?.city?.name || citySlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
  const state = String(data?.city?.state || "");
  const cityLabel = state ? `${cityName}, ${state}` : cityName;
  const totalDeals = Number(data?.totalDeals || 0);
  const title = `Deals in ${cityLabel} | MealScout`;
  const metaDescription = `Browse ${totalDeals > 0 ? totalDeals + " active" : ""} food deals in ${cityLabel}. Exclusive discounts from local food trucks and restaurants on MealScout.`;
  const canonicalUrl = data?.canonicalUrl || `https://www.mealscout.us/deals/${encodeURIComponent(citySlug)}`;

  const deals: DealRow[] = Array.isArray(data?.deals) ? data.deals : [];

  const faqEntries = [
    {
      q: `Are there food deals in ${cityName}?`,
      a: deals.length > 0
        ? `Yes! MealScout currently lists ${totalDeals} active deal${totalDeals !== 1 ? "s" : ""} in ${cityLabel} from local food trucks and restaurants. All deals are verified and expire automatically.`
        : `MealScout is actively adding deals in ${cityLabel}. Sign up free to get notified the moment deals go live near you.`,
    },
    {
      q: `How do I claim a deal in ${cityName}?`,
      a: `Create a free MealScout account, browse deals in ${cityLabel}, and tap "View deal" to get the offer code or redemption instructions directly from the business.`,
    },
    {
      q: `Do deals expire in ${cityName}?`,
      a: `Yes. Every deal on MealScout has a set end date. Expired deals are automatically removed so you only ever see current, active offers in ${cityLabel}.`,
    },
  ];

  const schemaData = useMemo(() => {
    const graph: any[] = [
      {
        "@type": "CollectionPage",
        name: `Food Deals in ${cityLabel}`,
        description: metaDescription,
        url: canonicalUrl,
      },
      {
        "@type": "FAQPage",
        mainEntity: faqEntries.map(({ q, a }) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
    ];
    if (deals.length > 0) {
      graph.push({
        "@type": "ItemList",
        name: `Deals in ${cityLabel}`,
        numberOfItems: deals.length,
        itemListElement: deals.map((d, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: d.title,
          url: `https://www.mealscout.us${d.dealPath}`,
        })),
      });
    }
    return { "@context": "https://schema.org", "@graph": graph };
  }, [deals, cityLabel, canonicalUrl, metaDescription]);

  return (
    <div className="min-h-screen bg-[var(--bg-layered)]">
      <SEOHead title={title} description={metaDescription} canonicalUrl={canonicalUrl} schemaData={schemaData} />

      <BackHeader title={`Deals · ${cityName}`} fallbackHref={`/food-trucks/${citySlug}`} icon={Tag} />

      <div className="max-w-3xl mx-auto px-4 pb-16 pt-4 space-y-6">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1 text-xs text-muted-foreground" aria-label="Breadcrumb">
          <Link href="/" className="hover:underline">Home</Link>
          <ChevronRight className="w-3 h-3" />
          <Link href="/search" className="hover:underline">Deals</Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground font-medium">{cityName}</span>
        </nav>

        {/* Hero heading */}
        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Tag className="w-5 h-5 text-primary" />
            Food Deals in {cityLabel}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isLoading
              ? "Loading deals…"
              : totalDeals > 0
                ? `${totalDeals} active deal${totalDeals !== 1 ? "s" : ""} from local trucks and restaurants. Verified and auto-removed when they expire.`
                : `No active deals in ${cityName} right now — check back soon or explore nearby restaurants.`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm" className="food-gradient-primary border-0">
              <Link href={`/food-trucks/${citySlug}`}>
                <MapPin className="w-3.5 h-3.5 mr-1" />
                Food trucks in {cityName}
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="border-[color:var(--border-subtle)]">
              <Link href="/search">Search all deals</Link>
            </Button>
          </div>
        </section>

        {/* Deal grid */}
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading deals…</div>
        ) : error ? (
          <div className="text-sm text-destructive py-4">
            {(error as any)?.message || "Failed to load deals."}
          </div>
        ) : deals.length === 0 ? (
          <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean text-center">
            <p className="text-sm text-muted-foreground">No active deals in {cityName} right now.</p>
            <Button asChild size="sm" variant="outline" className="mt-3 border-[color:var(--border-subtle)]">
              <Link href="/search">Browse all cities</Link>
            </Button>
          </section>
        ) : (
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              Active Deals in {cityName}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {deals.map((deal) => (
                <Card
                  key={deal.id}
                  className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean hover:shadow-clean-lg transition-shadow overflow-hidden"
                >
                  <CardContent className="p-4 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={deal.dealPath} className="font-semibold text-foreground hover:underline leading-snug">
                        {deal.title}
                      </Link>
                      {deal.discountValue ? (
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                          {deal.discountValue}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <Link href={deal.restaurant.entityPath} className="hover:underline font-medium">
                        {deal.restaurant.name}
                      </Link>
                      {deal.restaurant.cuisineType ? ` · ${deal.restaurant.cuisineType}` : ""}
                    </div>
                    {deal.description ? (
                      <p className="text-xs text-muted-foreground line-clamp-2">{deal.description}</p>
                    ) : null}
                    <div className="mt-1 flex gap-2">
                      <Button asChild size="sm" className="food-gradient-primary border-0 h-7 text-xs px-3">
                        <Link href={deal.dealPath}>View deal</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline" className="border-[color:var(--border-subtle)] h-7 text-xs px-3">
                        <Link href={deal.restaurant.entityPath}>Business</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* FAQ */}
        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h2 className="text-lg font-semibold text-foreground">Frequently Asked Questions</h2>
          <div className="mt-4 space-y-4">
            {faqEntries.map(({ q, a }) => (
              <div key={q}>
                <p className="text-sm font-semibold text-foreground">{q}</p>
                <p className="mt-1 text-sm text-muted-foreground">{a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Referral / Share section */}
        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Share2 className="w-4 h-4" />
            Share These Deals with Friends
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Know someone in {cityLabel} who loves saving on food? Share this page and earn credits when they join.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {affiliateTagData?.sharePath ? (
              <Button
                size="sm"
                className="food-gradient-primary border-0"
                onClick={() => {
                  const url = `${window.location.origin}/deals/${citySlug}?ref=${affiliateTagData.tag}`;
                  if (navigator.share) {
                    navigator.share({ title: `Food Deals in ${cityLabel} | MealScout`, url });
                  } else {
                    navigator.clipboard.writeText(url).then(() => alert("Link copied!"));
                  }
                }}
              >
                Share & Earn Credits
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="border-[color:var(--border-subtle)]"
                onClick={() => {
                  const url = `${window.location.origin}/deals/${citySlug}`;
                  if (navigator.share) {
                    navigator.share({ title: `Food Deals in ${cityLabel} | MealScout`, url });
                  } else {
                    navigator.clipboard.writeText(url).then(() => alert("Link copied!"));
                  }
                }}
              >
                Share this page
              </Button>
            )}
            {!user && (
              <Button asChild size="sm" variant="outline" className="border-[color:var(--border-subtle)]">
                <Link href="/signup">Sign up to earn credits</Link>
              </Button>
            )}
          </div>
        </section>

        {/* Continue Exploring */}
        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h2 className="text-lg font-semibold text-foreground">Continue Exploring</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Link href={`/food-trucks/${citySlug}`}>
              <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] hover:shadow-clean-lg transition-shadow">
                <CardContent className="p-4">
                  <div className="font-medium text-foreground">Food Trucks in {cityName}</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Browse all active food trucks and their locations in {cityLabel}.
                  </p>
                </CardContent>
              </Card>
            </Link>
            <Link href="/search">
              <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] hover:shadow-clean-lg transition-shadow">
                <CardContent className="p-4">
                  <div className="font-medium text-foreground">Search All Cities</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Explore deals and food trucks across every city on MealScout.
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </section>

      </div>
    </div>
  );
}

