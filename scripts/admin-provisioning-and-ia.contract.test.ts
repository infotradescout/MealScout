import { readFileSync } from "node:fs";

const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const adminRoutes = readFileSync("server/adminRoutes.ts", "utf8");

const requiredDashboardSnippets = [
  "Provision User + Business Access",
  "Users are people accounts. Businesses are separate entities.",
  "Role/account type is separate from business category and discovery",
  "<option value=\"bar_owner\">Bar Owner</option>",
  "<option value=\"brewery_taproom_owner\">Brewery / Taproom Owner</option>",
  "businessType: \"bar\"",
  "businessType: \"brewery_taproom\"",
  "businessType: \"caterer_private_chef\"",
  "Business Information",
  "Business staff - attach to an existing business or send pending invite",
];

const requiredRouteSnippets = [
  "bar_owner: { userType: \"restaurant_owner\", businessType: \"bar\" }",
  "brewery_taproom_owner: { userType: \"restaurant_owner\", businessType: \"brewery_taproom\" }",
  "caterer_private_chef_owner: {",
  "businessType: \"caterer_private_chef\"",
  "shouldCreateBusinessShell =",
  "const createdBusiness = await storage.createRestaurantForUser({",
  "await storage.updateRestaurant(createdBusiness.id, {",
  "isFoodTruck: String(resolvedBusinessType || \"\") === \"food_truck\"",
  "staff: { userType: \"staff\", businessType: null }",
  "customer: { userType: \"customer\", businessType: null }",
];

const forbiddenSnippets = [
  "Duperrr Admin",
  "businessType: \"brewery\"",
  "businessType: \"caterer\",",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Missing admin dashboard provisioning snippet: ${snippet}`);
  }
}

for (const snippet of requiredRouteSnippets) {
  if (!adminRoutes.includes(snippet)) {
    throw new Error(`Missing admin route provisioning snippet: ${snippet}`);
  }
}

for (const snippet of forbiddenSnippets) {
  if (adminDashboard.includes(snippet) || adminRoutes.includes(snippet)) {
    throw new Error(`Found forbidden provisioning snippet: ${snippet}`);
  }
}

console.log("admin-provisioning-and-ia.contract: PASS");

