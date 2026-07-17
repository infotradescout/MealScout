import { readFileSync } from "node:fs";

// The live /scout surface is ScoutPageV2 (explore-preview-v2.tsx), not
// scout-prototype.tsx (a secondary /scout-prototype page). It was rewritten
// onto a card/surface-based architecture that no longer contains the old
// inline isBarBusinessType pattern this test originally checked, but it
// does still route bars correctly, just via buildPublicProfilePath with an
// explicit "bar" entityType instead.
const scout = readFileSync("client/src/pages/explore-preview-v2.tsx", "utf8");
const adminUsers = readFileSync("server/routes/admin/userAdminRoutes.ts", "utf8");
const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);
const publicProfile = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const businessTypes = readFileSync("shared/businessTypes.ts", "utf8");

const requiredScout = [
  'import { buildPublicProfilePath } from "@/lib/public-profile-path";',
  "function getRestaurantEntityType(",
  "isBarBusinessType(",
  '.toLowerCase() === "bar"',
  'return "bar";',
  'entityType: entityType === "unknown" ? "restaurant" : entityType',
];

const requiredAdmin = [
  '"bar_owner"',
  "businessTypeFallback",
  'userType === "bar_owner"',
  '? "bar"',
];

const requiredOwner = [
  "const isBarBusiness =",
  "label: \"Bar profile complete\"",
  "label: \"Events or specials current\"",
  "...(servesFood",
  "...(hostsFoodTrucks",
];

const requiredPublic = [
  "function FeaturedBartendersSection",
  'if (profile.profileType !== "bar") return null;',
];

const requiredHelpers = [
  "export function isBarBusinessType",
  "export function isTruckBusinessType",
  "export function isRestaurantLikeBusinessType",
];

for (const snippet of requiredScout) {
  if (!scout.includes(snippet)) {
    throw new Error(`Missing scout bar coverage snippet: ${snippet}`);
  }
}
for (const snippet of requiredAdmin) {
  if (!adminUsers.includes(snippet)) {
    throw new Error(`Missing admin bar coverage snippet: ${snippet}`);
  }
}
for (const snippet of requiredOwner) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Missing owner bar coverage snippet: ${snippet}`);
  }
}
for (const snippet of requiredPublic) {
  if (!publicProfile.includes(snippet)) {
    throw new Error(`Missing public bar coverage snippet: ${snippet}`);
  }
}
for (const snippet of requiredHelpers) {
  if (!businessTypes.includes(snippet)) {
    throw new Error(`Missing business type helper snippet: ${snippet}`);
  }
}

console.log("bar-business-type-coverage.contract: PASS");
