import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);

const requiredSnippets = [
  "const hasValidTruckOperatingWindow = (entries: any[]) => {",
  "const isTruckServingByScheduleNow = (entries: any[]) => {",
  "entry?.startTime || entry?.start || entry?.opensAt",
  "entry?.endTime || entry?.end || entry?.closesAt",
  "entry?.locationName ||",
  "entry?.serviceArea ||",
  "!scheduleStatusAllows(entry?.status)",
  "return startAt >= now && startAt <= weekAhead;",
  "return now >= startAt && now <= endAt;",
  "? hasValidTruckScheduleWindow || scheduleUpdatedRecently",
  "label: \"Schedule this week\"",
  "label: \"Hours complete\"",
];

for (const snippet of requiredSnippets) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Missing truck operating window snippet: ${snippet}`);
  }
}

if (ownerDashboard.includes('label: "Truck schedule current"')) {
  throw new Error("Legacy truck schedule checklist label must be removed");
}

console.log("truck-schedule-operating-windows.contract: PASS");
