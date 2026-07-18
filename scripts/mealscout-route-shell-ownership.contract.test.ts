import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const app = read("client/src/App.tsx");
const navigation = read("client/src/components/navigation.tsx");
const routeSurface = read("client/src/lib/app-route-surface.ts");
const parkingPass = read("client/src/pages/parking-pass.tsx");

assert.match(app, /function AppFrame\(\)/);
assert.match(
  app,
  /<QueryClientProvider client=\{queryClient\}>[\s\S]*<AppFrame \/>/,
);
assert.match(app, /isScoutRoutePath\(currentPath\)/);
assert.match(app, /isBusinessWorkspaceRoutePath\(currentPath/);

assert.match(navigation, /const isScoutRoute = isScoutRoutePath\(currentPath\)/);
assert.match(
  navigation,
  /const isParkingPassRoute = isParkingPassRoutePath\(currentPath\)/,
);
assert.match(navigation, /isParkingPassRoute[\s\S]*\? "parking"/);
assert.match(navigation, /parking: !user/);
assert.match(
  navigation,
  /label: "Overview"[\s\S]*label: "Work"[\s\S]*label: "Manage"/,
);

for (const route of [
  "/restaurant-owner-dashboard",
  "/restaurant/dashboard",
  "/menu-builder",
  "/deal-creation",
  "/business-team",
  "/kitchen",
  "/orders",
  "/subscribe",
  "/profile/settings",
  "/settings",
]) {
  assert.ok(
    routeSurface.includes(`"${route}"`),
    `Missing workspace route ownership for ${route}`,
  );
}

assert.match(parkingPass, /const selectTopTab = \(/);
assert.match(parkingPass, /params\.set\("tab", nextTab\)/);
assert.match(parkingPass, /window\.history\.replaceState/);
assert.match(
  parkingPass,
  /onValueChange=\{\(value\) =>[\s\S]*selectTopTab/,
);

console.log("mealscout-route-shell-ownership.contract: PASS");
