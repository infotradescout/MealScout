import { readFileSync } from "node:fs";

const appRoutes = readFileSync("client/src/App.tsx", "utf8");
const publicSeoPage = readFileSync("client/src/pages/public-seo-landing.tsx", "utf8");
const publicSeoRoutes = readFileSync("server/routes/publicSeoLandingRoutes.ts", "utf8");
const routerRegistry = readFileSync("server/routes.ts", "utf8");
const seoRoutes = readFileSync("server/routes/seoRoutes.ts", "utf8");
const prerender = readFileSync("server/seo/publicProfilePrerender.ts", "utf8");
const vercelConfig = readFileSync("vercel.json", "utf8");
const publicProfile = readFileSync("client/src/pages/public-profile.tsx", "utf8");

const requiredClientRoutes = [
  '"/food-trucks/:citySlug"',
  '"/food-trucks-today/:city"',
  '"/deals-today/:city"',
  '"/events-today/:city"',
  '"/city/:city/food"',
  '"/cuisine/:cuisine/:city"',
  '"/locations-with-trucks/:city"',
];

for (const snippet of requiredClientRoutes) {
  if (!appRoutes.includes(snippet)) {
    throw new Error(`SEO client route missing: ${snippet}`);
  }
}

if (!routerRegistry.includes("registerPublicSeoLandingRoutes(app);")) {
  throw new Error("Public SEO routes are not registered in server routes");
}

const requiredApiRoutes = [
  "/api/public/seo/food-trucks/:city",
  "/api/public/seo/food-trucks-today/:city",
  "/api/public/seo/deals-today/:city",
  "/api/public/seo/events-today/:city",
  "/api/public/seo/city/:city/food",
  "/api/public/seo/cuisine/:cuisine/:city?",
  "/api/public/seo/locations-with-trucks/:city",
  "assertPublicResponseSafe",
  "profilePath",
  "primaryCtaPath",
];

for (const snippet of requiredApiRoutes) {
  if (!publicSeoRoutes.includes(snippet)) {
    throw new Error(`SEO API route/payload missing: ${snippet}`);
  }
}

const requiredSitemapSnippets = [
  "/food-trucks-today/",
  "/deals-today/",
  "/events-today/",
  "/city/",
  "/locations-with-trucks/",
  "/cuisine/",
];
for (const snippet of requiredSitemapSnippets) {
  if (!seoRoutes.includes(snippet)) {
    throw new Error(`Sitemap missing SEO landing inclusion: ${snippet}`);
  }
}

const cityFoodRouteIndex = appRoutes.indexOf('path="/city/:city/food"');
const genericCityModeIndex = appRoutes.indexOf('path="/city/:city/:mode"');
if (cityFoodRouteIndex < 0 || genericCityModeIndex < 0 || cityFoodRouteIndex > genericCityModeIndex) {
  throw new Error("City SEO route must run before the generic city mode route");
}

for (const snippet of [
  '"/food-trucks/:city"',
  '"/food-trucks-today/:city"',
  '"/city/:city/food"',
  '"/deals-today/:city"',
  '"/events-today/:city"',
  '"/locations-with-trucks/:city"',
  '"/cuisine/:cuisine/:city"',
]) {
  if (!vercelConfig.includes(snippet)) {
    throw new Error(`Vercel SEO rewrite missing: ${snippet}`);
  }
}

if (!publicSeoRoutes.includes('case "city"') || !publicSeoRoutes.includes("encodedCity")) {
  throw new Error("SEO API canonical mapping for city pages is missing");
}
if (!publicSeoRoutes.includes('case "cuisine"') || !publicSeoRoutes.includes("encodedCuisine")) {
  throw new Error("SEO API canonical mapping for cuisine pages is missing");
}

const requiredPrerenderRoutes = [
  "/food-trucks/:city",
  "/food-trucks-today/:city",
  "/deals-today/:city",
  "/events-today/:city",
  "/city/:city/food",
  "/cuisine/:cuisine/:city?",
  "/locations-with-trucks/:city",
];
for (const snippet of requiredPrerenderRoutes) {
  if (!prerender.includes(snippet)) {
    throw new Error(`Prerender SEO route missing: ${snippet}`);
  }
}

const bannedClaimPhrases = [" top-rated ", " #1 ", " elite ", " highest quality "];
const routeCopy = publicSeoRoutes.toLowerCase().replace(/\s+/g, " ");
for (const phrase of bannedClaimPhrases) {
  if (routeCopy.includes(phrase)) {
    throw new Error(`Banned ranking claim introduced in public SEO routes: ${phrase.trim()}`);
  }
}

if (!publicSeoPage.includes("canonicalUrl")) {
  throw new Error("Public SEO page is missing canonical metadata wiring");
}

if (!publicProfile.includes("/city/") || !publicProfile.includes("/food-trucks-today/")) {
  throw new Error("Public profile related discovery links were not added");
}

console.log("public-seo-landing-pages.contract: PASS");
