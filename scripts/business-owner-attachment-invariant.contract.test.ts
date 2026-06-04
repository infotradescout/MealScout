import { readFileSync } from "node:fs";

const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const adminRoutes = readFileSync("server/adminRoutes.ts", "utf8");
const signupPage = readFileSync("client/src/pages/restaurant-signup.tsx", "utf8");

const requiredDashboardSnippets = [
  "type BusinessAttachmentState =",
  "\"attached\"",
  "\"not_required\"",
  "\"pending_invite\"",
  "\"pending_claim\"",
  "\"admin_import_draft\"",
  "\"orphan_needs_repair\"",
  "\"needs_business_shell\"",
  "\"invalid_missing_business\"",
  "function resolveBusinessAttachmentState(",
  "if (!isBusinessBearingUserType(userType)) return \"not_required\";",
  "return \"needs_business_shell\";",
  "return \"invalid_missing_business\";",
  "Business attachment:",
  "Link state:",
  "needs_business_shell",
];

const forbiddenDashboardSnippets = [
  "Business link: not_attached",
  "link state: not_attached",
  "\"not_attached\"",
];

const requiredRoutesSnippets = [
  "food_truck_owner: { userType: \"food_truck\", businessType: \"food_truck\" }",
  "restaurant_owner: { userType: \"restaurant_owner\", businessType: \"restaurant\" }",
  "bar_owner: { userType: \"restaurant_owner\", businessType: \"bar\" }",
  "host_venue_operator: { userType: \"host\", businessType: \"host_venue\" }",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Missing dashboard invariant snippet: ${snippet}`);
  }
}

for (const snippet of forbiddenDashboardSnippets) {
  if (adminDashboard.includes(snippet)) {
    throw new Error(`Found forbidden dashboard fallback snippet: ${snippet}`);
  }
}

for (const snippet of requiredRoutesSnippets) {
  if (!adminRoutes.includes(snippet)) {
    throw new Error(`Missing route invariant snippet: ${snippet}`);
  }
}

if (
  !adminDashboard.includes("create-and-attach") &&
  !signupPage.includes("create-and-attach")
) {
  throw new Error("Missing create-and-attach owner-link flow reference");
}

console.log("business-owner-attachment-invariant.contract: PASS");
