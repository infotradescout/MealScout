import { useEffect, useMemo } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  MapPin,
  MenuSquare,
  Radio,
  ShieldCheck,
  Truck,
} from "lucide-react";

import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { useAuth } from "@/hooks/useAuth";
import { trackMetaEvent } from "@/lib/meta-pixel";
import {
  FUNNEL_EVENTS,
  trackFunnelEvent,
  trackFunnelEventOncePerSession,
} from "@/utils/funnelTelemetry";

const rawSignupHref = "/truck-onboarding?claim=1&flow=truck-owner";

const coreTools = [
  {
    title: "Profile",
    body: "Photos, cuisine, phone, service area, menu, booking notes, and the public link owners can share.",
    icon: Truck,
  },
  {
    title: "Schedule",
    body: "Public stops, private bookings, recurring locations, and live status stay in one owner workflow.",
    icon: CalendarDays,
  },
  {
    title: "Opportunities",
    body: "Hosts post date, time, place, headcount, notes, and event terms before an owner commits.",
    icon: ClipboardList,
  },
  {
    title: "Ordering",
    body: "Turn on pickup ordering when the profile, menu, and operations are ready.",
    icon: MenuSquare,
  },
];

const profileChecklist = [
  "Claim or create the truck",
  "Add menu, photos, city, and contact info",
  "Verify business ownership and insurance",
  "Publish one profile link for posts, QR codes, and event pitches",
];

