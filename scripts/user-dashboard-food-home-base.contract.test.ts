import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("client/src/pages/user-dashboard.tsx", "utf8");

assert(
  source.includes('setLocation("/favorites", { replace: true })'),
  "Legacy user dashboard must replace itself with the canonical Saved route.",
);
assert(
  source.includes("Opening Saved"),
  "Legacy user dashboard must provide an honest transition state.",
);

const removedCompetingDashboardConcepts = [
  "Your Flavor Trail",
  "Nearby now",
  "Recommended next action",
  'queryKey: ["/api/users/favorites"]',
  'queryKey: ["/api/deals/recommended"]',
  "<Navigation",
];

for (const phrase of removedCompetingDashboardConcepts) {
  assert(
    !source.includes(phrase),
    `Legacy user dashboard must not keep the competing consumer dashboard concept: ${phrase}`,
  );
}

console.log("user-dashboard-food-home-base.contract: PASS");
