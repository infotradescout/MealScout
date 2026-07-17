import { readFileSync } from "node:fs";

const page = readFileSync("client/src/pages/business-team.tsx", "utf8");
const routes = readFileSync("server/routes/businessTeamRoutes.ts", "utf8");

for (const snippet of [
  "<BusinessWorkspaceShell",
  'activeModule="team"',
  "business-team-workspace",
  'new URLSearchParams(search).get("restaurantId")',
  "onBusinessChange={handleBusinessChange}",
  "/api/business/team${params.size",
  "return response.json()",
  "Nothing is selected by default.",
  "Choose at least one area before creating the link.",
  "Account, plan, and payment access stay with the business owner.",
  "Create access link",
  "Access link ready",
  "Active team",
  "Pending invites",
  "Remove access",
  "Revoke invite",
  "AlertDialog",
]) {
  if (!page.includes(snippet)) {
    throw new Error(`Business team workspace contract missing: ${snippet}`);
  }
}

for (const permission of [
  "manageDeals: false",
  "manageParkingPass: false",
  "viewAnalytics: false",
  "manageProfile: false",
]) {
  if (!page.includes(permission)) {
    throw new Error(`Team access must default to least privilege: ${permission}`);
  }
}

for (const removedSurface of [
  "Share to Conversion Snapshot",
  "Share actions",
  "Referral clicks",
  "Paid conversion",
  "<BackHeader",
]) {
  if (page.includes(removedSurface)) {
    throw new Error(`Unrelated legacy Team surface remains: ${removedSurface}`);
  }
}

for (const snippet of [
  'app.get("/api/business/team"',
  "requestedRestaurantId",
  'String(req.query.restaurantId || "").trim()',
  "contextRestaurant?.isOwner",
  "isElevated(req.user)",
  "Only business owners can manage team access.",
  "inArray(",
  "businessStaffMemberships.restaurantId",
  "businessStaffInvites.restaurantId",
  '"/api/business/team/invites"',
  '"/api/business/team/members/:membershipId"',
  '"/api/business/team/invites/:inviteId/revoke"',
]) {
  if (!routes.includes(snippet)) {
    throw new Error(`Business team route contract missing: ${snippet}`);
  }
}

console.log("mealscout-business-team-workspace.contract: PASS");
