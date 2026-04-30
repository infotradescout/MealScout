import { Link } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Store, Truck, UtensilsCrossed } from "lucide-react";

const sections = [
  {
    icon: Store,
    title: "Restaurants",
    body: "Show your profile, menus, and active deals in a discovery-first local feed.",
  },
  {
    icon: Truck,
    title: "Food Trucks",
    body: "Combine live truck discovery, profile trust signals, and ordering intent.",
  },
  {
    icon: UtensilsCrossed,
    title: "Bars & Local Spots",
    body: "Stay visible through follows, favorites, recommendations, and real local demand.",
  },
];

export default function OnlineOrderingPlatformsPage() {
  return (
    <div className="page">
      <SEOHead
        title="Online Ordering Platform for Restaurants, Trucks, and Bars | MealScout"
        description="MealScout is a local-first online ordering and food discovery platform for restaurants, food trucks, and bars."
        canonicalUrl="https://www.mealscout.us/online-ordering-platforms"
      />

      <section className="section section--full border-b border-[color:var(--border-subtle)] py-6">
        <div className="content max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-text)]">
            Online Ordering Platform
          </p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">
            Local online ordering built for real food businesses
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            MealScout is an online ordering and food discovery platform focused
            on local trust, not pay-to-rank placement.
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
            Common food-intent searches this supports
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {[
              "online ordering platform for restaurants",
              "food ordering app for small business",
              "restaurant online ordering software alternatives",
              "food truck ordering platform",
              "best food apps near me",
          "local food pickup apps",
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
            <Link href="/doordash-alternative-for-food-trucks">
              <Button size="sm" variant="outline">DoorDash alternative for trucks</Button>
            </Link>
            <Link href="/food-truck-online-ordering">
              <Button size="sm" variant="outline">Food truck ordering</Button>
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
