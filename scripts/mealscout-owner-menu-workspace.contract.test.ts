import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const client = read("client/src/pages/menu-builder.tsx");
const server = read("server/routes/menuRoutes.ts");

const ownerDetailsStart = server.indexOf(
  '"/api/owner/menus/:menuId/details"',
);
const nextOwnerMutation = server.indexOf(
  '"/api/owner/menus"',
  ownerDetailsStart + 1,
);

assert.ok(ownerDetailsStart >= 0, "owner menu details route must exist");
assert.ok(
  nextOwnerMutation > ownerDetailsStart,
  "owner menu details route must end before menu creation",
);

const ownerDetailsRoute = server.slice(ownerDetailsStart, nextOwnerMutation);

assert.match(ownerDetailsRoute, /isAuthenticated/);
assert.match(ownerDetailsRoute, /canManageMenu/);
assert.match(ownerDetailsRoute, /assertOwnsMenu/);
assert.match(ownerDetailsRoute, /\.where\(eq\(menuItems\.menuId, menuId\)\)/);
assert.doesNotMatch(
  ownerDetailsRoute,
  /eq\(menuItems\.isAvailable, true\)/,
  "owners must receive unavailable items so they can restore them",
);
assert.doesNotMatch(
  ownerDetailsRoute,
  /eq\(menuCategories\.isActive, true\)/,
  "owners must receive hidden categories so they can restore them",
);

for (const testId of [
  "owner-menu-workspace",
  "owner-menu-editor",
  "menu-import-tools",
  "menu-ordering-readiness",
  "menu-settings",
  "menu-item-options-editor",
]) {
  assert.match(client, new RegExp(`data-testid="${testId}"`));
}

assert.match(
  client,
  /`\/api\/owner\/menus\/\$\{encodeURIComponent\(selectedMenuId\)\}\/details`/,
);
assert.match(client, /setSelectedMenuId\(menus\[0\]\.id\)/);
assert.match(client, /payload\?\.menu \?\? payload/);
assert.match(client, />Available</);
assert.match(client, /Unavailable/);
assert.match(client, /Visible to customers/);
assert.match(client, /Your visible menu can still be viewed/);
assert.match(client, /Category visible/);
assert.match(client, /"Restore"/);
assert.match(client, /\/api\/owner\/menu-items\/\$\{savedItemId\}\/variants/);
assert.match(client, /\/api\/owner\/menu-items\/\$\{savedItemId\}\/modifiers/);

for (const forbidden of [
  /queryKey: \["\/api\/menus", selectedMenuId\]/,
  /86'd/i,
  /while we wire deeper API access/i,
  /before publishing/i,
  /Menu setup/i,
  /Open Scout/i,
  /Scout nearby/i,
  /Keep scouting/i,
  /Back to Scout/i,
]) {
  assert.doesNotMatch(client, forbidden);
}

console.log("mealscout-owner-menu-workspace.contract: PASS");
