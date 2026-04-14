import { Link } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const rows = [
  {
    label: "Top placement logic",
    mealscout: "Ranked by recommendations, follows, favorites, active deals, and location.",
    legacy: "Sponsored and paid placement can strongly influence visibility.",
  },
  {
    label: "Small business competitiveness",
    mealscout: "Can compete through local trust and consistency without bidding for placement.",
    legacy: "Operators with larger budgets can often outspend smaller competitors.",
  },
  {
    label: "Community signal usage",
    mealscout: "Community actions directly improve profile visibility.",
    legacy: "Engagement exists, but ranking is often mixed with ad economics.",
  },
  {
    label: "Discovery experience",
    mealscout: "Public profiles plus active deals and online menu context on one surface.",
    legacy: "Primarily transaction-focused listing and ordering flow.",
  },
];

export default function CompareDoorDashPage() {
  return (
    <div className="page">
      <SEOHead
        title="MealScout vs DoorDash | Fair Local Ranking for Restaurants and Trucks"
        description="Compare MealScout and DoorDash. MealScout prioritizes trust-based local ranking instead of paid placement."
        canonicalUrl="https://www.mealscout.us/compare/doordash"
      />
      <section className="section section--full border-b border-[color:var(--border-subtle)] py-6">
        <div className="content max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-text)]">
            Comparison
          </p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">
            MealScout vs DoorDash
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            MealScout is designed to avoid nickel-and-diming small businesses.
            Ranking is community-first and location-aware, not ad-budget-first.
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
                  <span className="font-semibold text-foreground">DoorDash model:</span>{" "}
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
