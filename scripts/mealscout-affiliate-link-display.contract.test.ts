import { readFileSync } from "node:fs";

const dashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const profilePage = readFileSync("client/src/pages/profile.tsx", "utf8");
const adminAffiliatePage = readFileSync(
  "client/src/pages/AdminAffiliateManagement.tsx",
  "utf8",
);
const cleanupMap = readFileSync("CLEANUP_MAP.md", "utf8");
const affiliateRoutes = readFileSync("server/affiliateRoutes.ts", "utf8");
const affiliateService = readFileSync("server/affiliateService.ts", "utf8");

const requiredDashboardSnippets = [
  "const buildCanonicalAffiliateLink = (",
  "const profilePath = getAdminUserPublicProfilePath(",
  "attachedRestaurant,",
  "attachedHostProfile,",
  "if (!tag) return null;",
  "https://www.mealscout.us",
  "const url = new URL(",
  "profilePath",
  "canonicalMealScoutOrigin",
  'const normalizedPathname = url.pathname.replace(/\\/+$/, "") || "/";',
  "url.pathname = normalizedPathname;",
  'url.searchParams.set("ref", tag);',
  'url.searchParams.delete("to");',
  "Affiliate Link",
  "No affiliate link assigned",
  "Copy Link",
  "Open Link",
  "navigator.clipboard.writeText(",
  "affiliateLink",
  "window.open(",
  "data-testid={`button-copy-affiliate-link-${selectedUser.id}`}",
  "data-testid={`button-open-affiliate-link-${selectedUser.id}`}",
];

for (const snippet of requiredDashboardSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing affiliate link display snippet: ${snippet}`);
  }
}

if (dashboard.includes("`/ref/${encodeURIComponent(tag)}`")) {
  throw new Error(
    "Affiliate links must not use /ref/:tag wrappers in admin dashboard",
  );
}

if (
  !profilePage.includes("/directory?ref=${encodeURIComponent(") ||
  profilePage.includes("/ref/${affiliateTag}") ||
  profilePage.includes("/directory/${encodeURIComponent(")
) {
  throw new Error(
    "Profile affiliate link generator must use canonical /directory?ref=<tag> links",
  );
}

if (
  !adminAffiliatePage.includes("const getAffiliateLink") ||
  !adminAffiliatePage.includes("`/directory?ref=${encodedTag}`") ||
  adminAffiliatePage.includes("`/ref/${tag}`") ||
  adminAffiliatePage.includes("`/directory/${encodedTag}`")
) {
  throw new Error(
    "Admin affiliate page link generator must use canonical /directory?ref=<tag> links",
  );
}

if (dashboard.includes("Affiliate Tag")) {
  throw new Error(
    "Admin dashboard primary UI must not label the field Affiliate Tag",
  );
}

const linkLabelIndex = dashboard.indexOf("Affiliate Link");
const rawTagRenderIndex = dashboard.indexOf(
  "{selectedUser.affiliateTag}",
  linkLabelIndex,
);
if (rawTagRenderIndex !== -1) {
  throw new Error(
    "Raw affiliate tag must not be the primary displayed affiliate value",
  );
}

const emptyStateIndex = dashboard.indexOf("No affiliate link assigned");
if (emptyStateIndex === -1) {
  throw new Error("Users without affiliate tags must get an empty state");
}

for (const fakeFallback of ["userXXXX", "user8530", "No tag"]) {
  if (dashboard.includes(fakeFallback)) {
    throw new Error(
      `Admin dashboard must not render fake affiliate link fallback: ${fakeFallback}`,
    );
  }
}

const forbiddenMutationSnippets = [
  "affiliatePercent",
  "affiliateCloserUserId",
  "affiliateBookerUserId",
  "affiliateCommissions",
  "affiliateWallet",
  "payout",
  "commission",
];

const dashboardMutationSurface = dashboard.slice(
  dashboard.indexOf("const buildCanonicalAffiliateLink"),
  dashboard.indexOf("interface PendingRestaurant"),
);
for (const snippet of forbiddenMutationSnippets) {
  if (dashboardMutationSurface.includes(snippet)) {
    throw new Error(
      `Affiliate link display helper must not touch mutation/payout logic: ${snippet}`,
    );
  }
}

const routeRequiredSnippets = ["appendReferralParam", "ref", "affiliateTag"];

for (const snippet of routeRequiredSnippets) {
  if (
    !affiliateRoutes.includes(snippet) &&
    !affiliateService.includes(snippet)
  ) {
    throw new Error(
      `Existing attribution support must remain discoverable: ${snippet}`,
    );
  }
}

const c5cStart = cleanupMap.indexOf(
  "## C5C - Affiliate Link Display Correction",
);
const c6Start = cleanupMap.indexOf(
  "## C6 - Parking Pass Page Decomposition Map",
);
const c5cSection =
  c5cStart >= 0
    ? cleanupMap.slice(c5cStart, c6Start >= 0 ? c6Start : cleanupMap.length)
    : "";

if (!c5cSection) {
  throw new Error("CLEANUP_MAP.md must include C5C");
}

if (!c5cSection.includes("Status: `DONE`")) {
  throw new Error("CLEANUP_MAP.md must mark C5C DONE");
}

const requiredDisallowedScope = [
  "Attribution logic changes",
  "payout changes",
  "fake tag generation",
  "new affiliate features",
];

for (const phrase of requiredDisallowedScope) {
  if (!c5cSection.toLowerCase().includes(phrase.toLowerCase())) {
    throw new Error(
      `C5C must explicitly disallow feature/mutation scope: ${phrase}`,
    );
  }
}

console.log("mealscout-affiliate-link-display.contract: PASS");
