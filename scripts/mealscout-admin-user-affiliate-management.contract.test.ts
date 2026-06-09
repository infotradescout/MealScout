import { readFileSync } from "node:fs";

const audit = readFileSync("MEALSCOUT_ADMIN_USER_AFFILIATE_MANAGEMENT_AUDIT.md", "utf8");
const dashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const affiliatePage = readFileSync("client/src/pages/AdminAffiliateManagement.tsx", "utf8");
const affiliateAdminRoutes = readFileSync("server/routes/admin/affiliateAdminRoutes.ts", "utf8");
const roleAccess = readFileSync("server/roleAccess.ts", "utf8");

const requiredAuditSnippets = [
  "Admins manage affiliate visibility and supported affiliate settings.",
  "Affiliate is not a standalone user role.",
  "Internal admin-family accounts do not receive public-ref affiliate assignment or payout controls by default.",
  "The admin user card includes an `Affiliate Management` section.",
  "The canonical primary affiliate link is always `https://www.mealscout.us/?ref=<affiliateTag>`.",
  "`Copy Link` and `Open Link` use the canonical root referral URL.",
  "Public truck, restaurant, or location profile URLs are not used as the primary `Affiliate Link`.",
  "client/src/pages/AdminAffiliateManagement.tsx` remains an aggregate affiliate reporting/overview surface",
  "Not applicable for internal admin accounts.",
  "The internal admin focus URL is not copied from the user card.",
  "affiliatePercent`, `affiliateCloserUserId`, and `affiliateBookerUserId`",
  "No `Create Link`, `Regenerate Link`, `Remove Affiliate`, or `Disable Affiliate` control is added",
  "Customer users do not show `invalid_missing_business`.",
  "Parking Pass free-management access remains unchanged.",
];

for (const snippet of requiredAuditSnippets) {
  if (!audit.includes(snippet)) {
    throw new Error(`Missing affiliate management audit snippet: ${snippet}`);
  }
}

const requiredDashboardSnippets = [
  "import { toSeoSlug } from \"@/lib/seo-slug\";",
  "const isAffiliateEligibleUserType = (userType?: string | null) =>",
  "!isAdminFamilyUserType(String(userType || \"\").toLowerCase())",
  "const getAdminUserPublicProfilePath = (",
  "user?.businessIsFoodTruck === true",
  "return `/p/${profileType}/${encodeURIComponent(restaurantId)}/${encodeURIComponent(slug || restaurantId)}`;",
  "return `/p/location/${encodeURIComponent(hostId)}/${encodeURIComponent(slug || hostId)}`;",
  "const buildCanonicalAffiliateLink = (",
  "const url = new URL(\"/\", canonicalMealScoutOrigin);",
  "url.searchParams.set(\"ref\", tag);",
  "Affiliate Management",
  "Affiliate Link",
  "Affiliate active",
  "No affiliate link",
  "Not applicable for internal admin accounts.",
  "No affiliate link assigned",
  "Copy Link",
  "Open Link",
  "navigator.clipboard.writeText(",
  "window.open(",
  "Internal token",
  "Commission Percent",
  "Closer User ID",
  "Booker User ID",
  "Save Affiliate Settings",
  "updateUserAffiliateSettings",
  "`/api/admin/affiliates/users/${payload.userId}`",
  "affiliatePercent: Number(",
  "affiliateCloserUserId:",
  "affiliateBookerUserId:",
];

