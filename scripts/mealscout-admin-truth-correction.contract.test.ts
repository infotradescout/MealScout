import { readFileSync } from "node:fs";

const audit = readFileSync("MEALSCOUT_ADMIN_TRUTH_AUDIT.md", "utf8");
const dashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const useAuth = readFileSync("client/src/hooks/useAuth.ts", "utf8");
const roleAccess = readFileSync("server/roleAccess.ts", "utf8");

const requiredAuditSnippets = [
  "Current code says:",
  "Current UI showed:",
  "This is wrong because:",
  "Correction:",
  "Test guarding it:",
  "Customer Business Attachment",
  "Customer Business-Only Controls",
  "Affiliate Link Display",
  "Role Dropdown Truth",
  "Parking Pass Free Management Boundary",
  "No new roles were introduced.",
  "No product features were introduced.",
];

for (const snippet of requiredAuditSnippets) {
  if (!audit.includes(snippet)) {
    throw new Error(`Missing admin truth audit snippet: ${snippet}`);
  }
}

const canonicalRoles = [
  "customer",
  "restaurant_owner",
  "food_truck",
  "supplier",
  "host",
  "event_coordinator",
  "staff",
  "admin",
  "duper_admin",
  "super_admin",
];

for (const role of canonicalRoles) {
  if (!roleAccess.includes(`"${role}"`)) {
    throw new Error(`Role source of truth is missing expected role: ${role}`);
  }
}

const requiredDashboardSnippets = [
  'if (!isBusinessBearingUserType(userType)) return "not_required";',
  "{isBusinessBearingUserType(user.userType) && (",
  "{isBusinessUserType(user.userType) &&",
  "Attach Business",
  "Create Business Shell",
  "Affiliate Link",
  "const buildCanonicalAffiliateLink = (",
  "const profilePath = getAdminUserPublicProfilePath(",
  "const url = new URL(profilePath, canonicalMealScoutOrigin);",
  "url.pathname = normalizedPathname;",
  'url.searchParams.set("ref", tag);',
  'url.searchParams.delete("to");',
  "https://www.mealscout.us",
  "Copy Link",
  "Open Link",
  "No affiliate link assigned",
  '<option value="customer">Customer</option>',
  '<option value="restaurant_owner">Restaurant Owner</option>',
  '<option value="food_truck">Food Truck</option>',
  '<option value="host">Host</option>',
  '<option value="event_coordinator">',
  '<option value="supplier">Supplier</option>',
  '<option value="staff">Staff</option>',
  '<option value="admin">Admin</option>',
  '<option value="duper_admin">Duper Admin</option>',
  '<option value="super_admin">Super Admin</option>',
];

