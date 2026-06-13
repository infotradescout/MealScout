import { readFileSync } from "node:fs";

const locationUtility = readFileSync("server/routes/locationUtilityRoutes.ts", "utf8");
const restaurantOps = readFileSync("server/routes/restaurantOperationsRoutes.ts", "utf8");
const publicDiscovery = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");
const loginContinuation = readFileSync("server/services/loginContinuation.ts", "utf8");

const requiredLocationSnippets = [
  "const menuEligibleIds = new Set<string>();",
  "const menuCounts: Record<string, number> = {};",
  ".from(menuItems)",
  "const discoverableRestaurants = restaurants.filter",
  'String(restaurant?.businessType || "").toLowerCase() === "food_truck"',
  "return isTruck || menuEligibleIds.has",
  "menuItemCount: menuCounts[String(restaurant.id)] || 0,",
  "menuAvailable: menuEligibleIds.has(String(restaurant.id)),",
  "X-MealScout-Filtered-Missing-Menu",
];

for (const snippet of requiredLocationSnippets) {
  if (!locationUtility.includes(snippet)) {
    throw new Error(`Missing subscribed-restaurants menu gate snippet: ${snippet}`);
  }
}

const requiredTruckSnippets = [
  "const menuEligibleTrucks = payloadTrucks.map",
  ".from(menuItems)",
  'res.setHeader("X-MealScout-Filtered-Missing-Menu", "0");',
  "menuItemCount: menuCounts.get(String(truck?.id || \"\").trim()) || 0,",
  "menuAvailable: menuEligibleIds.has(String(truck?.id || \"\").trim()),",
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
