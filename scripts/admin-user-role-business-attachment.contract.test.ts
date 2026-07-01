import { readFileSync } from "node:fs";

const dashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const cleanupMap = readFileSync("CLEANUP_MAP.md", "utf8");

const requiredDashboardSnippets = [
  "const businessBearingUserTypes = new Set([",
  "\"restaurant_owner\"",
  "\"food_truck\"",
  "\"host\"",
  "\"event_coordinator\"",
  "\"supplier\"",
  "const isBusinessBearingUserType = (userType?: string | null) =>",
  "const isBusinessUserType = (userType?: string | null) => {",
  "const monthlySubscriptionLinkUserTypes = new Set([",
  "const canSendMonthlySubscriptionLink = (userType?: string | null) =>",
  "| \"not_required\"",
  "if (!isBusinessBearingUserType(userType)) return \"not_required\";",
  "{isBusinessBearingUserType(user.userType) && (",
  "attachment:",
  "email:",
  "{user.emailVerified ? \"verified\" : \"unverified\"}",
  "{canSendMonthlySubscriptionLink(user.userType) && (",
  "Send Monthly Link",
  "<option value=\"customer\">Customer</option>",
  "onChange={(e) =>",
  "updateUserType.mutate({",
];

const forbiddenDashboardSnippets = [
  "!user.email ||\n                              ![\"restaurant_owner\", \"food_truck\"].includes",
  "<Button\n                            size=\"sm\"\n                            variant=\"outline\"\n                            onClick={() => sendSubscriptionLink.mutate(user.id)}",
  "\"business_owner\"",
];

for (const snippet of requiredDashboardSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing role-aware business attachment guard: ${snippet}`);
  }
}

for (const snippet of forbiddenDashboardSnippets) {
  if (dashboard.includes(snippet)) {
    throw new Error(`Found forbidden broad customer/business attachment pattern: ${snippet}`);
  }
}

const customerNotRequiredIndex = dashboard.indexOf(
  "if (!isBusinessBearingUserType(userType)) return \"not_required\";",
);
const invalidMissingIndex = dashboard.indexOf("return \"invalid_missing_business\";", customerNotRequiredIndex);
if (customerNotRequiredIndex === -1 || invalidMissingIndex === -1) {
  throw new Error("Customer/non-business attachment path must resolve before invalid_missing_business");
}

const attachmentBadgeIndex = dashboard.indexOf("{isBusinessBearingUserType(user.userType) && (");
const attachmentLabelIndex = dashboard.indexOf("attachment:", attachmentBadgeIndex);
if (attachmentBadgeIndex === -1 || attachmentLabelIndex === -1) {
  throw new Error("Admin user card attachment badge must be gated by business-bearing role");
}

const monthlyGateIndex = dashboard.indexOf("{canSendMonthlySubscriptionLink(user.userType) && (");
const monthlyButtonIndex = dashboard.indexOf("Send Monthly Link", monthlyGateIndex);
if (monthlyGateIndex === -1 || monthlyButtonIndex === -1) {
  throw new Error("Send Monthly Link must be hidden behind a subscription-role gate");
}

const emailBadgeLabelIndex = dashboard.indexOf("email:");
const emailBadgeValueIndex = dashboard.indexOf(
  "{user.emailVerified ? \"verified\" : \"unverified\"}",
  emailBadgeLabelIndex,
);
if (emailBadgeLabelIndex === -1 || emailBadgeValueIndex === -1) {
  throw new Error("Email verification status must remain visible on admin user cards");
}

const roleDropdownIndex = dashboard.indexOf("<option value=\"customer\">Customer</option>");
if (roleDropdownIndex === -1) {
  throw new Error("Admin role dropdown must keep the customer role option");
}

const c5bStart = cleanupMap.indexOf("## C5B - Code-Derived Role + Admin Display Audit");
const c6Start = cleanupMap.indexOf("## C6 - Parking Pass Page Decomposition Map");
const c5bSection =
  c5bStart >= 0
    ? cleanupMap.slice(c5bStart, c6Start >= 0 ? c6Start : cleanupMap.length)
    : "";

const featureScopePhrases = [
  "new campaign",
  "new subscription product",
  "new customer feature",
];

for (const phrase of featureScopePhrases) {
  if (c5bSection.toLowerCase().includes(phrase)) {
    throw new Error(`C5B must not introduce product feature scope: ${phrase}`);
  }
}

if (!c5bSection) {
  throw new Error("CLEANUP_MAP.md must include C5B");
}

if (!c5bSection.includes("Status: `DONE`")) {
  throw new Error("CLEANUP_MAP.md must mark C5B DONE");
}

console.log("admin-user-role-business-attachment.contract: PASS");
