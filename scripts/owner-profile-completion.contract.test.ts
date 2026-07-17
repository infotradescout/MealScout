import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
);
const normalizedOwnerDashboard = ownerDashboard.replace(/\s+/g, " ");

const requiredSnippets = [
  "Profile completion loop",
  "Profile strength:",
  "Menu missing",
  "Photos missing",
  "Business hours missing",
  "Service area missing",
  "Contact method missing",
  "Social link missing",
  "Catering/private event info missing",
  "Deal/special missing",
  "Complete profiles are easier for people to evaluate when they find you through MealScout.",
  "Update next missing item",
  "Profile completion looks strong. Keep details current as your business updates.",
];

for (const snippet of requiredSnippets) {
  if (!normalizedOwnerDashboard.includes(snippet)) {
    throw new Error(`PDA-2.6 owner completion contract missing: ${snippet}`);
  }
}

console.log("owner-profile-completion.contract: PASS");
