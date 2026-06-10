import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shareRoutes = readFileSync("server/shareRoutes.ts", "utf8");
const shareHub = readFileSync("client/src/components/share-hub.tsx", "utf8");
const shareLib = readFileSync("client/src/lib/share.ts", "utf8");
const ownerDashboard = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");
const adminRoutes = readFileSync("server/routes/adminManagementRoutes.ts", "utf8");
const adminControlCenter = readFileSync("client/src/pages/AdminControlCenter.tsx", "utf8");
const shareMiddleware = readFileSync("server/shareMiddleware.ts", "utf8");
const appRoutes = readFileSync("client/src/App.tsx", "utf8");

assert(
  shareRoutes.includes("async function requireShareAffiliateTag"),
  "/api/share/generate must have a dedicated affiliate-tag guard.",
);
assert(
  shareRoutes.includes("ensureAffiliateTag(authenticatedUserId)"),
  "Authenticated share generation must ensure/generate the current user's affiliate tag.",
);
assert(
  shareRoutes.includes("resolveAffiliateUserId(suppliedRef)"),
  "Unauthenticated share generation must validate supplied ref tags before sharing.",
);
assert(
  shareRoutes.includes("res.status(409)") &&
    shareRoutes.includes('error: "affiliate_tag_required"'),
  "Share generation must block sharing when no affiliate tag can be resolved.",
);
assert(
  shareRoutes.includes("generateShareableUrl(sharePath, baseUrl, affiliate.affiliateTag)"),
  "Generated share URLs must always use the resolved affiliate tag.",
);
assert(
  shareRoutes.includes("normalizeShareTargetPath") &&
    shareRoutes.includes("isBlockedShareTargetPath") &&
    shareRoutes.includes('error: "share_target_required"'),
  "Share generation must normalize targets and reject missing/root/internal/ref targets.",
);
assert(
  shareRoutes.includes('pathname.startsWith("/ref/")') &&
    shareRoutes.includes('pathname.startsWith("/admin")') &&
    shareRoutes.includes('pathname.startsWith("/staff")'),
  "Share generation must reject legacy referral pages and internal dashboards as share targets.",
);

assert(
  shareHub.includes("Affiliate tag unavailable — sharing disabled."),
  "Share Hub must show clear disabled copy when no tag is available.",
);
assert(
  shareHub.includes("disabled={affiliateTagUnavailable || !affiliateTag}"),
  "Share Hub actions must be disabled without a resolved affiliate tag.",
);
assert(
  shareHub.includes("!/[?&]ref=/.test(shareLink)"),
  "Share Hub must reject generated links missing referral attribution.",
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
  shareLib.includes("!/[?&]ref=/.test(shareLink)"),
  "Shared URL helper must reject API links missing referral attribution.",
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
    adminRoutes.includes("publicProfileUrl: publicReady ? canonicalPath : null"),
  "Admin completion API must suppress public-profile URLs until the profile is public-ready.",
);
assert(
  adminControlCenter.includes("item.hasPublicProfile && item.publicProfileUrl") &&
    adminControlCenter.includes("No public profile yet"),
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
  appRoutes.includes('"/ref/"') && appRoutes.includes('path="/ref/:tag"'),
  "Referral URLs must resolve through the registered /ref/:tag public route.",
);

console.log("share-directory-affiliate-profile-guard.contract: PASS");
