import { readFileSync } from "node:fs";

const ownerDashboard = readFileSync(
  "client/src/pages/restaurant-owner-dashboard.tsx",
  "utf8",
).replace(/\s+/g, " ");

for (const snippet of [
  "Profile completion loop",
  "Profile strength:",
  "Menu missing",
  "Approved profile media missing",
  "Dated truck stop missing",
  "Weekly business hours missing",
  "Public profile is not published",
  "Update next missing item",
  "Profile completion looks strong. Keep details current as your business updates.",
]) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(`Canonical owner completion contract missing: ${snippet}`);
  }
}

for (const legacyOptional of [
  "Service area missing",
  "Social link missing",
  "Catering/private event info missing",
  "Deal/special missing",
]) {
  if (ownerDashboard.includes(legacyOptional)) {
    throw new Error(`Optional item must not remain in completion denominator: ${legacyOptional}`);
  }
}

console.log("owner-profile-completion.contract: PASS");