for (const snippet of requiredDashboardSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing admin truth correction snippet: ${snippet}`);
  }
}

const affiliateBuilderIndex = dashboard.indexOf(
  "const buildCanonicalAffiliateLink = (",
);
const affiliateBuilderEnd = dashboard.indexOf(
  "const businessTypeOptions",
  affiliateBuilderIndex,
);
if (affiliateBuilderIndex === -1 || affiliateBuilderEnd === -1) {
  throw new Error("Canonical affiliate link builder must remain discoverable");
}
const affiliateBuilderSlice = dashboard.slice(
  affiliateBuilderIndex,
  affiliateBuilderEnd,
);
for (const forbidden of [
  'url.searchParams.set("to"',
  "?ref=",
  "/ref/",
  "/admin/dashboard",
  "focusUser",
]) {
  if (affiliateBuilderSlice.includes(forbidden)) {
    throw new Error(
      `Canonical affiliate link builder must not use stale/admin attribution: ${forbidden}`,
    );
  }
}

const customerNotRequiredIndex = dashboard.indexOf(
  'if (!isBusinessBearingUserType(userType)) return "not_required";',
);
const invalidMissingIndex = dashboard.indexOf(
  'return "invalid_missing_business";',
  customerNotRequiredIndex,
);
if (customerNotRequiredIndex === -1 || invalidMissingIndex === -1) {
  throw new Error(
    "Customer/non-business users must resolve before invalid_missing_business",
  );
}

const attachmentBadgeIndex = dashboard.indexOf(
  "{isBusinessBearingUserType(user.userType) && (",
);
const attachmentTextIndex = dashboard.indexOf(
  "attachment:",
  attachmentBadgeIndex,
);
if (attachmentBadgeIndex === -1 || attachmentTextIndex === -1) {
  throw new Error(
    "Business attachment badge must be gated by business-bearing role",
  );
}

const attachControlIndex = dashboard.indexOf("Attach Business");
const attachGateIndex = dashboard.lastIndexOf(
  "{isBusinessUserType(user.userType) &&",
  attachControlIndex,
);
if (attachControlIndex === -1 || attachGateIndex === -1) {
  throw new Error("Attach Business control must be gated by business role");
}

for (const retiredRecurringControl of [
  "Send Monthly Link",
  "canSendMonthlySubscriptionLink",
  "sendSubscriptionLink.mutate",
]) {
  if (dashboard.includes(retiredRecurringControl)) {
    throw new Error(
      `Admin dashboard still exposes recurring profile billing: ${retiredRecurringControl}`,
    );
  }
}

const forbiddenDashboardSnippets = [
  "Affiliate Tag",
  '"business_owner"',
  'return "business_owner"',
  '<option value="event_organizer">',
  'userType: "event_organizer"',
  '<option value="restaurant_owner">Business Owner</option>',
  '<option value="food_truck">Business Owner (Truck)</option>',
  "userXXXX",
  "No tag",
];

for (const snippet of forbiddenDashboardSnippets) {
  if (dashboard.includes(snippet)) {
    throw new Error(
      `Admin dashboard contains forbidden stale/invented display snippet: ${snippet}`,
    );
  }
}

const dropdownOptionMatches = Array.from(
  dashboard.matchAll(/<option value="([^"]+)">(?:.|\n)*?<\/option>/g),
).map((match) => match[1]);
const dropdownAllowedValues = new Set([...canonicalRoles, "unknown"]);
for (const value of dropdownOptionMatches) {
  if (
    value.includes("_owner") ||
    canonicalRoles.includes(value) ||
    value === "unknown"
  ) {
    if (
      !dropdownAllowedValues.has(value) &&
      ![
        "food_truck_owner",
        "bar_owner",
        "brewery_taproom_owner",
        "caterer_owner",
        "private_chef_owner",
        "host_venue_operator",
      ].includes(value)
    ) {
      throw new Error(
        `Role dropdown contains unsupported userType value: ${value}`,
      );
    }
  }
}

const businessRedirectStart = useAuth.indexOf("const setupOnlyRoutes =");
const businessRedirectEnd = useAuth.indexOf(
  "if (!setupOnlyRoutes) return;",
  businessRedirectStart,
);
if (businessRedirectStart === -1 || businessRedirectEnd === -1) {
  throw new Error(
    "useAuth business onboarding redirect block must be discoverable",
  );
}
const businessRedirectBlock = useAuth.slice(
  businessRedirectStart,
  businessRedirectEnd,
);
if (businessRedirectBlock.includes('pathname.startsWith("/parking-pass")')) {
  throw new Error(
    "Parking Pass management must not be blocked by unrelated business onboarding redirect",
  );
}

const forbiddenFeaturePhrases = [
  "new role model",
  "new permission model",
  "new affiliate feature",
  "new parking pass feature",
  "new product feature",
];

for (const phrase of forbiddenFeaturePhrases) {
  if (audit.toLowerCase().includes(phrase)) {
    throw new Error(
      `Admin truth audit must not introduce feature/design scope: ${phrase}`,
    );
  }
}

console.log("mealscout-admin-truth-correction.contract: PASS");
