import { Link } from "wouter";
import {
  ArrowRight,
  CalendarDays,
  MapPin,
  PlaySquare,
  Search,
  Store,
  TicketPercent,
  Truck,
  UtensilsCrossed,
} from "lucide-react";
import Navigation from "@/components/navigation";
import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";

const foodActions = [
  {
    title: "Map",
    description: "Open nearby food",
    href: "/map",
    icon: MapPin,
  },
  {
    title: "Find food",
    description: "Browse local options",
    href: "/find-food",
    icon: UtensilsCrossed,
  },
  {
    title: "Deals",
    description: "See local specials",
    href: "/deals/featured",
    icon: TicketPercent,
  },
  {
    title: "Video",
    description: "Watch recommendations",
    href: "/video",
    icon: PlaySquare,
  },
];

const businessActions = [
  {
    title: "Food truck owner",
    description: "Claim your truck, add your profile, and get found.",
    href: "/truck-onboarding",
    cta: "Start",
    icon: Truck,
  },
  {
    title: "Host location",
    description: "List a spot where food trucks can serve.",
    href: "/host-signup",
    cta: "List space",
    icon: Store,
  },
  {
    title: "Event",
    description: "Bring food trucks to a public or private event.",
    href: "/event-signup",
    cta: "Plan event",
    icon: CalendarDays,
  },
];

export default function LaunchHome() {
  return (
    <>
      <SEOHead
        title="MealScout | Find Food Trucks, Deals, and Events Nearby"
        description="Find nearby food trucks, local deals, events, and video food recommendations with MealScout."
        canonicalUrl="/"
      />
      <Navigation />

      <main className="min-h-screen bg-[var(--bg-surface)] text-[var(--text-primary)] pb-24 lg:pb-8">
        <section className="relative min-h-[100svh] overflow-hidden bg-neutral-950 text-white lg:min-h-[calc(100vh_-_4rem)]">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: "url('/backgrounds/food-truck-day.jpg')",
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/58 to-black/88" />

          <div className="relative mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-center px-5 pb-[calc(var(--mobile-nav-height)_+_1rem)] pt-14 sm:px-6 lg:min-h-[calc(100vh_-_4rem)] lg:py-20">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/45 px-4 py-2 text-sm font-bold text-amber-300 backdrop-blur">
                <MapPin className="h-4 w-4" />
                Food nearby
              </div>

              <h1
                className="mt-5 max-w-[12ch] text-5xl font-black leading-[0.96] tracking-normal text-white sm:text-7xl"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                Find food nearby.
              </h1>

              <p className="mt-5 max-w-xl text-lg font-semibold leading-relaxed text-white/90 sm:text-xl">
                Food trucks, local deals, events, and video recommendations
                around you.
              </p>

              <div className="mt-7 grid gap-3 sm:flex">
                <Link href="/find-food">
                  <Button className="h-14 w-full rounded-full px-7 text-base font-black sm:w-auto">
                    Find food
                    <Search className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
                <Link href="/map">
                  <Button
                    variant="secondary"
                    className="h-14 w-full rounded-full bg-white/95 px-7 text-base font-black text-black hover:bg-white sm:w-auto"
                  >
                    Open map
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <Link href="/truck-onboarding">
                  <Button
                    variant="outline"
                    className="h-11 w-full rounded-full border-white/25 bg-black/35 px-4 text-sm font-black text-white hover:bg-black/55 hover:text-white"
                  >
                    <Truck className="mr-2 h-4 w-4" />I own a truck
                  </Button>
                </Link>
                <Link href="/host-signup">
                  <Button
                    variant="outline"
                    className="h-11 w-full rounded-full border-white/25 bg-black/35 px-4 text-sm font-black text-white hover:bg-black/55 hover:text-white"
                  >
                    <Store className="mr-2 h-4 w-4" />I have a location
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-6 sm:px-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {foodActions.map((action) => (
              <Link key={action.title} href={action.href}>
                <a className="block rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean transition hover:-translate-y-0.5 hover:border-[color:var(--accent-text)]/45">
                  <action.icon className="h-5 w-5 text-[color:var(--accent-text)]" />
                  <div className="mt-3 text-base font-black text-[var(--text-primary)]">
                    {action.title}
                  </div>
                  <div className="mt-1 text-xs font-semibold leading-snug text-[var(--text-secondary)]">
                    {action.description}
                  </div>
                </a>
              </Link>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-8 sm:px-6 sm:py-14">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-black text-[color:var(--accent-text)]">
                For operators
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-normal text-[var(--text-primary)] sm:text-3xl">
                Run the food side here too.
              </h2>
            </div>
            <Link href="/for-restaurants">
              <Button variant="outline" className="rounded-full font-bold">
                Business tools
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {businessActions.map((action) => (
              <Link key={action.title} href={action.href}>
                <a className="flex min-h-[132px] flex-col justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean transition hover:-translate-y-0.5 hover:border-[color:var(--accent-text)]/45">
                  <div>
                    <action.icon className="h-6 w-6 text-[color:var(--accent-text)]" />
                    <h3 className="mt-4 text-lg font-black text-[var(--text-primary)]">
                      {action.title}
                    </h3>
                    <p className="mt-2 text-sm font-medium leading-relaxed text-[var(--text-secondary)]">
                      {action.description}
                    </p>
                  </div>
                  <div className="mt-4 inline-flex items-center text-sm font-black text-[color:var(--accent-text)]">
                    {action.cta}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </div>
                </a>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
