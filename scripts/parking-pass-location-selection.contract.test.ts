import { readFileSync } from "node:fs";

const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");

const requiredSnippets = [
  "if (!listingHasAvailability(listing))",
  "Location unavailable",
  "Pick another open location.",
  "disabled={!hasAvailability}",
];

for (const snippet of requiredSnippets) {
  if (!parkingPassPage.includes(snippet)) {
    throw new Error(`parking-pass location selection guard missing: ${snippet}`);
  }
}

const forbiddenSnippets = ['disabled={!canBook}'];

for (const snippet of forbiddenSnippets) {
  if (parkingPassPage.includes(snippet)) {
    throw new Error(`parking-pass still hard-disables selection by canBook: ${snippet}`);
  }
}

console.log("parking-pass-location-selection.contract: PASS");
