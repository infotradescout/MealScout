import { readFileSync } from "node:fs";

const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const adminCreateRoute = readFileSync(
  "server/routes/adminManagementRoutes.ts",
  "utf8",
);
const manualCreationStart = adminDashboard.indexOf("function ManualUserCreation");
const manualCreationEnd = adminDashboard.indexOf(
  "function ExistingUsersList",
  manualCreationStart,
);
const manualCreationSection =
  manualCreationStart >= 0 && manualCreationEnd > manualCreationStart
    ? adminDashboard.slice(manualCreationStart, manualCreationEnd)
    : adminDashboard;

const uiRequired = [
  'value="food_truck_owner"',
  "Food Truck Owner",
  "Restaurant Owner",
  "Bar Owner",
  "Brewery / Taproom Owner",
  "Caterer / Private Chef",
  "Host / Venue Operator",
  'value="supplier"',
  "Duper Admin",
];

const routeRequired = [
  "accountTypeMap",
  'bar_owner: { userType: "restaurant_owner", businessType: "bar" }',
  'food_truck_owner: { userType: "food_truck", businessType: "food_truck" }',
  'host_venue_operator: { userType: "host", businessType: "venue" }',
  "const resolvedBusinessType =",
  "businessType: resolvedBusinessType",
  "isFoodTruck:",
];

for (const snippet of uiRequired) {
  if (!manualCreationSection.includes(snippet)) {
    throw new Error(`Missing admin create-account UI snippet: ${snippet}`);
  }
}

for (const snippet of routeRequired) {
  if (!adminCreateRoute.includes(snippet)) {
    throw new Error(`Missing admin create-account route snippet: ${snippet}`);
  }
}

console.log("admin-create-account-business-types.contract: PASS");
