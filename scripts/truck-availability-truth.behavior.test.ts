import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.NODE_ENV = "development";
process.env.PUBLIC_SLOT_LOOKAHEAD_HOURS = "168";
process.env.PUBLIC_SLOT_TTL_HOURS = "72";
process.env.PUBLIC_SLOT_GRACE_MINUTES = "30";

const { assembleTruckOperatingPlan, assembleTruckOperatingProfileData } =
  await import(
  "../server/services/truckOperatingPlan"
  );
const { buildSlotDateTimes } = await import("../server/services/timeIntent");

const now = new Date("2026-07-22T16:00:00.000Z");
const freshConfirmation = new Date("2026-07-22T15:30:00.000Z");

for (const [startTime, endTime] of [
  ["99:99", "12:00"],
  ["25:00", "12:00"],
  ["12:60", "14:00"],
  ["12:00", "12:00"],
  ["12:00garbage", "14:00"],
] as const) {
  assert.equal(
    buildSlotDateTimes({
      timeZone: "America/Chicago",
      date: "2026-07-22",
      startTime,
      endTime,
    }),
    null,
    `${startTime}-${endTime} must not normalize into a public interval`,
  );
}

const confirmedBooking = {
  sourceKind: "booking" as const,
  stopId: "booking-1",
  eventId: "event-1",
  eventTitle: "Canonical lunch stop",
  eventDescription: "Confirmed through Parking Pass",
  eventType: "food_truck_night",
  date: "2026-07-22",
  startTime: "10:00",
  endTime: "14:00",
  sourceStatus: "open",
  bookingStatus: "confirmed",
  isPublic: true,
  locationName: "Canonical Host",
  address: "1 Public Plaza",
  city: "Pensacola",
  state: "FL",
  latitude: "30.42",
  longitude: "-87.21",
  hostId: "host-1",
  hostName: "Canonical Host",
  timezone: "America/Chicago",
  lastConfirmedAt: freshConfirmation,
  updatedAt: freshConfirmation,
  mapEligible: true,
  liveFeedEligible: true,
};

{
  const plan = assembleTruckOperatingPlan({
    rows: [
      confirmedBooking,
      {
        ...confirmedBooking,
        stopId: "legacy-canceled-booking",
        bookingStatus: "cancelled",
      },
      {
        ...confirmedBooking,
        stopId: "pending-booking",
        bookingStatus: "pending",
      },
    ],
    now,
  });
  assert.equal(plan.status, "here_now");
  assert.equal(plan.currentStop?.stopId, "booking-1");
  assert.equal(plan.upcomingStops.length, 0);
  assert.match(plan.currentStop?.directionsUrl || "", /30\.42,-87\.21/);

  const profileData = assembleTruckOperatingProfileData({
    rows: [
      confirmedBooking,
      {
        ...confirmedBooking,
        stopId: "legacy-canceled-booking",
        eventId: "event-canceled",
        eventTitle: "Canceled event",
        bookingStatus: "cancelled",
      },
    ],
    now,
  });
  assert.equal(profileData.eventsItems.length, 1);
  assert.equal(profileData.eventsItems[0]?.id, "event-1");
  assert.equal(profileData.eventsItems[0]?.actionType, "directions");
  assert.equal(profileData.upcomingEventCount, 1);
}

{
  const futureBooking = {
    ...confirmedBooking,
    stopId: "booking-future",
    eventId: "event-future",
    eventTitle: "Tomorrow's confirmed stop",
    date: "2026-07-23",
    startTime: "10:00",
    endTime: "14:00",
    lastConfirmedAt: "2026-06-01T12:00:00.000Z",
  };
  const profileData = assembleTruckOperatingProfileData({
    rows: [futureBooking],
    now,
  });
  assert.equal(profileData.truckSchedule.nextStop?.stopId, "booking-future");
  assert.equal(profileData.truckSchedule.upcomingStops.length, 0);
  assert.equal(profileData.truckSchedule.upcomingCount, 1);
  assert.equal(profileData.eventsItems[0]?.id, "event-future");

  const currentAndFuture = assembleTruckOperatingPlan({
    rows: [confirmedBooking, futureBooking],
    now,
  });
  assert.equal(currentAndFuture.currentStop?.stopId, "booking-1");
  assert.equal(
    currentAndFuture.upcomingStops[0]?.stopId,
    "booking-future",
    "A future stop must remain visible when the current stop owns the primary card",
  );
}

