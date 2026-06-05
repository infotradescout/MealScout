import { readFileSync } from "node:fs";

const adminCoreOps = readFileSync("server/routes/admin/adminCoreOpsRoutes.ts", "utf8");
const legacySchema = readFileSync("shared/schema/legacy.ts", "utf8");
const launchBoardSqlSafetyMap = readFileSync(
  "MEALSCOUT_LAUNCH_BOARD_SQL_SAFETY_MAP.md",
  "utf8",
);

const routeStart = adminCoreOps.indexOf('"/api/admin/profile-quarantine/suspects"');
const routeEnd = adminCoreOps.indexOf(
  '"/api/admin/profile-quarantine/:profileId/evidence/:evidenceId/accept"',
  routeStart,
);

if (routeStart === -1 || routeEnd === -1) {
  throw new Error("Profile quarantine suspects route must remain discoverable");
}

const route = adminCoreOps.slice(routeStart, routeEnd);

for (const forbidden of [
  "restaurants.email",
  "${restaurants}.email",
  "restaurants.email)",
  "restaurants.email,",
  "r.email",
  "email: sql<string>`coalesce(${restaurants}.email",
]) {
  if (route.includes(forbidden)) {
    throw new Error(`Profile quarantine suspects route must not reference nonexistent restaurant email column: ${forbidden}`);
  }
}

for (const required of [
  '"/api/admin/profile-quarantine/suspects"',
  "isAuthenticated",
  "isStaffOrAdmin",
  "phone: restaurants.phone",
  "websiteUrl: restaurants.websiteUrl",
  "rawData: sql<any>`coalesce(${restaurants}.raw_data, '{}'::jsonb)`",
  "email: users.email",
  ".leftJoin(users, eq(users.id, restaurants.ownerId))",
  "buildQuarantineReview(row)",
  "res.json({",
]) {
  if (!route.includes(required)) {
    throw new Error(`Profile quarantine suspects route missing schema-safe guard: ${required}`);
  }
}

const restaurantsStart = legacySchema.indexOf("export const restaurants = pgTable(");
const restaurantsEnd = legacySchema.indexOf("export const businessStaffInvites", restaurantsStart);
if (restaurantsStart === -1 || restaurantsEnd === -1) {
  throw new Error("restaurants schema block must remain discoverable");
}
const restaurantsSchema = legacySchema.slice(restaurantsStart, restaurantsEnd);

if (restaurantsSchema.includes('email:') || restaurantsSchema.includes('"email"')) {
  throw new Error("Do not introduce a fake restaurants.email column for this hotfix");
}

for (const requiredSchemaField of [
  "ownerId",
  'phone: varchar("phone")',
  'websiteUrl: varchar("website_url")',
  'instagramUrl: varchar("instagram_url")',
  'facebookPageUrl: varchar("facebook_page_url")',
  'socialAutopostSettings: jsonb("social_autopost_settings")',
]) {
  if (!restaurantsSchema.includes(requiredSchemaField)) {
    throw new Error(`restaurants schema missing expected existing contact/owner field: ${requiredSchemaField}`);
  }
}

for (const requiredMapSnippet of [
  "restaurants.email",
  "SQL `restaurants.email`",
  "SQL `r.email`",
  "Use `restaurants.phone` / `r.phone` and `restaurants.websiteUrl` / `r.website_url`",
  "join through `restaurants.ownerId` to `users.id`",
]) {
  if (!launchBoardSqlSafetyMap.includes(requiredMapSnippet)) {
    throw new Error(`Launch Board SQL safety map must keep restaurant email drift guidance: ${requiredMapSnippet}`);
  }
}

for (const forbiddenScope of [
  "affiliatePayout",
  "affiliateCommission",
  "parking pass",
  "updateUserType",
  "verify-insurance",
]) {
  if (route.toLowerCase().includes(forbiddenScope.toLowerCase())) {
    throw new Error(`Profile quarantine schema hotfix must not touch unrelated scope: ${forbiddenScope}`);
  }
}

console.log("mealscout-profile-quarantine-schema.contract: PASS");
