import { readFileSync } from "node:fs";

const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");

const routeStart = adminCoreOpsRoutes.indexOf('"/api/admin/food-trucks/inventory"');
if (routeStart === -1) {
  throw new Error("Missing admin food truck inventory route.");
}

const routeEnd = adminCoreOpsRoutes.indexOf('"/api/admin/stats"', routeStart);
const inventoryRoute = adminCoreOpsRoutes.slice(
  routeStart,
  routeEnd === -1 ? undefined : routeEnd,
);

[
  "isStaffOrAdmin",
  "restaurants.isFoodTruck",
  "restaurants.businessType",
  "restaurants.websiteUrl",
  "menuItems.restaurantId",
  "ownerEmail",
  "missingFields",
  "res.json({ trucks, counts })",
].forEach((snippet) => {
  if (!inventoryRoute.includes(snippet)) {
    throw new Error(`Food truck inventory route missing snippet: ${snippet}`);
  }
});

[
  "restaurants.email",
  "restaurants.rawData",
  "${restaurants}.email",
  "${restaurants}.raw_data",
].forEach((snippet) => {
  if (inventoryRoute.includes(snippet)) {
    throw new Error(`Food truck inventory route uses drift-prone snippet: ${snippet}`);
  }
});

[
  'value="food-trucks"',
  "Food Truck Profile Inventory",
  '"/api/admin/food-trucks/inventory"',
  "Failed to load food truck inventory.",
  "refetchFoodTruckInventory",
].forEach((snippet) => {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Admin dashboard missing food truck inventory snippet: ${snippet}`);
  }
});

console.log("admin-food-truck-inventory.contract: PASS");
