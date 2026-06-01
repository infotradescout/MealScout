import { readFileSync } from "node:fs";

const dashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const adminRoutes = readFileSync("server/adminRoutes.ts", "utf8");
const adminManagementRoutes = readFileSync(
  "server/routes/adminManagementRoutes.ts",
  "utf8",
);

const requiredSnippets = [
  "food_truck_owner",
  "restaurant_owner",
  "bar_owner",
  "brewery_taproom_owner",
  "caterer_owner",
  "private_chef_owner",
  "host_venue_operator",
  "supplier",
  "event_organizer",
  "customer",
  "staff",
  "admin",
  "super_admin",
  "businessType: \"bar\"",
  "businessType: \"brewery_taproom\"",
  "businessType: \"caterer\"",
  "businessType: \"private_chef\"",
  "businessType: \"host_venue\"",
  "businessType: \"event_organizer\"",
  "servesFood",
  "hostsFoodTrucks",
  "wantsFoodTrucks",
  "runsEvents",
  "postsSpecials",
  "allowsPrivateEvents",
  "hasFeaturedStaff",
  "Unknown account type",
];

for (const snippet of requiredSnippets) {
  if (
    !dashboard.includes(snippet) &&
    !adminRoutes.includes(snippet) &&
    !adminManagementRoutes.includes(snippet)
  ) {
    throw new Error(`Missing onboarding E2E contract snippet: ${snippet}`);
  }
}

const forbiddenSnippets = [
  "businessType: \"caterer_private_chef\"",
  "businessType: \"venue\"",
];

for (const snippet of forbiddenSnippets) {
  if (adminRoutes.includes(snippet) || adminManagementRoutes.includes(snippet)) {
    throw new Error(`Found forbidden onboarding snippet: ${snippet}`);
  }
}

console.log("admin-onboarding-end-to-end.contract: PASS");
