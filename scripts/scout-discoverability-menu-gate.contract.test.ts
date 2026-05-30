import { readFileSync } from "node:fs";

const locationUtility = readFileSync("server/routes/locationUtilityRoutes.ts", "utf8");
const restaurantOps = readFileSync("server/routes/restaurantOperationsRoutes.ts", "utf8");
const publicDiscovery = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");
const loginContinuation = readFileSync("server/services/loginContinuation.ts", "utf8");

const requiredLocationSnippets = [
  "const menuEligibleIds = new Set<string>();",
  ".from(menuItems)",
  "const discoverableRestaurants = restaurants.filter",
  "X-MealScout-Filtered-Missing-Menu",
];

for (const snippet of requiredLocationSnippets) {
  if (!locationUtility.includes(snippet)) {
    throw new Error(`Missing subscribed-restaurants menu gate snippet: ${snippet}`);
  }
}

const requiredTruckSnippets = [
  "const menuEligibleTrucks = payloadTrucks.filter",
  ".from(menuItems)",
  "X-MealScout-Filtered-Missing-Menu",
  "const trustedPayloadTrucks = menuEligibleTrucks.filter",
];

for (const snippet of requiredTruckSnippets) {
  if (!restaurantOps.includes(snippet)) {
    throw new Error(`Missing live-trucks menu gate snippet: ${snippet}`);
  }
}

if (!publicDiscovery.includes('app.get("/api/public/profiles/:entity/:id", async (req, res) => {')) {
  throw new Error("Direct public profile route must remain resolvable.");
}

if (
  !loginContinuation.includes(
    'reason = "Add at least one menu item so customers can discover your business.";',
  )
) {
  throw new Error("Missing continuation reason for zero-menu linked businesses.");
}

console.log("scout-discoverability-menu-gate.contract: PASS");
