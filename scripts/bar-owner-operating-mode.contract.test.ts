import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);
const publicProfile = readFileSync("client/src/pages/public-profile.tsx", "utf8");

const requiredOwnerSnippets = [
  "const isBarBusiness =",
  "const servesFood = Boolean(",
  "const hostsFoodTrucks = Boolean(",
  "const hasBarMarketing = hasDeal || hasEvents;",
  "label: \"Bar profile complete\"",
  "label: \"Hours complete\"",
  "label: \"Photos/logo complete\"",
  "label: \"Contact/social links complete\"",
  "label: \"Events or specials current\"",
  "Food menu complete",
  "label: \"Truck hosting availability complete\"",
  "label: \"Event/truck schedule current\"",
  "Optional boost: feature a bartender",
  "(!servesFood || hasMenu)",
  "barScheduleReady",
  "...(servesFood",
  "...(hostsFoodTrucks",
];

for (const snippet of requiredOwnerSnippets) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Missing bar owner snippet: ${snippet}`);
  }
}

if (!publicProfile.includes("function FeaturedBartendersSection")) {
  throw new Error("Featured bartenders public section is missing");
}
if (!publicProfile.includes('if (profile.profileType !== "bar") return null;')) {
  throw new Error("Featured bartenders must be bar-only");
}
if (!publicProfile.includes("(entry.isActive ?? true)")) {
  throw new Error("Inactive bartender cards must be excluded");
}
if (!publicProfile.includes("<FeaturedBartendersSection profile={restaurantProfile} />")) {
  throw new Error("Featured bartenders section is not wired into bar profile rendering");
}

console.log("bar-owner-operating-mode.contract: PASS");
