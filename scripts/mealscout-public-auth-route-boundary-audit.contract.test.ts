import { existsSync, readFileSync } from "node:fs";

const auditPath = "MEALSCOUT_PUBLIC_AUTH_ROUTE_BOUNDARY_AUDIT.md";
const cleanupMapPath = "CLEANUP_MAP.md";

const requiredFiles = [
  auditPath,
  cleanupMapPath,
  "client/src/App.tsx",
  "server/routes.ts",
  "server/unifiedAuth.ts",
  "server/routes/authAccountRoutes.ts",
  "server/routes/publicDiscoveryRoutes.ts",
  "server/routes/publicMapRoutes.ts",
  "server/routes/publicSearchRoutes.ts",
  "server/routes/publicSeoLandingRoutes.ts",
  "server/routes/restaurantCoreRoutes.ts",
  "server/routes/restaurantOperationsRoutes.ts",
  "server/routes/dealDiscoveryRoutes.ts",
  "server/routes/dealManagementRoutes.ts",
  "server/routes/hostRoutes.ts",
  "server/routes/bookingRoutes.ts",
  "server/routes/businessTeamRoutes.ts",
  "server/routes/stripeWebhookRoutes.ts",
  "server/staffRoutes.ts",
  "server/moderationRoutes.ts",
];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    throw new Error(`C8 public/auth route boundary audit missing required file: ${file}`);
  }
}

const read = (path: string) => readFileSync(path, "utf8");
const audit = read(auditPath);
const cleanupMap = read(cleanupMapPath);
const app = read("client/src/App.tsx");
const routes = read("server/routes.ts");
const unifiedAuth = read("server/unifiedAuth.ts");
const authAccountRoutes = read("server/routes/authAccountRoutes.ts");
const publicDiscoveryRoutes = read("server/routes/publicDiscoveryRoutes.ts");
const publicMapRoutes = read("server/routes/publicMapRoutes.ts");
const publicSearchRoutes = read("server/routes/publicSearchRoutes.ts");
const publicSeoLandingRoutes = read("server/routes/publicSeoLandingRoutes.ts");
const restaurantCoreRoutes = read("server/routes/restaurantCoreRoutes.ts");
const dealDiscoveryRoutes = read("server/routes/dealDiscoveryRoutes.ts");
const dealManagementRoutes = read("server/routes/dealManagementRoutes.ts");
const hostRoutes = read("server/routes/hostRoutes.ts");
const bookingRoutes = read("server/routes/bookingRoutes.ts");
const businessTeamRoutes = read("server/routes/businessTeamRoutes.ts");
const stripeWebhookRoutes = read("server/routes/stripeWebhookRoutes.ts");

