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
      "/opensearch.xml",
    ],
  },
  {
    path: "/sitemap-index.xml",
    type: "application/xml",
    includes: ["<sitemapindex", "/sitemap.xml", "/sitemap-videos.xml"],
  },
  {
    path: "/llms.txt",
    type: "text/plain",
    includes: ["# MealScout", "Priority Pages", "Business Profile Pages"],
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
