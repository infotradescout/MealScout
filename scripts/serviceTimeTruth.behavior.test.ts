import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.TZ = "UTC";

const { evaluateParkingPassBookingTime } = await import(
  "../server/services/parkingPassServiceTime"
);
const { isEventWithinPublicFeedWindow } = await import(
  "../server/services/publicEventTimeTruth"
);
const { resolvePersistedEventServiceTimeZone } = await import(
  "../server/services/persistedServiceTimeZoneRules"
);
const { parkingPassSeriesBoundaryDateKey } = await import(
  "../server/services/parkingPassVirtualDates"
);

assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, "UTC");

const schedule = {
  timeZone: "America/Chicago",
  date: "2026-08-29T00:00:00.000Z",
  startTime: "14:00",
  endTime: "14:40",
} as const;
const evaluate = (
  policy: "must_start_in_future" | "until_service_end",
  now: string,
) =>
  evaluateParkingPassBookingTime({
    ...schedule,
    policy,
    now: new Date(now),
  });

// Server process is UTC, while the venue's service calendar is Chicago.
assert.deepEqual(
  [
    evaluate("must_start_in_future", "2026-08-29T03:00:00.000Z").phase,
    evaluate("must_start_in_future", "2026-08-29T18:00:00.000Z").phase,
    evaluate("must_start_in_future", "2026-08-29T19:10:00.000Z").phase,
    evaluate("must_start_in_future", "2026-08-29T19:41:00.000Z").phase,
  ],
  ["future_date", "before_start", "in_service", "ended"],
);
assert.equal(
  evaluate("must_start_in_future", "2026-08-29T03:00:00.000Z").eligible,
  true,
  "primary checkout accepts the Chicago prior evening",
);
assert.equal(
  evaluate("must_start_in_future", "2026-08-29T18:00:00.000Z").eligible,
  true,
  "primary checkout accepts a same-day future slot",
);
assert.equal(
  evaluate("must_start_in_future", "2026-08-29T19:10:00.000Z").eligible,
  false,
  "primary checkout refuses an already-started slot",
);
assert.equal(
  evaluate("until_service_end", "2026-08-29T19:10:00.000Z").eligible,
  true,
  "Action compatibility booking does not expire a date-only event before local service end",
);
assert.equal(
  evaluate("until_service_end", "2026-08-29T15:00:00.000Z").eligible,
  true,
  "15:00Z is morning in Chicago, not an expired UTC-midnight event",
);
assert.equal(
  evaluate("until_service_end", "2026-08-29T19:41:00.000Z").eligible,
  false,
  "Action compatibility booking closes after local service end",
);

const feedEvent = {
  date: schedule.date,
  startTime: schedule.startTime,
  endTime: schedule.endTime,
  status: "open",
  seriesStatus: "published",
  seriesId: "fixture-chicago-series",
  series: { id: "fixture-chicago-series", timezone: schedule.timeZone },
  host: { status: "active", city: "Chicago", state: "IL" },
};
assert.equal(
  isEventWithinPublicFeedWindow(
    feedEvent,
    new Date("2026-08-29T19:10:00.000Z"),
  ),
  true,
);
assert.equal(
  isEventWithinPublicFeedWindow(
    feedEvent,
    new Date("2026-08-29T20:11:00.000Z"),
  ),
  false,
  "public feed expires from the Chicago service end plus its existing grace period",
);

const storedElPasoTimeZone = resolvePersistedEventServiceTimeZone({
  seriesId: "fixture-el-paso-series",
  seriesTimeZone: "America/Denver",
  venueTimeZone: "America/Chicago",
});
assert.equal(
  storedElPasoTimeZone,
  "America/Denver",
  "the stored series timezone overrides coarse Texas geography",
);
assert.equal(
  resolvePersistedEventServiceTimeZone({
    seriesId: "fixture-invalid-series",
    seriesTimeZone: "not/a-zone",
    venueTimeZone: "America/Chicago",
  }),
  null,
  "a series with an invalid stored timezone fails closed instead of falling back",
);
assert.equal(
  resolvePersistedEventServiceTimeZone({ venueTimeZone: null }),
  null,
  "a non-series event without a persisted venue timezone fails closed",
);

