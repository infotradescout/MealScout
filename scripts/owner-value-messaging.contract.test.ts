import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);
const normalizedOwnerDashboard = ownerDashboard.replace(/\s+/g, " ");

const requiredSnippets = [
  "Attribution summary",
  "Discovery traffic and profile actions are shown from real activity only.",
  "Completing your menu, photos, and action links helps people take the next step when they discover your profile.",
  "Use this panel weekly to track what changed and decide your next profile update.",
  "Complete profile basics",
  "Update menu and links",
  "?setup=profile&restaurantId=",
  "?setup=menu&restaurantId=",
];

for (const snippet of requiredSnippets) {
  if (!normalizedOwnerDashboard.includes(snippet)) {
    throw new Error(`PDA-2.5 owner messaging contract missing: ${snippet}`);
  }
}

const attributionSummaryStart = ownerDashboard.indexOf("Attribution summary");
if (attributionSummaryStart < 0) {
  throw new Error(
    "PDA-2.5 owner messaging contract could not locate Attribution summary block",
  );
}
const attributionSummarySlice = ownerDashboard
  .slice(attributionSummaryStart, attributionSummaryStart + 2200)
  .toLowerCase();

const bannedClaims = ["top-rated", "#1", "elite", "highest quality"];
for (const phrase of bannedClaims) {
  if (attributionSummarySlice.includes(phrase)) {
    throw new Error(`PDA-2.5 owner messaging includes banned claim: ${phrase}`);
  }
}

console.log("owner-value-messaging.contract: PASS");
