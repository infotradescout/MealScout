import { readFileSync } from "node:fs";

const service = readFileSync(
  "server/services/customProfileDomain.ts",
  "utf8",
);
const routes = readFileSync(
  "server/routes/authAccountRoutes.ts",
  "utf8",
);
const index = readFileSync("server/index.ts", "utf8");

for (const required of [
  "restaurantId: z.string().uuid()",
  "hasBusinessPermissionForRestaurant(",
  "Business access required",
  "normalizeCustomProfileHostname",
  "isMealScoutPlatformHostname",
  "canonicalPath:",
]) {
  if (!routes.includes(required)) {
    throw new Error(`Business-bound domain verification missing: ${required}`);
  }
}

for (const required of [
  "u.account_settings->'customDomain'->>'restaurantId'",
  "u.account_settings->'customDomain'->>'status' = 'verified'",
  "r.owner_id = u.id",
  "r.is_active = true",
  "if (rows.length !== 1) return null",
  "res.redirect(302, resolved.canonicalPath)",
]) {
  if (!service.includes(required)) {
    throw new Error(`Custom-domain routing safety missing: ${required}`);
  }
}

const middlewareIndex = index.indexOf("app.use(customProfileDomainRootRedirect)");
const prerenderIndex = index.indexOf(
  "registerPublicProfilePrerenderRoutes(app, canonicalBaseUrl)",
);
if (
  middlewareIndex === -1 ||
  prerenderIndex === -1 ||
  middlewareIndex > prerenderIndex
) {
  throw new Error("Custom-domain routing must run before public prerender");
}

console.log("mealscout-business-custom-domain-routing.contract: PASS");
