import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { generateShareableUrl } from "../server/shareMiddleware";
import {
  buildTrackedAttributedPath,
  isEligibleInternalShareTarget,
  normalizeInternalShareTarget,
} from "../server/shareTargetPolicy";

const shareRoutes = readFileSync("server/shareRoutes.ts", "utf8");
const systemRoutes = readFileSync(
  "server/routes/systemUtilityRoutes.ts",
  "utf8",
);
const shareHub = readFileSync("client/src/components/share-hub.tsx", "utf8");
const doctrine = readFileSync("MEALSCOUT_UI_DOCTRINE.md", "utf8");

const validTargets = [
  "/p/truck/t1/taco-bandito",
  "/restaurant/letty-b-smokehouse",
  "/contractors/bobs-roofing",
  "/request/start",
  "/claim-provider",
  "/booking/start",
  "/landing",
  "/customer-signup?role=business",
];

for (const target of validTargets) {
  assert.equal(
    isEligibleInternalShareTarget(target),
    true,
    `eligible public internal target should be allowed: ${target}`,
  );
}

const unsafeTargets = [
  "",
  "/",
  "https://external.example/path",
  "//evil.example/path",
  "/admin/dashboard",
  "/staff",
  "/api/auth/user",
  "/ref/user9968",
  "/ref/user9968?ref=user9968",
];

for (const target of unsafeTargets) {
  assert.equal(
    isEligibleInternalShareTarget(target),
    false,
    `unsafe target should be refused: ${target}`,
  );
}

assert.equal(normalizeInternalShareTarget("/scout?q=tacos"), "/scout?q=tacos");
assert.equal(
  normalizeInternalShareTarget("https://external.example/path"),
  null,
);
assert.equal(
  buildTrackedAttributedPath("traci", "/request/start"),
  "/request/start/traci",
);

const shareUrl = generateShareableUrl(
  "/contractors/bobs-roofing",
  "https://www.mealscout.us",
  "traci",
);
assert.equal(
  shareUrl,
  "https://www.mealscout.us/contractors/bobs-roofing/traci",
);

assert.throws(() =>
  generateShareableUrl("/admin/dashboard", "https://www.mealscout.us", "traci"),
);
assert.throws(() =>
  generateShareableUrl("/scout", "https://www.mealscout.us", undefined),
);
assert.throws(() =>
  generateShareableUrl("/scout", "https://www.mealscout.us", "user1234"),
);

assert(
  shareRoutes.includes("resolveShareAttributionIdentity") &&
    shareRoutes.includes("getOrCreateInternalAttributionCode") &&
    shareRoutes.includes("users.affiliateTag") &&
    shareRoutes.includes("attribution.attributionKey") &&
    !shareRoutes.includes("/api/restaurants/my") &&
    !shareRoutes.includes("restaurantId"),
  "Share generation must use authenticated attribution identity, support internal key fallback, and must not require destination ownership.",
);

assert(
  shareRoutes.includes("buildTrackedAttributedUrl(") &&
    !shareRoutes.includes("commission") &&
    !shareRoutes.includes("payout") &&
    !shareRoutes.includes("stripe"),
  "Tracked share generation must stay separated from payout/payment logic.",
);

assert(
  systemRoutes.includes('app.get("/ref/:tag"') &&
    systemRoutes.includes("resolveAffiliateUserId(tag)") &&
    systemRoutes.includes("recordReferralClick(") &&
    systemRoutes.includes("isEligibleInternalShareTarget(targetPath)") &&
    systemRoutes.includes('redirectUrl.searchParams.set("ref", tag)'),
  "/ref/:tag must validate tag and target, record click attribution, and redirect safely.",
);

assert(
  // Share Hub's own fetch("/api/auth/user") call was replaced by the
  // shared useAuth() hook (2026-07-05 site-drift-sweep fix), deriving
  // from the same authenticated user state instead of a redundant
  // second request.
  shareHub.includes("useAuth()") &&
    !shareHub.includes('fetch("/api/affiliate/tag"') &&
    !shareHub.includes("/api/restaurants/my") &&
    shareHub.includes(
      "Tracked links are active. Add a custom share tag any time for cleaner branding.",
    ),
  "Share Hub must allow tracked sharing for authenticated users without requiring a custom vanity tag.",
);

assert(
  doctrine.includes(
    "Every eligible internal link shared by an authenticated user",
  ) &&
    doctrine.includes("destination ownership is not required") &&
    doctrine.includes("Destination validity is required") &&
    doctrine.includes("/<safe-internal-path>/<tag>") &&
    doctrine.includes("tracking separate from payout"),
  "Doctrine must encode universal authenticated share attribution.",
);

console.log("universal-authenticated-share-attribution.contract: PASS");
