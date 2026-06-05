import { existsSync, readFileSync } from "node:fs";

const mapPath = "MEALSCOUT_OWNER_DASHBOARD_DECOMPOSITION_MAP.md";
const cleanupMapPath = "CLEANUP_MAP.md";

if (!existsSync(mapPath)) {
  throw new Error("MEALSCOUT_OWNER_DASHBOARD_DECOMPOSITION_MAP.md must exist.");
}

if (!existsSync(cleanupMapPath)) {
  throw new Error("CLEANUP_MAP.md must exist.");
}

const map = readFileSync(mapPath, "utf8");
const cleanupMap = readFileSync(cleanupMapPath, "utf8");
const ownerDashboard = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");
const menuBuilder = readFileSync("client/src/pages/menu-builder.tsx", "utf8");
const parkingPass = readFileSync("client/src/pages/parking-pass.tsx", "utf8");
const dashboardRouter = readFileSync("client/src/pages/dashboard-router.tsx", "utf8");
const dashboardSwitcher = readFileSync("client/src/components/dashboard-switcher.tsx", "utf8");
const loginContinuation = readFileSync("server/services/loginContinuation.ts", "utf8");
const restaurantOperationsRoutes = readFileSync("server/routes/restaurantOperationsRoutes.ts", "utf8");
const restaurantCoreRoutes = readFileSync("server/routes/restaurantCoreRoutes.ts", "utf8");
const menuRoutes = readFileSync("server/routes/menuRoutes.ts", "utf8");
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
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "Current Owner Dashboard Responsibilities",
  "Related Owner Surfaces",
  "Server Route Ownership",
  "Proposed Component Boundaries",
  "Safe Extraction Order",
  "Do-Not-Touch Rules",
  "Required Validations",
  "Exit Criteria For Future Refactor",
].forEach((snippet) => requireIncludes(map, snippet, snippet));

[
  "restaurant owner surfaces",
  "food truck owner/operator surfaces",
  "menu/profile setup surfaces",
  "schedule/manual stop surfaces",
  "deals/marketing surfaces",
  "analytics/value attribution surfaces",
  "Parking Pass entry points",
  "verification/insurance state display",
  "dangerous mutation paths",
].forEach((snippet) => requireIncludes(map, snippet, `current responsibility ${snippet}`));

[
  "client/src/pages/menu-builder.tsx",
  "client/src/pages/online-menu.tsx",
  "client/src/pages/parking-pass.tsx",
  "client/src/pages/dashboard-router.tsx",
  "client/src/components/dashboard-switcher.tsx",
  "client/src/hooks/useAuth.ts",
  "server/routes/restaurantOperationsRoutes.ts",
  "server/routes/restaurantCoreRoutes.ts",
  "server/routes/menuRoutes.ts",
  "server/routes/restaurantSignupRoutes.ts",
  "server/services/loginContinuation.ts",
].forEach((snippet) => requireIncludes(map, snippet, `related surface ${snippet}`));

[
  "OwnerDashboardShell",
  "OwnerProfileCompletionPanel",
  "OwnerProfileEditor",
  "OwnerMenuPanel",
  "OwnerSchedulePanel",
  "OwnerDealsPanel",
  "OwnerParkingPassEntryPanel",
  "OwnerVerificationStatusPanel",
  "OwnerAnalyticsPanel",
].forEach((snippet) => requireIncludes(map, snippet, `component boundary ${snippet}`));

[
  "1. Pure display cards",
  "2. Owner dashboard shell layout",
  "3. Profile completion/readiness cards",
  "4. Read-only analytics cards",
  "5. Public profile/QR/menu entry display",
  "6. Deals display",
  "7. Schedule and Parking Pass entry display",
  "8. Profile editor display",
  "9. Verification/insurance status display",
  "10. Shared hooks/API clients",
].forEach((snippet) => requireIncludes(map, snippet, `extraction order ${snippet}`));

[
  "Do not change owner routes",
  "Do not change login continuation",
  "Do not change Parking Pass access",
  "Do not change insurance verification requirements",
  "Do not change menu gating/discoverability rules",
  "Do not change claim/setup flow",
  "Do not change endpoint paths",
  "Do not change query keys",
  "Do not change profile save behavior",
  "Do not change menu writes",
  "Do not change schedule writes",
  "Do not change subscription gating",
  "Do not introduce new features",
].forEach((snippet) => requireIncludes(map, snippet, `do-not-touch rule ${snippet}`));

[
  "/api/restaurants/my-restaurants",
  "/api/restaurants/:restaurantId/profile-basics",
  "/api/restaurants/:restaurantId/location",
  "/api/restaurants/:restaurantId/operating-hours",
  "/api/restaurants/:restaurantId/truck-session/start",
  "/api/restaurants/:restaurantId/truck-session/end",
  "/api/owner/value-attribution",
  "/api/owner/profile-completion-action",
  "/api/restaurants/:restaurantId/analytics/summary",
  "/api/restaurants/:restaurantId/analytics/export",
  "/api/restaurants/:id/verification/request",
  "/api/owner/menus/:restaurantId",
  "/api/owner/menus",
  "/api/owner/menu-categories",
  "/api/owner/menu-items",
  "/restaurant-owner-dashboard?setup=profile",
  "/menu-builder",
  "/parking-pass-manage",
].forEach((snippet) => requireIncludes(map, snippet, `endpoint or route ${snippet}`));

[
  "node scripts/mealscout-owner-dashboard-decomposition-map.contract.test.ts",
  "node scripts/mealscout-admin-dashboard-decomposition-map.contract.test.ts",
  "node scripts/mealscout-route-map.contract.test.ts",
  "node scripts/repoDoctor.mjs",
  "npm run gate:production",
  "npm run check",
  "npm run build",
].forEach((snippet) => requireIncludes(map, snippet, `validation ${snippet}`));

