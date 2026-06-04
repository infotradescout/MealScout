import { readFileSync } from "node:fs";

const audit = readFileSync("MEALSCOUT_ADMIN_USER_AFFILIATE_MANAGEMENT_AUDIT.md", "utf8");
const dashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const affiliateAdminRoutes = readFileSync("server/routes/admin/affiliateAdminRoutes.ts", "utf8");
const roleAccess = readFileSync("server/roleAccess.ts", "utf8");

const requiredAuditSnippets = [
  "Admins manage affiliates.",
  "Admins are not affiliates.",
  "Not applicable for internal admin accounts.",
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
  "const profilePath = getAdminUserPublicProfilePath(user, attachedHostProfile);",
  "url.searchParams.set(\"ref\", tag);",
  "Affiliate Link",
  "Not applicable for internal admin accounts.",
  "No affiliate link assigned",
  "Copy Link",
  "Open Link",
  "Copy Admin Link",
  "navigator.clipboard.writeText(affiliateLink)",
  "window.open(",
  "const href = `${window.location.origin}/admin/dashboard?tab=users&focusUser=${encodeURIComponent(selectedUser.id)}`;",
];

for (const snippet of requiredDashboardSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing admin user affiliate management snippet: ${snippet}`);
  }
}

const affiliateSectionIndex = dashboard.indexOf("Affiliate Link");
const affiliateCopyIndex = dashboard.indexOf("Copy Link", affiliateSectionIndex);
const adminCopyIndex = dashboard.indexOf("Copy Admin Link");
if (affiliateSectionIndex === -1 || affiliateCopyIndex === -1) {
  throw new Error("Admin user card must contain Affiliate Link section with Copy Link");
}
if (adminCopyIndex === -1) {
  throw new Error("Internal admin focus URL must be exposed only as separate Copy Admin Link");
}

const copyLinkHandlerStart = dashboard.lastIndexOf("onClick={async () =>", affiliateCopyIndex);
const copyLinkHandler = dashboard.slice(copyLinkHandlerStart, affiliateCopyIndex + 200);
if (copyLinkHandler.includes("/admin/dashboard") || !copyLinkHandler.includes("affiliateLink")) {
  throw new Error("Primary Copy Link must copy the public affiliate link, not admin dashboard URL");
}

const openLinkHandlerStart = dashboard.lastIndexOf("onClick={() =>", dashboard.indexOf("Open Link", affiliateSectionIndex));
const openLinkHandler = dashboard.slice(openLinkHandlerStart, dashboard.indexOf("Open Link", affiliateSectionIndex) + 200);
if (openLinkHandler.includes("/admin/dashboard") || !openLinkHandler.includes("affiliateLink")) {
  throw new Error("Open Link must open the public affiliate link, not admin dashboard URL");
}

const notApplicableIndex = dashboard.indexOf("Not applicable for internal admin accounts.");
const affiliateBuilderIndex = dashboard.indexOf("const affiliateLink = buildCanonicalAffiliateLink", notApplicableIndex);
if (notApplicableIndex === -1 || affiliateBuilderIndex === -1 || notApplicableIndex > affiliateBuilderIndex) {
  throw new Error("Internal admin not-applicable check must happen before affiliate link construction");
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
