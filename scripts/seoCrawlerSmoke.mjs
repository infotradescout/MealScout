const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000").replace(
  /\/+$/,
  "",
);

const checks = [
  {
    path: "/robots.txt",
    type: "text/plain",
    includes: [
      "Sitemap:",
      "/sitemap-index.xml",
      "/llms.txt",
      "/ai-summary.json",
      "/opensearch.xml",
      "Meta-ExternalAgent",
      "bingbot",
    ],
  },
  {
    path: "/sitemap-index.xml",
    type: "application/xml",
    includes: ["<sitemapindex", "/sitemap.xml", "/sitemap-videos.xml"],
  },
  {
    path: "/sitemap-videos.xml",
    type: "application/xml",
    includes: ["<urlset"],
  },
  {
    path: "/llms.txt",
    type: "text/plain",
    includes: [
      "# MealScout",
      "Quick Facts for AI Answers",
      "Menu highlights:",
      "Machine-Readable Resources",
      "Business Profile Pages",
    ],
  },
  {
    path: "/ai-summary.json",
    type: "application/ld+json",
    includes: [
      '"@context": "https://schema.org"',
      '"name": "MealScout"',
      '"menuHighlights"',
      '"answerGuidance"',
    ],
  },
  {
    path: "/.well-known/ai-summary.json",
    type: "application/ld+json",
    includes: ['"@context": "https://schema.org"', '"name": "MealScout"'],
  },
  {
    path: "/answers/mealscout",
    type: "text/html",
    includes: [
      "MealScout Quick Facts",
      "Menu Highlights",
      "The MealScout website is available online 24/7",
      "info.mealscout@gmail.com",
    ],
  },
  {
    path: "/opensearch.xml",
    type: "application/opensearchdescription+xml",
    includes: ["OpenSearchDescription", "/search?q={searchTerms}"],
  },
  {
    path: "/for-restaurants?prerender=1",
    type: "text/html",
    includes: ["application/ld+json", "MealScout"],
  },
  {
    path: "/map?prerender=1",
    type: "text/html",
    includes: ["application/ld+json", "Food trucks"],
  },
  {
    path: "/video?prerender=1",
    type: "text/html",
    includes: ["application/ld+json", "Local food videos"],
  },
  {
    path: "/share-hub?prerender=1",
    type: "text/html",
    includes: ["application/ld+json", "Share MealScout"],
  },
  {
    path: "/truck-onboarding?prerender=1",
    type: "text/html",
    includes: ["application/ld+json", "List or claim your food truck"],
  },
  {
    path: "/events?prerender=1",
    type: "text/html",
    includes: ["application/ld+json", "Open food truck events"],
  },
];

let failures = 0;

for (const check of checks) {
  const url = `${baseUrl}${check.path}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "MealScoutSEOSmoke/1.0 (+https://www.mealscout.us)",
    },
  });
  const body = await response.text();
  const contentType = response.headers.get("content-type") || "";
  const missing = check.includes.filter((token) => !body.includes(token));
  const typeOk = contentType.includes(check.type);

  if (!response.ok || !typeOk || missing.length > 0) {
    failures += 1;
    console.error(
      `[FAIL] ${check.path} status=${response.status} content-type=${contentType} missing=${missing.join(",")}`,
    );
  } else {
    console.log(`[PASS] ${check.path}`);
  }
}

if (failures > 0) process.exit(1);
console.log("SEO crawler smoke checks passed.");
