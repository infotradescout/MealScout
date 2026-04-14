import { Link } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const rows = [
  {
    label: "Ranking inputs",
    mealscout: "Recommendations, follows, favorites, active deals, and local distance.",
    legacy: "Commercial and marketplace dynamics can outweigh local trust signals.",
  },
  {
    label: "Operator visibility",
    mealscout: "Designed so great local operators can rise without paid boosts.",
    legacy: "Sponsored visibility can shift discoverability toward larger spenders.",
  },
  {
    label: "Community-first discovery",
    mealscout: "Profiles are surfaced based on authentic customer behavior.",
    legacy: "Discovery is often optimized for platform-level throughput.",
  },
  {
    label: "Product direction",
    mealscout: "Local profiles + deals + online menus with transparent ranking philosophy.",
    legacy: "Ordering-first marketplace with broader ad and placement programs.",
  },
];

export default function CompareUberEatsPage() {
  return (
    <div className="page">
      <SEOHead
        title="MealScout vs Uber Eats | Local Trust-Based Discovery"
        description="Compare MealScout and Uber Eats. MealScout highlights small businesses through community trust and location relevance."
        canonicalUrl="https://www.mealscout.us/compare/uber-eats"
      />
      <section className="section section--full border-b border-[color:var(--border-subtle)] py-6">
        <div className="content max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-text)]">
            Comparison
          </p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">
            MealScout vs Uber Eats
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            MealScout keeps ranking tied to real local engagement instead of
            paid placement mechanics.
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
                  <span className="font-semibold text-foreground">Uber Eats model:</span>{" "}
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
