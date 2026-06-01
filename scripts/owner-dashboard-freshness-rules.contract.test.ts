import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");

const requiredSnippets = [
  "const scheduleFreshnessDays = 7;",
  "const truckMenuWarningDays = 14;",
  "const truckMenuStaleDays = 30;",
  "const restaurantMenuWarningDays = 60;",
  "const restaurantMenuStaleDays = 90;",
  "menuNeedsReview",
  "menuIsStale",
  "menuNeedsNudge",
  "Menu current (needs review timestamp)",
  "Menu current (stale - refresh needed)",
  "Menu current (review soon)",
  "Schedule this week",
  "label: \"Hours complete\"",
  "? hasValidTruckScheduleWindow || scheduleUpdatedRecently",
  "menuFreshnessDays != null &&",
  "menuFreshnessDays > menuWarningDays",
  "menuFreshnessDays > menuStaleDays",
];

for (const snippet of requiredSnippets) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Missing owner freshness rules snippet: ${snippet}`);
  }
}

console.log("owner-dashboard-freshness-rules.contract: PASS");
