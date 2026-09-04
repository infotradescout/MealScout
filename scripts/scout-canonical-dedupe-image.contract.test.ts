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
  "function resolveScoutBusinessImage(",
  '{ kind: "cover" as const',
  '{ kind: "hero" as const',
  '{ kind: "legacy" as const',
  '{ kind: "logo" as const',
  'return resolveBusinessMedia(assets, "scout_card")?.url || null;',
  "getRestaurantImage(restaurant)",
  "getTruckImage(truck)",
];

for (const snippet of requiredSnippets) {
  if (!scoutPage.includes(snippet) && !scoutModel.includes(snippet)) {
    throw new Error(`Missing scout canonical dedupe/image snippet: ${snippet}`);
  }
}

console.log("scout-canonical-dedupe-image.contract: PASS");