function requireIncludes(source: string, snippet: string, label = snippet) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing ${label}`);
  }
}

function requireMatch(source: string, pattern: RegExp, label: string) {
  if (!pattern.test(source)) {
    throw new Error(`Missing ${label}`);
  }
}

[
  "C8 public/auth route boundary audit complete",
  "docs/contract-only cleanup slice",
  "## Frontend Public Routes",
  "## Frontend Authenticated Routes",
  "## Server Public API Routes",
  "## Server Authenticated API Routes",
  "## Middleware Alignment",
  "## Boundary Checks",
  "## Follow-Up Tickets",
  "No hard public/auth boundary mismatch was found",
  "C9 Payment/Webhook Safety Map",
  "C10 Production Smoke Fixture Plan",
  "Do not change runtime behavior as part of this C8 audit",
  "Do not change auth middleware, role names, route permissions, redirects, or route registration order",
].forEach((snippet) => requireIncludes(audit, snippet, `audit snippet ${snippet}`));

[
  "## C8 - Public/Auth Route Boundary Audit",
  "Status: `DONE`",
  "MEALSCOUT_PUBLIC_AUTH_ROUTE_BOUNDARY_AUDIT.md",
  "scripts/mealscout-public-auth-route-boundary-audit.contract.test.ts",
  "C9 - Payment/Webhook Safety Map",
  "Status: `DONE`",
  "C10 - Production Smoke Fixture Plan",
].forEach((snippet) => requireIncludes(cleanupMap, snippet, `cleanup map snippet ${snippet}`));

requireMatch(
  cleanupMap,
  /## C8 - Public\/Auth Route Boundary Audit[\s\S]*Status: `DONE`[\s\S]*## C9A - Account Lifecycle \+ Discovery Boundary Audit/,
  "C8 done before C9A section",
);
requireMatch(
  cleanupMap,
  /## C9 - Payment\/Webhook Safety Map[\s\S]*Status: `DONE`[\s\S]*## C10 - Production Smoke Fixture Plan[\s\S]*Status: `DONE`/,
  "C9 and C10 are DONE",
);

[
  "const publicRoutePrefixes",
  "shouldUseGuestRoutes",
  '<Route path="/scout" component={ScoutPage} />',
  'path="/p/:profileType/:profileId"',
  '<Route path="/parking-pass" component={ParkingPassPage} />',
  'path="/restaurant-owner-dashboard"',
  '<Route path="/host/dashboard" component={HostDashboard} />',
  'path="/supplier/dashboard"',
  '<Route path="/admin/dashboard" component={AdminDashboard} />',
  '<Route path="/staff" component={StaffDashboard} />',
  '<Route path="/parking-pass-manage" component={ParkingPassManage} />',
].forEach((snippet) => requireIncludes(app, snippet, `App route snippet ${snippet}`));

[
  "registerPublicDiscoveryRoutes(app)",
  "registerPublicMapRoutes(app)",
  "registerPublicSearchRoutes(app)",
  "registerPublicSeoLandingRoutes(app)",
  "registerRestaurantOperationsRoutes(app",
  "registerDealManagementRoutes(app",
  "registerHostRoutes(app)",
  "registerBookingRoutes(app",
  "registerSupplierMarketplaceRoutes(app)",
  "registerStripeWebhookRoutes(app",
  "registerAdminManagementRoutes(app)",
  "registerStaffRoutes(app)",
  'app.get("/api/signals"',
].forEach((snippet) => requireIncludes(routes, snippet, `server route registration ${snippet}`));

[
  "export const isAuthenticated",
  "export const isAdmin",
  "export const isSuperAdmin",
  "export const isStaffOrAdmin",
  "export const isRestaurantOwnerOrAdmin",
  "export const isSupplierOrAdmin",
  "export const requireRole",
].forEach((snippet) => requireIncludes(unifiedAuth, snippet, `unified auth snippet ${snippet}`));

[
  'app.get("/api/auth/user"',
  'app.get("/api/location/context", isAuthenticated',
  'app.patch("/api/location/context", isAuthenticated',
  'app.get("/api/settings/me", isAuthenticated',
  'app.patch("/api/settings/me", isAuthenticated',
  '"/api/auth/change-temp-password"',
  'app.get("/api/user/addresses", isAuthenticated',
].forEach((snippet) => requireIncludes(authAccountRoutes, snippet, `auth account snippet ${snippet}`));

[
  '"/api/public/resolve/:entity/:slug"',
  '"/api/public/canonical/:entity/:id"',
  '"/api/public/profiles/:entity/:id"',
  '"/api/public/evidence/:entity/:id"',
  '"/api/cities"',
].forEach((snippet) => requireIncludes(publicDiscoveryRoutes, snippet, `public discovery snippet ${snippet}`));

[
  '"/api/map/runtime"',
  '"/api/map/locations"',
  '"/api/map/overlays"',
  '"/api/parking-pass/weather"',
  '"/api/parking-pass/intelligence-status"',
].forEach((snippet) => requireIncludes(publicMapRoutes, snippet, `public map snippet ${snippet}`));

requireIncludes(publicSearchRoutes, '"/api/search"', "public search endpoint");
requireIncludes(publicSearchRoutes, '"/api/search/suggestions/:query"', "public search suggestions endpoint");
requireIncludes(publicSeoLandingRoutes, '"/api/public/seo/food-trucks-today/:city"', "public SEO endpoint");

[
  '"/api/restaurants/search"',
  '"/api/restaurants/public"',
  '"/api/restaurants/:id"',
  "isRestaurantOwner",
  "isAuthenticated",
].forEach((snippet) => requireIncludes(restaurantCoreRoutes, snippet, `restaurant core snippet ${snippet}`));

[
  '"/api/deals/active"',
  '"/api/deals/my-active", isAuthenticated',
  '"/api/deals/featured"',
  '"/api/deals/recommended"',
  '"/api/reviews", isAuthenticated',
  "req.isAuthenticated?.()",
].forEach((snippet) => requireIncludes(dealDiscoveryRoutes, snippet, `deal discovery snippet ${snippet}`));

[
  '"/api/deals/claimed", isAuthenticated',
  '"/api/deals", isAuthenticated',
].forEach((snippet) => requireIncludes(dealManagementRoutes, snippet, `deal management snippet ${snippet}`));

[
  '"/api/payments/stripe-config"',
  '"/api/hosts", isAuthenticated',
  '"/api/hosts/me", isAuthenticated',
  '"/api/hosts/stripe/status", isAuthenticated',
].forEach((snippet) => requireIncludes(hostRoutes, snippet, `host route snippet ${snippet}`));

[
  '"/api/bookings/my-truck", isAuthenticated',
  '"/api/bookings/my-host", isAuthenticated',
  '"/api/trucks/:truckId/manual-schedule"',
  '"/api/bookings/truck/:truckId/schedule"',
  "req.isAuthenticated?.()",
].forEach((snippet) => requireIncludes(bookingRoutes, snippet, `booking route snippet ${snippet}`));

[
  '"/api/business-access/me", isAuthenticated',
  '"/api/business/team", isAuthenticated',
].forEach((snippet) => requireIncludes(businessTeamRoutes, snippet, `business team snippet ${snippet}`));

requireIncludes(stripeWebhookRoutes, 'app.post("/api/stripe/webhook"', "public Stripe webhook endpoint");

for (const forbidden of [
  "change runtime behavior",
  "changed runtime behavior",
  "route behavior was changed",
  "auth middleware was changed",
  "new feature",
  "sample data",
]) {
  if (audit.toLowerCase().includes(forbidden.toLowerCase()) && !/do not|no runtime|without/.test(audit.toLowerCase())) {
    throw new Error(`Audit appears to include forbidden scope: ${forbidden}`);
  }
}

console.log("mealscout-public-auth-route-boundary-audit.contract: PASS");
