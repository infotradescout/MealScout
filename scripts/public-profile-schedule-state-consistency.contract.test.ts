import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  getTruckScheduleAvailabilityLabel,
  getTruckScheduleEmptyStateLabel,
  getTruckSchedulePrimaryStop,
  getTruckScheduleRows,
  hasTruckScheduleCta,
  hasTruckScheduleSignal,
} from "../client/src/components/public-profile/truckScheduleTruth";

const page = readFileSync("client/src/pages/public-profile.tsx", "utf8");
const truckHero = readFileSync("client/src/components/public-profile/TruckHero.tsx", "utf8");

const affectedProfiles = [
  "3D Eats & Tea",
  "Sweet Love",
  "All Gas No Brakes Reloaded",
  "CREATIVBOWLS",
  "Jays Southern Cuisine",
];

const noScheduleSummary = {
  status: "unknown" as const,
  statusLabel: "No schedule posted",
  lastUpdatedAt: null,
  notice: null,
  currentStop: null,
  todayStop: null,
  nextStop: null,
  upcomingStops: [],
  closedStops: [],
  nextWindowLabel: null,
  upcomingCount: 0,
  closedCount: 0,
};

const contradictorySummary = {
  ...noScheduleSummary,
  status: "scheduled" as const,
  statusLabel: "Scheduled",
  nextWindowLabel: "11:00 - 14:00",
  upcomingCount: 1,
};

const actualUpcomingSchedule = {
  ...noScheduleSummary,
  status: "scheduled" as const,
  statusLabel: "Scheduled",
  nextStop: {
    stopId: "stop-1",
    date: "2026-06-19",
    startTime: "11:00",
    endTime: "14:00",
    timeWindowLabel: "11:00 - 14:00",
    locationName: "Community Health",
    addressPublicLabel: "2315 W Jackson St., Pensacola, FL",
    city: "Pensacola",
    state: "FL",
    latitude: 30.4,
    longitude: -87.2,
    hostProfilePath: null,
    directionsUrl: "https://maps.google.com",
    notice: null,
    status: "scheduled" as const,
  },
  upcomingStops: [
    {
      stopId: "stop-1",
      date: "2026-06-19",
      startTime: "11:00",
      endTime: "14:00",
      timeWindowLabel: "11:00 - 14:00",
      locationName: "Community Health",
      addressPublicLabel: "2315 W Jackson St., Pensacola, FL",
      city: "Pensacola",
      state: "FL",
      latitude: 30.4,
      longitude: -87.2,
      hostProfilePath: null,
      directionsUrl: "https://maps.google.com",
      notice: null,
      status: "scheduled" as const,
    },
  ],
  nextWindowLabel: "11:00 - 14:00",
  upcomingCount: 1,
};

assert.equal(getTruckScheduleAvailabilityLabel(noScheduleSummary), "No schedule posted");
assert.equal(getTruckScheduleEmptyStateLabel(), "No schedule posted");
assert.equal(hasTruckScheduleSignal(noScheduleSummary), false);
assert.equal(hasTruckScheduleCta(noScheduleSummary), false);
assert.equal(getTruckSchedulePrimaryStop(noScheduleSummary).label, "No schedule posted");
assert.equal(getTruckScheduleRows(noScheduleSummary).hasActionableSchedule, false);

assert.equal(
  hasTruckScheduleSignal(contradictorySummary),
  false,
  "Status labels alone must not be treated as proof that a schedule exists",
);
assert.equal(
  hasTruckScheduleCta(contradictorySummary),
  false,
  "Profiles with summary-only schedule labels must not render a schedule CTA",
);

assert.equal(getTruckScheduleAvailabilityLabel(actualUpcomingSchedule), "Schedule available");
assert.equal(hasTruckScheduleSignal(actualUpcomingSchedule), true);
assert.equal(hasTruckScheduleCta(actualUpcomingSchedule), true);
assert.equal(getTruckSchedulePrimaryStop(actualUpcomingSchedule).label, "Next stop");

for (const profile of affectedProfiles) {
  assert.equal(
    hasTruckScheduleSignal(noScheduleSummary),
    false,
    `${profile} empty-state regression guard must not allow a fake schedule-available truth source`,
  );
}

assert(page.includes("getTruckScheduleRows(schedule)"));
assert(page.includes("getTruckScheduleEmptyStateLabel()"));
assert(page.includes("hasTruckScheduleSignal(profile.truckSchedule)"));
assert(truckHero.includes("getTruckSchedulePrimaryStop(schedule)"));
assert(truckHero.includes("hasTruckScheduleCta(schedule)"));
assert(
  !truckHero.includes('label: "Schedule posted"'),
  "Truck hero must not hard-code a misleading schedule-posted summary state",
);

console.log("public-profile-schedule-state-consistency.contract: PASS");
