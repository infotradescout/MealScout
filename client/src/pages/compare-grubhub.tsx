import { Link } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const rows = [
  {
    label: "Marketplace philosophy",
    mealscout: "Fair community-driven ranking for public local profiles.",
    legacy: "Traditional listing economics can prioritize paid marketplace positioning.",
  },
  {
    label: "Signals that matter",
    mealscout: "Recommendations, follows, favorites, active deals, location relevance.",
    legacy: "Ranking mix may include variables less visible to local operators.",
  },
  {
    label: "Small business outcomes",
    mealscout: "Encourages growth via reputation and consistency.",
    legacy: "Visibility may require more budget pressure for sustained placement.",
  },
  {
    label: "Discovery + ordering fit",
    mealscout: "Unified surface for profile trust, deal activity, and menu intent.",
    legacy: "Ordering-driven experience with less local trust transparency.",
  },
];

export default function CompareGrubhubPage() {
  return (
    <div className="page">
      <SEOHead
        title="MealScout vs Grubhub | Transparent Local Food Ranking"
        description="Compare MealScout and Grubhub. See how MealScout promotes local operators with trust signals instead of pay-to-top placement."
        canonicalUrl="https://www.mealscout.us/compare/grubhub"
      />
      <section className="section section--full border-b border-[color:var(--border-subtle)] py-6">
        <div className="content max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-text)]">
            Comparison
          </p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">
            MealScout vs Grubhub
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            MealScout ranks based on community trust and local fit, so small
            businesses are not forced into pay-to-play placement.
          </p>
        </div>
      </section>
      <section className="section section--full py-5">
        <div className="content max-w-4xl space-y-3">
          {rows.map((row) => (
            <Card key={row.label}>
              <CardContent className="p-4">
                <h2 className="text-sm font-semibold text-foreground">{row.label}</h2>
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">MealScout:</span>{" "}
                  {row.mealscout}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Grubhub model:</span>{" "}
                  {row.legacy}
                </p>
              </CardContent>
            </Card>
          ))}
          <div className="pt-2">
            <Link href="/compare">
              <Button variant="outline" size="sm">
                Back to all comparisons
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
