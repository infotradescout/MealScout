import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeEligibleAffiliateDestination } from "../server/shareTargetPolicy.ts";

const currentOrigin = "https://www.mealscout.us";

assert.equal(
  normalizeEligibleAffiliateDestination("/scout?near=pensacola#map", currentOrigin),
  "/scout?near=pensacola#map",
);
assert.equal(
  normalizeEligibleAffiliateDestination(
    "https://www.mealscout.us/scout?near=pensacola",
    currentOrigin,
  ),
  "/scout?near=pensacola",
  "Legacy first-party affiliate URLs should continue to work as internal paths.",
);
assert.equal(
  normalizeEligibleAffiliateDestination(
    "http://localhost:5000/scout",
    "http://localhost:5000",
  ),
  "/scout",
  "The exact current application origin should work in local environments.",
);

for (const unsafe of [
  "https://evil.example/steal",
  "//evil.example/steal",
  "javascript:alert(1)",
  "data:text/html,redirect",
  "/api/auth/logout",
  "/admin/users",
  "/ref/loop",
  "/",
]) {
  assert.equal(
    normalizeEligibleAffiliateDestination(unsafe, currentOrigin),
    null,
    `Unsafe affiliate destination must be rejected: ${unsafe}`,
  );
}

const routes = readFileSync("server/affiliateRoutes.ts", "utf8");
const service = readFileSync("server/affiliateService.ts", "utf8");

assert(
  routes.includes("normalizeEligibleAffiliateDestination(") &&
    routes.includes("res.redirect(targetPath)") &&
    !routes.includes("res.redirect(link.sourceUrl)"),
  "The click route must redirect only to its normalized internal target.",
);
assert(
  service.includes("sourceUrl: safeSourceUrl") &&
    service.includes("buildTrackedAttributedUrl(publicOrigin, code, safeSourceUrl)"),
  "New affiliate records must store an internal path and build their public URL from the canonical origin.",
);

console.log("affiliate redirect policy behavior passed");
