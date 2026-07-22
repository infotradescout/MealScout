import { readFileSync } from "node:fs";

const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");
const mapPicker = readFileSync("client/src/components/maps/GoogleMapPicker.tsx", "utf8");

const requiredUiSnippets = [
  "Map tools",
  "Gas (",
  "Propane (",
  "Supply (",
  "Support (",
  "Unavailable",
  "MealScout movement",
  "Scheduled activity",
  "Food destinations",
  "Weather: ",
  "🔥 ",
  "📦 ",
  "🛠️ ",
  "Nearby place from Google",
  "Open directions",
  "group.key === activeLocationKey || bookings.length > 0",
  "unlistedHostPins",
  "parkingPassHostPinCount",
  "parkingPassMapLocations",
  "Show every active, mappable host.",
  "Host pins",
  "fitPins",
  "Results are not limited to your",
  'apiUrl("/api/map/locations")',
];

for (const snippet of requiredUiSnippets) {
  if (!parkingPassPage.includes(snippet)) {
    throw new Error(`Operational parking map UX snippet missing: ${snippet}`);
  }
}

for (const forbiddenSnippet of [
  "only show paid/priced host locations",
  "return listingHostIds.has(hostId) || bookableHostIds.has(hostId)",
]) {
  if (parkingPassPage.includes(forbiddenSnippet)) {
    throw new Error(
      `Parking Pass must not hide unlisted map hosts: ${forbiddenSnippet}`,
    );
  }
}

const requiredMapSnippets = [
  "Math.max(110, Math.min(1200, (cell.weight || 1) * 10))",
  "? 0.1",
  "? 0.14",
  ": 0.12",
  "map.fitBounds(bounds, 72)",
  "new g.maps.Polyline",
];

for (const snippet of requiredMapSnippets) {
  if (!mapPicker.includes(snippet)) {
    throw new Error(`Map overlay dominance guard missing: ${snippet}`);
  }
}

console.log("Parking pass operational map UX contract OK");
