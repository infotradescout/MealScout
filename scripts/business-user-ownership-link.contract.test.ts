import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serviceSource = readFileSync(
  "server/services/businessTeamAccess.ts",
  "utf8",
);
const adminRouteSource = readFileSync(
  "server/routes/admin/userAdminRoutes.ts",
  "utf8",
);
const mediaRouteSource = readFileSync("server/routes/mediaRoutes.ts", "utf8");

assert.match(serviceSource, /linkState\s*=\s*[\s\S]*"linked"[\s\S]*"not_attached"/);
assert.match(
  serviceSource,
  /Connect or claim your business to continue\./,
);

assert.match(
  adminRouteSource,
  /\/api\/admin\/business-users\/:userId\/attach-restaurant/,
);
assert.match(
  adminRouteSource,
  /Only super admin can attach a business user to a business\./,
);

assert.match(mediaRouteSource, /hasBusinessPermissionForRestaurant/);
assert.match(mediaRouteSource, /"manageProfile"/);

console.log("business-user-ownership-link.contract: PASS");
