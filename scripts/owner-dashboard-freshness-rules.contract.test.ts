import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);
const completionService = readFileSync(
  "server/services/profileCompletionEvidence.ts",
  "utf8",
);

for (const snippet of [
  'completionTruth?.menuState === "approved_current"',
  '"present_needs_confirmation"',
  'completionTruth?.menuState === "rejected"',
  "Food-truck availability requires a real dated stop",
]) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Owner canonical freshness UI is missing: ${snippet}`);
  }
}

for (const snippet of [
  "rawData.ownerMenuApproval",
  'status === "approved"',
  'status === "rejected"',
  "hasPublicSurface",
]) {
  if (!completionService.includes(snippet)) {
    throw new Error(`Menu approval evidence is missing: ${snippet}`);
  }
}

for (const staleRule of [
  "scheduleFreshnessDays",
  "truckMenuWarningDays",
  "truckMenuStaleDays",
  "restaurantMenuWarningDays",
  "restaurantMenuStaleDays",
  "scheduleUpdatedRecently",
  "Menu current (review soon)",
]) {
  if (ownerDashboard.includes(staleRule)) {
    throw new Error(`Owner completion still contains stale freshness rule: ${staleRule}`);
  }
}

console.log("owner-dashboard-freshness-rules.contract: PASS");
