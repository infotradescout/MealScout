import { BarChart3, ExternalLink, MousePointerClick, Search } from "lucide-react";
import { Link } from "wouter";

import { SEOHead } from "@/components/seo-head";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ownerIntentSitemapPages } from "@/pages/food-truck-owner-intent";

const telemetryEvents = [
  "funnel_owner_intent_view",
  "funnel_owner_intent_tool_used",
  "funnel_owner_intent_cta_click",
  "funnel_signup_started",
  "funnel_signup_submitted",
  "funnel_activation_started",
];

const localVariants = [
  "/food-truck-opportunities/pensacola",
  "/food-truck-vendor-opportunities/pensacola",
  "/food-truck-catering-leads/pensacola",
  "/food-truck-booking-software/pensacola",
];

export default function AdminOwnerSeoPage() {
  return (
    <main className="min-h-screen bg-[var(--bg-layered)] px-4 py-8 text-[color:var(--text-primary)] sm:px-6">
      <SEOHead
        title="Owner SEO Cockpit | MealScout Admin"
        description="Internal MealScout owner-intent SEO cockpit."
        canonicalUrl="https://www.mealscout.us/admin/owner-seo"
        noIndex
      />

      <div className="mx-auto max-w-6xl space-y-6">
        <section className="flex flex-col gap-4 rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean-lg sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
              <Search className="h-3.5 w-3.5" />
              Owner acquisition
            </div>
            <h1 className="mt-3 text-3xl font-black">Food truck owner SEO cockpit</h1>
            <p className="mt-2 max-w-3xl text-sm text-[color:var(--text-secondary)]">
              Track the pages designed to catch owners searching for business tools, DoorDash alternatives, booking leads, social help, loyalty, websites, and local opportunities.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/sitemap">Public sitemap</Link>
          </Button>
        </section>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <Search className="h-5 w-5 text-[color:var(--accent-text)]" />
              <div className="mt-3 text-2xl font-black">{ownerIntentSitemapPages.length}</div>
              <p className="text-sm text-[color:var(--text-secondary)]">Owner-intent pages</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <ExternalLink className="h-5 w-5 text-[color:var(--accent-text)]" />
              <div className="mt-3 text-2xl font-black">{localVariants.length}</div>
              <p className="text-sm text-[color:var(--text-secondary)]">Pensacola local variants</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <MousePointerClick className="h-5 w-5 text-[color:var(--accent-text)]" />
              <div className="mt-3 text-2xl font-black">{telemetryEvents.length}</div>
              <p className="text-sm text-[color:var(--text-secondary)]">Funnel events to monitor</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <BarChart3 className="h-5 w-5 text-[color:var(--accent-text)]" />
              Pages to watch
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {ownerIntentSitemapPages.map((page) => (
              <Link key={page.href} href={page.href}>
                <div className="h-full rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4 transition hover:border-[color:var(--accent-text)]/40 hover:shadow-clean">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-sm font-black text-[color:var(--text-primary)]">
                      {page.title}
                    </h2>
                    <ExternalLink className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]" />
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[color:var(--text-secondary)]">
                    {page.description}
                  </p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Telemetry events</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {telemetryEvents.map((event) => (
              <Badge key={event} variant="outline">
                {event}
              </Badge>
            ))}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}