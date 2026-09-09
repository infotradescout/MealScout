import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const fixtureMode = process.argv.includes("--fixture");

if (fixtureMode) {
  const { dateKeyFromUnknown, dateKeyInZone } = await import(
    "../server/services/dateKeys"
  );
  const { filterFutureOccurrences, generateOccurrences } = await import(
    "../server/services/openCallSeries"
  );
  const { parkingPassSeriesBoundaryDateKey } = await import(
    "../server/services/parkingPassVirtualDates"
  );

  const occurrences = generateOccurrences({
    startDate: new Date("2026-08-29T00:00:00.000Z"),
    endDate: new Date("2026-09-02T00:00:00.000Z"),
    recurrenceRule: "WEEKLY:SA,SU,MO,TU,WE",
    defaults: {
      hostId: "fixture-host",
      seriesId: "fixture-series",
      name: "Fixture series",
      description: null,
      startTime: "14:00",
      endTime: "14:40",
      maxTrucks: 3,
      hardCapEnabled: true,
    },
  });
  const occurrenceKeys = occurrences.map((occurrence) =>
    dateKeyFromUnknown(occurrence.date, "UTC"),
  );
  const remaining = (now: string, timeZone: string) =>
    filterFutureOccurrences(occurrences, new Date(now), timeZone).map(
      (occurrence) => dateKeyFromUnknown(occurrence.date, "UTC"),
    );

  process.stdout.write(
    JSON.stringify({
      processTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      occurrenceKeys,
      utcMidnightBoundary: parkingPassSeriesBoundaryDateKey(
        "2026-08-29T00:00:00.000Z",
      ),
      chicago: {
        at01Z: dateKeyInZone(
          new Date("2026-08-29T01:00:00.000Z"),
          "America/Chicago",
        ),
        at07Z: dateKeyInZone(
          new Date("2026-08-29T07:00:00.000Z"),
          "America/Chicago",
        ),
        remainingAt01Z: remaining(
          "2026-08-29T01:00:00.000Z",
          "America/Chicago",
        ),
        remainingAt07Z: remaining(
          "2026-08-29T07:00:00.000Z",
          "America/Chicago",
        ),
      },
      denver: {
        at01Z: dateKeyInZone(
          new Date("2026-08-29T01:00:00.000Z"),
          "America/Denver",
        ),
        at07Z: dateKeyInZone(
          new Date("2026-08-29T07:00:00.000Z"),
          "America/Denver",
        ),
        remainingAt01Z: remaining(
          "2026-08-29T01:00:00.000Z",
          "America/Denver",
        ),
        remainingAt07Z: remaining(
          "2026-08-29T07:00:00.000Z",
          "America/Denver",
        ),
      },
    }),
  );
} else {
  const testFile = fileURLToPath(import.meta.url);
  const run = (timeZone: string) => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", testFile, "--fixture"],
      {
        cwd: process.cwd(),
        env: { ...process.env, TZ: timeZone },
        encoding: "utf8",
      },
    );
    assert.equal(
      result.status,
      0,
      `${timeZone} fixture failed: ${result.stderr || result.stdout}`,
    );
    return JSON.parse(result.stdout) as Record<string, unknown>;
  };

  const utc = run("UTC");
  const chicagoProcess = run("America/Chicago");
  assert.equal(utc.processTimeZone, "UTC");
  assert.equal(chicagoProcess.processTimeZone, "America/Chicago");

  const withoutProcessZone = ({ processTimeZone: _ignored, ...truth }: any) =>
    truth;
  assert.deepEqual(
    withoutProcessZone(utc),
    withoutProcessZone(chicagoProcess),
    "authoritative series/venue date truth must not depend on the server process timezone",
  );
  assert.deepEqual(utc.occurrenceKeys, [
    "2026-08-29",
    "2026-08-30",
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
  ]);
  assert.equal(utc.utcMidnightBoundary, "2026-08-29");
  assert.deepEqual(utc.chicago, {
    at01Z: "2026-08-28",
    at07Z: "2026-08-29",
    remainingAt01Z: [
      "2026-08-29",
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ],
    remainingAt07Z: [
      "2026-08-29",
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
    ],
  });
  assert.deepEqual(utc.denver, utc.chicago);

  console.log(
    "date-rollover-invariant: UTC/Chicago process zones and Chicago/Denver venue calendars PASS",
  );
}
