import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getBusinessCapabilities } from "../shared/businessTypes";
import { buildPublicProfilePath } from "../server/publicProfiles/publicProfileUtils";
import { buildPublicProfilePath as buildClientPublicProfilePath } from "../client/src/lib/public-profile-path";
import { toPublicRestaurantProfile } from "../server/publicProfiles/toPublicRestaurantProfile";

const baseUrl = "https://www.mealscout.us";

const caterer = toPublicRestaurantProfile({
  row: {
    id: "caterer-1",
    name: "Gather & Serve",
    businessType: "caterer",
    address: "100 Main St",
    city: "Pensacola",
    state: "FL",
    cateringInquiryUrl: "https://example.com/catering",
    bookingInquiryUrl: "https://example.com/book",
  },
  baseUrl,
});

assert.equal(caterer.profileType, "caterer");
assert.match(caterer.seo.canonicalUrl, /\/caterer\/gather-serve--caterer-1$/);
assert.equal(caterer.addressPublicLabel, "100 Main St, Pensacola, FL");
assert.equal(caterer.cta[0]?.type, "internal");
assert.ok(caterer.cta.some((cta) => cta.label === "Request catering"));

const privateChef = toPublicRestaurantProfile({
  row: {
    id: "chef-1",
    name: "Chef Taylor",
    businessType: "private_chef",
    address: "55 Private Home Rd",
    city: "Pensacola",
    state: "FL",
    latitude: 30.4,
    longitude: -87.2,
    onlineOrderingUrl: "https://example.com/order",
    bookingInquiryUrl: "https://example.com/chef",
  },
  baseUrl,
});

assert.equal(privateChef.profileType, "private_chef");
assert.equal(privateChef.addressPublicLabel, null);
assert.equal(privateChef.latitude, null);
assert.equal(privateChef.longitude, null);
assert.ok(!privateChef.cta.some((cta) => cta.label === "Order online"));
assert.ok(privateChef.cta.some((cta) => cta.label === "Request this chef"));
assert.equal(getBusinessCapabilities("private_chef")?.onlineOrdering, false);

assert.equal(
  buildPublicProfilePath({
    entityType: "private_chef",
    name: "Chef Taylor",
    id: "chef-1",
  }),
  "/private-chef/chef-taylor--chef-1",
);
assert.equal(
  buildClientPublicProfilePath({
    entityType: "restaurant",
    businessType: "caterer",
    name: "Gather & Serve",
    id: "caterer-1",
  }),
  "/caterer/gather-serve--caterer-1",
  "Legacy discovery callers must still reach the canonical caterer route",
);

const publicProfileSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/public-profile.tsx"),
  "utf8",
);
assert.match(publicProfileSource, /pathname\.startsWith\("\/caterer\/"\)/);
assert.match(publicProfileSource, /pathname\.startsWith\("\/private-chef\/"\)/);
assert.doesNotMatch(
  publicProfileSource,
  /isThinProfile\(restaurantProfile\)[\s\S]{0,800}:\s*\(\s*<>/,
  "Thin profiles must not replace the normal profile sections",
);

const ownerDashboardSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/restaurant-owner-dashboard.tsx"),
  "utf8",
);
for (const staleCopy of [
  "No Restaurant Found",
  "Register Your Restaurant",
  "Restaurant Dashboard - MealScout",
  "Users who favorited your restaurant",
]) {
  assert.ok(!ownerDashboardSource.includes(staleCopy), `Remove stale copy: ${staleCopy}`);
}

console.log("Profile-first business modes contract: PASS");
