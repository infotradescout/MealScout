import { existsSync, readFileSync } from "node:fs";

const mapPath = "MEALSCOUT_PARKING_PASS_DECOMPOSITION_MAP.md";
const cleanupMapPath = "CLEANUP_MAP.md";

if (!existsSync(mapPath)) {
  throw new Error("MEALSCOUT_PARKING_PASS_DECOMPOSITION_MAP.md must exist.");
}

if (!existsSync(cleanupMapPath)) {
  throw new Error("CLEANUP_MAP.md must exist.");
}

const map = readFileSync(mapPath, "utf8");
const cleanupMap = readFileSync(cleanupMapPath, "utf8");
const parkingPassPage = readFileSync("client/src/pages/parking-pass.tsx", "utf8");
const combined = `${map}\n${cleanupMap}`;

function requireIncludes(source: string, snippet: string, label = snippet) {
  if (!source.toLowerCase().includes(snippet.toLowerCase())) {
    throw new Error(`Missing ${label}.`);
  }
}

function requireMatch(source: string, pattern: RegExp, label: string) {
  if (!pattern.test(source)) {
    throw new Error(`Missing ${label}.`);
  }
}

[
  "client/src/pages/parking-pass.tsx",
  "Current Major Responsibilities",
  "Endpoint Inventory",
  "State Clusters",
  "Proposed Component Boundaries",
  "Extraction Order",
  "Do-Not-Touch Rules",
  "Required Validations",
  "Exit Criteria For Future Refactor",
].forEach((snippet) => requireIncludes(map, snippet, snippet));

[
  "Find & Book",
  "Host Tools",
  "My Schedule",
  "Map/Search",
  "Payment Modal",
  "Reports",
  "Social/Share",
  "Manual Schedule",
  "Live Location",
].forEach((snippet) => requireIncludes(map, snippet, `responsibility ${snippet}`));

[
  "ParkingPassPageShell",
  "ParkingPassFindBookTab",
  "ParkingPassMapSearchPanel",
  "ParkingPassLocationCardList",
  "ParkingPassPaymentSection",
  "ParkingPassHostToolsTab",
  "ParkingPassHostListingEditor",
  "ParkingPassHostLocationPanel",
  "ParkingPassTruckScheduleTab",
  "ParkingPassManualScheduleForm",
  "ParkingPassReportsDialog",
  "ParkingPassSocialSharePanel",
  "ParkingPassLiveLocationPanel",
].forEach((snippet) => requireIncludes(map, snippet, `component boundary ${snippet}`));

[
  "1. Pure display cards",
  "2. Read-only list cards",
  "3. Map/search panel",
  "4. Schedule calendar display",
  "5. Reports dialog",
  "6. Social/share settings display",
  "7. Host location display",
  "8. Host listing create/edit panel",
  "9. Payment modal wrapper",
  "10. Shared hooks/API clients",
].forEach((snippet) => requireIncludes(map, snippet, `extraction order ${snippet}`));

[
  "Do not change endpoint paths",
  "Do not change booking eligibility",
  "Do not change insurance verification requirements",
  "Do not change Stripe/payment intent behavior",
  "Do not change `BookingPaymentModal` prop semantics",
  "Do not change selected slot, cart, fee, or host-price calculations",
  "Do not change Parking Pass listing visibility rules",
  "Do not change host create/update/delete behavior",
  "Do not change manual schedule create/delete behavior",
  "Do not change social OAuth, social post queue, or manual share handoff behavior",
  "Do not change live-location write behavior",
  "Do not introduce new features",
].forEach((snippet) => requireIncludes(map, snippet, `do-not-touch rule ${snippet}`));

[
  "/api/parking-pass",
  "/api/parking-pass/host-ids",
  "/api/parking-pass/:passId/book",
  "/api/bookings/truck/:truckId/schedule",
  "/api/bookings/:bookingId/cancel",
  "/api/bookings/payment-intent/:paymentIntentId",
  "/api/hosts/parking-pass",
  "/api/trucks/:truckId/manual-schedule",
  "/api/trucks/:truckId/parking-reports",
  "/api/map/locations",
  "/api/map/foot-traffic",
  "/api/restaurants/:truckId/mobile-settings",
  "/api/restaurants/:truckId/location",
  "/api/restaurants/:truckId/live-share-card",
].forEach((snippet) => requireIncludes(map, snippet, `endpoint ${snippet}`));

[
  "node scripts/mealscout-parking-pass-decomposition-map.contract.test.ts",
  "node scripts/mealscout-launch-board-sql-safety-map.contract.test.ts",
  "node scripts/mealscout-admin-dashboard-decomposition-map.contract.test.ts",
  "node scripts/mealscout-route-map.contract.test.ts",
  "node scripts/repoDoctor.mjs",
  "npm run gate:production",
  "npm run check",
  "npm run build",
].forEach((snippet) => requireIncludes(map, snippet, `validation ${snippet}`));

[
  "BookingPaymentModal",
  'useState<"book" | "schedule" | "host">("book")',
  '"listings" | "location" | "payments"',
  "handleBookSelected",
  "handleCreatePass",
  "handleCreateSchedule",
  "handleSaveReport",
  "handleShareLocation",
  "isLive",
  'fetch(apiUrl("/api/parking-pass"))',
  'apiUrl("/api/map/locations")',
  'apiUrl(`/api/hosts/parking-pass?hostId=${hostId}`)',
  'apiUrl(`/api/restaurants/${truckId}/mobile-settings`)',
].forEach((snippet) => requireIncludes(parkingPassPage, snippet, `source owner evidence ${snippet}`));

requireMatch(
  cleanupMap,
  /C6 - Parking Pass Page Decomposition Map[\s\S]*Status: `DONE`/,
  "CLEANUP_MAP.md marks C6 DONE",
);

requireMatch(
  cleanupMap,
  /C7 - Owner Dashboard Decomposition Map[\s\S]*Status: `NEXT`/,
  "CLEANUP_MAP.md marks C7 NEXT",
);

const productFeatureLines = combined
  .split(/\r?\n/)
  .filter((line) =>
    /(new product feature|new dashboard|new monetization flow|new provider integration|feature plan)/i.test(
      line,
    ),
  );

for (const line of productFeatureLines) {
  if (!/(no |not |do not|does not|disallowed|without|frozen|approval)/i.test(line)) {
    throw new Error(`Parking Pass decomposition map appears to introduce feature scope: ${line}`);
  }
}

console.log("mealscout-parking-pass-decomposition-map.contract: PASS");
