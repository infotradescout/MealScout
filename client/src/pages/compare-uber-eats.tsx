import { Link } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const rows = [
  {
    label: "Current scope",
    mealscout: "Local profiles, menus, discovery, and limited eligibility-gated ASAP pickup by card.",
    legacy: "A mature restaurant marketplace with pickup and courier delivery.",
  },
  {
    label: "Delivery",
    mealscout: "No native courier-delivery network is promised today.",
    legacy: "Courier delivery is a core customer capability.",
  },
  {
    label: "Pickup checkout",
    mealscout: "Available only for a claimed, verified, open, locatable merchant with priced available items and card-payout readiness.",
    legacy: "Ordering availability follows Uber Eats marketplace coverage.",
  },
  {
    label: "Honest comparison",
    mealscout: "An early local discovery product with a narrow pickup transaction path.",
    legacy: "MealScout does not currently match its marketplace breadth or delivery operations.",
  },
];

export default function CompareUberEatsPage() {
  return (
    <div className="page">
      <SEOHead
        title="MealScout vs Uber Eats | Discovery and Pickup Scope"
        description="MealScout is a local discovery product with limited verified pickup checkout, not an Uber Eats-scale delivery marketplace."
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
            This is a scope comparison, not a parity claim. MealScout does not
            currently match Uber Eats&apos; merchant coverage, ordering breadth,
            or courier-delivery operations.
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
