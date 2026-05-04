import { useEffect, useMemo } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  MapPin,
  MenuSquare,
  Radio,
  ShieldCheck,
  ShoppingBag,
  Truck,
  Users,
} from "lucide-react";

import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getLoginUrl } from "@/const";
import { useAuth } from "@/hooks/useAuth";
import { trackMetaEvent } from "@/lib/meta-pixel";
import {
  FUNNEL_EVENTS,
  trackFunnelEvent,
  trackFunnelEventOncePerSession,
} from "@/utils/funnelTelemetry";

const rawSignupHref = "/truck-onboarding?claim=1&flow=truck-owner";

const ownerOutcomes = [
  {
    title: "Host-posted opportunities",
    body: "Hosts and organizers post date, time, location, crowd size, and notes so you can decide fast.",
    icon: ClipboardList,
    image: "/backgrounds/food-truck-day.jpg",
  },
  {
    title: "Menu and pickup orders",
    body: "Keep the current menu online and point regulars to direct pickup ordering when you are ready.",
    icon: MenuSquare,
    image: "/backgrounds/night-market-plate.webp",
  },
  {
    title: "Schedule and live status",
    body: "Publish weekly stops, service windows, and live location while your window is open.",
    icon: ShoppingBag,
    image: "/backgrounds/food-truck-night.jpg",
  },
  {
    title: "Service area profile",
    body: "Show city, cuisine, contact, parking needs, and the details hosts need before booking.",
    icon: CalendarDays,
    image: "/backgrounds/food-truck-day.jpg",
  },
  {
    title: "Promotion link",
    body: "Use one link in Facebook, Instagram, QR codes, flyers, and event pitches.",
    icon: Radio,
    image: "/backgrounds/food-truck-night.jpg",
  },
  {
    title: "Setup checklist",
    body: "See what is missing before sending hosts or customers to your truck profile.",
    icon: BarChart3,
    image: "/backgrounds/night-market-plate.webp",
  },
];

const ownerUseCases = [
  {
    title: "Turn scattered DMs into clear leads",
    body: "Give offices, lots, breweries, schools, and event organizers one place to post the terms trucks need.",
    label: "Events",
    icon: Users,
    image: "/backgrounds/food-truck-night.jpg",
  },
  {
    title: "Keep menu and stops current",
    body: "Update your profile once, then use the same link everywhere you promote the truck.",
    label: "Menu",
    icon: MenuSquare,
    image: "/backgrounds/night-market-plate.webp",
  },
  {
    title: "Start with a real owner claim",
    body: "Create or claim the truck before adding ordering, schedules, and paid tools.",
    label: "Claim",
    icon: Truck,
    image: "/backgrounds/food-truck-day.jpg",
  },
];

const setupSteps = [
  {
    title: "Claim or create your truck",
    body: "Attach the profile to the owner account that will manage menu, schedule, and booking leads.",
    image: "/backgrounds/food-truck-day.jpg",
  },
  {
    title: "Add the details hosts check",
    body: "Cuisine, city, service area, phone, menu, photos, booking notes, and service windows.",
    image: "/backgrounds/night-market-plate.webp",
  },
  {
    title: "Publish the link",
    body: "Use the profile in social bios, ads, event pitches, QR codes, and customer messages.",
    image: "/backgrounds/food-truck-night.jpg",
  },
];

const faqItems = [
  {
    question: "Can I start without paying?",
    answer:
      "Yes. Start by creating or claiming the truck profile. Paid tools can come after the profile is useful.",
  },
  {
    question: "Do I need online ordering ready first?",
    answer:
      "No. You can launch with profile details, menu, schedule, and host-posted opportunities before turning on pickup ordering.",
  },
  {
    question: "Does this replace my social pages?",
    answer:
      "No. MealScout gives those pages a stable link for menu, stops, bookings, and ordering.",
  },
];

const schemaData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "MealScout Food Truck Owner Tools",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Food truck owner tools for profile claims, menus, schedules, host-posted opportunities, live location, and direct pickup ordering.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "Free food truck profile creation with optional paid owner tools.",
      },
    },
    {
      "@type": "FAQPage",
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    },
  ],
};

