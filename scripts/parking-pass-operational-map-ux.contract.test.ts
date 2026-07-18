import { readFileSync } from "node:fs";

const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");
const mapPicker = readFileSync("client/src/components/maps/GoogleMapPicker.tsx", "utf8");

const requiredUiSnippets = [
  "Tools",
  "View dates and prices",
  "getParkingListingPriceLabel",
  "Road traffic",
  'surfaceMode="parking"',
  "showMapTypeControl={true}",
  "showRoadTrafficLayer={showRoadTrafficLayer}",
  "markerPriceLabel",
  "Propane (",
  "Supply (",
  "Support (",
  "Unavailable",
  "Green stronger",
  "Yellow moderate",
  "Red weaker",
  "Weather: ",
  "🔥 ",
  "📦 ",
  "🛠️ ",
  "group.key === activeLocationKey || bookings.length > 0",
];

for (const snippet of requiredUiSnippets) {
  if (!parkingPassPage.includes(snippet)) {
    throw new Error(`Operational parking map UX snippet missing: ${snippet}`);
  }
}

const requiredMapSnippets = [
  'zoomControlsPosition="bottom"',
  "Math.max(110, Math.min(1200, (cell.weight || 1) * 10))",
  "? 0.1",
  "? 0.14",
  ": 0.12",
];

for (const snippet of requiredMapSnippets) {
  if (!mapPicker.includes(snippet)) {
    throw new Error(`Map overlay dominance guard missing: ${snippet}`);
  }
}

console.log("Parking pass operational map UX contract OK");