for (const snippet of requiredDashboardSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing admin user affiliate management snippet: ${snippet}`);
  }
}

const managementSectionIndex = dashboard.indexOf("Affiliate Management");
const affiliateSectionIndex = dashboard.indexOf("Affiliate Link", managementSectionIndex);
const affiliateCopyIndex = dashboard.indexOf("Copy Link", affiliateSectionIndex);
if (affiliateSectionIndex === -1 || affiliateCopyIndex === -1) {
  throw new Error("Admin user card must contain Affiliate Link section with Copy Link");
}
if (managementSectionIndex === -1 || affiliateSectionIndex === -1) {
  throw new Error("Affiliate management section must exist inside the admin user card");
}
if (dashboard.includes("Copy Admin Link")) {
  throw new Error("Admin user card must not expose Copy Admin Link");
}

const clipboardCalls = [...dashboard.matchAll(/navigator\.clipboard\.writeText\(([^)]*)\)/g)];
for (const match of clipboardCalls) {
  const callStart = Math.max(0, match.index - 500);
  const callEnd = Math.min(dashboard.length, match.index + 500);
  const callContext = dashboard.slice(callStart, callEnd);
  if (
    callContext.includes("/admin/dashboard") ||
    callContext.includes("admin/dashboard?tab=users") ||
    callContext.includes("focusUser")
  ) {
    throw new Error("User-card copy/share handlers must not copy admin dashboard focus URLs");
  }
}

const copyLinkHandlerStart = dashboard.lastIndexOf("onClick={async () =>", affiliateCopyIndex);
const copyLinkHandler = dashboard.slice(copyLinkHandlerStart, affiliateCopyIndex + 200);
if (copyLinkHandler.includes("/admin/dashboard") || !copyLinkHandler.includes("affiliateLink")) {
  throw new Error("Primary Copy Link must copy the public affiliate link, not admin dashboard URL");
}
if (
  !copyLinkHandler.includes("navigator.clipboard.writeText(") ||
  !copyLinkHandler.includes("affiliateLink")
) {
  throw new Error("Copy Link must copy affiliateLink/publicProfileLink only");
}

const openLinkHandlerStart = dashboard.lastIndexOf("onClick={() =>", dashboard.indexOf("Open Link", affiliateSectionIndex));
const openLinkHandler = dashboard.slice(openLinkHandlerStart, dashboard.indexOf("Open Link", affiliateSectionIndex) + 200);
if (openLinkHandler.includes("/admin/dashboard") || !openLinkHandler.includes("affiliateLink")) {
  throw new Error("Open Link must open the public affiliate link, not admin dashboard URL");
}

const affiliateBuilderIndex = dashboard.indexOf("const buildCanonicalAffiliateLink = (");
const affiliateBuilderSlice = dashboard.slice(affiliateBuilderIndex, dashboard.indexOf("const businessTypeOptions"));
if (
  !affiliateBuilderSlice.includes("const url = new URL(\"/\", canonicalMealScoutOrigin);") ||
  !affiliateBuilderSlice.includes("url.searchParams.set(\"ref\", tag);") ||
  affiliateBuilderSlice.includes("getAdminUserPublicProfilePath(") ||
  affiliateBuilderSlice.includes("/p/truck") ||
  affiliateBuilderSlice.includes("/p/restaurant") ||
  affiliateBuilderSlice.includes("/p/location") ||
  affiliateBuilderSlice.includes("/admin/dashboard")
) {
  throw new Error("Primary Affiliate Link must be the root referral URL, never profile/admin URL");
}

const affiliateDisplaySlice = dashboard.slice(affiliateSectionIndex, dashboard.indexOf("Internal token", affiliateSectionIndex));
if (
  affiliateDisplaySlice.includes("/p/truck") ||
  affiliateDisplaySlice.includes("/p/restaurant") ||
  affiliateDisplaySlice.includes("/p/location") ||
  affiliateDisplaySlice.includes("focusUser") ||
  affiliateDisplaySlice.includes("/admin/dashboard")
) {
  throw new Error("Primary Affiliate Link display/copy/open must not use profile or admin paths");
}

const notApplicableIndex = dashboard.indexOf("Not applicable for internal admin accounts.");
const affiliateLinkConstructionIndex = dashboard.indexOf("const affiliateLink = buildCanonicalAffiliateLink", notApplicableIndex);
if (notApplicableIndex === -1 || affiliateLinkConstructionIndex === -1 || notApplicableIndex > affiliateLinkConstructionIndex) {
  throw new Error("Internal admin not-applicable check must happen before affiliate link construction");
}

const notApplicableSlice = dashboard.slice(notApplicableIndex, affiliateLinkConstructionIndex);
if (notApplicableSlice.includes("Copy Link") || notApplicableSlice.includes("Open Link")) {
  throw new Error("Internal admin accounts must not render affiliate link controls");
}

const settingsEndpointIndex = dashboard.indexOf("`/api/admin/affiliates/users/${payload.userId}`");
const settingsButtonIndex = dashboard.indexOf("Save Affiliate Settings", affiliateSectionIndex);
if (settingsEndpointIndex === -1 || settingsButtonIndex === -1) {
  throw new Error("Supported single-user affiliate settings must be editable from the admin user card");
}

const affiliatePageReportingSnippets = [
  "Affiliate Performance",
  "affiliateEarningsCents",
  "mealScoutRevenueCents",
  "subscriptionRevenueCents",
  "bookingRevenueCents",
];

for (const snippet of affiliatePageReportingSnippets) {
  if (!affiliatePage.includes(snippet)) {
    throw new Error(`Aggregate affiliate page must remain a reporting/overview surface: ${snippet}`);
  }
}

if (!affiliatePage.includes("/api/admin/affiliates/users")) {
  throw new Error("Affiliate page may remain as aggregate affiliate user overview");
}

const forbiddenDashboardSnippets = [
  "Affiliate Tag",
  "Create Affiliate Link",
  "Create Link",
  "Regenerate Link",
  "Remove Affiliate",
  "Disable Affiliate",
  "userXXXX",
  "No tag",
];

for (const snippet of forbiddenDashboardSnippets) {
  if (dashboard.includes(snippet)) {
    throw new Error(`Admin user card must not include fake/unsupported affiliate control: ${snippet}`);
  }
}

const forbiddenMutationSnippets = [
  "affiliateCommission",
  "affiliatePayout",
  "affiliateWithdrawals",
  "commissionSource",
];

const dashboardAffiliateSlice = dashboard.slice(
  dashboard.indexOf("const isAffiliateEligibleUserType"),
  dashboard.indexOf("const businessTypeOptions"),
);
for (const snippet of forbiddenMutationSnippets) {
  if (dashboardAffiliateSlice.includes(snippet)) {
    throw new Error(`Admin dashboard affiliate link display must not touch payout logic: ${snippet}`);
  }
}

if (!roleAccess.includes("shouldAssignAffiliateTagForUserType")) {
  throw new Error("Role affiliate eligibility source must remain discoverable");
}

if (affiliateAdminRoutes.includes("affiliateTag") && !affiliateAdminRoutes.includes("affiliatePercent")) {
  throw new Error("Existing admin affiliate route shape changed unexpectedly");
}

if (dashboard.includes("return \"business_owner\"") || dashboard.includes("\"business_owner\"")) {
  throw new Error("No generic business_owner role model may be introduced");
}

const customerNotRequiredIndex = dashboard.indexOf(
  "if (!isBusinessBearingUserType(userType)) return \"not_required\";",
);
const invalidMissingIndex = dashboard.indexOf(
  "return \"invalid_missing_business\";",
  customerNotRequiredIndex,
);
if (customerNotRequiredIndex === -1 || invalidMissingIndex === -1) {
  throw new Error("Customer users must resolve before invalid_missing_business");
}

console.log("mealscout-admin-user-affiliate-management.contract: PASS");
