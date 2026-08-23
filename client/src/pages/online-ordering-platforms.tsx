import { Link } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Store, Truck, UtensilsCrossed } from "lucide-react";

const sections = [
  {
    icon: Store,
    title: "Restaurants",
    body: "Show a profile, menus, and active deals. Separately reviewed businesses can unlock ASAP pickup only after every checkout-readiness check passes.",
  },
  {
    icon: Truck,
    title: "Food Trucks",
    body: "Combine live truck discovery with pickup only while a verified current stop, menu, item availability, and card settlement are ready.",
  },
  {
    icon: UtensilsCrossed,
    title: "Bars & Local Spots",
    body: "Stay discoverable through a local profile; ordering is not implied unless the pickup checkout is visibly enabled.",
  },
];

export default function OnlineOrderingPlatformsPage() {
  return (
    <div className="page">
      <SEOHead
        title="Local Food Discovery and Eligible Pickup Ordering | MealScout"
        description="MealScout provides local profiles and menus, with ASAP card pickup only for businesses that pass current eligibility checks."
        canonicalUrl="https://www.mealscout.us/online-ordering-platforms"
      />

      <section className="section section--full border-b border-[color:var(--border-subtle)] py-6">
        <div className="content max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-text)]">
            Discovery with limited pickup ordering
          </p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">
            Local profiles first, verified pickup checkout where eligible
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            MealScout is not a delivery network. It supports discovery broadly
            and exposes ASAP card pickup only when a business is claimed,
            verified, open, showing priced available items, locatable, and ready
            for Stripe payouts.
          </p>
        </div>
      </section>

      <section className="section section--full py-5">
        <div className="content grid gap-3 md:grid-cols-3">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <Card key={section.title}>
                <CardContent className="p-4">
                  <Icon className="h-5 w-5 text-[color:var(--accent-text)]" />
                  <h2 className="mt-2 text-sm font-semibold text-foreground">
                    {section.title}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {section.body}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="section section--full border-y border-[color:var(--border-subtle)] py-5">
        <div className="content max-w-4xl">
          <h2 className="text-lg font-semibold text-foreground">
            What this product surface supports
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[
              "Public local business profiles",
              "Published menus with priced available items",
              "Discovery for restaurants, trucks, and bars",
              "Eligibility-gated ASAP pickup by card",
              "No native courier-delivery promise",
              "No cash, dine-in, or scheduled checkout promise",
            ].map((term) => (
              <p
                key={term}
                className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-3 text-xs text-muted-foreground"
              >
                {term}
              </p>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/delivery-app-alternatives">
              <Button size="sm" variant="outline">
                Understand the scope <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
            <Link href="/compare">
              <Button size="sm">Compare platforms</Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
