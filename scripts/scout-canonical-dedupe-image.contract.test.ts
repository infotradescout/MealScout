import { readFileSync } from "node:fs";

const scoutPage = readFileSync("client/src/pages/explore-preview-v2.tsx", "utf8");
const scoutModel = readFileSync("client/src/features/scout/scoutDiscoveryModel.ts", "utf8");

const requiredSnippets = [
  "function getScoutBusinessKey(",
  '"businessId"',
  '"profileId"',
  '"restaurantId"',
  '"truckId"',
  "export function assignScoutBusinessCardsBySection<T>(",
  "SCOUT_PRIMARY_SECTION_PRIORITY",
  "filterUniqueScoutBusinessCards(",
  "claimedBusinessKeys",
  "normalizeScoutBusinessKind(source, \"restaurant\")",
  "const nearbyFoodBusinesses = useMemo<RestaurantSummary[]>(() => {",
  "const nearbyFoodTruckBusinesses = useMemo<RestaurantSummary[]>(() => {",
  "const scoutTruckInventory = useMemo(() => {",
  "const byId = new Map<string, LiveTruckSummary>();",
  "liveTrucks.forEach((truck) => byId.set(String(truck.id), truck));",
  "fallbackTruckBusinesses.forEach((truck) => {",
  "getRestaurantImage(restaurant)",
  "getTruckImage(truck)",
  "function resolveScoutBusinessImage(input:",
  "input.coverImageUrl",
  "input.heroImageUrl",
  "input.imageUrl",
  "input.logoUrl",
  'resolveBusinessMedia(assets, "scout_card")',
];

for (const snippet of requiredSnippets) {
  if (!scoutPage.includes(snippet) && !scoutModel.includes(snippet)) {
    throw new Error(`Missing scout canonical dedupe/image snippet: ${snippet}`);
  }
}

console.log("scout-canonical-dedupe-image.contract: PASS");