{
  const durableOwnerStop = assembleTruckOperatingPlan({
    rows: [
      {
        sourceKind: "manual",
        stopId: "durable-owner-stop",
        date: "2026-07-23",
        startTime: "10:00",
        endTime: "14:00",
        sourceStatus: "confirmed",
        isPublic: true,
        city: "Pensacola",
        state: "FL",
        timezone: "America/Chicago",
        lastConfirmedAt: "2026-06-01T12:00:00.000Z",
        expiresAt: "2026-07-23T19:00:00.000Z",
        sourceType: "owner_manual",
        sourceConfidence: "confirmed",
        ownerSubmittedEquivalent: true,
        liveFeedEligible: true,
      },
    ],
    now,
  });
  assert.equal(
    durableOwnerStop.nextStop?.stopId,
    "durable-owner-stop",
    "An owner-confirmed stop with an explicit expiry must not vanish after 72 hours",
  );
}

{
  const plan = assembleTruckOperatingPlan({
    rows: [
      {
        sourceKind: "manual",
        stopId: "private",
        date: "2026-07-22",
        startTime: "12:00",
        endTime: "15:00",
        sourceStatus: "open",
        isPublic: false,
        city: "Pensacola",
        state: "FL",
        lastConfirmedAt: freshConfirmation,
      },
      {
        sourceKind: "manual",
        stopId: "missing-timezone-evidence",
        date: "2026-07-22",
        startTime: "12:00",
        endTime: "15:00",
        sourceStatus: "open",
        isPublic: true,
        lastConfirmedAt: freshConfirmation,
      },
      {
        sourceKind: "manual",
        stopId: "expired",
        date: "2026-07-22",
        startTime: "12:00",
        endTime: "15:00",
        sourceStatus: "open",
        isPublic: true,
        city: "Pensacola",
        state: "FL",
        expiresAt: "2026-07-22T15:59:59.000Z",
        lastConfirmedAt: freshConfirmation,
      },
      {
        sourceKind: "manual",
        stopId: "stale",
        date: "2026-07-22",
        startTime: "12:00",
        endTime: "15:00",
        sourceStatus: "open",
        isPublic: true,
        city: "Pensacola",
        state: "FL",
        lastConfirmedAt: "2026-07-18T00:00:00.000Z",
      },
      {
        sourceKind: "manual",
        stopId: "invalid-timezone",
        date: "2026-07-22",
        startTime: "12:00",
        endTime: "15:00",
        sourceStatus: "open",
        isPublic: true,
        timezone: "Not/A_Timezone",
        lastConfirmedAt: freshConfirmation,
      },
      {
        sourceKind: "manual",
        stopId: "disabled-feed",
        date: "2026-07-22",
        startTime: "12:00",
        endTime: "15:00",
        sourceStatus: "open",
        isPublic: true,
        city: "Pensacola",
        state: "FL",
        liveFeedEligible: false,
        lastConfirmedAt: freshConfirmation,
      },
      {
        sourceKind: "manual",
        stopId: "disabled-closed-day",
        date: "2026-07-22",
        sourceStatus: "closed",
        isPublic: true,
        city: "Pensacola",
        state: "FL",
        liveFeedEligible: false,
        lastConfirmedAt: freshConfirmation,
      },
    ],
    now,
  });
  assert.equal(plan.status, "unknown");
  assert.equal(plan.statusLabel, "No schedule posted");
  assert.equal(plan.currentStop, null);
  assert.equal(plan.nextStop, null);
  assert.deepEqual(plan.upcomingStops, []);
}

{
  const plan = assembleTruckOperatingPlan({
    rows: [
      {
        sourceKind: "manual",
        stopId: "no-map",
        date: "2026-07-22",
        startTime: "12:00",
        endTime: "15:00",
        sourceStatus: "open",
        isPublic: true,
        locationName: "Owner-confirmed lunch",
        address: "5 Main Street",
        city: "Pensacola",
        state: "FL",
        timezone: "America/Chicago",
        lastConfirmedAt: freshConfirmation,
        mapEligible: false,
        liveFeedEligible: true,
      },
      {
        sourceKind: "manual",
        stopId: "closed-day",
        date: "2026-07-22",
        sourceStatus: "closed",
        isPublic: true,
        city: "Pensacola",
        state: "FL",
        timezone: "America/Chicago",
        lastConfirmedAt: freshConfirmation,
        mapEligible: true,
      },
    ],
    now,
  });
  assert.equal(plan.nextStop?.stopId, "no-map");
  assert.equal(plan.nextStop?.directionsUrl, null);
  assert.equal(plan.nextStop?.latitude, null);
  assert.equal(plan.closedStops.length, 1);
  assert.equal(plan.closedStops[0]?.directionsUrl, null);
  assert.equal(plan.closedStops[0]?.hostProfilePath, null);
}

