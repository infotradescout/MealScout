import { readFileSync } from "fs";

const discoveryRoutes = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");
const seoLandingPage = readFileSync("client/src/pages/public-seo-landing.tsx", "utf8");
const adminControlCenter = readFileSync("client/src/pages/AdminControlCenter.tsx", "utf8");

const requiredServerSnippets = [
  'app.post("/api/public/discovery-analytics"',
  "DISCOVERY_ANALYTICS_EVENT_TYPES",
  "DISCOVERY_SOURCE_PAGE_TYPES",
  "discovery_page_view",
  "discovery_card_click",
  "discovery_profile_click",
  "discovery_cta_click",
  'app.get("/api/admin/discovery-analytics"',
  'eq(requestLogs.surface, "public_discovery")',
  'eq(requestLogs.eventType, "discovery_event")',
];

for (const snippet of requiredServerSnippets) {
  if (!discoveryRoutes.includes(snippet)) {
    throw new Error(`Missing required discovery analytics server snippet: ${snippet}`);
  }
}

const requiredClientSnippets = [
  'fetch(apiUrl("/api/public/discovery-analytics")',
  "eventType: \"discovery_page_view\"",
  "eventType: \"discovery_card_click\"",
  "eventType: \"discovery_profile_click\"",
  "sourcePageType",
];

for (const snippet of requiredClientSnippets) {
  if (!seoLandingPage.includes(snippet)) {
    throw new Error(`Missing required discovery analytics client snippet: ${snippet}`);
  }
}

if (!adminControlCenter.includes("/api/admin/discovery-analytics?window=")) {
  throw new Error("Admin Control Center is missing discovery analytics aggregate fetch");
}

if (!adminControlCenter.includes("Public Discovery Analytics")) {
  throw new Error("Admin Control Center is missing Public Discovery Analytics panel");
}

if (seoLandingPage.includes("/api/restaurants")) {
  throw new Error("public-seo-landing.tsx must not call /api/restaurants");
}

if (seoLandingPage.includes("/api/parking-pass")) {
  throw new Error("public-seo-landing.tsx must not call /api/parking-pass");
}

if (discoveryRoutes.includes("res.json(requestLogs")) {
  throw new Error("Discovery analytics must not expose raw request logs");
}

console.log("public-discovery-analytics.contract: PASS");
