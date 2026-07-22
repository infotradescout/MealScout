import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");

const requiredSnippets = [
  "analytics/timeseries?startDate=",
  "&endDate=",
  "if (response.status === 400) return [];",
  "Verification pending",
  'data-testid="business-verification-information"',
  "Complete truck profile",
  "Open menu builder",
  "Add photos or logo",
  "Set schedule/live status",
  "verificationState?.verificationLabel",
];

for (const snippet of requiredSnippets) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Missing owner dashboard setup/analytics contract snippet: ${snippet}`);
  }
}

if (ownerDashboard.includes("analytics/timeseries?start=")) {
  throw new Error("Owner dashboard still contains deprecated timeseries start/end query shape");
}

console.log("owner-dashboard-setup-analytics.contract: PASS");
