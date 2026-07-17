import { readFileSync } from "node:fs";

const dashboard = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");

const requiredSnippets = [
  "currentRestaurant && setupMode && setupMode !== \"schedule\"",
  "Business onboarding",
  "id=\"owner-workspace-operations\"",
  "key={defaultTab}",
  "defaultValue={defaultTab}",
  "TabsTrigger value=\"active\"",
  "TabsTrigger value=\"analytics\"",
  "TabsTrigger value=\"bookings\"",
  "TabsTrigger value=\"foodtruck\"",
  "Open menu builder",
  "data-testid=\"owner-availability-workspace\"",
  "data-testid=\"owner-live-location-panel\"",
  "data-testid=\"owner-weekly-hours-panel\"",
];

for (const snippet of requiredSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing setup gating snippet: ${snippet}`);
  }
}

for (const staleSetupControl of [
  "Jump to schedule and live tools",
  "Jump to hours",
  "Open parking pass schedule manager",
]) {
  if (dashboard.includes(staleSetupControl)) {
    throw new Error(`Legacy schedule indirection remains: ${staleSetupControl}`);
  }
}

console.log("owner-dashboard-setup-gating.contract: PASS");
