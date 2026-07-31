import { readFileSync } from "node:fs";

const dashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const adminRoutes = readFileSync("server/routes/admin/userAdminRoutes.ts", "utf8");
const cleanupMap = readFileSync("CLEANUP_MAP.md", "utf8");

for (const snippet of [
  "const businessBearingUserTypes = new Set([",
  '"restaurant_owner"',
  '"food_truck"',
  '"host"',
  '"event_coordinator"',
  '"supplier"',
  "const isBusinessBearingUserType = (userType?: string | null) =>",
  "const isBusinessUserType = (userType?: string | null) => {",
  '| "not_required"',
  'if (!isBusinessBearingUserType(userType)) return "not_required";',
  "{isBusinessBearingUserType(user.userType) && (",
  "attachment:",
  "email:",
  '{user.emailVerified ? "verified" : "unverified"}',
  '<option value="customer">Customer</option>',
  "updateUserType.mutate({",
  "LEGACY BILLING RECORD",
]) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing role-aware admin behavior: ${snippet}`);
  }
}

for (const retiredBillingControl of [
  "monthlySubscriptionLinkUserTypes",
  "canSendMonthlySubscriptionLink",
  "Send Monthly Link",
  "sendSubscriptionLink.mutate",
]) {
  if (dashboard.includes(retiredBillingControl)) {
    throw new Error(`Admin can still start recurring profile billing: ${retiredBillingControl}`);
  }
}

for (const routePromise of [
  '"/api/admin/users/:id/send-subscription-link"',
  "Monthly subscriptions are retired.",
]) {
  if (!adminRoutes.includes(routePromise)) {
    throw new Error(`Retired admin route is not safely blocked: ${routePromise}`);
  }
}

const c5bStart = cleanupMap.indexOf("## C5B - Code-Derived Role + Admin Display Audit");
const c6Start = cleanupMap.indexOf("## C6 - Parking Pass Page Decomposition Map");
const c5bSection =
  c5bStart >= 0
    ? cleanupMap.slice(c5bStart, c6Start >= 0 ? c6Start : cleanupMap.length)
    : "";

if (!c5bSection || !c5bSection.includes("Status: `DONE`")) {
  throw new Error("CLEANUP_MAP.md must retain the completed C5B audit record");
}

console.log("admin-user-role-business-attachment.contract: PASS");
