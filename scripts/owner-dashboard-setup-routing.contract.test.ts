import { readFileSync } from "node:fs";

const page = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);
const workspace = readFileSync(
  "client/src/components/business-workspace-shell.tsx",
  "utf8",
);

const requiredSnippets = [
  "const buildOwnerSetupHref = (",
  'href={buildOwnerSetupHref("profile")}',
  'href={buildOwnerSetupHref("menu")}',
  'href={buildOwnerSetupHref("profile-media")}',
  'setupMode === "profile" || setupMode === "profile-media"',
  'setupMode === "menu" ? (',
  'setupMode === "schedule"',
  'setupMode !== "schedule"',
  '<TabsContent value="foodtruck"',
  'data-testid="owner-availability-workspace"',
  "setupPanelRef.current.scrollIntoView",
];

for (const snippet of requiredSnippets) {
  if (!page.includes(snippet)) {
    throw new Error(`Missing setup routing snippet: ${snippet}`);
  }
}

for (const snippet of [
  'setup: "profile"',
  'setup: "profile-media"',
  'setup: "schedule"',
  '...(isFoodTruck ? { truck: "1" } : {})',
]) {
  if (!workspace.includes(snippet)) {
    throw new Error(`Missing workspace routing snippet: ${snippet}`);
  }
}

if (page.includes("querySelector('[data-testid=\"tab-food-truck\"]')")) {
  throw new Error("Schedule setup still depends on a jump-to-tab control");
}

console.log("owner-dashboard-setup-routing.contract: PASS");
