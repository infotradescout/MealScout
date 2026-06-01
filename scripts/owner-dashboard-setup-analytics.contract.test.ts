import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");

const requiredSnippets = [
  "analytics/timeseries?startDate=",
  "&endDate=",
  "if (response.status === 400) return [];",
  "Verification pending (non-blocking)",
  "className=\"w-full justify-start border-orange-200 bg-white text-orange-900 hover:bg-orange-100\"",
  "verificationState?.isVerifiedForSetup",
];

for (const snippet of requiredSnippets) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Missing owner dashboard setup/analytics contract snippet: ${snippet}`);
  }
}

console.log("owner-dashboard-setup-analytics.contract: PASS");
