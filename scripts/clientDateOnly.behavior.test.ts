import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.TZ = "America/Chicago";

const {
  compareDateOnly,
  dateOnlyKey,
  formatDateOnly,
  localCalendarDate,
  localDateTimeFromDateKey,
  isDateOnlyBeforeToday,
} = await import("../client/src/lib/date-only");
const {
  eventLongDateLabel,
  eventCardWhenLabel,
  eventClockLabel,
  eventNumericDateLabel,
  eventNotificationWhenLabel,
  eventSeriesRangeLabel,
  eventShortDateLabel,
  eventServiceDateKey,
  eventServicePhaseLabel,
  isEventAuthoritativelyOpenNow,
  isEventOnAuthoritativeVenueDay,
} = await import("../client/src/lib/event-date-labels");

const midnightUtc = "2026-08-29T00:00:00.000Z";
assert.equal(
  Intl.DateTimeFormat().resolvedOptions().timeZone,
  "America/Chicago",
);
assert.equal(dateOnlyKey(midnightUtc), "2026-08-29");
assert.equal(dateOnlyKey(new Date(midnightUtc)), "2026-08-29");
assert.equal(dateOnlyKey("2026-02-30"), null);
assert.equal(formatDateOnly(midnightUtc, { month: "short", day: "numeric" }, "en-US"), "Aug 29");
const local = localCalendarDate(midnightUtc)!;
assert.deepEqual(
  [local.getFullYear(), local.getMonth() + 1, local.getDate()],
  [2026, 8, 29],
);
const startsAt = localDateTimeFromDateKey(midnightUtc, "09:30")!;
assert.deepEqual(
  [startsAt.getFullYear(), startsAt.getMonth() + 1, startsAt.getDate(), startsAt.getHours(), startsAt.getMinutes()],
  [2026, 8, 29, 9, 30],
);
assert.equal(compareDateOnly(midnightUtc, "2026-08-29"), 0);
assert.equal(compareDateOnly(midnightUtc, "2026-08-30"), -1);
assert.equal(eventLongDateLabel(midnightUtc), "Saturday, August 29, 2026");
assert.equal(eventShortDateLabel(midnightUtc), "Sat, Aug 29");
assert.equal(eventNumericDateLabel(midnightUtc), "8/29/2026");
assert.equal(eventClockLabel("14:00"), "2:00 PM");
assert.equal(
  eventCardWhenLabel({ date: midnightUtc, startTime: "14:00" }),
  "Sat, Aug 29 • 2:00 PM",
);
const denverEventAtChicagoMidnight = {
  date: "2026-08-29T00:00:00.000Z",
  startTime: "22:00",
  endTime: "23:59",
  serviceTimezone: "America/Denver",
  serviceDateKey: "2026-08-29",
  servicePhase: "in_service",
  serviceStartsAtUtc: "2026-08-30T04:00:00.000Z",
  serviceEndsAtUtc: "2026-08-30T05:59:00.000Z",
} as const;
assert.equal(eventServiceDateKey(denverEventAtChicagoMidnight), "2026-08-29");
assert.equal(isEventOnAuthoritativeVenueDay(denverEventAtChicagoMidnight), true);
assert.equal(isEventAuthoritativelyOpenNow(denverEventAtChicagoMidnight), true);
assert.equal(eventServicePhaseLabel(denverEventAtChicagoMidnight), "Happening now");
assert.equal(
  eventCardWhenLabel(denverEventAtChicagoMidnight),
  "Sat, Aug 29 • 10:00 PM",
  "the Chicago browser must render the server-projected Denver Aug 29 service day",
);
assert.equal(
  eventSeriesRangeLabel(midnightUtc, "2026-09-05T00:00:00.000Z"),
  "Aug 29 – Sep 5, 2026",
);
assert.equal(
  eventNotificationWhenLabel({
    date: midnightUtc,
    startTime: "14:00",
    endTime: "14:40",
  }),
  "8/29/2026 • 14:00 - 14:40",
);
assert.equal(
  isDateOnlyBeforeToday(midnightUtc, {
    now: new Date("2026-08-30T04:30:00.000Z"),
    timeZone: "America/Chicago",
  }),
  false,
  "Chicago still considers the event Aug 29 before local midnight",
);
assert.equal(
  isDateOnlyBeforeToday(midnightUtc, {
    now: new Date("2026-08-30T05:01:00.000Z"),
    timeZone: "America/Chicago",
  }),
  true,
);

for (const [path, expectedHelper] of [
  ["client/src/pages/truck-discovery.tsx", "eventLongDateLabel"],
  ["client/src/pages/city-landing.tsx", "eventNumericDateLabel"],
  ["client/src/pages/restaurant-owner-dashboard.tsx", "eventShortDateLabel"],
  ["client/src/services/location-notifications.ts", "eventNotificationWhenLabel"],
  ["client/src/pages/explore-preview-v2.tsx", "eventCardWhenLabel"],
  ["client/src/pages/explore-preview.tsx", "eventCardWhenLabel"],
  ["client/src/pages/events.tsx", "eventShortDateLabel"],
  ["client/src/pages/city-discovery.tsx", "eventNumericDateLabel"],
  ["client/src/pages/location-discovery.tsx", "eventNumericDateLabel"],
] as const) {
  const source = readFileSync(path, "utf8");
  assert.match(source, new RegExp(expectedHelper));
  assert.doesNotMatch(source, /new Date\((?:event|booking\.event)\.date\)/);
}

for (const scoutSource of [
  readFileSync("client/src/pages/explore-preview-v2.tsx", "utf8"),
  readFileSync("client/src/pages/explore-preview.tsx", "utf8"),
]) {
  assert.match(scoutSource, /isEventAuthoritativelyOpenNow/);
  assert.match(scoutSource, /eventServicePhaseLabel/);
  assert.doesNotMatch(scoutSource, /todayDateOnlyKey/);
  assert.doesNotMatch(
    scoutSource,
    /new Date\((?:start|raw|event\.startTime|event\.startsAt)/,
  );
}
const adminParkingPassSource = readFileSync(
  "server/routes/admin/userAdminRoutes.ts",
  "utf8",
);
assert.match(adminParkingPassSource, /listParkingPassOccurrences\(\{[\s\S]*?now,/);
assert.doesNotMatch(adminParkingPassSource, /today\.setHours\(0, 0, 0, 0\)/);

console.log(
  "client-date-only: Scout/events/city/location/admin Chicago surfaces PASS (midnight UTC remains Aug 29)",
);
