import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("client/src/pages/user-dashboard.tsx", "utf8");
const normalized = source.toLowerCase();

const requiredPhrases = [
  "Your Flavor Trail",
  "Saved spots",
  "Nearby now",
  "Deals near you",
  "Recent places",
  "Recommended next action",
  "Find food near you",
  "Save places you want to try",
  "Deals you use will appear here",
  "Recent places will show up after you explore",
];

for (const phrase of requiredPhrases) {
  assert(
    source.includes(phrase),
    `User dashboard must include food-home-base copy: ${phrase}`,
  );
}

const prohibitedPhrases = [
  "Specials Used",
  "Total Saved",
  "This Month",
  "No specials claimed yet",
  "Start discovering amazing specials near you.",
  "Recent Activity",
];

for (const phrase of prohibitedPhrases) {
  assert(
    !source.includes(phrase),
    `User dashboard must not use cold metric/dashboard copy: ${phrase}`,
  );
}

assert(
  !normalized.includes("signals"),
  "User dashboard must not use customer-facing signals language.",
);

assert(
  !source.includes("TabsList"),
  "User dashboard should not keep the old wide dashboard tabs shell.",
);

console.log("user-dashboard-food-home-base.contract: PASS");
