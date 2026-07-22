import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isMealScoutProductionUrl } from "./productionTargetSafety";
import {
  getScopedBusinessPermissions,
  isScopedBusinessOwner,
} from "../client/src/lib/business-access";
import { createGoogleMapWithRasterFallback } from "../client/src/lib/google-map-runtime";

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
      isOwner: false,
      permissions: {
        manageDeals: true,
        manageParkingPass: false,
        viewAnalytics: false,
        manageProfile: false,
      },
    },
    {
      id: "profile-only",
      isOwner: false,
      permissions: {
        manageDeals: false,
        manageParkingPass: false,
        viewAnalytics: false,
        manageProfile: true,
      },
    },
    {
      id: "owned-business",
      isOwner: true,
      permissions: {
        manageDeals: true,
        manageParkingPass: true,
        viewAnalytics: true,
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
assert.equal(isScopedBusinessOwner(accessContext, "owned-business"), true);
assert.equal(
  isScopedBusinessOwner(accessContext, "deals-only"),
  false,
  "owning one business must not grant owner control over a collaborator business",
);
assert.equal(isScopedBusinessOwner(accessContext, "missing"), false);

const mapConstructionCalls: Array<Record<string, unknown>> = [];
class VectorRejectingMap {
  constructor(_container: unknown, options: Record<string, unknown>) {
    mapConstructionCalls.push(options);
    if (options.mapId) throw new Error("vector rendering unavailable");
  }
}
const rasterRecovery = createGoogleMapWithRasterFallback({
  MapConstructor: VectorRejectingMap,
  container: {},
  options: { center: { lat: 30.4, lng: -87.2 }, zoom: 10 },
  mapId: "configured-vector-map",
});
assert.equal(rasterRecovery.mapIdApplied, false);
assert.equal(mapConstructionCalls.length, 2);
assert.equal(mapConstructionCalls[0].mapId, "configured-vector-map");
assert.equal(mapConstructionCalls[1].mapId, undefined);

for (const pagePath of [
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "client/src/pages/deal-creation.tsx",
  "client/src/pages/deal-edit.tsx",
  "client/src/pages/menu-builder.tsx",
]) {
  const page = readFileSync(pagePath, "utf8");
  assert.match(
    page,
    /isScopedBusinessOwner/,
    `${pagePath} must derive owner control from the selected business`,
  );
}

const picker = readFileSync(
  "client/src/components/maps/GoogleMapPicker.tsx",
  "utf8",
);
assert.match(picker, /typeof marker\.setMap === "function"/);
assert.match(picker, /marker\.map = null/);
assert.match(picker, /typeof marker\.setPosition === "function"/);
assert.match(picker, /marker\.position = position/);

const navigation = readFileSync("client/src/components/navigation.tsx", "utf8");
assert.match(navigation, /GlobalNavigationOwnerContext/);
assert.match(navigation, /!isGlobalScope && hasGlobalNavigationOwner/);
assert.doesNotMatch(navigation, /let hasGlobalNavigation\s*=/);

const appShell = readFileSync("client/src/App.tsx", "utf8");
assert.match(appShell, /GlobalNavigationOwnerProvider/);

const mapFallback = readFileSync(
  "client/src/components/maps/themed-scout-map-v2.tsx",
  "utf8",
);
assert.match(mapFallback, /data-testid="scout-map-tile-fallback"/);
assert.match(mapFallback, /backgroundColor: "#f5f3ee"/);

console.log("post-merge-safety.contract: PASS");