{
  const overnight = assembleTruckOperatingPlan({
    rows: [
      {
        sourceKind: "manual",
        stopId: "overnight",
        date: "2026-07-22",
        startTime: "22:00",
        endTime: "01:00",
        sourceStatus: "open",
        isPublic: true,
        city: "Pensacola",
        state: "FL",
        timezone: "America/Chicago",
        lastConfirmedAt: freshConfirmation,
        liveFeedEligible: true,
      },
    ],
    now: new Date("2026-07-23T04:30:00.000Z"),
  });
  assert.equal(overnight.currentStop?.stopId, "overnight");
}

{
  const THREE_D_EATS_ID = "95c4e656-f3cc-46ab-ae18-53f549cecfd1";
  assert.match(THREE_D_EATS_ID, /^[0-9a-f-]{36}$/);
  const plan = assembleTruckOperatingPlan({ rows: [], now });
  assert.equal(plan.status, "unknown");
  assert.equal(plan.statusLabel, "No schedule posted");
  assert.equal(plan.currentStop, null);
  assert.equal(plan.todayStop, null);
  assert.equal(plan.nextStop, null);
  assert.deepEqual(plan.upcomingStops, []);
  assert.deepEqual(plan.closedStops, []);
  const profileData = assembleTruckOperatingProfileData({ rows: [], now });
  assert.deepEqual(profileData.eventsItems, []);
  assert.equal(profileData.upcomingEventCount, 0);
}

