import { readFileSync } from "node:fs";

const audit = readFileSync("MEALSCOUT_ROLE_ADMIN_DISPLAY_AUDIT.md", "utf8");
const cleanupMap = readFileSync("CLEANUP_MAP.md", "utf8");
const roleAccess = readFileSync("server/roleAccess.ts", "utf8");
const unifiedAuth = readFileSync("server/unifiedAuth.ts", "utf8");
const adminDashboard = readFileSync(
  "client/src/pages/admin-dashboard.tsx",
  "utf8",
);
const useAuth = readFileSync("client/src/hooks/useAuth.ts", "utf8");
const dashboardSwitcher = readFileSync(
  "client/src/components/dashboard-switcher.tsx",
  "utf8",
);
const adminRoutes = readFileSync("server/adminRoutes.ts", "utf8");
const adminManagementRoutes = readFileSync(
  "server/routes/adminManagementRoutes.ts",
  "utf8",
);

const canonicalUserTypes = [
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

for (const role of canonicalUserTypes) {
  if (!roleAccess.includes(`"${role}"`)) {
    throw new Error(
      `server/roleAccess.ts must include canonical user type: ${role}`,
    );
  }
  if (!audit.includes(`\`${role}\``)) {
    throw new Error(`Audit doc must inventory canonical user type: ${role}`);
  }
}

const requiredAuditSnippets = [
  "shared/schema.ts",
  "server/roleAccess.ts",
  "server/unifiedAuth.ts",
  "server/routes/*",
  "client/src/pages/admin-dashboard.tsx",
  "client/src/hooks/useAuth.ts",
  "client/src/components/dashboard-switcher.tsx",
  "Admin Role Dropdown Inventory",
  "Business Attachment Display Rules",
  "Affiliate Link Display Rules",
  "Parking Pass Access Boundary",
  "Code-Derived User Type Values",
  "Do not use a generic `business_owner` user type",
  "No affiliate link assigned",
];

for (const snippet of requiredAuditSnippets) {
  if (!audit.includes(snippet)) {
    throw new Error(`Missing audit doc snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "const businessBearingUserTypes = new Set([",
  '"event_coordinator"',
  'if (!isBusinessBearingUserType(userType)) return "not_required";',
  "{isBusinessBearingUserType(user.userType) && (",
  "{canSendMonthlySubscriptionLink(user.userType) && (",
  '<option value="customer">Customer</option>',
  '<option value="restaurant_owner">Restaurant Owner</option>',
  '<option value="food_truck">Food Truck</option>',
  '<option value="host">Host</option>',
  '<option value="event_coordinator">',
  '<option value="staff">Staff</option>',
  '<option value="admin">Admin</option>',
  '<option value="duper_admin">Duper Admin</option>',
  '<option value="super_admin">Super Admin</option>',
  'event_coordinator: { userType: "event_coordinator"',
  "const buildCanonicalAffiliateLink = (",
  "const url = new URL(",
  "`/ref/${encodeURIComponent(tag)}`",
  "canonicalMealScoutOrigin",
  'url.searchParams.set("to", profilePath);',
  "Affiliate Link",
  "Copy Link",
  "Open Link",
  "No affiliate link assigned",
];

for (const snippet of requiredDashboardSnippets) {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Missing admin dashboard role/display guard: ${snippet}`);
  }
}

const affiliateBuilderIndex = adminDashboard.indexOf(
  "const buildCanonicalAffiliateLink = (",
);
const affiliateBuilderSlice = adminDashboard.slice(
  affiliateBuilderIndex,
  adminDashboard.indexOf(
    "const getSafeAuthProviderLabel",
    affiliateBuilderIndex,
  ),
);
if (
  affiliateBuilderIndex === -1 ||
  !affiliateBuilderSlice.includes(
    "const profilePath = getAdminUserPublicProfilePath(user, attachedHostProfile);",
  ) ||
  !affiliateBuilderSlice.includes("const url = new URL(") ||
  !affiliateBuilderSlice.includes("`/ref/${encodeURIComponent(tag)}`") ||
  !affiliateBuilderSlice.includes("canonicalMealScoutOrigin") ||
  !affiliateBuilderSlice.includes('url.searchParams.set("to", profilePath);') ||
  affiliateBuilderSlice.includes("/admin/dashboard") ||
  affiliateBuilderSlice.includes("focusUser")
) {
  throw new Error(
    "Admin primary Affiliate Link must use universal /ref/:tag?to=<profile> wrapper, not admin paths",
  );
}

const forbiddenDashboardSnippets = [
  '"business_owner"',
  'return "business_owner"',
  '<option value="event_organizer">',
  'userType: "event_organizer"',
  '<option value="restaurant_owner">Business Owner</option>',
  '<option value="food_truck">Business Owner (Truck)</option>',
  "Affiliate Tag",
];

for (const snippet of forbiddenDashboardSnippets) {
  if (adminDashboard.includes(snippet)) {
    throw new Error(
      `Admin dashboard must not contain stale role/display snippet: ${snippet}`,
    );
  }
}

if (
  !adminRoutes.includes(
    'event_coordinator: { userType: "event_coordinator", businessType: "event_organizer" }',
  )
) {
  throw new Error(
    "server/adminRoutes.ts must map event coordinator account type to canonical event_coordinator userType",
  );
}

if (
  !adminManagementRoutes.includes(
    'event_coordinator: { userType: "event_coordinator", businessType: "event_organizer" }',
  )
) {
  throw new Error(
    "server/routes/adminManagementRoutes.ts must map event coordinator account type to canonical event_coordinator userType",
  );
}

for (const source of [adminRoutes, adminManagementRoutes]) {
  if (source.includes('userType: "event_organizer"')) {
    throw new Error(
      "Admin provisioning routes must not emit event_organizer as users.userType",
    );
  }
}

const continuationBlockStart = useAuth.indexOf("const setupOnlyRoutes =");
const continuationBlockEnd = useAuth.indexOf(
  "if (!setupOnlyRoutes) return;",
  continuationBlockStart,
);
if (continuationBlockStart === -1 || continuationBlockEnd === -1) {
  throw new Error(
    "useAuth business onboarding continuation block must remain discoverable",
  );
}
const continuationBlock = useAuth.slice(
  continuationBlockStart,
  continuationBlockEnd,
);
if (continuationBlock.includes('pathname.startsWith("/parking-pass")')) {
  throw new Error(
    "Parking Pass must not be globally blocked by business onboarding redirect",
  );
}

if (!unifiedAuth.includes("event_coordinator")) {
  throw new Error("server/unifiedAuth.ts must reference event_coordinator");
}

if (!dashboardSwitcher.includes("/parking-pass?adminMode=host")) {
  throw new Error(
    "dashboard switcher must keep Parking Pass host/operator lane discoverable",
  );
}

const c5Start = cleanupMap.indexOf("## C5 - Launch Board SQL Safety Map");
const c5bStart = cleanupMap.indexOf(
  "## C5B - Code-Derived Role + Admin Display Audit",
);
const c6Start = cleanupMap.indexOf(
  "## C6 - Parking Pass Page Decomposition Map",
);
if (c5Start === -1 || c5bStart === -1 || c6Start === -1) {
  throw new Error("CLEANUP_MAP.md must include C5, C5B, and C6");
}
if (!(c5Start < c5bStart && c5bStart < c6Start)) {
  throw new Error("CLEANUP_MAP.md must insert C5B before continuing to C6");
}

const c5bSection = cleanupMap.slice(c5bStart, c6Start);
if (!c5bSection.includes("Status: `DONE`")) {
  throw new Error("CLEANUP_MAP.md must mark C5B DONE");
}

const forbiddenFeatureScope = [
  "new roles",
  "new admin features",
  "new subscription flows",
  "payout/attribution logic changes",
];
for (const phrase of forbiddenFeatureScope) {
  if (!c5bSection.toLowerCase().includes(phrase.toLowerCase())) {
    throw new Error(`C5B must explicitly disallow scope: ${phrase}`);
  }
}

console.log("mealscout-role-admin-display-audit.contract: PASS");