const elPasoSchedule = {
  date: "2026-08-29T00:00:00.000Z",
  startTime: "14:00",
  endTime: "14:40",
} as const;
const evaluateElPaso = (
  timeZone: string,
  policy: "must_start_in_future" | "until_service_end",
  now: string,
) =>
  evaluateParkingPassBookingTime({
    ...elPasoSchedule,
    timeZone,
    policy,
    now: new Date(now),
  });
assert.equal(
  evaluateElPaso(
    storedElPasoTimeZone!,
    "must_start_in_future",
    "2026-08-29T19:50:00.000Z",
  ).eligible,
  true,
  "primary/canonical timing sees the Denver slot as not started",
);
assert.equal(
  evaluateElPaso(
    "America/Chicago",
    "must_start_in_future",
    "2026-08-29T19:50:00.000Z",
  ).eligible,
  false,
  "the former Texas-wide inference would already close the slot",
);
assert.equal(
  evaluateElPaso(
    storedElPasoTimeZone!,
    "until_service_end",
    "2026-08-29T20:20:00.000Z",
  ).eligible,
  true,
  "Action compatibility remains eligible while Denver service is active",
);
assert.equal(
  evaluateElPaso(
    "America/Chicago",
    "until_service_end",
    "2026-08-29T20:20:00.000Z",
  ).eligible,
  false,
);
assert.equal(
  isEventWithinPublicFeedWindow(
    {
      ...elPasoSchedule,
      seriesId: "fixture-el-paso-series",
      series: {
        id: "fixture-el-paso-series",
        timezone: storedElPasoTimeZone,
      },
      host: { city: "El Paso", state: "TX" },
    },
    new Date("2026-08-29T20:20:00.000Z"),
  ),
  true,
  "public expiry uses the stored Denver service interval",
);

for (const boundary of [
  new Date("2026-08-29T00:00:00.000Z"),
  "2026-08-29T00:00:00.000Z",
]) {
  assert.equal(
    parkingPassSeriesBoundaryDateKey(boundary),
    "2026-08-29",
    "UTC-midnight virtual series boundaries remain Aug 29",
  );
}

const hostRoute = readFileSync("server/routes/hostRoutes.ts", "utf8");
const actionRoute = readFileSync("server/routes/actionRoutes.ts", "utf8");
const eventRoute = readFileSync("server/routes/eventRoutes.ts", "utf8");
const storage = readFileSync("server/storage.ts", "utf8");
const canonicalService = readFileSync(
  "server/services/parkingPassBookingService.ts",
  "utf8",
);
const parkingPassRepository = readFileSync(
  "server/storage/parkingPassRepository.ts",
  "utf8",
);
assert.match(hostRoute, /policy: "must_start_in_future"/);
assert.match(actionRoute, /policy: "until_service_end"/);
assert.match(hostRoute, /loadPersistedEventServiceTimeZone/);
assert.match(actionRoute, /loadPersistedEventServiceTimeZone/);
assert.match(eventRoute, /loadPersistedEventServiceTimeZone/);
assert.match(canonicalService, /eventTimeZoneById/);
assert.match(canonicalService, /resolvePersistedEventServiceTimeZone/);
assert.match(eventRoute, /isEventWithinPublicFeedWindow\(event, now\)/);
assert.match(storage, /venueTimeZone[\s\S]*buildSlotDateTimes/);
assert.match(parkingPassRepository, /resolveCityTimeZoneStrict/);
assert.doesNotMatch(
  parkingPassRepository,
  /timezone:\s*resolveCityTimeZoneSync/,
  "host sync must not overwrite stored series timezone with coarse geography",
);

console.log(
  "service-time-truth: persisted Chicago/Denver route/feed/virtual phases PASS",
);