const root = process.cwd();
const serviceSource = fs.readFileSync(
  path.join(root, "server", "services", "truckOperatingPlan.ts"),
  "utf8",
);
const routeSource = fs.readFileSync(
  path.join(root, "server", "routes", "publicDiscoveryRoutes.ts"),
  "utf8",
);
const bookingRouteSource = fs.readFileSync(
  path.join(root, "server", "routes", "bookingRoutes.ts"),
  "utf8",
);
const publicMapRouteSource = fs.readFileSync(
  path.join(root, "server", "routes", "publicMapRoutes.ts"),
  "utf8",
);
const confirmedEventTrucksSource = fs.readFileSync(
  path.join(root, "server", "services", "confirmedEventTrucks.ts"),
  "utf8",
);
const eventRouteSource = fs.readFileSync(
  path.join(root, "server", "routes", "eventRoutes.ts"),
  "utf8",
);
const userAdminRouteSource = fs.readFileSync(
  path.join(root, "server", "routes", "admin", "userAdminRoutes.ts"),
  "utf8",
);
const discoveryRouteSource = fs.readFileSync(
  path.join(root, "server", "routes", "discoveryRoutes.ts"),
  "utf8",
);
const prerenderSource = fs.readFileSync(
  path.join(root, "server", "seo", "publicProfilePrerender.ts"),
  "utf8",
);
const publicSeoLandingSource = fs.readFileSync(
  path.join(root, "server", "routes", "publicSeoLandingRoutes.ts"),
  "utf8",
);
const seoRouteSource = fs.readFileSync(
  path.join(root, "server", "routes", "seoRoutes.ts"),
  "utf8",
);
const recommendationSource = fs.readFileSync(
  path.join(root, "server", "services", "recommendationEngine.ts"),
  "utf8",
);
assert.match(serviceSource, /\.from\(eventBookings\)/);
assert.match(serviceSource, /eq\(eventBookings\.truckId, restaurantId\)/);
assert.match(serviceSource, /eq\(eventBookings\.status, "confirmed"\)/);
assert.doesNotMatch(serviceSource, /bookedRestaurantId/);
assert.match(routeSource, /buildPublicTruckOperatingPlan\(String\(row\.id\)\)/);
assert.doesNotMatch(routeSource, /buildPublicTruckSchedulePayload/);
assert.match(
  routeSource,
  /isTruckProfile[\s\S]*buildPublicTruckOperatingPlan[\s\S]*\.\.\.profileActivityPayload/,
);
assert.ok(
  (bookingRouteSource.match(/isTruckOperatingPlanRowPublic/g) || []).length >= 4,
  "Anonymous booking and manual-schedule surfaces must reuse the profile eligibility policy",
);
assert.match(
  bookingRouteSource,
  /sourceKind: "manual"[\s\S]*expiresAt:[\s\S]*liveFeedEligible:/,
  "The anonymous manual endpoint must evaluate expiry and live-feed eligibility",
);
assert.match(
  publicMapRouteSource,
  /isTruckOperatingPlanRowPublic\([\s\S]*sourceKind: "manual"[\s\S]*expiresAt: schedule\.expiresAt/,
  "The public map must use the same manual-stop truth policy as the profile",
);
assert.doesNotMatch(
  publicMapRouteSource,
  /status !== "open"/,
  "Confirmed owner-created manual stops must not disappear from the map",
);
assert.match(
  publicMapRouteSource,
  /schedule\.mapEligible !== true/,
  "A card-only manual stop must fail closed on the public map",
);
assert.match(
  bookingRouteSource,
  /acceptedInterestRows[\s\S]*\.filter\(\(\) => includePending\)/,
  "Accepted interest must remain private until it becomes a confirmed booking",
);
assert.doesNotMatch(
  bookingRouteSource,
  /entry\.date >= today/,
  "Timezone-aware projection must decide whether a date-only manual stop is public",
);
assert.match(confirmedEventTrucksSource, /\.from\(eventBookings\)/);
assert.match(
  confirmedEventTrucksSource,
  /eq\(eventBookings\.status, "confirmed"\)/,
  "Public event-to-truck associations must originate from confirmed bookings",
);
assert.match(
  confirmedEventTrucksSource,
  /isNotNull\(eventBookings\.bookingConfirmedAt\)/,
  "A confirmed public truck association must carry durable confirmation evidence",
);
assert.match(
  confirmedEventTrucksSource,
  /eq\(restaurants\.isActive, true\)/,
  "Inactive trucks must not remain attached to public events",
);
assert.match(
  confirmedEventTrucksSource,
  /existing\.some\(\(truck\) => truck\.truckId === String\(row\.truckId\)\)/,
  "Duplicate confirmed booking rows must not duplicate one truck in trucks[]",
);
assert.doesNotMatch(
  confirmedEventTrucksSource,
  /bookedRestaurantId/,
  "The legacy singular event pointer must not be a public truth source",
);
for (const [label, source] of [
  ["public discovery", discoveryRouteSource],
  ["public map", publicMapRouteSource],
  ["public profile activity", routeSource],
  ["public SEO", seoRouteSource],
] as const) {
  const confirmedQueryCount = (
    source.match(/eq\(eventBookings\.status, "confirmed"\)/g) || []
  ).length;
  const evidencedQueryCount = (
    source.match(/isNotNull\(eventBookings\.bookingConfirmedAt\)/g) || []
  ).length;
  assert.ok(confirmedQueryCount > 0, `${label} must query confirmed bookings`);
  assert.equal(
    evidencedQueryCount,
    confirmedQueryCount,
    `${label} must require durable evidence in every direct confirmed-booking query`,
  );
}
assert.doesNotMatch(
  discoveryRouteSource,
  /kind: "booking"[\s\S]{0,500}lastConfirmedAtUtc: new Date\(row\.lastConfirmedAt \|\|/,
  "Discovery must not turn an update or event date into booking confirmation evidence",
);
assert.match(
  eventRouteSource,
  /attachConfirmedPublicEventTrucks[\s\S]*bookedRestaurantId: trucks\[0\]\?\.id \|\| null[\s\S]*trucks,/,
  "Public event feeds must derive the compatibility alias and trucks[] from canonical bookings",
);
assert.match(
  eventRouteSource,
  /loadConfirmedEventTrucks\(\[eventId\]\)[\s\S]*truck: publicTrucks\[0\] \|\| null,[\s\S]*trucks: publicTrucks/,
  "Public event detail must expose multi-truck truth with a singular compatibility alias",
);
assert.match(
  userAdminRouteSource,
  /updates\.bookingConfirmedAt = sql<Date>`case[\s\S]*eventBookings\.status[\s\S]*eventBookings\.bookingConfirmedAt[\s\S]*else now\(\)/,
  "Admin confirmation must atomically stamp missing or newly transitioned booking evidence",
);
assert.ok(
  (discoveryRouteSource.match(/\.from\(eventBookings\)/g) || []).length >= 2,
  "Both city and location truck discovery must originate from bookings",
);
assert.doesNotMatch(
  discoveryRouteSource,
  /events\.bookedRestaurantId/,
  "Discovery must not trust the legacy event pointer",
);
assert.match(
  discoveryRouteSource,
  /isTruckOperatingPlanRowPublic\([\s\S]*sourceKind: "manual"/,
  "Manual stops in discovery must use the same eligibility policy as profiles and maps",
);
assert.match(
  publicMapRouteSource,
  /confirmedTrucksByEvent = await loadConfirmedEventTrucks/,
  "The public map must attach event trucks from confirmed bookings",
);
assert.match(
  publicMapRouteSource,
  /app\.get\("\/api\/map\/hosts\/:hostId\/upcoming-bookings"[\s\S]*\.from\(eventBookings\)[\s\S]*eq\(eventBookings\.status, "confirmed"\)/,
  "Host map previews must suppress canceled and pending truck bookings",
);
assert.match(
  publicMapRouteSource,
  /app\.get\("\/api\/map\/hosts\/:hostId\/upcoming-bookings"[\s\S]*bookingConfirmedAt[\s\S]*isSlotPublic/,
  "Host map previews must validate the actual confirmed interval",
);
assert.match(
  publicMapRouteSource,
  /upcomingHostBookings[\s\S]*bookingConfirmedAt[\s\S]*isSlotPublic/,
  "Map supply ranking must ignore invalid or ended booking slots",
);
assert.match(
  bookingRouteSource,
  /includePrivate[\s\S]*\? filtered[\s\S]*: filtered\.map\(\(entry\) => \(\{[\s\S]*status: entry\.status,[\s\S]*\}\)\)/,
  "Anonymous manual schedule responses must use an explicit public allowlist",
);
assert.ok(
  (bookingRouteSource.match(/!truck\.isActive/g) || []).length >= 3,
  "Inactive trucks must be rejected from anonymous and mutation schedule routes",
);
for (const [label, source] of [
  ["public profile and evidence", routeSource],
  ["event prerender", prerenderSource],
  ["public SEO landings", publicSeoLandingSource],
  ["sitemaps", seoRouteSource],
  ["Scout recommendations", recommendationSource],
] as const) {
  assert.doesNotMatch(
    source,
    /events\.bookedRestaurantId/,
    `${label} must not attribute a truck from the legacy event pointer`,
  );
}
assert.doesNotMatch(
  prerenderSource,
  /Booked truck:/,
  "Crawler output must not publish a legacy booking claim",
);
assert.match(
  prerenderSource,
  /loadConfirmedEventTrucks[\s\S]*canExposeAnonymousEventDetail[\s\S]*performer:[\s\S]*confirmedTrucks/,
  "Event structured data must pass the guest gate and derive performers from confirmed bookings",
);
assert.match(
  recommendationSource,
  /confirmedTrucksByEvent[\s\S]*food trucks confirmed/,
  "Scout recommendation reasons must be backed by confirmed bookings",
);
assert.doesNotMatch(
  recommendationSource,
  /eventRow\.bookedRestaurantId/,
  "Scout recommendations must never turn the legacy pointer into a serving claim",
);
assert.match(
  recommendationSource,
  /lastConfirmedAtUtc[\s\S]*isSlotPublic\([\s\S]*ttlHours: 24 \* 365 \* 100/,
  "Scout must not recommend an event that fails confirmed-slot visibility",
);
assert.match(
  recommendationSource,
  /buildSlotDateTimes[\s\S]*dateKeyInZone\(interval\.startUtc, timeZone\)/,
  "Today recommendations must use the host-local event interval",
);
assert.doesNotMatch(
  recommendationSource,
  /Parking Pass availability/,
  "Raw paid events must not be advertised as available inventory",
);
assert.match(
  routeSource,
  /canExposeAnonymousEventDetail[\s\S]*requiresPayment: row\.requiresPayment/,
  "Public event evidence must use the same guest privacy gate as event detail",
);
assert.match(
  publicSeoLandingSource,
  /dateKeyInZone\(interval\.startUtc, timeZone\)[\s\S]*isSlotPublic/,
  "Events-today SEO must use host-local day and confirmed-slot eligibility",
);
assert.match(
  seoRouteSource,
  /sitemap-events\.xml[\s\S]*buildSlotDateTimes[\s\S]*isSlotPublic/,
  "Event sitemaps must exclude ended or invalid date-only slots",
);
assert.match(
  seoRouteSource,
  /sitemap-locations\.xml[\s\S]*candidateRows[\s\S]*buildSlotDateTimes[\s\S]*isSlotPublic/,
  "Location sitemaps must be backed by an eligible confirmed booking interval",
);
assert.match(
  seoRouteSource,
  /hasEligibleManualTruckStopInCity[\s\S]*assembleTruckOperatingPlan/,
  "Time-page sitemaps must reuse active manual-stop truth policy",
);

console.log("truck-availability-truth.behavior: PASS");
