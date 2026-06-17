import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildPublicProfileHeroAssets } from "../client/src/components/public-profile/ProfileHeroMedia";

const trackerPath = "docs/evidence/live-scout-truck-content-completion-2026-06-13.json";
const tracker = JSON.parse(readFileSync(trackerPath, "utf8"));
const heroMedia = readFileSync("client/src/components/public-profile/ProfileHeroMedia.tsx", "utf8");
const page = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const truckHero = readFileSync("client/src/components/public-profile/TruckHero.tsx", "utf8");

const blessed = tracker.trucks.find((truck: any) => truck.truckName === "Blessed Berry Bowls");

assert(blessed, "Blessed Berry Bowls must remain present in the live scout truck tracker");
assert.equal(blessed.coverStatus, "applied");
assert.equal(blessed.logoStatus, "sourced");
assert.match(
  blessed.notes,
  /no logoUrl/i,
  "Blessed Berry notes must remain honest that the production DTO does not currently expose a logoUrl",
);
assert.match(
  blessed.notes,
  /Google Places cover image/i,
  "Blessed Berry notes must preserve that the current cover is a Google Places asset",
);

const coverAndLogo = buildPublicProfileHeroAssets({
  entity: "truck",
  displayName: "Blessed Berry Bowls",
  coverImageUrl: "https://cdn.example/blessed-cover.jpg",
  logoUrl: "https://cdn.example/blessed-logo.jpg",
});
assert.equal(coverAndLogo.coverImageUrl, "https://cdn.example/blessed-cover.jpg");
assert.equal(coverAndLogo.logoImageUrl, "https://cdn.example/blessed-logo.jpg");
assert.equal(coverAndLogo.initials, "BB");

const logoOnly = buildPublicProfileHeroAssets({
  entity: "truck",
  displayName: "Blessed Berry Bowls",
  coverImageUrl: null,
  logoUrl: "https://cdn.example/blessed-logo.jpg",
});
assert.equal(logoOnly.coverImageUrl, null);
assert.equal(
  logoOnly.logoImageUrl,
  "https://cdn.example/blessed-logo.jpg",
  "Logo-only truck profiles must keep the logo as a separate avatar asset instead of promoting it into the cover slot",
);

const legacyLogo = buildPublicProfileHeroAssets({
  entity: "truck",
  displayName: "3D Eats & Tea",
  coverImageUrl: null,
  logoUrl: null,
  profileImageUrl: "https://cdn.example/legacy-profile.jpg",
  truckPhotoLogo: "https://cdn.example/legacy-truck-logo.jpg",
});
assert.equal(legacyLogo.coverImageUrl, null);
assert.equal(
  legacyLogo.logoImageUrl,
  "https://cdn.example/legacy-profile.jpg",
  "Legacy profileImageUrl must still feed the avatar slot when logoUrl is absent",
);

const hostAssets = buildPublicProfileHeroAssets({
  entity: "host",
  displayName: "Court of Food",
  spotImageUrl: "https://cdn.example/location-hero.jpg",
  coverImageUrl: "https://cdn.example/location-cover.jpg",
  logoUrl: "https://cdn.example/location-logo.jpg",
});
assert.equal(
  hostAssets.coverImageUrl,
  "https://cdn.example/location-hero.jpg",
  "Host profiles must keep preferring spot imagery for the cover slot",
);
assert.equal(hostAssets.logoImageUrl, "https://cdn.example/location-logo.jpg");

assert(page.includes("<ProfileHeroMedia"), "Public profile page must render shared hero media");
assert(truckHero.includes("<ProfileHeroMedia"), "Truck hero must render shared hero media");
assert(
  heroMedia.includes('onError={() => setCoverImageFailed(true)}') &&
    heroMedia.includes('onError={() => setLogoImageFailed(true)}'),
  "Hero media must swap to runtime fallback when a cover or logo image fails to load",
);
assert(
  heroMedia.includes('data-testid="public-profile-hero-cover-fallback"') &&
    heroMedia.includes('data-testid={showLogoImage ? "public-profile-hero-avatar" : "public-profile-hero-avatar-fallback"}'),
  "Hero media must expose dedicated cover and avatar fallback surfaces",
);

console.log("public-profile-asset-rendering.contract: PASS");
