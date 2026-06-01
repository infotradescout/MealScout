import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");

const requiredSnippets = [
  "const hasOperatingTimeRequirement = isFoodTruck",
  "? hasSchedule || hasTruckScheduleSignals",
  ": hasSchedule;",
  "hasOperatingTimeRequirement &&",
  "...(isFoodTruck",
  "label: \"Truck schedule complete\"",
  "href: \"/restaurant-owner-dashboard?setup=schedule&truck=1\"",
  ": [",
  "label: \"Hours complete\"",
  "href: \"/restaurant-owner-dashboard?setup=schedule\"",
  "{completedCount} of {checklistItems.length} steps complete",
  "Math.round((completedCount / checklistItems.length) * 100)",
];

for (const snippet of requiredSnippets) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Missing type-aware checklist snippet: ${snippet}`);
  }
}

const truckLabelIndex = ownerDashboard.indexOf('label: "Truck schedule complete"');
const hoursLabelIndex = ownerDashboard.indexOf('label: "Hours complete"');
if (truckLabelIndex < 0 || hoursLabelIndex < 0) {
  throw new Error("Both schedule/hour labels must exist in type-aware branch");
}

console.log("owner-dashboard-type-aware-completion.contract: PASS");
