import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const doctrine = readFileSync("docs/MEALSCOUT_CLEAN_URL_DOCTRINE.md", "utf8");
const audit = readFileSync("docs/MEALSCOUT_LAUNCH_SURFACE_AUDIT.md", "utf8");
const appRoutes = readFileSync("client/src/App.tsx", "utf8");
const publicProfilePage = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const publicProfilePathsClient = readFileSync("client/src/lib/public-profile-path.ts", "utf8");
const publicProfilePathsServer = readFileSync("server/publicProfiles/publicProfileUtils.ts", "utf8");
const publicDiscoveryRoutes = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");
const scoutAdapters = readFileSync("client/src/features/scout/scoutAdapters.ts", "utf8");
const liveScout = readFileSync("client/src/pages/explore-preview-v2.tsx", "utf8");
const cityLanding = readFileSync("client/src/pages/city-landing.tsx", "utf8");
const shareHub = readFileSync("client/src/components/share-hub.tsx", "utf8");

for (const snippet of [
  "All public and user-facing MealScout URLs must describe the destination",
  "target public profile architecture is:",
  "/{businessSlug}",
  "Preferred final public affiliate format:",
  "https://www.mealscout.us/{businessSlug}/{affiliateTag}",
  "userNNNN",
  "/referral-redirect",
  "/p/location",
  "does not yet satisfy the final no-ID affiliate URL end state",
  "Stage 1 canonical public route families:",
  "/restaurant/{slug}--{id}",
  "/truck/{slug}--{id}",
  "/bar/{slug}--{id}",
  "/location/{slug}--{id}",
  "Legacy `/p/...` routes may remain for compatibility",
]) {
  assert(doctrine.includes(snippet), `Missing clean URL doctrine snippet: ${snippet}`);
}

assert(
  audit.includes("Clean URL Doctrine / Stage 1 Migration") &&
    audit.includes("launch-critical user-facing outputs must stop treating `/p/...` as canonical final output") &&
    audit.includes("Preferred final user-facing affiliate shape is `https://www.mealscout.us/{businessSlug}/{affiliateTag}`") &&
    audit.includes("final clean affiliate URL doctrine remains an explicit follow-up slice"),
  "Launch audit must record the clean URL doctrine slice and stage 1 migration rule.",
);

for (const snippet of [
  'path="/restaurant/:id/:profileSlug"',
  'path="/restaurant/:id"',
  'path="/truck/:slug/:refTag"',
  'path="/truck/:slug"',
  'path="/bar/:slug/:refTag"',
  'path="/bar/:slug"',
  'path="/location/:slug/:refTag"',
  'path="/location/:slug"',
  'path="/supplier/:slug/:refTag"',
  'path="/supplier/:slug"',
]) {
  assert(appRoutes.includes(snippet), `Missing clean URL alias route: ${snippet}`);
}

assert(
  publicProfilePage.includes("extractUuidFromSlug(rawProfileId) || rawProfileId"),
  "Public profile page must resolve slug-based family routes back to the underlying profile id.",
);

for (const source of [publicProfilePathsClient, publicProfilePathsServer]) {
  assert(
    source.includes('return `/truck/') &&
      source.includes('return `/bar/') &&
      source.includes('return `/location/') &&
      source.includes('return `/supplier/') &&
      source.includes('return `/restaurant/'),
    "Client and server public profile path helpers must emit clean route-family URLs.",
  );
}

assert(
  publicDiscoveryRoutes.includes('profilePath: mapped.seo.canonicalUrl.replace(baseUrl, "")'),
  "Public profile payloads must expose canonical clean profile paths, not legacy /p paths.",
);

for (const source of [scoutAdapters, liveScout, cityLanding, shareHub]) {
  assert(
    source.includes("buildPublicProfilePath("),
    "Launch-critical public link builders must use clean public profile path helper.",
  );
}

for (const legacyFragment of ["/p/restaurant/", "/p/truck/", "/p/bar/", "/p/location/", "/p/supplier/"]) {
  const launchCriticalCombined = [scoutAdapters, liveScout, cityLanding, shareHub].join("\n");
  assert.equal(
    launchCriticalCombined.includes(legacyFragment),
    false,
    `Launch-critical public link builders must not emit legacy fragment: ${legacyFragment}`,
  );
}

console.log("mealscout-clean-url-doctrine.contract: PASS");
