import { existsSync, readFileSync } from "node:fs";

const mapPath = "MEALSCOUT_ADMIN_DASHBOARD_DECOMPOSITION_MAP.md";
const cleanupMapPath = "CLEANUP_MAP.md";

if (!existsSync(mapPath)) {
  throw new Error("MEALSCOUT_ADMIN_DASHBOARD_DECOMPOSITION_MAP.md must exist.");
}

if (!existsSync(cleanupMapPath)) {
  throw new Error("CLEANUP_MAP.md must exist.");
}

const map = readFileSync(mapPath, "utf8");
const cleanupMap = readFileSync(cleanupMapPath, "utf8");
const combined = `${map}\n${cleanupMap}`;

function requireIncludes(source: string, snippet: string, label = snippet) {
  if (!source.toLowerCase().includes(snippet.toLowerCase())) {
    throw new Error(`Missing ${label}.`);
  }
}

function requireMatch(source: string, pattern: RegExp, label: string) {
  if (!pattern.test(source)) {
    throw new Error(`Missing ${label}.`);
  }
}

[
  "client/src/pages/admin-dashboard.tsx",
  "Why it is dangerous",
  "why it should not be refactored casually",
  "Current Major Regions",
  "Proposed Component Boundaries",
  "Extraction Order",
  "Do-Not-Touch Rules",
  "Required Validations",
  "Exit Criteria For Future Refactor",
].forEach((snippet) => requireIncludes(map, snippet, snippet));

[
  "admin auth / admin user state",
  "tab selection and high-level dashboard shell",
  "Launch Board query/rendering",
  "food truck inventory / unclaimed imports",
  "claim pitch creation/status/share actions",
  "insurance verification controls",
  "user management/admin controls",
  "market/geo tools",
  "moderation/admin telemetry",
  "support/safety/admin panels",
].forEach((snippet) => requireIncludes(map, snippet, `major region ${snippet}`));

[
  "AdminDashboardShell",
  "AdminOverviewTab",
  "AdminLaunchBoardTab",
  "AdminFoodTruckInventoryTab",
  "AdminClaimPitchPanel",
  "AdminInsuranceVerificationControls",
  "AdminUserManagementTab",
  "AdminMarketGeoTab",
  "AdminModerationTab",
  "AdminTelemetryTab",
].forEach((snippet) => requireIncludes(map, snippet, `component boundary ${snippet}`));

[
  "1. Pure display cards",
  "2. Launch Board metric grid",
  "3. Claim pitch panel",
  "4. Food truck inventory table/cards",
  "5. Insurance controls",
  "6. User management",
  "7. Geo/market tools",
  "8. Shared hooks/API clients",
].forEach((snippet) => requireIncludes(map, snippet, `extraction order ${snippet}`));

[
  "Do not change endpoint paths",
  "Do not change auth gates",
  "Do not change Launch Board metric names",
  "Do not change claim pitch status values",
  "Do not change insurance verification semantics",
  "Do not change Parking Pass booking eligibility",
  "Do not change mutation behavior during decomposition",
  "Do not introduce new features",
].forEach((snippet) => requireIncludes(map, snippet, `do-not-touch rule ${snippet}`));

[
  "node scripts/mealscout-one-market-launch-board.contract.test.ts",
  "node scripts/mealscout-claim-pitch-flow.contract.test.ts",
  "node scripts/mealscout-claim-pitch-sent-tracking.contract.test.ts",
  "node scripts/admin-insurance-verification.contract.test.ts",
  "npm run gate:production",
  "npm run check",
  "npm run build",
].forEach((snippet) => requireIncludes(map, snippet, `validation ${snippet}`));

[
  "Contract tests remain green",
  "No endpoint names changed",
  "No metric names changed",
  "No mutation behavior changed",
  "Visual behavior is preserved",
  "Component has a clear prop boundary",
].forEach((snippet) => requireIncludes(map, snippet, `exit criteria ${snippet}`));

requireMatch(
  cleanupMap,
  /C4 - Admin Dashboard Decomposition Map[\s\S]*Status: `DONE`/,
  "CLEANUP_MAP.md marks C4 DONE",
);

requireMatch(
  cleanupMap,
  /C5 - Launch Board SQL Safety Map[\s\S]*Status: `NEXT`/,
  "CLEANUP_MAP.md marks C5 NEXT",
);

const productFeatureLines = combined
  .split(/\r?\n/)
  .filter((line) =>
    /(new product feature|new dashboard|new monetization flow|new provider integration)/i.test(
      line,
    ),
  );

for (const line of productFeatureLines) {
  if (!/(no |not |do not|disallowed|without|frozen|approval)/i.test(line)) {
    throw new Error(`Admin decomposition map appears to introduce feature scope: ${line}`);
  }
}

console.log("mealscout-admin-dashboard-decomposition-map.contract: PASS");
