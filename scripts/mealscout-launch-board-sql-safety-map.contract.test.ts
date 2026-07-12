import { existsSync, readFileSync } from "node:fs";

const safetyMapPath = "MEALSCOUT_LAUNCH_BOARD_SQL_SAFETY_MAP.md";
const cleanupMapPath = "CLEANUP_MAP.md";

if (!existsSync(safetyMapPath)) {
  throw new Error("MEALSCOUT_LAUNCH_BOARD_SQL_SAFETY_MAP.md must exist.");
}

if (!existsSync(cleanupMapPath)) {
  throw new Error("CLEANUP_MAP.md must exist.");
}

const safetyMap = readFileSync(safetyMapPath, "utf8");
const cleanupMap = readFileSync(cleanupMapPath, "utf8");
const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const combined = `${safetyMap}\n${cleanupMap}`;

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
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "All Launch Board Metric Groups",
  "SQL Tables Used",
  "Approved Column References",
  "Known Forbidden Column References",
  "City Filter Rules",
  "JSON/rawData Usage Rules",
  "Request Log Event Assumptions",
  "Insurance Verification Assumptions",
  "Parking Pass Funnel/Leak Assumptions",
  "Required Validation Commands",
  "Future SQL Change Checklist",
].forEach((snippet) => requireIncludes(safetyMap, snippet, snippet));

[
  "profilesTotal",
  "claimableProfiles",
  "claimedProfiles",
  "profilesWithMenu",
  "profilesWithSchedule",
  "profilesWithContact",
  "profilesWithPhotoLogo",
  "activeFoodTrucks",
  "activeHosts",
  "parkingPassListings",
  "bookingStarts",
  "bookingConfirmations",
  "publicProfileViews",
  "publicProfileActions",
  "affiliateLinkOpens",
  "claimPitchesCreated",
  "claimPitchesSent",
  "claimPitchesOpened",
  "claimPitchesStarted",
  "claimPitchesCompleted",
  "parkingPassNoListingLeak",
  "parkingPassClickNoStartLeak",
  "parkingPassStartNoConfirmLeak",
].forEach((snippet) => requireIncludes(safetyMap, snippet, `metric group ${snippet}`));

[
  "truckManualSchedules.truckId",
  "truck_manual_schedules.truck_id",
  "menuItems.restaurantId",
  "menu_items.restaurant_id",
  "restaurants.phone",
  "restaurants.websiteUrl",
  "r.phone",
  "r.website_url",
  "requestLogs.surface",
  "requestLogs.eventType",
  "truckImportListings.rawData",
].forEach((snippet) => requireIncludes(safetyMap, snippet, `approved schema reference ${snippet}`));

[
  "truckManualSchedules.restaurantId",
  "truck_manual_schedules.restaurant_id",
  "tms.restaurant_id",
  "tms2.restaurant_id",
  "restaurants.email",
  "r.email",
].forEach((snippet) => requireIncludes(safetyMap, snippet, `forbidden schema reference ${snippet}`));

[
  "truckImportListings.rawData.claimPitch",
  "l.raw_data->'claimPitch'",
  "sentAt",
  "pitchOpenedAt",
  "claimStartedAt",
  "claimCompletedAt",
].forEach((snippet) => requireIncludes(safetyMap, snippet, `rawData claimPitch rule ${snippet}`));

[
  "surface = 'public_profile'",
  "event_type = 'profile_view'",
  "event_type = 'profile_action'",
  "event_type in ('booking_click', 'menu_click', 'directions_click', 'call_click')",
  "event_type in ('parking_pass_view', 'parking_pass_listing_view')",
  "event_type = 'parking_pass_click'",
  "surface = 'launch_board'",
  "event_type = 'leak_fix_outcome'",
].forEach((snippet) => requireIncludes(safetyMap, snippet, `request_logs assumption ${snippet}`));

[
  "restaurants.city",
  "r.city",
  "hosts.city",
  "h.city",
  "events e",
  "truckImportListings.city",
  "l.city",
  "rl.metadata->>'marketCity'",
  "lower(trim(coalesce",
].forEach((snippet) => requireIncludes(safetyMap, snippet, `city filter rule ${snippet}`));

[
  "restaurants.insuranceVerified = true",
  "restaurants.insuranceExpiresAt",
  "non-expired stored insurance verification",
  "eventSeries",
  "seriesType = 'parking_pass'",
  "status = 'published'",
  "eventBookings.status = 'confirmed'",
].forEach((snippet) => requireIncludes(safetyMap, snippet, `insurance/parking assumption ${snippet}`));

[
  "node scripts/mealscout-one-market-launch-board.contract.test.ts",
  "node scripts/mealscout-claim-pitch-flow.contract.test.ts",
  "node scripts/mealscout-claim-pitch-sent-tracking.contract.test.ts",
  "node scripts/admin-insurance-verification.contract.test.ts",
  "npm run gate:production",
  "npm run check",
  "npm run build",
].forEach((snippet) => requireIncludes(safetyMap, snippet, `validation ${snippet}`));

requireMatch(
  safetyMap,
  /truckManualSchedules\.truckId[\s\S]*valid[\s\S]*truckManualSchedules\.restaurantId[\s\S]*forbidden/i,
  "truckId valid / restaurantId forbidden rule",
);

requireMatch(
  safetyMap,
  /restaurants\.phone[\s\S]*restaurants\.websiteUrl[\s\S]*contact fields[\s\S]*restaurants\.email[\s\S]*forbidden/i,
  "restaurant contact field and email forbidden rule",
);

requireMatch(
  cleanupMap,
  /C5 - Launch Board SQL Safety Map[\s\S]*Status: `DONE`/,
  "CLEANUP_MAP.md marks C5 DONE",
);

requireMatch(
  cleanupMap,
  /C6 - Parking Pass Page Decomposition Map[\s\S]*Status: `DONE`/,
  "CLEANUP_MAP.md marks C6 DONE",
);

[
  "eq(restaurants.id, truckManualSchedules.truckId)",
  "exists (select 1 from truck_manual_schedules tms where tms.truck_id = r.id)",
  "coalesce(trim(r.phone), '') <> '' or coalesce(trim(r.website_url), '') <> ''",
  "l.raw_data->'claimPitch'",
  "surface = 'launch_board'",
  "event_type = 'leak_fix_outcome'",
].forEach((snippet) => requireIncludes(adminCoreOpsRoutes, snippet, `owner route guard ${snippet}`));

if (/tms\.restaurant_id/i.test(adminCoreOpsRoutes)) {
  throw new Error("Launch Board owner route must not reference tms.restaurant_id.");
}

if (/coalesce\(trim\(r\.email\)|r\.email\s+is\s+not\s+null/i.test(adminCoreOpsRoutes)) {
  throw new Error("Launch Board owner route must not use r.email as contact coverage.");
}

const productFeatureLines = combined
  .split(/\r?\n/)
  .filter((line) =>
    /(new product feature|new dashboard|new monetization flow|new provider integration|feature plan)/i.test(
      line,
    ),
  );

for (const line of productFeatureLines) {
  if (!/(no |not |do not|does not|disallowed|without|frozen|approval)/i.test(line)) {
    throw new Error(`Launch Board SQL safety map appears to introduce feature scope: ${line}`);
  }
}

console.log("mealscout-launch-board-sql-safety-map.contract: PASS");
