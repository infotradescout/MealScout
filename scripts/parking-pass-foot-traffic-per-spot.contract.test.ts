import { readFileSync } from "node:fs";

const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");

const requiredSnippets = [
  '"parking-pass-schedule"',
  "weatherLat",
  "weatherLng",
  "scheduleWindowMinutes",
  "enabled: canLoadScheduleFootTraffic",
  "spotFootTrafficCells",
  "Select a spot to view area activity.",
  "spotActivitySummary",
  "destinationCells",
];

for (const snippet of requiredSnippets) {
  if (!parkingPassPage.includes(snippet)) {
    throw new Error(`Per-spot foot traffic behavior missing snippet: ${snippet}`);
  }
}

const forbiddenSnippets = [
  '"parking-pass",',
  "debouncedParkingMapBounds",
  "onBoundsChanged={setParkingMapBounds}",
];

for (const snippet of forbiddenSnippets) {
  if (parkingPassPage.includes(snippet)) {
    throw new Error(`Unexpected viewport-wide foot traffic behavior present: ${snippet}`);
  }
}

console.log("Parking pass per-spot area activity contract OK");
