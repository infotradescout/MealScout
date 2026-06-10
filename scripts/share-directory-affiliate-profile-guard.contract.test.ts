import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shareRoutes = readFileSync("server/shareRoutes.ts", "utf8");
const shareHub = readFileSync("client/src/components/share-hub.tsx", "utf8");
const shareLib = readFileSync("client/src/lib/share.ts", "utf8");
const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);
const adminRoutes = readFileSync(
  "server/routes/adminManagementRoutes.ts",
  "utf8",
);
const adminControlCenter = readFileSync(
  "client/src/pages/AdminControlCenter.tsx",
  "utf8",
);
const shareMiddleware = readFileSync("server/shareMiddleware.ts", "utf8");
const shareTargetPolicy = readFileSync("server/shareTargetPolicy.ts", "utf8");
const appRoutes = readFileSync("client/src/App.tsx", "utf8");

assert(
  shareRoutes.includes("async function requireShareAffiliateTag"),
  "/api/share/generate must have a dedicated affiliate-tag guard.",
);
assert(
  shareRoutes.includes("users.affiliateTag") &&
    !shareRoutes.includes("ensureAffiliateTag(authenticatedUserId)"),
  "Authenticated share generation must read an existing affiliate tag without creating one.",
);
assert(
  shareRoutes.includes("return res.status(409).json({") &&
    !shareRoutes.includes("resolveAffiliateUserId(suppliedRef)"),
  "Unauthenticated tracked share generation must be refused.",
);
assert(
  shareRoutes.includes("resolveShareAttributionIdentity") &&
    shareRoutes.includes("attribution_identity_required") &&
    shareRoutes.includes("authentication_required"),
  "Share generation must resolve internal attribution for authenticated users and fail closed for unresolved identity or unauthenticated requests.",
);
assert(
  shareRoutes.includes("buildTrackedAttributedUrl(") &&
    shareRoutes.includes("attribution.attributionKey") &&
    shareRoutes.includes("sharePath"),
  "Generated share URLs must be direct clean links with ?ref= attribution.",
);
assert(
  shareRoutes.includes("normalizeInternalShareTarget") &&
    shareRoutes.includes("isEligibleInternalShareTarget") &&
    shareRoutes.includes("share_target_required"),
  "Share generation must normalize targets and reject missing/root/internal/ref targets.",
);
assert(
  shareTargetPolicy.includes('"/admin"') &&
    shareTargetPolicy.includes('"/staff"') &&
    shareTargetPolicy.includes('"/api"') &&
    shareTargetPolicy.includes('"/ref"') &&
    shareTargetPolicy.includes('raw.startsWith("//")') &&
    shareTargetPolicy.includes("/^[a-z][a-z0-9+.-]*:/i.test(raw)"),
  "Share generation must reject legacy referral pages, API paths, and internal dashboards as share targets.",
);

assert(
  shareHub.includes(
    "Tracked links are ready. Add a custom share tag later if you want cleaner links.",
  ),
  "Share Hub must show ready copy and keep vanity tags optional.",
);
assert(
  shareHub.includes(
    "!isAuthenticated || !normalizeShareHubTargetPath(item.href)",
  ),
  "Share Hub actions must be enabled for authenticated users and only disabled for invalid targets or unauthenticated sessions.",
);
assert(
  shareHub.includes("isDirectAttributedShareLink") &&
    shareHub.includes('url.searchParams.get("ref")') &&
    shareHub.includes('!url.searchParams.has("to")') &&
    shareHub.includes('!shareLink.includes("%2F")'),
  "Share Hub must validate direct clean ?ref links and reject nested/encoded destination params.",
);
assert(
  shareHub.includes("normalizeShareHubTargetPath") &&
    shareHub.includes('pathname.startsWith("/ref/")') &&
    !shareHub.includes("My Referral Link") &&
    !shareHub.includes("href: `/ref/${affiliateTag}`"),
  "Share Hub must validate targets and must not inject generic /ref/<tag> links.",
);
assert(
  shareHub.includes("meal-scout\\.vercel\\.app") &&
    shareHub.includes("/\\/ref\\/([^/?#]+)[^#]*[?&]ref=\\1"),
  "Share Hub must reject old Vercel links and /ref/<tag>?ref=<tag> links.",
);
assert(
  !shareHub.includes("return absoluteUrl(href)") &&
    !shareHub.includes("Referral tracking is temporarily unavailable"),
  "Share Hub must not fall back to untagged public links.",
);

assert(
  shareLib.includes("isDirectAttributedShareLink") &&
    shareLib.includes('url.searchParams.get("ref")') &&
    shareLib.includes('!url.searchParams.has("to")') &&
    shareLib.includes('!shareLink.includes("%2F")'),
  "Shared URL helper must accept direct ?ref links and reject malformed attribution links.",
);
assert(
  !shareLib.includes("return fallback"),
  "Shared URL helper must not return untagged fallback URLs.",
);

assert(
  ownerDashboard.includes("publicProfileForQr?.seo?.canonicalUrl"),
  "Owner dashboard public-profile link must come from the public profile response.",
);
assert(
  ownerDashboard.includes("No public profile yet"),
  "Owner dashboard must render a disabled no-profile state.",
);
assert(
  !ownerDashboard.includes("const publicProfilePath = currentPublicEntityType"),
  "Owner dashboard must not synthesize public-profile links before a profile exists.",
);

assert(
  adminRoutes.includes("hasPublicProfile: publicReady") &&
    adminRoutes.includes(
      "publicProfileUrl: publicReady ? canonicalPath : null",
    ),
  "Admin completion API must suppress public-profile URLs until the profile is public-ready.",
);
assert(
  adminControlCenter.includes(
    "item.hasPublicProfile && item.publicProfileUrl",
  ) && adminControlCenter.includes("No public profile yet"),
  "Admin completion UI must guard public-profile links.",
);

assert(
  shareMiddleware.includes("resolveCanonicalShareOrigin") &&
    shareMiddleware.includes('.endsWith(".onrender.com")') &&
    shareMiddleware.includes('"meal-scout.vercel.app"') &&
    shareMiddleware.includes('"https://www.mealscout.us"'),
  "Share middleware must keep canonical origin resolution and reject Render/legacy Vercel hosts.",
);
assert(
  shareMiddleware.includes("buildTrackedAttributedUrl") &&
    shareMiddleware.includes("isEligibleInternalShareTarget"),
  "Share middleware must produce universal attributed links and validate internal targets.",
);
assert(
  appRoutes.includes('"/ref/"') && appRoutes.includes('path="/ref/:tag"'),
  "Referral URLs must resolve through the registered /ref/:tag public route.",
);

console.log("share-directory-affiliate-profile-guard.contract: PASS");
