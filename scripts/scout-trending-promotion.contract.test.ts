import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const scoutPage = readFileSync("client/src/pages/explore-preview.tsx", "utf8");
const mapPage = readFileSync("client/src/pages/map.tsx", "utf8");
const userDashboardPage = readFileSync("client/src/pages/user-dashboard.tsx", "utf8");

assert.ok(
  !scoutPage.includes('href="/trending"'),
  "Scout page must not promote /trending through visible CTAs.",
);

assert.ok(
  !scoutPage.includes("See trending"),
  "Scout page must not include a 'See trending' CTA label.",
);

assert.ok(
  !mapPage.includes('href: "/trending"'),
  "Map explore links must not include /trending promotion.",
);

assert.ok(
  !userDashboardPage.includes('href="/trending"'),
  "User dashboard must not include a /trending promotion card.",
);

console.log("scout-trending-promotion.contract: PASS");
