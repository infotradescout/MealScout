import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCleanAffiliateBusinessPath,
  buildCleanPublicBusinessPath,
  parseCleanAffiliateBusinessRoute,
} from "../shared/cleanAffiliateLinks";

const helper = readFileSync("shared/cleanAffiliateLinks.ts", "utf8");
const appSource = readFileSync("client/src/App.tsx", "utf8");
const shareLib = readFileSync("client/src/lib/share.ts", "utf8");
const sharePolicy = readFileSync("server/shareTargetPolicy.ts", "utf8");
const shareRoutes = readFileSync("server/shareRoutes.ts", "utf8");
const publicProfile = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const publicDiscovery = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");
const useAuth = readFileSync("client/src/hooks/useAuth.ts", "utf8");
const serverIndex = readFileSync("server/index.ts", "utf8");
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const resolver = readFileSync("server/publicProfiles/publicBusinessSlugResolver.ts", "utf8");

assert(
  helper.includes("buildCleanPublicBusinessPath") &&
    helper.includes("buildCleanAffiliateBusinessPath") &&
    helper.includes("parseCleanAffiliateBusinessRoute") &&
    helper.includes("isDefaultLookingAffiliateTagSegment") &&
    helper.includes("isLikelyCleanAffiliateTagSegment"),
  "Clean affiliate helper must centralize clean public-business path, clean affiliate path, and route parsing rules.",
);

assert.equal(
  buildCleanPublicBusinessPath("/restaurant/the-spot-tavern--a5d30bff-1318-4d7a-8ee2-96190bbf378f"),
  "/the-spot-tavern",
  "Stage 1 restaurant profile paths must collapse to clean public business paths.",
);

assert.equal(
  buildCleanAffiliateBusinessPath(
    "/location/the-spot-tavern--a5d30bff-1318-4d7a-8ee2-96190bbf378f#menu",
    "thomas",
  ),
  "/the-spot-tavern/thomas#menu",
  "Eligible profile/location targets must emit clean root affiliate links without ids.",
);

assert.equal(
  buildCleanAffiliateBusinessPath("/map?lat=1&lng=2", "thomas"),
  null,
  "Non-business public routes must not be rewritten into fake clean business affiliate links.",
);

assert.deepEqual(
  parseCleanAffiliateBusinessRoute("/the-spot-tavern/thomas"),
  { businessSlug: "the-spot-tavern", affiliateTag: "thomas" },
  "Clean affiliate route parser must recover slug and affiliate tag.",
);

assert.equal(
  parseCleanAffiliateBusinessRoute("/the-spot-tavern/user1234"),
  null,
  "Default-looking userNNNN tags must be rejected from clean affiliate route parsing.",
);

for (const snippet of [
  'path="/:businessSlug/:refTag"',
  'path="/:businessSlug"',
]) {
  assert(appSource.includes(snippet), `App must register clean business profile route: ${snippet}`);
}

assert(
  publicProfile.includes('"/api/public/resolve-business"') &&
    publicProfile.includes("parseCleanAffiliateBusinessRoute(pathname)") &&
    publicProfile.includes("resolvedCleanBusinessPath") &&
    publicProfile.includes("sharePath={resolvedCleanBusinessPath}") &&
    publicProfile.includes("new URL(resolvedCleanBusinessPath, window.location.origin).toString()") &&
    publicProfile.includes("if (!routeRef || !resolvedCleanBusinessPath) return;"),
  "Public profile page must resolve clean business slug routes and share from clean root profile paths.",
);

assert(
  resolver.includes("listPublicBusinessSlugCandidates") &&
    resolver.includes('status: "ambiguous"') &&
    resolver.includes('status: "unique"') &&
    resolver.includes('status: "not_found"') &&
    resolver.includes("resolveUniqueCleanBusinessPathForEntity"),
  "Business slug resolver must distinguish unique, ambiguous, and missing root slugs and expose a unique-only clean-path helper.",
);

assert(
  publicDiscovery.includes('app.get("/api/public/resolve-business/:businessSlug"') &&
    publicDiscovery.includes('reason: "ambiguous_slug"') &&
    publicDiscovery.includes("resolveUniqueCleanBusinessPathForEntity"),
  "Server must expose root business-slug resolution and fail-safe ambiguity handling instead of silently choosing a colliding profile.",
);

assert(
  shareRoutes.includes("resolveUniqueCleanShareTarget") &&
    shareRoutes.includes("resolveUniqueCleanBusinessPathForEntity") &&
    shareRoutes.includes("(await resolveUniqueCleanShareTarget(sharePath)) || sharePath") &&
    !sharePolicy.includes("buildCleanAffiliateBusinessPath"),
  "Tracked share generation must only emit clean root affiliate URLs for unique business/profile targets and must fall back to compatibility paths when slug resolution is ambiguous.",
);

assert(
  !shareLib.includes("buildCleanPublicBusinessPath") &&
    !shareLib.includes("buildCleanAffiliateBusinessPath"),
  "Client share fallback must not guess-clean stage1 profile paths locally when uniqueness is unknown.",
);

assert(
  !useAuth.includes("parseCleanAffiliateBusinessRoute") &&
    useAuth.includes("isLikelyCleanAffiliateTagSegment(ref)") &&
    useAuth.includes("setAffiliateRef(affiliateTag)") &&
    !useAuth.includes("setAffiliateRef(user.affiliateTag || user.id)"),
  "Auth/share state must not fall back to raw user ids and must avoid locally trusting unresolved root clean-path tags before uniqueness is confirmed.",
);

assert(
  serverIndex.includes("parseCleanAffiliateBusinessRoute") &&
    serverIndex.includes("resolvePublicBusinessSlug") &&
    serverIndex.includes('resolvedBusiness.status !== "unique"') &&
    serverIndex.includes("const ref = queryRef || cleanAffiliateRoute?.affiliateTag || \"\";"),
  "Server request capture must only preserve attribution from clean root affiliate paths after unique slug resolution succeeds.",
);

assert(
  !adminDashboard.includes("buildCleanAffiliateBusinessPath"),
  "Admin user-card affiliate links must not guess-clean root business paths without uniqueness proof.",
);

const generatedPublicSamples = [
  buildCleanAffiliateBusinessPath(
    "/restaurant/the-spot-tavern--a5d30bff-1318-4d7a-8ee2-96190bbf378f",
    "thomas",
  ),
  buildCleanAffiliateBusinessPath(
    "/location/the-spot-tavern--a5d30bff-1318-4d7a-8ee2-96190bbf378f",
    "pensacolafoodies",
  ),
].join("\n");

for (const forbidden of ["/p/location", "/referral-redirect", "user1234", "?ref=", "to="]) {
  assert.equal(
    generatedPublicSamples.includes(forbidden),
    false,
    `Final clean affiliate samples must not contain forbidden public fragment: ${forbidden}`,
  );
}

assert.equal(
  /[0-9a-f]{8}-[0-9a-f-]{27,}/i.test(generatedPublicSamples),
  false,
  "Final clean affiliate samples must not expose UUIDs or raw database ids.",
);

console.log("mealscout-final-clean-affiliate-runtime.contract: PASS");
