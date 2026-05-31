import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");
const discoveryGate = readFileSync("server/routes/locationUtilityRoutes.ts", "utf8");

const requiredOwnerSnippets = [
  "const isMenuGatedFromScoutDiscoverability = canonicalMenuItemCount <= 0;",
  "Not discoverable in Scout yet.",
  "Add at least one menu item so customers can discover your business.",
];

for (const snippet of requiredOwnerSnippets) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Missing owner discoverability messaging snippet: ${snippet}`);
  }
}

if (!discoveryGate.includes("const discoverableRestaurants = restaurants.filter")) {
  throw new Error("Scout discovery menu gating must remain in customer-facing discovery.");
}

console.log("owner-discoverability-menu-state.contract: PASS");
