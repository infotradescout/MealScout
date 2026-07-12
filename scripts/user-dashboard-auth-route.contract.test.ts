import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync("client/src/App.tsx", "utf8");
const dashboardSource = readFileSync("client/src/pages/user-dashboard.tsx", "utf8");

const guestRoutesStart = appSource.indexOf("{shouldUseGuestRoutes ? (");
const guestRoutesEnd = appSource.indexOf(") : (", guestRoutesStart);

assert(guestRoutesStart !== -1 && guestRoutesEnd !== -1, "App guest route block must exist.");

const guestRoutes = appSource.slice(guestRoutesStart, guestRoutesEnd);

// /user-dashboard used to be duplicated inline in both the guest and
// authenticated route blocks; a route-consolidation refactor moved it
// (once) into a shared SharedPublicRoutes() component that both blocks
// render via <SharedPublicRoutes />, so it's no longer a literal <Route>
// tag inside this slice -- check for the shared-component reference and
// that /user-dashboard is actually defined inside that component instead.
const sharedRoutesIndex = guestRoutes.indexOf("<SharedPublicRoutes />");
const guestBusinessCatchallIndex = guestRoutes.indexOf(
  '<Route path="/:businessSlug" component={CleanPublicProfileRoute} />',
);

assert(
  sharedRoutesIndex !== -1,
  "Guest routes must render the shared public routes component.",
);

assert(
  appSource.includes(
    '<Route path="/user-dashboard" component={UserDashboard} />',
  ),
  "SharedPublicRoutes must explicitly serve /user-dashboard.",
);

assert(
  guestBusinessCatchallIndex !== -1 &&
    sharedRoutesIndex < guestBusinessCatchallIndex,
  "Guest shared routes (including /user-dashboard) must resolve before the public profile catchall.",
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