const appendCurrentAttribution = (
  href: string,
  extraParams: Record<string, string>,
) => {
  if (typeof window === "undefined") return href;

  const url = new URL(href, window.location.origin);
  const currentParams = new URLSearchParams(window.location.search);

  currentParams.forEach((value, key) => {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
  });

  Object.entries(extraParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return `${url.pathname}${url.search}`;
};

export default function TruckLanding() {
  const { isAuthenticated } = useAuth();
  const signupHref = useMemo(
    () =>
      appendCurrentAttribution(rawSignupHref, {
        source: "truck-landing",
        audience: "food-truck-owner",
      }),
    [],
  );

  useEffect(() => {
    trackFunnelEventOncePerSession(
      FUNNEL_EVENTS.landingView,
      "truck_landing",
      {
        page: "truck-landing",
        audience: "food_truck_owner",
      },
    );
  }, []);

  const trackCta = (cta: string, href: string) => {
    trackFunnelEvent(FUNNEL_EVENTS.primaryCtaClick, {
      page: "truck-landing",
      audience: "food_truck_owner",
      cta,
      href,
    });

    if (cta.includes("profile")) {
      trackMetaEvent("Lead", {
        content_name: "truck_landing_profile_cta",
        content_category: "food_truck_owner",
      });
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg-surface)] text-[color:var(--text-primary)]">
      <SEOHead
        title="Food Truck Booking, Menu, Schedule, and Pickup Ordering Tools | MealScout"
        description="Create or claim your food truck profile, publish your menu and schedule, review host-posted opportunities, show live location, and turn on direct pickup ordering."
        canonicalUrl="https://www.mealscout.us/truck-landing"
        ogImage="/backgrounds/food-truck-day.jpg"
        schemaData={schemaData}
      />

      <section className="relative min-h-[88svh] overflow-hidden bg-neutral-950 text-white">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/backgrounds/food-truck-day.jpg')" }}
        />
        <div className="absolute inset-0 bg-black/42" />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.9) 34%, rgba(0,0,0,0.62) 70%, rgba(0,0,0,0.38) 100%)",
          }}
        />

        <header className="absolute inset-x-0 top-0 z-20 border-b border-white/10 bg-black/38 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-black">
              <Truck className="h-6 w-6 text-amber-300" />
              <span>MealScout</span>
            </Link>
            <nav className="hidden items-center gap-5 text-sm font-bold text-white/82 md:flex">
              <a href="#owner-tools" className="hover:text-white">
                Owner Tools
              </a>
              <a href="#setup" className="hover:text-white">
                Setup
              </a>
              <a href="#faq" className="hover:text-white">
                FAQ
              </a>
            </nav>
            {isAuthenticated ? (
              <Button asChild size="sm">
                <Link href="/restaurant-owner-dashboard">Dashboard</Link>
              </Button>
            ) : (
              <Button asChild size="sm" variant="secondary">
                <a href={getLoginUrl()}>Sign in</a>
              </Button>
            )}
          </div>
        </header>

        <div className="relative z-10 mx-auto flex min-h-[88svh] max-w-6xl flex-col justify-center px-4 pb-10 pt-24 sm:px-6 lg:pt-28">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-md border border-amber-300/35 bg-black/45 px-3 py-2 text-sm font-black text-amber-200 backdrop-blur">
              <ShieldCheck className="h-4 w-4" />
              For food truck owners
            </div>

            <h1 className="mt-5 max-w-[13ch] text-4xl font-black leading-[1.02] tracking-normal sm:text-6xl lg:text-7xl">
              Fill your calendar without chasing every DM.
            </h1>

            <p className="mt-5 max-w-2xl text-lg font-semibold leading-relaxed text-white/88 sm:text-xl">
              Claim or create your truck profile, publish the menu and schedule,
              review host-posted opportunities, show live status, and add pickup ordering
              from one owner link.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-14 gap-2 px-7 text-base font-black">
                <Link
                  href={signupHref}
                  onClick={() => trackCta("create_profile_hero", signupHref)}
                >
                  Claim or create your truck
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="h-14 bg-white/95 px-7 text-base font-black text-black hover:bg-white"
              >
                <a
                  href="#owner-tools"
                  onClick={() => trackCta("view_owner_tools", "#owner-tools")}
                >
                  See what you get
                </a>
              </Button>
            </div>

            <div className="mt-6 grid gap-2 text-sm font-bold text-white/86 sm:grid-cols-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                Free profile setup
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                Booking request link
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                Menu and stops together
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
        <div className="mx-auto grid max-w-6xl gap-3 px-4 py-5 sm:grid-cols-3 sm:px-6">
          {[
            {
              title: "Claim",
              body: "Tie the profile to the owner who runs the truck.",
              image: "/backgrounds/food-truck-day.jpg",
            },
            {
              title: "Publish",
              body: "Put menu, schedule, service area, and live status in one place.",
              image: "/backgrounds/night-market-plate.webp",
            },
            {
              title: "Book",
              body: "Give hosts and customers a destination that can capture demand.",
              image: "/backgrounds/food-truck-night.jpg",
            },
          ].map((card) => (
            <div
              key={card.title}
              className="overflow-hidden rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface)]"
            >
              <img
                src={card.image}
                alt=""
                className="h-24 w-full object-cover"
                loading="lazy"
              />
              <div className="p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <h2 className="mt-3 text-base font-black">{card.title}</h2>
                <p className="mt-1 text-sm font-semibold leading-relaxed text-[color:var(--text-secondary)]">
                  {card.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
            Built for truck work
          </p>
          <h2 className="mt-2 text-3xl font-black tracking-normal sm:text-4xl">
            The profile has to help you get booked.
          </h2>
          <p className="mt-3 text-base font-semibold leading-relaxed text-[color:var(--text-secondary)]">
            A food truck owner needs faster setup, cleaner host-posted leads, and
            one link that is useful the same day it goes live.
          </p>
        </div>
        <div className="grid gap-3">
          {ownerUseCases.map((item) => (
            <div
              key={item.title}
              className="grid overflow-hidden rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean sm:grid-cols-[10rem_1fr]"
            >
              <img
                src={item.image}
                alt=""
                className="h-32 w-full object-cover sm:h-full"
                loading="lazy"
              />
              <div className="p-4">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-[color:var(--accent-text)]">
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </div>
                <h3 className="mt-2 text-lg font-black">{item.title}</h3>
                <p className="mt-1 text-sm font-semibold leading-relaxed text-[color:var(--text-secondary)]">
                  {item.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        id="owner-tools"
        className="border-y border-[color:var(--border-subtle)] bg-[var(--bg-card)]"
      >
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="max-w-2xl">
            <p className="text-sm font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
              Owner tools
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-normal sm:text-4xl">
              Tools that make the profile worth sharing.
            </h2>
            <p className="mt-3 text-base font-semibold leading-relaxed text-[color:var(--text-secondary)]">
              Start with the public profile. Add the tools that match how your
              truck actually serves customers and hosts.
            </p>
          </div>

          <div className="mt-7 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {ownerOutcomes.map((tool) => (
              <Card
                key={tool.title}
                className="overflow-hidden border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean"
              >
                <img
                  src={tool.image}
                  alt=""
                  className="h-36 w-full object-cover"
                  loading="lazy"
                />
                <CardContent className="p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[color:var(--accent-text)] text-black">
                    <tool.icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-lg font-black">{tool.title}</h3>
                  <p className="mt-2 text-sm font-semibold leading-relaxed text-[color:var(--text-secondary)]">
                    {tool.body}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="setup" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
              Setup path
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-normal sm:text-4xl">
              From signup to a useful truck link.
            </h2>
            <p className="mt-3 text-base font-semibold leading-relaxed text-[color:var(--text-secondary)]">
              The first job is simple: make the truck profile real enough for a
              host or customer to take the next step.
            </p>
            <Button asChild className="mt-5 gap-2 font-black">
              <Link
                href={signupHref}
                onClick={() => trackCta("create_profile_setup", signupHref)}
              >
                Start owner setup
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="grid gap-3">
            {setupSteps.map((step, index) => (
              <div
                key={step.title}
                className="grid overflow-hidden rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] shadow-clean sm:grid-cols-[9rem_1fr]"
              >
                <img
                  src={step.image}
                  alt=""
                  className="h-28 w-full object-cover sm:h-full"
                  loading="lazy"
                />
                <div className="flex gap-4 p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[color:var(--accent-text)] text-sm font-black text-black">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="font-black">{step.title}</h3>
                    <p className="mt-1 text-sm font-semibold leading-relaxed text-[color:var(--text-secondary)]">
                      {step.body}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1fr_1.05fr] lg:items-center">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
              Promotion link
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-normal sm:text-4xl">
              One link for the places you already promote.
            </h2>
            <p className="mt-3 text-base font-semibold leading-relaxed text-[color:var(--text-secondary)]">
              Put the profile behind your bio, ads, event pitches, QR codes,
              flyers, text replies, and customer follow-ups.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                title: "Menu link",
                body: "Point regulars to the current menu.",
                image: "/backgrounds/night-market-plate.webp",
              },
              {
                title: "Schedule link",
                body: "Show today and upcoming stops.",
                image: "/backgrounds/food-truck-night.jpg",
              },
              {
                title: "Booking link",
                body: "Let hosts post the opportunity clearly.",
                image: "/backgrounds/food-truck-day.jpg",
              },
              {
                title: "Live link",
                body: "Turn on location when serving.",
                image: "/backgrounds/food-truck-night.jpg",
              },
            ].map((card) => (
              <div
                key={card.title}
                className="overflow-hidden rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface)]"
              >
                <img
                  src={card.image}
                  alt=""
                  className="h-28 w-full object-cover"
                  loading="lazy"
                />
                <div className="p-4">
                  <MapPin className="h-5 w-5 text-sky-500" />
                  <h3 className="mt-3 font-black">{card.title}</h3>
                  <p className="mt-1 text-sm font-semibold leading-relaxed text-[color:var(--text-secondary)]">
                    {card.body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
              FAQ
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-normal">
              Clear answers for owners.
            </h2>
          </div>
          <Button asChild variant="outline" className="gap-2 font-black">
            <Link
              href={signupHref}
              onClick={() => trackCta("create_profile_faq", signupHref)}
            >
              Create profile
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="mt-7 grid gap-3 md:grid-cols-3">
          {faqItems.map((item) => (
            <div
              key={item.question}
              className="rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 shadow-clean"
            >
              <h3 className="font-black">{item.question}</h3>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-[color:var(--text-secondary)]">
                {item.answer}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-12 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-black">Ready to make the truck easier to book?</h2>
          <p className="mt-1 text-sm font-semibold text-[color:var(--text-secondary)]">
            Start with the profile. Add the ordering and promotion tools when
            the basics are in place.
          </p>
        </div>
        <Button asChild size="lg" className="gap-2 font-black">
          <Link
            href={signupHref}
            onClick={() => trackCta("create_profile_footer", signupHref)}
          >
            Claim or create your truck
            <ArrowRight className="h-5 w-5" />
          </Link>
        </Button>
      </section>
    </main>
  );
}
