import { Link } from "wouter";
import {
  ArrowRight,
  CheckCircle2,
  MapPin,
  ShieldCheck,
  Store,
  Truck,
  UtensilsCrossed,
} from "lucide-react";
import Navigation from "@/components/navigation";
import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const launchPaths = [
  {
    title: "I own a food truck",
    description:
      "Find places to park, claim your truck, and turn open host locations into paid booking opportunities.",
    href: "/truck-onboarding",
    cta: "Start as a truck owner",
    icon: Truck,
  },
  {
    title: "I have a location",
    description:
      "List parking space at your bar, restaurant, lot, venue, church, office, or event location.",
    href: "/host-signup",
    cta: "Become a host",
    icon: Store,
  },
  {
    title: "I am looking for food",
    description:
      "Find live food trucks, local spots, nearby deals, and food options around you.",
    href: "/find-food",
    cta: "Find food nearby",
    icon: UtensilsCrossed,
  },
];

const trustPoints = [
  "One booking path for trucks and hosts",
  "Hosts control price, rules, schedule, and availability",
  "Public discovery is tied to real local activity",
];

export default function LaunchHome() {
  return (
    <>
      <SEOHead
        title="MealScout | Book Food Truck Parking, Host Food Trucks, Find Food Nearby"
        description="MealScout helps food trucks find places to park, helps hosts turn space into booking revenue, and helps people find food nearby."
        canonicalUrl="/"
      />
      <Navigation />

      <main className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] pb-24 lg:pb-8">
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[color:var(--accent-text)]/20 blur-3xl" />
            <div className="absolute -left-24 top-48 h-72 w-72 rounded-full bg-orange-500/10 blur-3xl" />
          </div>

          <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-16 pb-10 sm:pt-24 sm:pb-16">
            <div className="max-w-4xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-2 text-sm font-bold text-[color:var(--accent-text)] shadow-clean">
                <MapPin className="h-4 w-4" />
                Local food truck booking starts here
              </div>

              <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black leading-[0.95] tracking-tight text-[var(--text-primary)]">
                Book food truck parking. Host food trucks. Find food nearby.
              </h1>

              <p className="mt-6 max-w-2xl text-base sm:text-xl font-medium leading-relaxed text-[var(--text-secondary)]">
                MealScout connects food trucks with host locations that have usable space, then turns real activity into public food discovery for the community.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Link href="/truck-onboarding">
                  <Button className="h-12 w-full sm:w-auto rounded-full px-6 text-base font-bold shadow-clean-lg">
                    I own a food truck
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
                <Link href="/host-signup">
                  <Button
                    variant="outline"
                    className="h-12 w-full sm:w-auto rounded-full px-6 text-base font-bold"
                  >
                    I have a location
                  </Button>
                </Link>
                <Link href="/find-food">
                  <Button
                    variant="ghost"
                    className="h-12 w-full sm:w-auto rounded-full px-6 text-base font-bold"
                  >
                    Find food
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {launchPaths.map((path) => (
              <Card
                key={path.title}
                className="group border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg transition-all duration-200 hover:-translate-y-1 hover:border-[color:var(--accent-text)]/50"
              >
                <CardContent className="p-6">
                  <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--accent-text)]/10 text-[color:var(--accent-text)]">
                    <path.icon className="h-6 w-6" />
                  </div>
                  <h2 className="text-xl font-black text-[var(--text-primary)]">
                    {path.title}
                  </h2>
                  <p className="mt-3 min-h-[72px] text-sm leading-relaxed text-[var(--text-secondary)]">
                    {path.description}
                  </p>
                  <Link href={path.href}>
                    <Button className="mt-5 w-full rounded-full font-bold" variant="outline">
                      {path.cta}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-6">
            <Card className="border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
              <CardContent className="p-6 sm:p-8">
                <div className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-[color:var(--accent-text)]">
                  <ShieldCheck className="h-5 w-5" />
                  Launch focus
                </div>
                <h2 className="text-2xl sm:text-3xl font-black tracking-tight">
                  The first job is not more features. The first job is reliable bookings.
                </h2>
                <p className="mt-4 text-base leading-relaxed text-[var(--text-secondary)]">
                  MealScout is built around a simple local transaction: a truck needs a place to park, a host has usable space, and both sides need a clean path to confirm the opportunity.
                </p>
                <div className="mt-6 grid gap-3">
                  {trustPoints.map((point) => (
                    <div key={point} className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[color:var(--accent-text)]" />
                      <span className="text-sm font-semibold text-[var(--text-primary)]">
                        {point}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-clean-lg">
              <CardContent className="p-6 sm:p-8">
                <h2 className="text-2xl font-black tracking-tight">
                  Not sure where to start?
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
                  Pick the role that matches what you control today. Trucks bring demand. Hosts bring space. Customers bring discovery once activity is real.
                </p>
                <div className="mt-6 space-y-3">
                  <Link href="/truck-onboarding?claim=1">
                    <Button variant="outline" className="w-full justify-between rounded-full font-bold">
                      Claim a truck
                      <Truck className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Link href="/for-hosts">
                    <Button variant="outline" className="w-full justify-between rounded-full font-bold">
                      Learn about hosting
                      <Store className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Link href="/map">
                    <Button variant="outline" className="w-full justify-between rounded-full font-bold">
                      Open the map
                      <MapPin className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </main>
    </>
  );
}
