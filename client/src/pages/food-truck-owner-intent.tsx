import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Megaphone,
  MessageSquareText,
  MousePointerClick,
  QrCode,
  Search,
  Share2,
  ShoppingBag,
  Store,
  Truck,
  Users,
} from "lucide-react";
import { Link } from "wouter";

import { SEOHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type OwnerIntentPage = {
  path: string;
  sitemapTitle: string;
  seoTitle: string;
  seoDescription: string;
  eyebrow: string;
  headline: string;
  subhead: string;
  primaryCta: { href: string; label: string };
  secondaryCta: { href: string; label: string };
  intentTerms: string[];
  promise: string;
  proof: Array<{ title: string; body: string; icon: typeof Truck }>;
  workflow: string[];
  faqs: Array<{ question: string; answer: string }>;
};

const signupHref =
  "/restaurant-signup?businessType=food_truck&claim=1&flow=truck-owner";

const pages: OwnerIntentPage[] = [
  {
    path: "/food-truck-business-tools",
    sitemapTitle: "Food truck business tools",
    seoTitle: "Food Truck Business Tools for Orders, Bookings, and Social | MealScout",
    seoDescription:
      "MealScout gives food truck owners one place to publish schedules, take direct pickup orders, receive booking requests, post updates, and grow repeat customers.",
    eyebrow: "Food truck business tools",
    headline: "Run orders, bookings, schedules, and social from one food truck hub.",
    subhead:
      "MealScout is built for owners who need more than another directory listing. Create a truck profile, publish where you are serving, take direct orders, receive host requests, and turn your schedule into shareable updates.",
    primaryCta: { href: signupHref, label: "Create free truck profile" },
    secondaryCta: { href: "/pensacola/spots", label: "View Pensacola spots" },
    intentTerms: [
      "food truck business tools",
      "food truck online ordering",
      "food truck booking software",
      "food truck social media tools",
    ],
    promise:
      "One owner workspace for the jobs food trucks repeat every week: tell customers where you are, collect orders, answer booking requests, and keep your own customer relationship.",
    proof: [
      {
        title: "Direct ordering",
        body: "Publish a menu and route pickup orders to your own MealScout ordering flow.",
        icon: ShoppingBag,
      },
      {
        title: "Booking requests",
        body: "Make it easier for hosts to request your truck for offices, apartments, events, and catering.",
        icon: ClipboardList,
      },
      {
        title: "Schedule visibility",
        body: "Give customers and hosts one reliable link for your upcoming stops.",
        icon: CalendarDays,
      },
    ],
    workflow: [
      "Claim or create your food truck profile.",
      "Add your menu, schedule, service area, and booking preferences.",
      "Use one public link for orders, schedule updates, and host requests.",
      "Keep building repeat customers instead of sending every interaction through scattered apps.",
    ],
    faqs: [
      {
        question: "What business tools does MealScout provide for food trucks?",
        answer:
          "MealScout supports food truck profiles, online menus, pickup ordering, schedule publishing, host booking requests, parking spot discovery, deal promotion, and social-ready updates.",
      },
      {
        question: "Is MealScout only a food truck directory?",
        answer:
          "No. Discovery is one part of the platform, but the owner tools are built around direct orders, booking demand, customer visibility, and weekly operations.",
      },
    ],
  },
  {
    path: "/doordash-alternative-for-food-trucks",
    sitemapTitle: "DoorDash alternative for food trucks",
    seoTitle: "DoorDash Alternative for Food Trucks | Direct Orders with MealScout",
    seoDescription:
      "A DoorDash alternative for food trucks that helps owners take direct pickup orders, share QR menus, publish locations, and keep customer relationships.",
    eyebrow: "DoorDash alternative for food trucks",
    headline: "Take direct pickup orders without making delivery apps your whole business.",
    subhead:
      "MealScout gives food trucks a direct ordering path for pickup, QR menus, customer-facing schedules, and repeat buyer visibility so every sale is not trapped inside a third-party marketplace.",
    primaryCta: { href: "/menu-builder", label: "Build direct menu" },
    secondaryCta: { href: signupHref, label: "Create truck profile" },
    intentTerms: [
      "DoorDash alternative for food trucks",
      "Uber Eats alternative for food trucks",
      "direct online ordering for food trucks",
      "avoid delivery app fees",
    ],
    promise:
      "Give customers a direct way to order from your truck while still keeping the profile, schedule, and local discovery tools that help them find you again.",
    proof: [
      {
        title: "Pickup-first ordering",
        body: "Use direct pickup checkout for customers who already know they want your food.",
        icon: ShoppingBag,
      },
      {
        title: "QR menu links",
        body: "Point signs, posts, and event flyers to a menu that belongs to your truck profile.",
        icon: QrCode,
      },
      {
        title: "Customer ownership",
        body: "Keep buyers connected to your schedule, profile, deals, and future stops.",
        icon: Users,
      },
    ],
    workflow: [
      "Create your truck profile and menu.",
      "Share your direct ordering link from posts, QR codes, and event pages.",
      "Use pickup windows instead of relying only on delivery marketplaces.",
      "Bring customers back to your schedule, deals, and booking profile.",
    ],
    faqs: [
      {
        question: "What is a DoorDash alternative for food trucks?",
        answer:
          "For many trucks, the best alternative is a direct pickup ordering flow paired with a public schedule, menu, and customer list so regulars can order without starting inside a delivery marketplace.",
      },
      {
        question: "Does MealScout replace delivery apps completely?",
        answer:
          "MealScout is designed to reduce dependency by giving trucks direct ordering, profile, and discovery tools. Owners can still use delivery apps where they make sense.",
      },
    ],
  },
  {
    path: "/food-truck-online-ordering",
    sitemapTitle: "Food truck online ordering",
    seoTitle: "Food Truck Online Ordering and Pickup Menus | MealScout",
    seoDescription:
      "Create food truck online ordering with pickup menus, QR links, public profiles, and schedule visibility through MealScout.",
    eyebrow: "Food truck online ordering",
    headline: "Turn your menu into a direct pickup ordering page.",
    subhead:
      "MealScout online ordering helps owners publish a menu, send customers to pickup checkout, and keep ordering connected to the truck's profile, schedule, and local visibility.",
    primaryCta: { href: "/menu-builder", label: "Create online menu" },
    secondaryCta: { href: "/online-ordering-platforms", label: "Compare ordering options" },
    intentTerms: [
      "food truck online ordering",
      "food truck preorder app",
      "food truck pickup ordering",
      "QR code menu for food trucks",
    ],
    promise:
      "Give customers a simple way to order ahead while keeping the order connected to where your truck is serving today.",
    proof: [
      {
        title: "Menu builder",
        body: "Create a public menu that can be used for pickup ordering and QR sharing.",
        icon: Store,
      },
      {
        title: "Pickup checkout",
        body: "Route hungry customers to an order flow built around truck pickup, not table service.",
        icon: MousePointerClick,
      },
      {
        title: "Schedule context",
        body: "Connect orders to active locations and upcoming serving windows.",
        icon: CalendarDays,
      },
    ],
    workflow: [
      "Add menu items and pickup details.",
      "Publish the menu link on your profile, QR sign, and social channels.",
      "Let customers order before they reach the window.",
      "Use MealScout visibility to bring them back to future stops.",
    ],
    faqs: [
      {
        question: "Can food trucks take online orders with MealScout?",
        answer:
          "Yes. MealScout includes menu and pickup ordering tools for food businesses, including food trucks that want direct order links.",
      },
      {
        question: "Why should a food truck use direct online ordering?",
        answer:
          "Direct ordering can reduce dependency on third-party marketplaces, make lines easier to manage, and keep customers connected to the truck's own schedule and profile.",
      },
    ],
  },
  {
    path: "/food-truck-social-media-management",
    sitemapTitle: "Food truck social media management",
    seoTitle: "Food Truck Social Media Management and Schedule Posts | MealScout",
    seoDescription:
      "MealScout helps food truck owners turn schedules, specials, locations, and booking openings into social-ready updates for customers and hosts.",
    eyebrow: "Food truck social media management",
    headline: "Turn your weekly stops and specials into posts customers can act on.",
    subhead:
      "Food truck social media should not require rebuilding the same update in five places. MealScout keeps your schedule, menu, deals, and profile together so updates can point customers toward a real action.",
    primaryCta: { href: signupHref, label: "Create schedule-ready profile" },
    secondaryCta: { href: "/truck-landing", label: "See truck tools" },
    intentTerms: [
      "social media management for food trucks",
      "food truck Instagram post ideas",
      "food truck Facebook posting tool",
      "food truck schedule post template",
    ],
    promise:
      "Use your MealScout schedule, specials, and booking status as the source for posts that send people to your menu, location, and order links.",
    proof: [
      {
        title: "Schedule posts",
        body: "Use one schedule source for customer-facing updates about where you will be.",
        icon: Share2,
      },
      {
        title: "Specials and deals",
        body: "Promote time-sensitive offers with links customers can open immediately.",
        icon: Megaphone,
      },
      {
        title: "Action links",
        body: "Send social traffic to a menu, map listing, deal, or booking profile instead of a dead end.",
        icon: ArrowRight,
      },
    ],
    workflow: [
      "Add your weekly stops, current menu, and active offers.",
      "Use your public profile as the link behind schedule posts.",
      "Point customers to the correct action: order, find, follow, or request catering.",
      "Keep updates consistent as your schedule changes.",
    ],
    faqs: [
      {
        question: "What should food trucks post on social media?",
        answer:
          "Food trucks should post their schedule, location changes, menu specials, sellout notices, catering availability, and direct order links. MealScout gives those posts a working destination.",
      },
      {
        question: "Can MealScout help with food truck social media?",
        answer:
          "MealScout helps by centralizing the profile, schedule, menu, deals, and ordering links that social posts should point to.",
      },
    ],
  },
  {
    path: "/food-truck-booking-software",
    sitemapTitle: "Food truck booking software",
    seoTitle: "Food Truck Booking Software for Host Requests | MealScout",
    seoDescription:
      "Food truck booking software for host requests, catering leads, apartment events, office lunches, brewery rotations, and event details.",
    eyebrow: "Food truck booking software",
    headline: "Let hosts request your truck without running every lead through DMs.",
    subhead:
      "MealScout gives food truck owners a booking-ready profile so hosts can understand what you serve, where you operate, and how to request you for offices, apartments, breweries, events, and catering.",
    primaryCta: { href: signupHref, label: "Create booking profile" },
    secondaryCta: { href: "/food-truck-opportunities/pensacola", label: "View Pensacola opportunities" },
    intentTerms: [
      "food truck booking software",
      "food truck request form",
      "food truck catering leads",
      "food truck event management software",
    ],
    promise:
      "Make your truck easier to request, compare, and approve without making hosts manage a spreadsheet or chase messages.",
    proof: [
      {
        title: "Request-ready profile",
        body: "Show menu style, service area, booking preferences, and public trust signals.",
        icon: ClipboardList,
      },
      {
        title: "Host context",
        body: "Capture the details trucks need before committing to a spot or event.",
        icon: MessageSquareText,
      },
      {
        title: "Opportunity flow",
        body: "Pair owner profiles with host-posted spots and food truck parking passes.",
        icon: Truck,
      },
    ],
    workflow: [
      "Create a truck profile built for bookings.",
      "Add cuisine, service radius, truck requirements, and catering notes.",
      "Let hosts submit requests or post spots trucks can review.",
      "Keep confirmations and next steps attached to the booking flow.",
    ],
    faqs: [
      {
        question: "What should food truck booking software include?",
        answer:
          "It should include a booking profile, event details, schedule context, host requirements, contact flow, and a way to manage requests without losing information in DMs.",
      },
      {
        question: "Does MealScout support host-posted food truck spots?",
        answer:
          "Yes. MealScout includes host and parking pass workflows, with Pensacola serving as the first focused food truck market.",
      },
    ],
  },
  {
    path: "/food-truck-catering-leads",
    sitemapTitle: "Food truck catering leads",
    seoTitle: "Food Truck Catering Leads and Event Requests | MealScout",
    seoDescription:
      "Get food truck catering leads by creating a MealScout profile hosts can request for offices, apartments, schools, breweries, private events, and local gatherings.",
    eyebrow: "Food truck catering leads",
    headline: "Give catering and event buyers a clear way to request your truck.",
    subhead:
      "MealScout turns your truck into a requestable local food business with menu, schedule, service area, and event details in one place.",
    primaryCta: { href: signupHref, label: "Create catering profile" },
    secondaryCta: { href: "/request-truck", label: "See host request flow" },
    intentTerms: [
      "food truck catering leads",
      "food truck event leads",
      "book my food truck for events",
      "food truck catering request form",
    ],
    promise:
      "Help buyers understand your truck before they reach out, then route serious requests into a clearer booking path.",
    proof: [
      {
        title: "Catering-ready details",
        body: "Cuisine, service radius, minimums, and event fit can live on your public profile.",
        icon: ClipboardList,
      },
      {
        title: "Host demand",
        body: "MealScout supports hosts looking for trucks for offices, apartments, events, and private gatherings.",
        icon: Users,
      },
      {
        title: "Direct path",
        body: "Turn interested buyers into requests instead of making them guess how to contact you.",
        icon: ArrowRight,
      },
    ],
    workflow: [
      "Publish a catering-friendly truck profile.",
      "Show the events, group sizes, and service areas you can handle.",
      "Let hosts submit the details you need up front.",
      "Use the request as the starting point for pricing and confirmation.",
    ],
    faqs: [
      {
        question: "How do food trucks get more catering leads?",
        answer:
          "Food trucks get better leads when hosts can see menu style, service area, schedule, event fit, and a clear request path before contacting the owner.",
      },
      {
        question: "Can MealScout help food trucks get event requests?",
        answer:
          "MealScout provides public profiles, host request flows, and opportunity pages designed to connect food trucks with local event demand.",
      },
    ],
  },
  {
    path: "/food-truck-schedule-app",
    sitemapTitle: "Food truck schedule app",
    seoTitle: "Food Truck Schedule App for Locations, Menus, and Updates | MealScout",
    seoDescription:
      "Publish your food truck schedule, upcoming locations, menus, deals, and public profile with MealScout so customers know where to find you next.",
    eyebrow: "Food truck schedule app",
    headline: "Publish your weekly food truck schedule once and share it everywhere.",
    subhead:
      "Customers should not have to scroll old posts to find your next stop. MealScout helps trucks keep locations, menus, deals, and profile links connected to one schedule-aware presence.",
    primaryCta: { href: signupHref, label: "Publish truck schedule" },
    secondaryCta: { href: "/map", label: "See live map" },
    intentTerms: [
      "food truck schedule app",
      "food truck location tracker",
      "where to post food truck schedule",
      "food truck calendar for customers",
    ],
    promise:
      "Make your next stop findable from search, map, profile, and social posts without rebuilding the same update from scratch.",
    proof: [
      {
        title: "Upcoming stops",
        body: "Keep customers oriented around where you will be and when.",
        icon: CalendarDays,
      },
      {
        title: "Map visibility",
        body: "Connect schedule updates to local discovery and live location context.",
        icon: Search,
      },
      {
        title: "Shareable profile",
        body: "Use one link for schedule, menu, deals, and booking interest.",
        icon: Share2,
      },
    ],
    workflow: [
      "Claim your truck profile.",
      "Add current and upcoming stops.",
      "Share your public schedule link from social, QR codes, and event pages.",
      "Update the schedule as your week changes.",
    ],
    faqs: [
      {
        question: "Where should food trucks post their schedule?",
        answer:
          "Food trucks should post schedules somewhere customers can open directly, not only in social feeds. MealScout gives trucks a public profile and schedule path tied to map discovery.",
      },
      {
        question: "Does MealScout show food truck locations?",
        answer:
          "MealScout supports food truck profiles, map discovery, and schedule/location tools so customers and hosts can find active trucks.",
      },
    ],
  },
  {
    path: "/food-truck-opportunities/pensacola",
    sitemapTitle: "Pensacola food truck opportunities",
    seoTitle: "Food Truck Opportunities in Pensacola | MealScout",
    seoDescription:
      "Find Pensacola food truck opportunities, host-posted spots, parking pass locations, event requests, and booking tools through MealScout.",
    eyebrow: "Pensacola food truck opportunities",
    headline: "Pensacola hosts and locations are the first MealScout food truck market.",
    subhead:
      "MealScout is building around Pensacola food truck operators first: available spots, host interest, booking profiles, schedules, direct ordering, and local visibility in one focused market.",
    primaryCta: { href: "/pensacola/spots", label: "See available Pensacola spots" },
    secondaryCta: { href: signupHref, label: "List my truck" },
    intentTerms: [
      "food truck opportunities Pensacola",
      "Pensacola food truck spots",
      "food truck events Pensacola",
      "Pensacola food truck booking",
    ],
    promise:
      "Start with a real local market instead of a blank national directory: Pensacola spots, host workflows, and owner tools that support repeat weekly operations.",
    proof: [
      {
        title: "Local spots",
        body: "Pensacola parking pass and host workflows are already part of the platform.",
        icon: Truck,
      },
      {
        title: "Owner profile",
        body: "Create one profile for schedule, menu, orders, booking requests, and visibility.",
        icon: Store,
      },
      {
        title: "Host demand",
        body: "The host side is designed so locations can create spots and trucks can self-manage interest.",
        icon: Users,
      },
    ],
    workflow: [
      "View Pensacola spots and opportunity pages.",
      "Claim or create your truck profile.",
      "Add your schedule, menu, service area, and booking preferences.",
      "Use MealScout as the local operating link behind orders, requests, and visibility.",
    ],
    faqs: [
      {
        question: "Where can food trucks find opportunities in Pensacola?",
        answer:
          "MealScout publishes Pensacola-focused food truck spot and host workflows, including parking pass locations and owner tools for claiming a truck profile.",
      },
      {
        question: "Is Pensacola a MealScout launch market?",
        answer:
          "Yes. Pensacola is MealScout's first focused food truck market before broader expansion.",
      },
    ],
  },
];

const pageByPath = new Map(pages.map((page) => [page.path, page]));

export const ownerIntentSitemapPages = pages.map((page) => ({
  href: page.path,
  title: page.sitemapTitle,
  description: page.seoDescription,
}));

export const ownerIntentPaths = pages.map((page) => page.path);

const defaultPage = pages[0];

function getCurrentPage() {
  if (typeof window === "undefined") return defaultPage;
  const pathname = window.location.pathname.replace(/\/$/, "") || "/";
  return pageByPath.get(pathname) || defaultPage;
}

function buildSchema(page: OwnerIntentPage) {
  const canonicalUrl = `https://www.mealscout.us${page.path}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: page.seoTitle,
        description: page.seoDescription,
        url: canonicalUrl,
        isPartOf: {
          "@type": "WebSite",
          name: "MealScout",
          url: "https://www.mealscout.us",
        },
      },
      {
        "@type": "SoftwareApplication",
        name: "MealScout",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, iOS, Android",
        description: page.promise,
        url: canonicalUrl,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          description: "Free food truck profile creation with optional paid business tools.",
        },
      },
      {
        "@type": "FAQPage",
        mainEntity: page.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: faq.answer,
          },
        })),
      },
    ],
  };
}

export default function FoodTruckOwnerIntentPage() {
  const page = getCurrentPage();
  const schemaData = buildSchema(page);

  return (
    <main className="min-h-screen bg-[var(--bg-layered)] text-[color:var(--text-primary)]">
      <SEOHead
        title={page.seoTitle}
        description={page.seoDescription}
        canonicalUrl={`https://www.mealscout.us${page.path}`}
        schemaData={schemaData}
      />

      <section className="border-b border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:py-14">
          <div className="space-y-5">
            <Link
              href="/truck-landing"
              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]"
            >
              <Truck className="h-3.5 w-3.5" />
              {page.eyebrow}
            </Link>
            <div className="space-y-3">
              <h1 className="max-w-4xl text-3xl font-black leading-tight sm:text-5xl">
                {page.headline}
              </h1>
              <p className="max-w-3xl text-base font-medium leading-relaxed text-[color:var(--text-secondary)] sm:text-lg">
                {page.subhead}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="gap-2">
                <Link href={page.primaryCta.href}>
                  {page.primaryCta.label}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href={page.secondaryCta.href}>{page.secondaryCta.label}</Link>
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {page.intentTerms.map((term) => (
                <span
                  key={term}
                  className="rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-semibold text-[color:var(--text-secondary)]"
                >
                  {term}
                </span>
              ))}
            </div>
          </div>

          <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-surface)] shadow-clean-lg">
            <CardContent className="space-y-4 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-[color:var(--accent-text)]/12 text-[color:var(--accent-text)]">
                  <Search className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
                    Owner search intent
                  </p>
                  <h2 className="mt-1 text-xl font-black">Be found when owners are already looking.</h2>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-[color:var(--text-secondary)]">
                {page.promise}
              </p>
              <div className="grid gap-2">
                {page.workflow.slice(0, 3).map((step) => (
                  <div key={step} className="flex gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-[color:var(--status-success)]" />
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="grid gap-3 md:grid-cols-3">
          {page.proof.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.title} className="border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
                <CardContent className="p-4">
                  <Icon className="h-5 w-5 text-[color:var(--accent-text)]" />
                  <h2 className="mt-3 text-base font-black">{item.title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-[color:var(--text-secondary)]">
                    {item.body}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="border-y border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
              Search path
            </p>
            <h2 className="mt-2 text-2xl font-black">One page, one owner problem, one next action.</h2>
            <p className="mt-2 text-sm leading-relaxed text-[color:var(--text-secondary)]">
              These pages are built for owners searching for a specific problem, not for people being interrupted by a cold link.
            </p>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2">
            {page.workflow.map((step, index) => (
              <li
                key={step}
                className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-surface)] p-4"
              >
                <div className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
                  Step {index + 1}
                </div>
                <p className="mt-2 text-sm font-medium leading-relaxed">{step}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
              Related owner searches
            </p>
            <h2 className="mt-2 text-2xl font-black">More ways truck owners find MealScout</h2>
          </div>
          <Link href="/sitemap" className="text-sm font-semibold text-[color:var(--accent-text)]">
            View sitemap
          </Link>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {ownerIntentSitemapPages
            .filter((item) => item.href !== page.path)
            .slice(0, 4)
            .map((item) => (
              <Link key={item.href} href={item.href}>
                <div className="h-full rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-card)] p-4 transition-colors hover:border-[color:var(--accent-text)]/40 hover:bg-[color:var(--accent-text)]/8">
                  <h3 className="text-sm font-black">{item.title}</h3>
                  <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-[color:var(--text-secondary)]">
                    {item.description}
                  </p>
                </div>
              </Link>
            ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <Card className="border-[color:var(--border-subtle)] bg-[var(--bg-card)]">
          <CardContent className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[color:var(--accent-text)]">
                FAQ
              </p>
              <h2 className="mt-2 text-2xl font-black">Answer-first content for AI and search.</h2>
            </div>
            <div className="space-y-4">
              {page.faqs.map((faq) => (
                <div key={faq.question}>
                  <h3 className="text-sm font-black">{faq.question}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-[color:var(--text-secondary)]">
                    {faq.answer}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
