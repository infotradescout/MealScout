import { readFileSync } from "node:fs";

const growthLedger = readFileSync("docs/MEALSCOUT_GROWTH_LEDGER.md", "utf8");
const discoveryRoutes = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");
const publicProfilePage = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const operationsRoutes = readFileSync("server/routes/restaurantOperationsRoutes.ts", "utf8");

const canonicalKpiEvents = [
  "public_discovery_view",
  "public_profile_view",
  "public_profile_action",
  "claim_started",
  "claim_completed",
  "owner_profile_updated",
  "parking_pass_listing_created",
  "parking_pass_booking_started",
  "parking_pass_booking_confirmed",
  "affiliate_profile_link_opened",
];

for (const eventName of canonicalKpiEvents) {
  if (!growthLedger.includes(`\`${eventName}\``)) {
    throw new Error(`Growth ledger missing canonical KPI event: ${eventName}`);
  }
}

const requiredAnalyticsAnchors = [
  {
    fileLabel: "publicDiscoveryRoutes",
    source: discoveryRoutes,
    snippets: ["discovery_page_view", "profile_view", "menu_click", "directions_click", "call_click", "order_click", "truck_booking_click"],
  },
  {
    fileLabel: "public-profile page",
    source: publicProfilePage,
    snippets: ["profile_view", "menu_click", "directions_click", "call_click", "order_click", "truck_booking_click"],
  },
  {
    fileLabel: "restaurantOperationsRoutes",
    source: operationsRoutes,
    snippets: ["profile_view", "menu_click", "directions_click", "call_click", "order_click", "truck_booking_click"],
  },
];

for (const anchor of requiredAnalyticsAnchors) {
  for (const snippet of anchor.snippets) {
    if (!anchor.source.includes(snippet)) {
      throw new Error(`Missing analytics anchor "${snippet}" in ${anchor.fileLabel}.`);
    }
  }
}

console.log("mealscout-growth-loop.contract: PASS");
