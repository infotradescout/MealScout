import { readFileSync } from "node:fs";

const scoutPage = readFileSync("client/src/pages/scout-prototype.tsx", "utf8");

const requiredSnippets = [
  "function isDiscoverableTruckProfile(restaurant: Restaurant)",
  "restaurant.adminVerified === true ||",
  "restaurant.emailVerified === true ||",
  "restaurant.insuranceVerified !== false",
  "restaurant.isSuspended !== true && restaurant.isBanned !== true",
  "(hasCoords || hasServiceArea)",
  "const { data: trucksRaw = [] } = useQuery<Truck[]>({",
  "queryKey: [\"/api/trucks/live\", location.lat, location.lng],",
  "const { data: restaurantsRaw = [] } = useQuery<Restaurant[]>({",
  "queryKey: [\"/api/restaurants/subscribed\", location.lat, location.lng],",
  "const trucksById = new Map<string, Truck>();",
  "discoverableTruckProfiles.forEach((truck) => {",
  "liveTrucks.forEach((truck) => {",
  "const aScheduledRank = a.scheduledToday ? 1 : 0;",
  "const aCompleteness = (a.menuAvailable ? 1 : 0) + (a.photosAvailable ? 1 : 0);",
  "\"Menu: none found\"",
  "\"Photos coming soon\"",
  "\"Verified truck\"",
  "\"Scheduled today\"",
  "\"Serving area\"",
  "\"Not live now\"",
  "const key = canonicalScoutEntityKey(truck);",
  "const existing = trucksById.get(key);",
];

for (const snippet of requiredSnippets) {
  if (!scoutPage.includes(snippet)) {
    throw new Error(`Missing unified discoverability snippet: ${snippet}`);
  }
}

const dedupeOrderDiscoverable = scoutPage.indexOf("discoverableTruckProfiles.forEach((truck) => {");
const dedupeOrderLive = scoutPage.indexOf("liveTrucks.forEach((truck) => {");
if (dedupeOrderDiscoverable < 0 || dedupeOrderLive < 0 || dedupeOrderLive < dedupeOrderDiscoverable) {
  throw new Error("Expected discoverable-first then live override dedupe order");
}

console.log("unified-truck-discoverability.contract: PASS");
