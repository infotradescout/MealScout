import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync("client/src/App.tsx", "utf8");
const dashboardSource = readFileSync("client/src/pages/user-dashboard.tsx", "utf8");

const guestRoutesStart = appSource.indexOf("{shouldUseGuestRoutes ? (");
const guestRoutesEnd = appSource.indexOf(") : (", guestRoutesStart);

assert(guestRoutesStart !== -1 && guestRoutesEnd !== -1, "App guest route block must exist.");

const guestRoutes = appSource.slice(guestRoutesStart, guestRoutesEnd);
const userDashboardRoute = '<Route path="/user-dashboard" component={UserDashboard} />';
const guestUserDashboardIndex = guestRoutes.indexOf(userDashboardRoute);
const guestBusinessCatchallIndex = guestRoutes.indexOf(
  '<Route path="/:businessSlug" component={PublicProfilePage} />',
);

assert(
  guestUserDashboardIndex !== -1,
  "Guest routes must explicitly serve /user-dashboard.",
);

assert(
  guestBusinessCatchallIndex !== -1 &&
    guestUserDashboardIndex < guestBusinessCatchallIndex,
  "Guest /user-dashboard route must resolve before the public profile catchall.",
);

assert(
  dashboardSource.includes("Sign In Required"),
  "User dashboard must keep the clean signed-out state.",
);

assert(
  dashboardSource.includes('href="/login?redirect=%2Fuser-dashboard"'),
  "Signed-out dashboard CTA must preserve the /user-dashboard return path.",
);

assert(
  !dashboardSource.includes("PROFILE NOT FOUND"),
  "User dashboard must never render PROFILE NOT FOUND copy.",
);

console.log("user-dashboard-auth-route.contract: PASS");
