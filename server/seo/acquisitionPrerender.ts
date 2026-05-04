import type { Express, Request, Response, NextFunction } from "express";
import { shouldServePrerender } from "./botDetection";

type AcquisitionPageConfig = {
  path: string;
  title: string;
  description: string;
  h1: string;
  body: string[];
  ctaLinks: Array<{ label: string; href: string }>;
  schemaType: "ProfessionalService" | "LocalBusiness" | "WebApplication";
  serviceType?: string;
};

const escapeHtml = (value: string) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildPageHtml = (
  canonicalBaseUrl: string,
  page: AcquisitionPageConfig,
) => {
  const canonical = `${canonicalBaseUrl}${page.path}`;
  const image = `${canonicalBaseUrl}/og-default.jpg`;
  const schema = {
    "@context": "https://schema.org",
    "@type": page.schemaType,
    name: "MealScout",
    url: canonical,
    description: page.description,
    areaServed: "United States",
    serviceType: page.serviceType,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:title" content="${escapeHtml(page.title)}">
  <meta property="og:description" content="${escapeHtml(page.description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:site_name" content="MealScout">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(page.title)}">
  <meta name="twitter:description" content="${escapeHtml(page.description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
  <meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1">
  <script type="application/ld+json">${JSON.stringify(schema)}</script>
  <style>
    body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; margin: 0; background: #fffaf2; color: #111827; }
    main { max-width: 840px; margin: 0 auto; padding: 28px 18px 44px; }
    h1 { font-size: 32px; margin: 0 0 14px; }
    p { line-height: 1.6; margin: 0 0 14px; }
    .card { background: #ffffff; border: 1px solid #fed7aa; border-radius: 14px; padding: 16px; margin-top: 16px; }
    .links a { display: inline-block; margin: 8px 10px 0 0; color: #9a3412; text-decoration: none; font-weight: 600; }
    .links a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(page.h1)}</h1>
    ${page.body.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n")}
    <div class="card">
      <strong>Important links</strong>
      <div class="links">
        ${page.ctaLinks
          .map(
            (link) =>
              `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`,
          )
          .join("\n")}
      </div>
    </div>
  </main>
</body>
</html>`;
};

export function registerAcquisitionPrerenderRoutes(
  app: Express,
  canonicalBaseUrl: string,
) {
  const pages: AcquisitionPageConfig[] = [
    {
      path: "/",
      title: "MealScout | Find Food Trucks, Restaurants, Events and Deals",
      description:
        "MealScout helps people find nearby food trucks, restaurants, food videos, local events, and host locations.",
      h1: "Find local food trucks, restaurants, events, and videos",
      body: [
        "MealScout connects local food discovery with booking-ready food truck and host location tools.",
        "Use the live map, video feed, public events, and searchable profiles to discover what is active nearby.",
        "Food truck owners, restaurants, hosts, and event organizers can create public pages that customers and search engines can find.",
      ],
      ctaLinks: [
        { label: "Open Food Map", href: "/map" },
        { label: "Watch Video Feed", href: "/video" },
        { label: "Browse Events", href: "/events" },
        { label: "Share MealScout", href: "/share-hub" },
      ],
      schemaType: "WebApplication",
      serviceType: "Local food discovery and food truck booking platform",
    },
    {
      path: "/map",
      title: "Food Trucks and Restaurants Near Me | MealScout Map",
      description:
        "Use the MealScout live map to find nearby food trucks, restaurants, host locations, deals, and public food events.",
      h1: "Food trucks, restaurants, host locations, and events on one map",
      body: [
        "The MealScout map shows public food activity near you, including active host locations and food truck events.",
        "Customers can discover nearby food. Operators can keep public visibility tied to real local activity.",
      ],
      ctaLinks: [
        { label: "Open Map", href: "/map" },
        { label: "Search Food", href: "/search" },
        { label: "Video Feed", href: "/video" },
        { label: "Share Map", href: "/share-hub" },
      ],
      schemaType: "WebApplication",
      serviceType: "Local food map",
    },
    {
      path: "/search",
      title: "Search Food Trucks, Restaurants and Deals | MealScout",
      description:
        "Search MealScout for local food trucks, restaurants, bars, specials, public events, and food recommendations.",
      h1: "Search local food trucks, restaurants, deals, and events",
      body: [
        "MealScout search helps customers discover local food options by name, cuisine, city, or activity.",
        "Search pages connect to public profiles, deal pages, event pages, the live map, and the video feed.",
      ],
      ctaLinks: [
        { label: "Search", href: "/search" },
        { label: "Food Map", href: "/map" },
        { label: "Events", href: "/events" },
      ],
      schemaType: "WebApplication",
      serviceType: "Local food search",
    },
    {
      path: "/video",
      title: "Local Food Videos and Recommendations | MealScout",
      description:
        "Watch MealScout food videos, recommendations, public profile media, and local food stories from the community.",
      h1: "Local food videos and recommendations",
      body: [
        "MealScout videos help customers see food, trucks, restaurants, hosts, and events before they visit.",
        "The public video feed highlights community recommendations and profile media that is approved for public discovery.",
      ],
      ctaLinks: [
        { label: "Watch Videos", href: "/video" },
        { label: "Food Map", href: "/map" },
        { label: "Share Video Feed", href: "/share-hub" },
      ],
      schemaType: "WebApplication",
      serviceType: "Local food video discovery",
    },
    {
      path: "/share-hub",
      title: "Share MealScout | Food Map, Video, Truck and Host Links",
      description:
        "Share MealScout links for the food map, video feed, food truck onboarding, restaurant signup, host locations, and event booking.",
      h1: "Share MealScout with customers, owners, hosts, and event organizers",
      body: [
        "The MealScout share hub gives customers and operators direct links to the most important public pages.",
        "Use it for food discovery, videos, food truck owner signup, restaurant signup, host location outreach, and event booking.",
      ],
      ctaLinks: [
        { label: "Food Map", href: "/map" },
        { label: "Video Feed", href: "/video" },
        { label: "Add a Food Truck", href: "/truck-onboarding" },
        { label: "Host a Truck", href: "/host-location-partner" },
      ],
      schemaType: "WebApplication",
      serviceType: "Public sharing hub",
    },
    {
      path: "/truck-onboarding",
      title: "List or Claim Your Food Truck | MealScout",
      description:
        "Create or claim a MealScout food truck profile so customers, hosts, and event organizers can find and book your truck.",
      h1: "List or claim your food truck on MealScout",
      body: [
        "Food truck owners can create a public profile, claim an existing truck, add business details, and start building visibility.",
        "MealScout connects truck profiles to local discovery, public events, host locations, videos, and booking demand.",
      ],
      ctaLinks: [
        { label: "Start Food Truck Onboarding", href: "/truck-onboarding" },
        { label: "Food Truck Landing Page", href: "/truck-landing" },
        { label: "Host Locations", href: "/for-hosts" },
        { label: "Food Map", href: "/map" },
      ],
      schemaType: "ProfessionalService",
      serviceType: "Food truck profile and booking onboarding",
    },
    {
      path: "/restaurant-signup",
      title: "List Your Restaurant or Bar | MealScout",
      description:
        "Create a MealScout restaurant or bar profile for local discovery, specials, menus, pickup ordering, and public media.",
      h1: "List your restaurant or bar on MealScout",
      body: [
        "Restaurant and bar owners can create public profiles that work like local storefronts.",
        "Profiles can support specials, menus, pickup ordering, photos, videos, and search visibility.",
      ],
      ctaLinks: [
        { label: "Start Restaurant Signup", href: "/restaurant-signup" },
        { label: "For Restaurants", href: "/for-restaurants" },
        { label: "For Bars", href: "/for-bars" },
        { label: "Search", href: "/search" },
      ],
      schemaType: "ProfessionalService",
      serviceType: "Restaurant local discovery and ordering",
    },
    {
      path: "/events",
      title: "Open Food Truck Events | MealScout",
      description:
        "Browse public food truck events, open calls, host locations, and booking opportunities on MealScout.",
      h1: "Open food truck events and booking opportunities",
      body: [
        "MealScout event pages help hosts and coordinators publish public food truck opportunities.",
        "Food truck owners can find active events, and customers can discover where trucks are scheduled.",
      ],
      ctaLinks: [
        { label: "Browse Events", href: "/events" },
        { label: "Book a Truck", href: "/request-truck" },
        { label: "Find Trucks", href: "/truck-discovery" },
        { label: "Food Map", href: "/map" },
      ],
      schemaType: "WebApplication",
      serviceType: "Food truck event discovery",
    },
    {
      path: "/request-truck",
      title: "Book a Food Truck for an Event | MealScout",
      description:
        "Request a food truck for catering, offices, apartments, public events, private events, and recurring host locations.",
      h1: "Book a food truck for your event or location",
      body: [
        "MealScout helps event organizers and hosts request food trucks for the right date, time, and audience.",
        "Requests can turn into public event opportunities or private booking workflows depending on the event.",
      ],
      ctaLinks: [
        { label: "Request a Truck", href: "/request-truck" },
        { label: "Open Events", href: "/events" },
        { label: "Host a Truck", href: "/host-location-partner" },
      ],
      schemaType: "ProfessionalService",
      serviceType: "Food truck booking request",
    },
    {
      path: "/for-restaurants",
      title: "MealScout for Restaurants and Food Trucks",
      description:
        "MealScout helps restaurants and food trucks get recurring local demand, monthly visibility, and direct booking opportunities.",
      h1: "Get recurring demand from local customers and booking-ready hosts",
      body: [
        "MealScout is built for restaurant owners and food truck operators who need steady monthly growth.",
        "We help businesses surface in local discovery, convert nearby demand, and capture booking opportunities from host locations.",
        "Start with your profile, then activate offers and booking visibility to keep demand compounding over time.",
      ],
      ctaLinks: [
        { label: "Owner Signup", href: "/restaurant-signup" },
        { label: "Claim Business", href: "/truck-onboarding?claim=1" },
        { label: "Live Food Map", href: "/map" },
      ],
      schemaType: "ProfessionalService",
      serviceType: "Restaurant and food truck demand generation",
    },
    {
      path: "/for-hosts",
      title: "MealScout for Host Locations",
      description:
        "Businesses with available parking can host food truck events and convert underused space into recurring booking revenue.",
      h1: "Turn open parking into recurring host revenue",
      body: [
        "MealScout host locations include offices, retail centers, churches, campuses, and other non-food businesses with parking space.",
        "Hosts publish availability, receive booking demand from active food trucks, and run repeat event days with minimal overhead.",
        "You can start with one location and scale into weekly or monthly recurring spots.",
      ],
      ctaLinks: [
        { label: "Host Partnership Signup", href: "/host-location-partner" },
        { label: "Host Program", href: "/for-hosts" },
        { label: "Public Events", href: "/events" },
      ],
      schemaType: "LocalBusiness",
      serviceType: "Host location marketplace for food trucks",
    },
    {
      path: "/host-location-partner",
      title: "Host Location Partner Request | MealScout",
      description:
        "Apply to become a MealScout host location if your business has truck-friendly parking space and wants recurring bookings.",
      h1: "Apply to become a MealScout host location partner",
      body: [
        "If your business has available parking, you can qualify as a MealScout host location.",
        "We work with non-food businesses that want to attract foot traffic and earn recurring revenue from hosted food truck bookings.",
        "Submit your location and our team will validate fit, setup readiness, and booking potential.",
      ],
      ctaLinks: [
        { label: "Start Host Application", href: "/host-location-partner" },
        { label: "For Hosts Overview", href: "/for-hosts" },
        { label: "For Restaurants", href: "/for-restaurants" },
      ],
      schemaType: "LocalBusiness",
      serviceType: "Host location marketplace for food trucks",
    },
  ];

  for (const page of pages) {
    app.get(page.path, (req: Request, res: Response, next: NextFunction) => {
      if (!shouldServePrerender(req)) {
        return next();
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=1800");
      res.send(buildPageHtml(canonicalBaseUrl, page));
    });
  }
}
