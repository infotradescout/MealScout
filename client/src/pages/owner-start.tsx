import {
  ArrowRight,
  CheckCircle2,
  MapPin,
  MenuSquare,
  Radio,
  Truck,
} from "lucide-react";
import { Link } from "wouter";

import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const ownerSteps = [
  "Create or sign in to your owner account",
  "Claim your existing food truck profile or create it",
  "Add a quick menu so diners know what to order",
  "Set today's serving location and go live on the map",
];

const ownerTools = [
  { label: "Go live on the map", icon: Radio },
  { label: "Update today's location", icon: MapPin },
  { label: "Add menu fast", icon: MenuSquare },
];

export default function OwnerStartPage() {
  return (
    <main className="min-h-screen bg-[var(--bg-layered)] px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-8 text-[color:var(--text-primary)] sm:px-6 sm:py-12">
      <SEOHead
        title="List Your Food Truck | Go Live on MealScout"
        description="Claim your food truck, add a quick menu, set today's serving location, and go live on the MealScout map."
        canonicalUrl="https://www.mealscout.us/owner/start"
      />

      <div className="mx-auto max-w-5xl space-y-6">
        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="space-y-5">
            <div className="inline-flex items-center rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-card)] px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
              Food truck owner setup
            </div>
            <div className="space-y-3">
              <h1 className="text-4xl font-black leading-tight sm:text-6xl">
                Get found today.
              </h1>
              <p className="max-w-2xl text-base font-medium leading-relaxed text-[color:var(--text-secondary)] sm:text-lg">
                Your first win is simple: claim your truck, add enough menu to
                be useful, set where you are serving, and show up live on the
                MealScout map.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/truck-onboarding?claim=1&flow=truck-owner">
                <Button size="lg" className="w-full gap-2 sm:w-auto">
                  Claim & go live
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/truck-onboarding?claim=1">
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full gap-2 sm:w-auto"
                >
                  Search for my truck
                </Button>
              </Link>
            </div>
          </div>

          <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
            <CardContent className="p-5 sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--accent-text)]/15 text-[color:var(--accent-text)]">
                  <Truck className="h-6 w-6" />
                </span>
                <div>
                  <h2 className="text-xl font-black">First live shift</h2>
                  <p className="text-sm text-[color:var(--text-secondary)]">
                    No admin maze. Just the steps that get you visible.
                  </p>
                </div>
              </div>
              <ol className="space-y-3">
                {ownerSteps.map((step) => (
                  <li key={step} className="flex gap-3 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-[color:var(--status-success)]" />
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          {ownerTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <div
                key={tool.label}
                className="rounded-xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean"
              >
                <Icon className="mb-3 h-5 w-5 text-[color:var(--accent-text)]" />
                <div className="text-sm font-black uppercase leading-tight">
                  {tool.label}
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