[
  "Contract tests remain green",
  "No endpoint names changed",
  "No query keys changed",
  "No owner routes changed",
  "No login continuation changed",
  "No Parking Pass access changed",
  "No insurance verification requirements changed",
  "No menu gating/discoverability rules changed",
  "No mutation behavior changed",
  "Visual behavior is preserved",
  "Component has a clear prop boundary",
].forEach((snippet) => requireIncludes(map, snippet, `exit criteria ${snippet}`));

[
  'user?.userType === "restaurant_owner"',
  'user?.userType === "food_truck"',
  'queryKey: ["/api/business-access/me"]',
  'queryKey: ["/api/restaurants/my-restaurants"]',
  'queryKey: ["/api/subscription/status"]',
  'queryKey: ["/api/bookings/my-truck"]',
  "/api/owner/value-attribution",
  "/api/owner/profile-completion-action",
  "/api/restaurants/${selectedRestaurant}/truck-session/start",
  "/api/restaurants/${selectedRestaurant}/truck-session/end",
  "/api/restaurants/${selectedRestaurant}/profile-basics",
  "/api/restaurants/${selectedRestaurant}/operating-hours",
  "/api/restaurants/${selectedRestaurant}/analytics/export",
  "/parking-pass-manage",
  "/menu-builder?restaurantId=",
].forEach((snippet) => requireIncludes(ownerDashboard, snippet, `owner dashboard evidence ${snippet}`));

[
  'queryKey: ["/api/owner/menus", restaurantId]',
  'apiRequest("POST", "/api/owner/menus"',
  'apiRequest("POST", "/api/owner/menu-categories"',
  'apiRequest("POST", "/api/owner/menu-items"',
  "/api/owner/restaurants/${encodeURIComponent(restaurantId)}/ordering-readiness",
].forEach((snippet) => requireIncludes(menuBuilder, snippet, `menu builder evidence ${snippet}`));

[
  'user?.userType === "food_truck"',
  'businessAccess?.permissions?.manageParkingPass === true',
  "/api/business-access/me",
].forEach((snippet) => requireIncludes(parkingPass, snippet, `Parking Pass evidence ${snippet}`));

[
  'primaryType === "restaurant_owner" || primaryType === "food_truck"',
  'setLocation("/restaurant-owner-dashboard")',
].forEach((snippet) => requireIncludes(dashboardRouter, snippet, `dashboard router evidence ${snippet}`));

[
  'href: "/parking-pass?adminMode=truck"',
  'href: "/menu-builder"',
].forEach((snippet) => requireIncludes(dashboardSwitcher, snippet, `dashboard switcher evidence ${snippet}`));

[
  'continuationPath = "/restaurant-owner-dashboard?setup=profile"',
  'continuationPath = "/menu-builder"',
  'continuationPath = "/parking-pass-manage"',
  'continuationPath = "/restaurant-owner-dashboard?setup=verification"',
].forEach((snippet) => requireIncludes(loginContinuation, snippet, `login continuation evidence ${snippet}`));

[
  '"/api/restaurants/my-restaurants"',
  '"/api/restaurants/:restaurantId/profile-basics"',
  '"/api/restaurants/:restaurantId/location"',
  '"/api/restaurants/:restaurantId/operating-hours"',
  '"/api/restaurants/:restaurantId/truck-session/start"',
  '"/api/restaurants/:restaurantId/truck-session/end"',
  '"/api/owner/value-attribution"',
  '"/api/owner/profile-completion-action"',
].forEach((snippet) => requireIncludes(restaurantOperationsRoutes, snippet, `restaurant operations route ${snippet}`));

[
  'app.post("/api/restaurants"',
  '"/api/restaurants/:id/verification/request"',
  '"/api/restaurants/:restaurantId/analytics/favorites"',
  '"/api/restaurants/:restaurantId/analytics/recommendations"',
].forEach((snippet) => requireIncludes(restaurantCoreRoutes, snippet, `restaurant core route ${snippet}`));

[
  '"/api/owner/menus/:restaurantId"',
  '"/api/owner/menus"',
  '"/api/owner/menu-categories"',
  '"/api/owner/menu-items"',
  '"/api/owner/restaurants/:restaurantId/ordering-readiness"',
].forEach((snippet) => requireIncludes(menuRoutes, snippet, `menu route ${snippet}`));

requireMatch(
  cleanupMap,
  /C7 - Owner Dashboard Decomposition Map[\s\S]*Status: `DONE`/,
  "CLEANUP_MAP.md marks C7 DONE",
);

requireMatch(
  cleanupMap,
  /C8 - Public\/Auth Route Boundary Audit[\s\S]*Status: `NEXT`/,
  "CLEANUP_MAP.md marks C8 NEXT",
);

const scopeDriftTerms = /\b(Merlin|TradeScout)\b/i;
if (scopeDriftTerms.test(combined)) {
  throw new Error("Owner dashboard decomposition map must not drift into Merlin/TradeScout scope.");
}

const productFeatureLines = combined
  .split(/\r?\n/)
  .filter((line) =>
    /(new product feature|new dashboard|new monetization flow|new provider integration|feature plan)/i.test(
      line,
    ),
  );

for (const line of productFeatureLines) {
  if (!/(no |not |do not|does not|disallowed|without|frozen|approval)/i.test(line)) {
    throw new Error(`Owner dashboard decomposition map appears to introduce feature scope: ${line}`);
  }
}

console.log("mealscout-owner-dashboard-decomposition-map.contract: PASS");
