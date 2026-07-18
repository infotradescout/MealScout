import { readFileSync } from "node:fs";

const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");
const mapPicker = readFileSync("client/src/components/maps/GoogleMapPicker.tsx", "utf8");

const requiredParkingPassSnippets = [
  "Area activity",
  "spotFootTrafficCells",
  "showParkingScoutHeat",
  "/api/map/foot-traffic",
  "MealScout movement",
  "Scheduled activity",
  "Food destinations",
  "not measured pedestrian counts",
  "trafficCells={spotFootTrafficCells}",
  "Select a spot to view area activity.",
  "No provider or MealScout activity signals were found for this spot yet.",
];

for (const snippet of requiredParkingPassSnippets) {
  if (!parkingPassPage.includes(snippet)) {
    throw new Error(`Parking pass foot traffic overlay missing snippet: ${snippet}`);
  }
}

if (!mapPicker.includes("cell.color ||")) {
  throw new Error("Map renderer does not respect overlay color overrides");
}

console.log("Parking pass truthful area activity overlay contract OK");
