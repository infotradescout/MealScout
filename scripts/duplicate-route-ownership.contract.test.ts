import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sources = [
  "server/routes/hostInterestRoutes.ts",
  "server/routes/hosts/eventsRoutes.ts",
  "server/routes/admin/userAdminRoutes.ts",
  "server/routes/systemUtilityRoutes.ts",
].map((path) => ({ path, source: readFileSync(path, "utf8") }));

function owners(route: string) {
  return sources.filter(({ source }) => source.includes(`"${route}"`));
}

assert.deepEqual(
  owners("/api/hosts/interests/:interestId/status").map(({ path }) => path),
  ["server/routes/hostInterestRoutes.ts"],
  "Host interest status must have one route owner.",
);
assert.deepEqual(
  owners("/api/admin/oauth/status").map(({ path }) => path),
  ["server/routes/systemUtilityRoutes.ts"],
  "OAuth status must have one route owner.",
);
const oauthOwner = readFileSync("server/routes/systemUtilityRoutes.ts", "utf8");
const oauthRouteStart = oauthOwner.indexOf('"/api/admin/oauth/status"');
const oauthRoute = oauthOwner.slice(oauthRouteStart, oauthRouteStart + 250);
assert(
  oauthRoute.includes("isAuthenticated") && oauthRoute.includes("isAdmin"),
  "OAuth configuration status must remain admin-only.",
);

console.log("duplicate route ownership contract passed");
