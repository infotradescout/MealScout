import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shareLib = readFileSync("client/src/lib/share.ts", "utf8");
const mapPage = readFileSync("client/src/pages/map.tsx", "utf8");
const cityLanding = readFileSync("client/src/pages/city-landing.tsx", "utf8");
const dealsCity = readFileSync("client/src/pages/deals-city.tsx", "utf8");
const dealDetail = readFileSync("client/src/pages/deal-detail.tsx", "utf8");
const publicProfile = readFileSync(
  "client/src/pages/public-profile.tsx",
  "utf8",
);
const shareHub = readFileSync("client/src/components/share-hub.tsx", "utf8");
const shareButton = readFileSync(
  "client/src/components/share-button.tsx",
  "utf8",
);
const shareButtonCaps = readFileSync(
  "client/src/components/ShareButton.tsx",
  "utf8",
);
const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);

assert(
  shareLib.includes("export async function resolveCanonicalShareUrl(") &&
    shareLib.includes("export function resolveCanonicalShareUrlSync(") &&
    shareLib.includes("buildClientFallbackAttributedUrl") &&
    shareLib.includes('parsed.searchParams.delete("to")') &&
    shareLib.includes('parsed.searchParams.delete("ref")'),
  "Share library must centralize canonical tracked URL resolution for native share/copy/QR payloads.",
);

for (const file of [
  mapPage,
  cityLanding,
  dealsCity,
  dealDetail,
  publicProfile,
]) {
  assert(
    file.includes("resolveCanonicalShareUrl"),
    "Native share call sites must resolve final URL via canonical share resolver.",
  );
}

assert(
  publicProfile.includes('data-testid="button-public-profile-share"') &&
    publicProfile.includes('data-testid="button-public-profile-copy-link"') &&
    publicProfile.includes("PublicProfileShareControls"),
  "Public profiles must expose visible Share and Copy Link controls.",
);

assert(
  publicProfile.includes(
    "const resolveShareUrl = async () => resolveCanonicalShareUrl(targetPath)",
  ) &&
    publicProfile.includes("await navigator.share({") &&
    publicProfile.includes("url: shareUrl") &&
    publicProfile.includes("await navigator.clipboard.writeText(shareUrl)"),
  "Public profile Share and Copy Link controls must use the canonical attributed URL resolver output.",
);

assert(
  ownerDashboard.includes("resolveCanonicalShareUrlSync(") &&
    ownerDashboard.includes("publicProfileForQr.seo.canonicalUrl"),
  "QR/share targets must resolve through canonical share URL sync resolver.",
);

assert(
  /await\s+resolveCanonicalShareUrl\(\s*publicProfilePath,?\s*\)/m.test(
    ownerDashboard,
  ) &&
    /await\s+navigator\.clipboard\.writeText\(\s*shareUrl,?\s*\)/m.test(
      ownerDashboard,
    ) &&
    !ownerDashboard.includes("navigator.clipboard.writeText(fullUrl)") &&
    !ownerDashboard.includes(
      "const fullUrl = `${window.location.origin}${publicProfilePath}`;",
    ),
  "Owner dashboard public-profile copy action must resolve canonical attributed URL before copying and must not regress to raw fullUrl clipboard writes.",
);

assert(
  !mapPage.includes("const url = window.location.href;") &&
    !mapPage.includes("navigator.clipboard.writeText(window.location.href)"),
  "Map native share must not use raw window.location.href as final payload.",
);

for (const file of [cityLanding, dealsCity, dealDetail]) {
  assert(
    !file.includes("window.location.origin}/") ||
      file.includes("resolveCanonicalShareUrl"),
    "Share payload must not be manually constructed as final output when canonical resolver is available.",
  );
}

const finalShareSurfaces = [
  mapPage,
  cityLanding,
  dealsCity,
  dealDetail,
  shareButton,
  shareButtonCaps,
  shareHub,
  ownerDashboard,
  publicProfile,
].join("\n");

assert.equal(
  /navigator\.share\([\s\S]*url:\s*window\.location\.href/m.test(
    finalShareSurfaces,
  ),
  false,
  "navigator.share must not receive raw window.location.href directly.",
);

assert.equal(
  /navigator\.share\([\s\S]*url:\s*publicProfileUrl/m.test(finalShareSurfaces),
  false,
  "navigator.share must not receive raw publicProfileUrl directly.",
);

assert.equal(
  /clipboard\.writeText\(\s*window\.location\.href\s*\)/m.test(
    finalShareSurfaces,
  ),
  false,
  "clipboard.writeText must not receive raw window.location.href directly.",
);

assert.equal(
  /clipboard\.writeText\(\s*publicProfileUrl\s*\)/m.test(finalShareSurfaces),
  false,
  "clipboard.writeText must not receive raw publicProfileUrl directly.",
);

assert.equal(
  /navigator\.share\([\s\S]*url:\s*[^\n]*\/p\/location\//m.test(
    finalShareSurfaces,
  ),
  false,
  "Native share must not pass raw /p/location/ URL as final payload.",
);

assert.equal(
  /clipboard\.writeText\(\s*[^\n]*\/p\/location\//m.test(finalShareSurfaces),
  false,
  "Clipboard share must not pass raw /p/location/ URL as final payload.",
);

for (const legacyFragment of [
  "/p/restaurant/",
  "/p/truck/",
  "/p/bar/",
  "/p/location/",
  "/p/supplier/",
]) {
  assert.equal(
    finalShareSurfaces.includes(legacyFragment),
    false,
    `Launch-critical final share/copy/QR surfaces must not emit legacy canonical fragment: ${legacyFragment}`,
  );
}

assert(
  shareHub.includes('fetch("/api/share/generate"') &&
    shareButton.includes("getAffiliateShareUrl") &&
    shareButtonCaps.includes("getAffiliateShareUrl"),
  "Share Hub and ShareButton surfaces must use canonical tracked share generation.",
);

console.log("mealscout-native-share-attribution.contract: PASS");
