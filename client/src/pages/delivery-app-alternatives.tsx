import { Link } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ArrowRight } from "lucide-react";

const alternatives = [
  {
    title: "Discovery before delivery checkout",
    summary:
      "Use MealScout to find local profiles, menus, deals, and community signals before choosing how to order.",
  },
  {
    title: "A profile surface for small operators",
    summary:
      "Restaurants and food trucks can publish a local profile without MealScout claiming to provide a citywide courier network.",
  },
  {
    title: "Limited verified pickup checkout",
    summary:
      "ASAP pickup by card appears only when a claimed business, live menu, hours, item availability, pickup location, and payout account all pass current checks.",
  },
];

export default function DeliveryAppAlternativesPage() {
  return (
    <div className="page">
      <SEOHead
        title="Local Food Discovery Beyond Delivery Apps | MealScout"
        description="MealScout supports local food discovery and limited eligibility-gated pickup ordering. It is not a DoorDash-scale delivery network."
        canonicalUrl="https://www.mealscout.us/delivery-app-alternatives"
      />

      <section className="section section--full border-b border-[color:var(--border-subtle)] py-6">
        <div className="content max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-text)]">
            Discovery beyond delivery apps
          </p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">
            Find local food first; choose an available ordering path second
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            MealScout helps people discover nearby food trucks, restaurants, and
            bars. It does not currently provide a DoorDash-scale delivery
            network. Eligible businesses may offer verified ASAP pickup by card.
          </p>
        </div>
      </section>

      <section className="section section--full py-5">
        <div className="content grid gap-3 md:grid-cols-3">
          {alternatives.map((item) => (
            <Card key={item.title}>
              <CardContent className="p-4">
                <h2 className="text-sm font-semibold text-foreground">
                  {item.title}
                </h2>
                <p className="mt-2 text-xs text-muted-foreground">
                  {item.summary}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="section section--full border-y border-[color:var(--border-subtle)] py-5">
        <div className="content max-w-4xl">
          <h2 className="text-lg font-semibold text-foreground">
            What MealScout prioritizes in ranking
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[
              "Recommendations from real users",
              "Follows and favorites",
              "Active deals and menu activity",
              "Location relevance",
              "Placement rules are not promised to be neutral or ad-free",
            ].map((point) => (
              <div
                key={point}
                className="flex items-start gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-[color:var(--status-success)]" />
                <p className="text-xs text-foreground">{point}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--full py-5">
        <div className="content max-w-4xl">
          <h2 className="text-lg font-semibold text-foreground">
            Start with what is actually available
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Browse local profiles and menus. An order button appears only for a
            business that passes MealScout&apos;s current pickup and card checks.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/compare">
              <Button size="sm" variant="outline">
                Compare discovery models <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
            <Link href="/search">
              <Button size="sm">Find food near you</Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
