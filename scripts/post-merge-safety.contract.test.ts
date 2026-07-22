import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isMealScoutProductionUrl } from "./productionTargetSafety";
import { getScopedBusinessPermissions } from "../client/src/lib/business-access";

for (const productionUrl of [
  "https://mealscout.us",
  "https://www.mealscout.us",
  "https://api.mealscout.us:443/apply",
  "https://preview.ops.mealscout.us./apply",
]) {
  assert.equal(
    isMealScoutProductionUrl(productionUrl),
    true,
    `production target escaped the allow-production guard: ${productionUrl}`,
  );
}

for (const safeUrl of [
  "http://127.0.0.1:5000",
  "http://localhost:5000",
  "https://notmealscout.us",
  "https://mealscout.us.example.com",
]) {
  assert.equal(
    isMealScoutProductionUrl(safeUrl),
    false,
    `non-production target was misclassified: ${safeUrl}`,
  );
}

const accessContext = {
  hasAnyAccess: true,
  permissions: {
    manageDeals: true,
    manageParkingPass: true,
    viewAnalytics: true,
    manageProfile: true,
  },
  restaurants: [
    {
      id: "deals-only",
      permissions: {
        manageDeals: true,
        manageParkingPass: false,
        viewAnalytics: false,
        manageProfile: false,
      },
    },
    {
      id: "profile-only",
      permissions: {
        manageDeals: false,
        manageParkingPass: false,
        viewAnalytics: false,
        manageProfile: true,
      },
    },
  ],
};

assert.deepEqual(getScopedBusinessPermissions(accessContext, "deals-only"), {
  manageDeals: true,
  manageParkingPass: false,
  viewAnalytics: false,
  manageProfile: false,
});
assert.equal(
  getScopedBusinessPermissions(accessContext, "missing").manageDeals,
  false,
  "aggregate permissions must not leak to an unrelated selected business",
);

const picker = readFileSync(
  "client/src/components/maps/GoogleMapPicker.tsx",
  "utf8",
);
assert.match(picker, /typeof marker\.setMap === "function"/);
assert.match(picker, /marker\.map = null/);
assert.match(picker, /typeof marker\.setPosition === "function"/);
assert.match(picker, /marker\.position = position/);

const navigation = readFileSync("client/src/components/navigation.tsx", "utf8");
assert.match(navigation, /if \(!isGlobalScope\) return null/);
assert.doesNotMatch(navigation, /hasGlobalNavigation/);

const mapFallback = readFileSync(
  "client/src/components/maps/themed-scout-map-v2.tsx",
  "utf8",
);
assert.match(mapFallback, /data-testid="scout-map-tile-fallback"/);
assert.match(mapFallback, /backgroundColor: "#f5f3ee"/);

console.log("post-merge-safety.contract: PASS");
