import { readFileSync } from "node:fs";

const dashboard = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");
const dealsWorkspace = readFileSync(
  "client/src/components/owner-deals-workspace.tsx",
  "utf8",
);
const audienceWorkspace = readFileSync(
  "client/src/components/owner-audience-workspace.tsx",
  "utf8",
);

const requiredSnippets = [
  '!["schedule", "bookings"].includes(setupMode)',
  "Business onboarding",
  "id=\"owner-workspace-operations\"",
  "key={defaultTab}",
  "defaultValue={defaultTab}",
  "<OwnerDealsWorkspace",
  "<OwnerAudienceWorkspace",
  'activeWorkspaceModule === "deals"',
  'activeWorkspaceModule === "audience"',
  'activeWorkspaceModule === "availability"',
  "TabsTrigger value=\"bookings\"",
  "TabsTrigger value=\"foodtruck\"",
  "Open menu builder",
  "data-testid=\"owner-availability-workspace\"",
  "data-testid=\"owner-live-location-panel\"",
  "data-testid=\"owner-weekly-hours-panel\"",
  "data-testid=\"owner-booked-stops-workspace\"",
];

for (const snippet of requiredSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing setup gating snippet: ${snippet}`);
  }
}

for (const [source, snippet] of [
  [dealsWorkspace, "Give people a reason to choose"],
  [audienceWorkspace, 'data-testid="owner-audience-workspace"'],
] as const) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing routed workspace gating snippet: ${snippet}`);
  }
}

for (const retiredTab of [
  'TabsTrigger value="active"',
  'TabsTrigger value="analytics"',
]) {
  if (dashboard.includes(retiredTab)) {
    throw new Error(`Retired owner dashboard tab remains: ${retiredTab}`);
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
