import { readFileSync } from "node:fs";

const scoutPage = readFileSync("client/src/pages/scout-prototype.tsx", "utf8");

const requiredSnippets = [
  "const { data: trucksRaw = [] } = useQuery<Truck[]>({",
  'queryKey: ["/api/trucks/live", location.lat, location.lng],',
  "const { data: restaurantsRaw = [] } = useQuery<Restaurant[]>({",
  'queryKey: ["/api/restaurants/subscribed", location.lat, location.lng],',
  "function isDiscoverableTruckProfile(restaurant: Restaurant)",
  "const discoverableTruckProfiles = filterByResolvedLocation(restaurantsRaw)",
  "const trucksById = new Map<string, Truck>();",
  "discoverableTruckProfiles.forEach((truck) => {",
  "liveTrucks.forEach((truck) => {",
  ".sort((a, b) => {",
  "const aLiveRank = a.liveNow ? (a.liveSource === \"location_update\" ? 2 : 1) : 0;",
  "const aDistance = Number(a.distanceMiles ?? Number.POSITIVE_INFINITY);",
  "return String(a.name || \"\").localeCompare(String(b.name || \"\"));",
  "t.liveSource === \"scheduled_now\"",
  "\"Live now · Scheduled\"",
  "\"Serving area\"",
  "\"Not live now\"",
];

for (const snippet of requiredSnippets) {
  if (!scoutPage.includes(snippet)) {
    throw new Error(`Missing Scout inventory composition snippet: ${snippet}`);
  }
}

const dedupeOrderDiscoverable = scoutPage.indexOf("discoverableTruckProfiles.forEach((truck) => {");
const dedupeOrderLive = scoutPage.indexOf("liveTrucks.forEach((truck) => {");
if (dedupeOrderDiscoverable < 0 || dedupeOrderLive < 0 || dedupeOrderLive < dedupeOrderDiscoverable) {
  throw new Error("Expected discoverable-first then live override dedupe order");
}

console.log("scout-food-trucks-inventory-composition.contract: PASS");
