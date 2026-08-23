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
      "Early local profile and menu discovery",
      "Eligibility-gated ASAP pickup by card",
      "No native courier-delivery parity claim",
    ],
  },
  {
    title: "MealScout vs Uber Eats",
    href: "/compare/uber-eats",
    points: [
      "Early local profile and menu discovery",
      "Eligibility-gated ASAP pickup by card",
      "No marketplace-breadth parity claim",
    ],
  },
  {
    title: "MealScout vs Grubhub",
    href: "/compare/grubhub",
    points: [
      "Early local profile and menu discovery",
      "Eligibility-gated ASAP pickup by card",
      "No marketplace-breadth parity claim",
    ],
  },
];

export default function ComparePage() {
  return (
    <div className="page">
      <SEOHead
        title="MealScout and Delivery Marketplaces | An Honest Scope Comparison"
        description="MealScout is an early local discovery product with limited eligible pickup checkout, not a replacement for mature delivery marketplaces."
        canonicalUrl="https://www.mealscout.us/compare"
      />

      <section className="section section--full border-b border-[color:var(--border-subtle)] py-6">
        <div className="content">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-text)]">
              Honest product scope
            </p>
            <h1 className="mt-2 text-2xl font-bold text-foreground">
              MealScout alongside mature delivery marketplaces
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              MealScout supports local profiles, menus, and discovery. It does
              not currently match the merchant coverage, ordering breadth, or
              courier operations of DoorDash, Uber Eats, or Grubhub.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-1">
                Public profiles
              </span>
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-1">
                Menus
              </span>
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-1">
                Local discovery
              </span>
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-1">
                Eligible pickup
              </span>
              <span className="rounded-full border border-[color:var(--border-subtle)] px-2 py-1">
                No delivery network
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
              <h3 className="mt-2 text-sm font-semibold">Discovery scope</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Browse local profiles, menus, and available business context.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <Users className="h-5 w-5 text-[color:var(--accent-text)]" />
              <h3 className="mt-2 text-sm font-semibold">Limited pickup scope</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                ASAP card pickup appears only after current eligibility checks pass.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <ShieldCheck className="h-5 w-5 text-[color:var(--accent-text)]" />
              <h3 className="mt-2 text-sm font-semibold">No parity claim</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                MealScout does not operate a native courier-delivery network today.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
