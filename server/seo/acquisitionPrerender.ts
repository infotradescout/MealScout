import type { Express, Request, Response, NextFunction } from "express";

type AcquisitionPageConfig = {
  path: string;
  title: string;
  description: string;
  h1: string;
  body: string[];
  ctaLinks: Array<{ label: string; href: string }>;
  schemaType: "ProfessionalService" | "LocalBusiness";
};

const BOT_UA_PATTERN =
  /(bot|crawler|spider|slurp|googlebot|bingbot|duckduckbot|applebot|gptbot|oai-searchbot|chatgpt-user|claudebot|anthropic-ai|perplexitybot|bytespider|ccbot|cohere-ai)/i;

const shouldServePrerender = (req: Request) => {
  const force = String(req.query?.prerender || "").toLowerCase();
  if (force === "1" || force === "true") return true;
  const ua = String(req.get("user-agent") || "");
  return BOT_UA_PATTERN.test(ua);
};

const escapeHtml = (value: string) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const buildPageHtml = (canonicalBaseUrl: string, page: AcquisitionPageConfig) => {
  const canonical = `${canonicalBaseUrl}${page.path}`;
  const schema = {
    "@context": "https://schema.org",
    "@type": page.schemaType,
    name: "MealScout",
    url: canonical,
    description: page.description,
    areaServed: "United States",
    serviceType:
      page.path === "/for-restaurants"
        ? "Restaurant and food truck demand generation"
        : "Host location marketplace for food trucks",
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
        { label: "Claim Food Truck", href: "/claim-truck" },
        { label: "Scout Local Dashboard", href: "/scout" },
        { label: "Sitemap", href: "/sitemap" },
      ],
      schemaType: "ProfessionalService",
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
        { label: "Public Events", href: "/events/public" },
        { label: "Sitemap", href: "/sitemap" },
      ],
      schemaType: "LocalBusiness",
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
        { label: "Sitemap", href: "/sitemap" },
      ],
      schemaType: "LocalBusiness",
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

