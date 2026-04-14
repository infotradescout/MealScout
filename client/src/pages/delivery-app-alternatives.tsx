import { Link } from "wouter";
import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ArrowRight } from "lucide-react";

const alternatives = [
  {
    title: "Alternative to DoorDash for local visibility",
    summary:
      "MealScout ranks by local recommendations, follows, favorites, active deals, and proximity.",
  },
  {
    title: "Alternative to Uber Eats for small operators",
    summary:
      "MealScout is built so smaller restaurants and trucks can rise through trust signals instead of paid placement.",
  },
  {
    title: "Alternative to Grubhub for community discovery",
    summary:
      "MealScout combines local profile discovery with active deals and online menu context.",
  },
];

const keywordBullets = [
  "food delivery app alternatives",
  "best doordash alternative",
  "uber eats alternative",
  "grubhub alternative",
  "food ordering platform for small restaurants",
  "local food delivery alternatives near me",
];

export default function DeliveryAppAlternativesPage() {
  return (
    <div className="page">
      <SEOHead
        title="Food Delivery App Alternatives | DoorDash, Uber Eats, Grubhub vs MealScout"
        description="Looking for alternatives to DoorDash, Uber Eats, or Grubhub? MealScout offers local-first discovery and online ordering with transparent, community-driven ranking."
        canonicalUrl="https://www.mealscout.us/delivery-app-alternatives"
      />

      <section className="section section--full border-b border-[color:var(--border-subtle)] py-6">
        <div className="content max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-text)]">
            Delivery & Ordering Alternatives
          </p>
          <h1 className="mt-2 text-2xl font-bold text-foreground">
            Alternatives to legacy delivery and online ordering apps
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            MealScout helps people discover nearby food trucks, restaurants, and
            bars while giving local operators a fair shot at visibility.
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
              "No paid top-slot bidding",
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
            Related searches this page is built for
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {keywordBullets.map((term) => (
              <span
                key={term}
                className="rounded-full border border-[color:var(--border-subtle)] px-2.5 py-1 text-xs text-muted-foreground"
              >
                {term}
              </span>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/compare">
              <Button size="sm" variant="outline">
                Full comparison hub <ArrowRight className="ml-1 h-3.5 w-3.5" />
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
