import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync("client/src/App.tsx", "utf8");
const dashboardSource = readFileSync("client/src/pages/user-dashboard.tsx", "utf8");

const userDashboardRoutes = appSource.match(
  /<Route path="\/user-dashboard" component=\{UserDashboard\} \/>/g,
);
const dashboardRoutes = appSource.match(
  /<Route path="\/dashboard" component=\{DashboardRouter\} \/>/g,
);

assert.equal(
  userDashboardRoutes?.length,
  1,
  "/user-dashboard must be declared once so authenticated users do not render duplicate page trees.",
);
assert.equal(
  dashboardRoutes?.length,
  1,
  "/dashboard must be declared once so role routing does not run twice.",
);
assert(
  dashboardSource.includes('setLocation("/favorites", { replace: true })'),
  "/user-dashboard must remain a compatible entry that lands on Saved.",
);
assert(
  !dashboardSource.includes("Sign In Required"),
  "Authentication for Saved belongs to the canonical /favorites route.",
);

console.log("user-dashboard-auth-route.contract: PASS");
