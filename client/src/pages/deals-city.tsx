import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { apiUrl } from "@/lib/api";
import { SEOHead } from "@/components/seo-head";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CollectionLoadingState,
  CollectionState,
  ConsumerCollectionShell,
} from "@/components/consumer-collection-shell";
import { useAuth } from "@/hooks/useAuth";
import { resolveCanonicalShareUrl } from "@/lib/share";
import { Tag, Share2, ChevronRight } from "lucide-react";

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

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["deals-city", citySlug],
    enabled: Boolean(citySlug),
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/public/deals/city/${encodeURIComponent(citySlug)}`),
        { credentials: "include" },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(
          payload?.message || `Failed to load deals (status=${res.status})`,
        );
      }
      return res.json() as any;
    },
    staleTime: 60_000,
  });

  const { data: affiliateTagData } = useQuery<AffiliateTag>({
    queryKey: ["affiliate-tag"],
    enabled: Boolean(user),
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/affiliate/tag"), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load affiliate tag");
      return res.json();
    },
    staleTime: 300_000,
  });

  const cityName = String(
    data?.city?.name ||
      citySlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  );
  const state = String(data?.city?.state || "").toUpperCase();
  const cityLabel = state ? `${cityName}, ${state}` : cityName;
  const totalDeals = Number(data?.totalDeals || 0);
  const title = `Deals in ${cityLabel} | MealScout`;
  const metaDescription = `Browse ${totalDeals > 0 ? totalDeals + " active" : ""} food deals in ${cityLabel}. Exclusive discounts from local food trucks and restaurants on MealScout.`;
  const canonicalUrl =
    data?.canonicalUrl ||
    `https://www.mealscout.us/deals/${encodeURIComponent(citySlug)}`;

  const deals: DealRow[] = Array.isArray(data?.deals) ? data.deals : [];

  const faqEntries = [
    {
      q: `Are there food deals in ${cityName}?`,
      a:
        deals.length > 0
          ? `Yes! MealScout currently lists ${totalDeals} active deal${totalDeals !== 1 ? "s" : ""} in ${cityLabel} from local food trucks and restaurants. All deals are verified and expire automatically.`
          : `MealScout is actively adding deals in ${cityLabel}. Sign up free to hear when new deals go live.`,
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
    <ConsumerCollectionShell
      section="deals"
      title={`Deals in ${cityName}`}
      description={`Current food offers from businesses in ${cityLabel}.`}
      icon={Tag}
      countLabel={
        isLoading
          ? null
          : `${totalDeals} active ${totalDeals === 1 ? "deal" : "deals"}`
      }
    >
      <SEOHead
        title={title}
        description={metaDescription}
        canonicalUrl={canonicalUrl}
        schemaData={schemaData}
      />

      <div className="mx-auto max-w-3xl space-y-6">
        {/* Breadcrumb */}
        <nav
          className="flex items-center gap-1 text-xs text-muted-foreground"
          aria-label="Breadcrumb"
        >
          <Link href="/scout" className="hover:text-[#f4512c] hover:underline">
            Scout
          </Link>
          <ChevronRight className="w-3 h-3" />
          <Link href="/deals" className="hover:text-[#f4512c] hover:underline">
            Deals
          </Link>
          <ChevronRight className="w-3 h-3" />
          <span className="text-foreground font-medium">{cityName}</span>
        </nav>

        {/* Deal grid */}
        {isLoading ? (
          <CollectionLoadingState label={`Loading deals in ${cityName}`} />
        ) : error ? (
          <CollectionState
            icon={Tag}
            title="Deals are unavailable"
            description={(error as any)?.message || "We could not load this city right now."}
            onRetry={() => void refetch()}
          />
        ) : deals.length === 0 ? (
          <CollectionState
            icon={Tag}
            title={`No active deals in ${cityName}`}
            description="Scout local menus, schedules, and food businesses while new offers are being added."
            actionHref="/scout"
            actionLabel="Scout"
          />
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
                      <Link
                        href={deal.dealPath}
                        className="font-semibold text-foreground hover:underline leading-snug"
                      >
                        {deal.title}
                      </Link>
                      {deal.discountValue ? (
                        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                          {deal.discountValue}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <Link
                        href={deal.restaurant.entityPath}
                        className="hover:underline font-medium"
                      >
                        {deal.restaurant.name}
                      </Link>
                      {deal.restaurant.cuisineType
                        ? ` · ${deal.restaurant.cuisineType}`
                        : ""}
                    </div>
                    {deal.description ? (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {deal.description}
                      </p>
                    ) : null}
                    <div className="mt-1 flex gap-2">
                      <Button
                        asChild
                        size="sm"
                        className="food-gradient-primary border-0 h-7 text-xs px-3"
                      >
                        <Link href={deal.dealPath}>View deal</Link>
                      </Button>
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="border-[color:var(--border-subtle)] h-7 text-xs px-3"
                      >
                        <Link href={deal.restaurant.entityPath}>Business</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {!isLoading && !error ? (
          <>
            {/* FAQ */}
            <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean">
          <h2 className="text-lg font-semibold text-foreground">
            Frequently Asked Questions
          </h2>
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
            Know someone in {cityLabel} who loves saving on food? Share this
            page and earn credits when they join.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {affiliateTagData?.sharePath ? (
              <Button
                size="sm"
                className="food-gradient-primary border-0"
                onClick={async () => {
                  const url = await resolveCanonicalShareUrl(`/deals/${citySlug}`, {
                    fallbackRef: affiliateTagData.tag,
                  });
                  if (navigator.share) {
                    await navigator.share({
                      title: `Food Deals in ${cityLabel} | MealScout`,
                      url,
                    });
                  } else {
                    await navigator.clipboard.writeText(url);
                    alert("Link copied!");
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
                onClick={async () => {
                  const url = await resolveCanonicalShareUrl(`/deals/${citySlug}`);
                  if (navigator.share) {
                    await navigator.share({
                      title: `Food Deals in ${cityLabel} | MealScout`,
                      url,
                    });
                  } else {
                    await navigator.clipboard.writeText(url);
                    alert("Link copied!");
                  }
                }}
              >
                Share this page
              </Button>
            )}
            {!user && (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="border-[color:var(--border-subtle)]"
              >
                <Link href="/customer-signup">Sign up to earn credits</Link>
              </Button>
            )}
          </div>
            </section>
          </>
        ) : null}

        <div className="border-t border-[#683a1f]/10 pt-2 text-center">
          <Link
            href="/scout"
            className="inline-flex min-h-11 items-center rounded-full px-5 text-sm font-black text-[#f4512c] hover:bg-[#fff0e8]"
          >
            Scout
          </Link>
        </div>
      </div>
    </ConsumerCollectionShell>
  );
}