const faqItems = [
  {
    question: "Can a truck start free?",
    answer:
      "Yes. Owners can start with the public profile first, then add paid tools when the profile is ready to drive business.",
  },
  {
    question: "Does the page replace social media?",
    answer:
      "No. It gives social posts, bios, flyers, QR codes, and text replies one dependable destination.",
  },
  {
    question: "What does verification do?",
    answer:
      "Verification helps staff confirm the business is legitimate before sensitive owner tools are expanded.",
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
        description:
          "Free food truck profile creation with optional paid owner tools.",
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

    if (cta.includes("profile") || cta.includes("truck")) {
      trackMetaEvent("Lead", {
        content_name: "truck_landing_profile_cta",
        content_category: "food_truck_owner",
      });
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg-layered)] text-[color:var(--text-primary)]">
      <SEOHead
        title="Food Truck Booking, Menu, Schedule, and Pickup Ordering Tools | MealScout"
        description="Create or claim your food truck profile, publish your menu and schedule, review host-posted opportunities, show live location, and turn on direct pickup ordering."
        canonicalUrl="https://www.mealscout.us/truck-landing"
        ogImage="/backgrounds/food-truck-day.jpg"
        schemaData={schemaData}
      />

      <section className="relative min-h-[86svh] overflow-hidden bg-neutral-950 text-white">
        <img
          src="/backgrounds/food-truck-day.jpg"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-black/58" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.78)_44%,rgba(0,0,0,0.32)_100%)]" />

        <header className="relative z-20 border-b border-white/10 bg-black/42 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-black">
              <Truck className="h-6 w-6 text-[color:var(--accent-text)]" />
              <span>MealScout</span>
            </Link>
            <nav className="hidden items-center gap-5 text-sm font-bold text-white/82 md:flex">
              <a href="#tools" className="hover:text-white">
                Tools
              </a>
              <a href="#proof" className="hover:text-white">
                Verification
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

        <div className="relative z-10 mx-auto flex min-h-[calc(86svh-4rem)] max-w-6xl flex-col justify-center px-4 py-14 sm:px-6">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-md border border-white/16 bg-black/42 px-3 py-2 text-sm font-black text-white/88 backdrop-blur">
              <ShieldCheck className="h-4 w-4 text-[color:var(--accent-text)]" />
              Food truck owner tools
            </div>

            <h1 className="mt-5 max-w-[14ch] text-4xl font-black leading-[1.02] tracking-normal sm:text-6xl lg:text-7xl">
              One profile for stops, menus, and bookings.
            </h1>

            <p className="mt-5 max-w-2xl text-lg font-semibold leading-relaxed text-white/86 sm:text-xl">
              Claim your truck, keep the public profile current, and give hosts
              one clear place to understand where you serve, what you sell, and
              how to book you.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-14 gap-2 px-7 text-base font-black">
                <Link
                  href={signupHref}
                  onClick={() => trackCta("claim_truck_profile_hero", signupHref)}
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
                <a href="#tools" onClick={() => trackCta("view_tools", "#tools")}>
                  See owner tools
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
        <div className="mx-auto grid max-w-6xl gap-px px-4 py-0 sm:px-6 md:grid-cols-3">
          {[
            ["Profile", "A public page customers and hosts can trust."],
            ["Schedule", "Stops, private bookings, and live status in one place."],
            ["Demand", "A cleaner path from social attention to real leads."],
          ].map(([title, body]) => (
            <div key={title} className="py-5 md:px-6 md:first:pl-0 md:last:pr-0">
              <p className="text-sm font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
                {title}
              </p>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-[color:var(--text-secondary)]">
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="tools" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
              Owner console
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-normal sm:text-4xl">
              Built around the work trucks actually do.
            </h2>
            <p className="mt-3 text-base font-semibold leading-relaxed text-[color:var(--text-secondary)]">
              The owner flow is practical: publish what customers need, collect
              the details hosts need, and keep the profile useful before and
              after online ordering is turned on.
            </p>
            <Button asChild className="mt-5 gap-2 font-black">
              <Link
                href={signupHref}
                onClick={() => trackCta("create_profile_tools", signupHref)}
              >
                Start the profile
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {coreTools.map((tool) => (
              <div
                key={tool.title}
                className="rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]">
                  <tool.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-black">{tool.title}</h3>
                <p className="mt-2 text-sm font-semibold leading-relaxed text-[color:var(--text-secondary)]">
                  {tool.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="proof" className="border-y border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
              Profile readiness
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-normal sm:text-4xl">
              Launch with enough detail to be taken seriously.
            </h2>
            <p className="mt-3 text-base font-semibold leading-relaxed text-[color:var(--text-secondary)]">
              A truck profile should not feel half-built. MealScout guides
              owners through the minimum set of details that make the page worth
              sharing.
            </p>
          </div>

          <div className="rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-clean">
            <div className="flex items-center gap-3 border-b border-[color:var(--border-subtle)] pb-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-emerald-500/12 text-emerald-700">
                <BadgeCheck className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-black">Owner launch checklist</h3>
                <p className="text-sm font-semibold text-[color:var(--text-muted)]">
                  Clear steps, not busywork.
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3">
              {profileChecklist.map((item, index) => (
                <div key={item} className="flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[color:var(--accent-text)] text-xs font-black text-[color:var(--action-primary-text)]">
                    {index + 1}
                  </span>
                  <p className="pt-1 text-sm font-semibold leading-relaxed text-[color:var(--text-secondary)]">
                    {item}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid overflow-hidden rounded-md border border-[color:var(--border-subtle)] bg-neutral-950 text-white shadow-clean-lg lg:grid-cols-[0.95fr_1.05fr]">
          <div className="relative min-h-[18rem]">
            <img
              src="/backgrounds/night-market-plate.webp"
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-black/24" />
          </div>
          <div className="p-6 sm:p-8">
            <p className="text-sm font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
              Promotion link
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-normal">
              A cleaner destination for every post, QR code, and pitch.
            </h2>
            <p className="mt-3 text-base font-semibold leading-relaxed text-white/78">
              Social channels are good at attention. The profile is where that
              attention turns into menu views, event leads, pickup orders, and
              repeat customers.
            </p>
            <div className="mt-5 grid gap-2">
              {["Shareable profile page", "Menu and schedule together", "Booking context for hosts"].map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm font-bold text-white/86">
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 sm:pb-16">
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
              className="rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-5 shadow-clean"
            >
              <h3 className="font-black">{item.question}</h3>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-[color:var(--text-secondary)]">
                {item.answer}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-black">Make the truck easier to find and easier to book.</h2>
            <p className="mt-1 text-sm font-semibold text-[color:var(--text-secondary)]">
              Start with the profile. Add ordering, promotion, and owner tools
              when the basics are in place.
            </p>
          </div>
          <Button asChild size="lg" className="gap-2 font-black">
            <Link
              href={signupHref}
              onClick={() => trackCta("claim_truck_profile_footer", signupHref)}
            >
              Claim or create your truck
              <ArrowRight className="h-5 w-5" />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
