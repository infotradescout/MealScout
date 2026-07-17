import { readFileSync } from "node:fs";

const dashboard = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");

const requiredSnippets = [
  'setupMode === "menu"',
  "MealScout menu builder",
  "Open menu builder",
  "Schedule & live",
  "Manage booked stops",
  "Weekly service hours",
  "Go live",
  "Stop sharing",
  'setupMode === "profile-media" ? "Media workspace" : "Profile basics workspace"',
  "External links (optional)",
  "These links are optional secondary fields",
  "Website URL (optional)",
  "Menu URL (optional)",
  "Online ordering URL (optional)",
  "DoorDash URL (optional)",
  "Uber Eats URL (optional)",
  "Toast URL (optional)",
  "Square URL (optional)",
  "Open schedule/live tools",
];

const forbiddenSnippets = [
  "setLocation(`/menu-builder?",
];

for (const snippet of requiredSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing owner setup workspace snippet: ${snippet}`);
  }
}

for (const snippet of forbiddenSnippets) {
  if (dashboard.includes(snippet)) {
    throw new Error(`Found forbidden setup behavior snippet: ${snippet}`);
  }
}

console.log("owner-setup-workspace-required-tools.contract: PASS");
