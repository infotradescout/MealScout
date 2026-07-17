import { readFileSync } from "node:fs";

const page = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");

const requiredSnippets = [
  "const buildOwnerSetupHref = (",
  'href={buildOwnerSetupHref("profile")}',
  'href={buildOwnerSetupHref("menu")}',
  'href={buildOwnerSetupHref("profile-media")}',
  'href={buildOwnerSetupHref("schedule", currentIsTruckBusiness ? { truck: "1" } : undefined)}',
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

if (page.includes('querySelector(\'[data-testid="tab-food-truck"]\')')) {
  throw new Error("Schedule setup still depends on a jump-to-tab control");
}

console.log("owner-dashboard-setup-routing.contract: PASS");
