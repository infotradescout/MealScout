import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const shell = read("client/src/components/business-workspace-shell.tsx");
const owner = read("client/src/pages/restaurant-owner-dashboard.tsx");
const menu = read("client/src/pages/menu-builder.tsx");
const app = read("client/src/App.tsx");
const navigation = read("client/src/components/navigation.tsx");
const drip = read("server/onboardingDripService.ts");
const prerender = read("server/seo/publicProfilePrerender.ts");

assert.match(shell, /data-business-workspace-shell="true"/);
assert.match(shell, /data-workspace-desktop-sidebar="true"/);
assert.match(shell, /data-workspace-mobile-switcher="true"/);
assert.match(shell, /label: "Public profile"/);
assert.match(shell, /label: "Menu"/);
assert.match(shell, /label: availabilityLabel/);
assert.match(shell, /label: "Photos"/);
assert.match(shell, /label: "Deals"/);
assert.match(shell, /label: "Orders"/);
assert.match(shell, /label: "Audience"/);
assert.match(shell, /label: "Team"/);
assert.match(shell, /label: "Payments"/);
assert.match(shell, /label: "Settings"/);
assert.match(
  shell,
  /const availabilityLabel = isFoodTruck[\s\S]*\? "Schedule & live"/,
);
assert.match(shell, />Scout</);

assert.match(owner, /<BusinessWorkspaceShell/);
assert.match(owner, /activeModule=\{activeWorkspaceModule\}/);
assert.match(owner, /setupMode === "profile"[\s\S]*"profile"/);
assert.match(owner, /setupMode === "profile-media"[\s\S]*"media"/);
assert.match(owner, /setupMode === "schedule"[\s\S]*"availability"/);
assert.match(owner, /workspaceMode === "deals"[\s\S]*"deals"/);
assert.match(owner, /workspaceMode === "audience"[\s\S]*"audience"/);
assert.match(owner, /\/api\/restaurants\/my-restaurants/);
assert.match(owner, /\/profile-basics/);
assert.match(owner, /\/operating-hours/);

assert.match(menu, /<BusinessWorkspaceShell/);
assert.match(menu, /activeModule="menu"/);
assert.match(menu, /queryKey: \["\/api\/owner\/menus", restaurantId\]/);
assert.match(
  menu,
  /queryKey: \["\/api\/owner\/menus", selectedMenuId, "details"\]/,
);
assert.match(menu, /data-testid="owner-menu-workspace"/);

assert.match(app, /const usesBusinessWorkspace =/);
assert.match(app, /usesBusinessWorkspace \? "lg:pt-0" : "lg:pt-16"/);
assert.match(navigation, /const isBusinessWorkspaceRoute =/);

for (const [name, source] of [
  ["workspace shell", shell],
  ["global navigation", navigation],
  ["onboarding email", drip],
  ["public profile prerender", prerender],
] as const) {
  assert.doesNotMatch(
    source,
    /Open Scout|open Scout/,
    `${name} must use Scout as an action, never as something to open`,
  );
}

console.log("mealscout-business-workspace-shell.contract: PASS");
