import { readFileSync } from "node:fs";

const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");

const requiredSnippets = [
  "selectedSpotGasPriceSummary",
  "Select a spot to view gas prices.",
  "Gas prices are not available for this spot yet.",
  "Regular ",
  "Midgrade ",
  "Premium ",
  "Diesel ",
  "Gas prices:",
  "Gas: {selectedSpotGasPriceSummary}",
];

for (const snippet of requiredSnippets) {
  if (!parkingPassPage.includes(snippet)) {
    throw new Error(`Per-spot gas prices behavior missing snippet: ${snippet}`);
  }
}

console.log("Parking pass per-spot gas prices contract OK");
