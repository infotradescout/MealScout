import { Link } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight, Scale, ShieldCheck, Users } from "lucide-react";

const cards = [
  {
    title: "MealScout vs DoorDash",
    href: "/compare/doordash",
    points: [
      "No pay-to-rank model",
      "Community trust signals drive visibility",
      "Stronger direct relationship with local operators",
    ],
  },
  {
    title: "MealScout vs Uber Eats",
    href: "/compare/uber-eats",
    points: [
      "Local-first discovery over ad placement",
      "Transparent profile ranking factors",
      "Built for small business sustainability",
    ],
  },
  {
    title: "MealScout vs Grubhub",
    href: "/compare/grubhub",
    points: [
      "Community engagement prioritized",
      "Profiles stay visible even without ad spend",
      "Deal and menu visibility in one experience",
    ],
  },
];

export default function ComparePage() {
  return (
    <div className="page">
      <SEOHead
        title="MealScout vs Legacy Delivery Apps | Fair Local Discovery"
        description="Compare MealScout with DoorDash, Uber Eats, and Grubhub. Learn how MealScout ranks food businesses by community trust and local relevance instead of paid placement."
        canonicalUrl="https://www.mealscout.us/compare"
      />

      <section className="section section--full border-b border-[color:var(--border-subtle)] py-6">
        <div className="content">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-text)]">
              Fair Ranking Philosophy
            </p>
            <h1 className="mt-2 text-2xl font-bold text-foreground">
              MealScout vs legacy delivery and ordering marketplaces
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              MealScout does not sell top placement. We rank public restaurant,
              bar, and truck profiles using community trust and local relevance.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-1">
                Recommendations
              </span>
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-1">
                Follows
              </span>
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-1">
                Favorites
              </span>
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-1">
                Active deals
              </span>
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-1">
                Nearby relevance
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--full py-5">
        <div className="content grid gap-3 md:grid-cols-3">
          {cards.map((card) => (
            <Card key={card.href} className="border border-[color:var(--border-subtle)]">
              <CardContent className="p-4">
                <h2 className="text-base font-semibold text-foreground">
                  {card.title}
                </h2>
                <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                  {card.points.map((point) => (
                    <p key={point}>{point}</p>
                  ))}
                </div>
                <div className="mt-3">
                  <Link href={card.href}>
                    <Button size="sm" variant="outline" className="w-full">
                      Read comparison <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="section section--full border-t border-[color:var(--border-subtle)] py-5">
        <div className="content grid gap-3 md:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <Scale className="h-5 w-5 text-[color:var(--accent-text)]" />
              <h3 className="mt-2 text-sm font-semibold">No pay-to-win ranking</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Visibility is earned through community trust and active value.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <Users className="h-5 w-5 text-[color:var(--accent-text)]" />
              <h3 className="mt-2 text-sm font-semibold">Local operator focus</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Small businesses can compete on quality and consistency, not ad budget.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <ShieldCheck className="h-5 w-5 text-[color:var(--accent-text)]" />
              <h3 className="mt-2 text-sm font-semibold">Transparent inputs</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Ranking factors are explicit and aligned with real customer intent.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
