import { readFileSync } from "node:fs";

const dashboard = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");

const requiredSnippets = [
  "currentRestaurant && setupMode",
  "Business onboarding",
  "<Tabs defaultValue={defaultTab} className=\"space-y-4\">",
  "TabsTrigger value=\"active\"",
  "TabsTrigger value=\"analytics\"",
  "TabsTrigger value=\"bookings\"",
  "TabsTrigger value=\"foodtruck\"",
  "Open menu builder",
  "Jump to schedule/live tools",
];

for (const snippet of requiredSnippets) {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing setup gating snippet: ${snippet}`);
  }
}

console.log("owner-dashboard-setup-gating.contract: PASS");
