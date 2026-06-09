import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  CANONICAL_DASHBOARD_ENTRY_PATH,
  getAccountContinuationPath,
  getRoleDashboardPath,
} from "../client/src/lib/dashboard-route";

const dashboardRouter = readFileSync("client/src/pages/dashboard-router.tsx", "utf8");
const loginPage = readFileSync("client/src/pages/login.tsx", "utf8");
const accountSetupPage = readFileSync("client/src/pages/account-setup.tsx", "utf8");
const postVerificationPage = readFileSync("client/src/pages/post-verification.tsx", "utf8");

assert.equal(CANONICAL_DASHBOARD_ENTRY_PATH, "/dashboard");
assert.equal(getRoleDashboardPath({ userType: "admin" }), "/admin/dashboard");
assert.equal(getRoleDashboardPath({ userType: "staff" }), "/staff");
assert.equal(getRoleDashboardPath({ userType: "event_coordinator" }), "/event-coordinator/dashboard");
assert.equal(getRoleDashboardPath({ userType: "host" }), "/host/dashboard");
assert.equal(getRoleDashboardPath({ userType: "supplier" }), "/supplier/dashboard");
assert.equal(getRoleDashboardPath({ userType: "food_truck" }), "/restaurant-owner-dashboard");
assert.equal(getRoleDashboardPath({ userType: "restaurant_owner" }), "/restaurant-owner-dashboard");
assert.equal(getRoleDashboardPath({ roles: ["restaurant_owner"] }), "/restaurant-owner-dashboard");
assert.equal(getRoleDashboardPath({ userType: "customer" }), "/scout");
assert.equal(
  getAccountContinuationPath({ userType: "supplier", continuationPath: "/supplier/dashboard?setup=1" }),
  "/supplier/dashboard?setup=1",
);
assert.equal(
  getAccountContinuationPath({ userType: "supplier", continuationPath: "https://evil.test" }),
  "/supplier/dashboard",
);
assert.equal(
  getAccountContinuationPath({ userType: "supplier", continuationPath: "/account-setup" }),
  "/supplier/dashboard",
);

[
  "getRoleDashboardPath(user)",
  '"/login?redirect=/dashboard"',
].forEach((snippet) => {
  if (!dashboardRouter.includes(snippet)) {
    throw new Error(`Dashboard router missing canonical handoff snippet: ${snippet}`);
  }
});

[
  "CANONICAL_DASHBOARD_ENTRY_PATH",
  "redirectPath || CANONICAL_DASHBOARD_ENTRY_PATH",
].forEach((snippet) => {
  if (!loginPage.includes(snippet)) {
    throw new Error(`Login page missing canonical dashboard default: ${snippet}`);
  }
});

[
  "getAccountContinuationPath",
  "const getNoTokenContinuationPath = getAccountContinuationPath",
].forEach((snippet) => {
  if (!accountSetupPage.includes(snippet)) {
    throw new Error(`Account setup missing shared continuation helper: ${snippet}`);
  }
});

if (!postVerificationPage.includes("CANONICAL_DASHBOARD_ENTRY_PATH")) {
  throw new Error("Post-verification must default to the canonical dashboard entry.");
}

if (loginPage.includes('redirectPath || "/"')) {
  throw new Error("Login must not default post-auth users to root.");
}

console.log("app-unification-dashboard-entry.contract: PASS");
