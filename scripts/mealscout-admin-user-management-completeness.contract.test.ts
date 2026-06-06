import { readFileSync } from "node:fs";

const audit = readFileSync(
  "MEALSCOUT_ADMIN_USER_MANAGEMENT_COMPLETENESS_AUDIT.md",
  "utf8",
);
const dashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const userAdminRoutes = readFileSync(
  "server/routes/admin/userAdminRoutes.ts",
  "utf8",
);

const requiredAuditSnippets = [
  "## 1) What The Current User Card Already Shows",
  "## 2) What Is Available Via Existing Admin APIs",
  "## 3) Missing-But-Supported Before Patch",
  "## 4) Missing Entirely (Documented Unsupported)",
  "## 5) Safe-To-Expose Actions",
  "## 6) Role/User-Type Visibility Rules",
  "## 7) Internal/Debug Fields (Operator-Only)",
  "## 8) Forbidden Secret Exposure Check",
  "No backend route behavior was changed.",
];

for (const snippet of requiredAuditSnippets) {
  if (!audit.includes(snippet)) {
    throw new Error(`Missing admin user management audit snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "ACCOUNT IDENTITY",
  "PUBLIC + SUPPORT LINKS",
  "Open Admin User View",
  "Internal operator link only.",
  "Public Profile Link",
  "Copy Public Link",
  "Open Public Link",
  "Open Scout Discovery",
  "LINKED ENTITIES",
  "Restaurants/Trucks:",
  "Hosts:",
  "Parking Pass Listings:",
  "Food truck accounts use truck setup and public Parking Pass flows",
  "Host management remains host/account-bound.",
  "Recent verification/reset email delivery attempts are not currently",
  "const selectedUserPublicProfilePath = useMemo(() =>",
  "const selectedUserPublicProfileUrl = useMemo(() =>",
  "getAdminUserPublicProfilePath(",
  "Not applicable for internal admin accounts.",
  "Passwords, password hashes, reset tokens, OAuth tokens, and",
  "session secrets are never shown here.",
];

for (const snippet of requiredDashboardSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing user management completeness snippet: ${snippet}`);
  }
}

if (!dashboard.includes("buildCanonicalAffiliateLink(")) {
  throw new Error("Affiliate canonical link flow must remain in the admin user card");
}

const publicSupportSectionStart = dashboard.indexOf("PUBLIC + SUPPORT LINKS");
const publicSupportSectionEnd = dashboard.indexOf("/* Location & Demographics */");
if (publicSupportSectionStart === -1 || publicSupportSectionEnd === -1) {
  throw new Error("Public/support links section boundaries not found");
}

const publicSupportSection = dashboard.slice(
  publicSupportSectionStart,
  publicSupportSectionEnd,
);

if (
  !publicSupportSection.includes("selectedUserPublicProfileUrl") ||
  !publicSupportSection.includes("navigator.clipboard.writeText(") ||
  !publicSupportSection.includes("window.open(")
) {
  throw new Error("Public/support links section must provide copy/open handlers for public links");
}

if (
  publicSupportSection.includes("admin/dashboard?tab=users") &&
  (publicSupportSection.includes("Copy Public Link") ||
    publicSupportSection.includes("Open Public Link"))
) {
  throw new Error("Public link controls must not use admin dashboard focus URLs");
}

if (!dashboard.includes("Copy Link") || !dashboard.includes("Open Link")) {
  throw new Error("Existing affiliate link controls must remain in the user card");
}

const forbiddenSecretSnippets = [
  "passwordHash",
  "resetPasswordToken",
  "resetToken",
  "oauthAccessToken",
  "sessionToken",
];

for (const snippet of forbiddenSecretSnippets) {
  const lowerDashboard = dashboard.toLowerCase();
  if (lowerDashboard.includes(`{${snippet.toLowerCase()}}`)) {
    throw new Error(`Forbidden secret field appears rendered in dashboard: ${snippet}`);
  }
}

const requiredApiSnippets = [
  "\"/api/admin/users\"",
  "getSafeAuthDiagnostics",
  "sanitizeUsers(allUsers, { includeStripe: true })",
  "\"/api/admin/users/:id/send-password-reset\"",
  "\"/api/admin/users/:id/force-password-reset\"",
  "\"/api/admin/users/:id/resend-verification\"",
  "\"/api/admin/users/:id/activity\"",
];

for (const snippet of requiredApiSnippets) {
  if (!adminCoreOpsRoutes.includes(snippet) && !userAdminRoutes.includes(snippet)) {
    throw new Error(`Expected existing admin API support snippet missing: ${snippet}`);
  }
}

console.log("mealscout-admin-user-management-completeness.contract: PASS");
