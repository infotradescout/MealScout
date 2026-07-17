import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const owner = read("client/src/pages/restaurant-owner-dashboard.tsx");
const workspace = read("client/src/components/owner-deals-workspace.tsx");
const creation = read("client/src/pages/deal-creation.tsx");
const edit = read("client/src/pages/deal-edit.tsx");
const managementRoutes = read("server/routes/dealManagementRoutes.ts");
const dealDetail = read("client/src/pages/deal-detail.tsx");
const scoutAdapters = read("client/src/features/scout/scoutAdapters.ts");
const dealDependencies = read("server/routes/dealRouteDependencies.ts");

const ownerRouteStart = managementRoutes.indexOf(
  '"/api/owner/restaurants/:restaurantId/deals"',
);
const ownerRouteEnd = managementRoutes.indexOf(
  'app.get("/api/deals/claimed"',
  ownerRouteStart,
);
assert.ok(ownerRouteStart >= 0, "owner all-deals route must exist");
assert.ok(ownerRouteEnd > ownerRouteStart, "owner all-deals route must be bounded");
const ownerRoute = managementRoutes.slice(ownerRouteStart, ownerRouteEnd);
assert.match(ownerRoute, /isAuthenticated/);
assert.match(ownerRoute, /hasBusinessPermissionForRestaurant/);
assert.match(ownerRoute, /"manageDeals"/);
assert.match(ownerRoute, /storage\.getDealsByRestaurant\(restaurantId\)/);
assert.doesNotMatch(
  ownerRoute,
  /filter\([^)]*isActive/,
  "owners must receive paused and expired deals so they can manage them",
);

assert.match(owner, /<OwnerDealsWorkspace/);
assert.match(owner, /activeWorkspaceModule === "deals"/);
assert.doesNotMatch(owner, /<TabsTrigger value="active">Active Specials/);
assert.doesNotMatch(owner, /<TabsTrigger value="inactive">Inactive Specials/);

for (const expected of [
  "Specials and deals",
  'type DealStatus = "live" | "scheduled" | "paused" | "expired"',
  "Needs attention",
  "New special",
  "Unlock deals",
  "Edit dates",
  "During business hours",
  "Specials could not be loaded",
]) {
  assert.ok(workspace.includes(expected), `Missing owner deal behavior: ${expected}`);
}
assert.match(
  workspace,
  /queryKey: ownerDealsQueryKey/,
);
assert.match(workspace, /`\/deal\/\$\{deal\.id\}`/);
assert.match(workspace, /`\/deal-edit\/\$\{deal\.id\}\?restaurantId=/);

assert.match(creation, /const selectedBusiness =/);
assert.match(creation, /restaurantId: selectedBusiness\.id/);
assert.match(creation, /response\.json\(\)/);
assert.match(creation, /setLocation\(dealsWorkspaceHref\)/);
assert.match(creation, /activeModule="deals"/);
assert.match(creation, /Your draft saves automatically on this device/);
assert.doesNotMatch(creation, /restaurantId: restaurants\[0\]\.id/);
assert.doesNotMatch(creation, /Save Draft/);

assert.match(edit, /restaurantId: deal\.restaurantId/);
assert.match(edit, /formData\.isOngoing \? null/);
assert.match(edit, /formData\.availableDuringBusinessHours \? null/);
assert.match(edit, /activeModule="deals"/);
assert.match(edit, /workspace=deals&restaurantId=/);
assert.doesNotMatch(edit, /restaurantId: restaurants\[0\]\.id/);

assert.match(dealDetail, /https:\/\/www\.mealscout\.us\/deal\/\$\{dealId\}/);
assert.match(scoutAdapters, /`\/deal\/\$\{deal\.id\}`/);
assert.match(dealDependencies, /\/deal\/\$\{params\.dealId\}/);
assert.doesNotMatch(dealDependencies, /\/deals\/\$\{params\.dealId\}/);

for (const source of [owner, workspace, creation, edit]) {
  assert.doesNotMatch(
    source,
    /Open Scout|Scout nearby|Keep scouting|Back to Scout/,
  );
}

console.log("mealscout-owner-deals-workspace.contract: PASS");
