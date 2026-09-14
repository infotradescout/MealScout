import assert from "node:assert/strict";
import { mock, test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ParkingScheduleCalendar } from "../client/src/components/parking-schedule-calendar";

(globalThis as any).React = React;

// Exercise the real calendar, including its selected-day detail and grid.
// API date-only timestamps preserve their UTC calendar key, while dates made
// by the browser calendar must retain the local day shown on screen.
for (const fixture of [
  { zone: "America/Chicago", instant: "2026-08-30T02:30:00Z", day: "2026-08-29", number: "29" },
  { zone: "America/Los_Angeles", instant: "2026-09-01T03:30:00Z", day: "2026-08-31", number: "31" },
  { zone: "Asia/Tokyo", instant: "2026-08-29T03:30:00Z", day: "2026-08-29", number: "29" },
  { zone: "Pacific/Kiritimati", instant: "2026-08-29T10:30:00Z", day: "2026-08-30", number: "30" },
  { zone: "America/Chicago", instant: "2026-11-01T05:30:00Z", day: "2026-11-01", number: "1" },
  { zone: "UTC", instant: "2026-08-29T21:30:00Z", day: "2026-08-29", number: "29" },
]) {
  test(`schedule grid and selected stops retain the local day in ${fixture.zone} at ${fixture.instant}`, () => {
    const originalZone = process.env.TZ;
    process.env.TZ = fixture.zone;
    mock.timers.enable({ apis: ["Date"], now: new Date(fixture.instant) });
    try {
      const timestamp = `${fixture.day}T00:00:00.000Z`;
      const html = renderToStaticMarkup(
        React.createElement(ParkingScheduleCalendar, {
          items: [
            { id: "api-string", date: timestamp, title: "API string stop", type: "manual" },
            { id: "api-date", date: new Date(timestamp), title: "API Date stop", type: "booking" },
          ],
        }),
      );
      const detail = html.split('class="mt-4 space-y-3"')[1] || "";
      assert.match(detail, /API string stop/, "the selected local day must show its API timestamp stop");
      assert.match(detail, /API Date stop/, "API Date objects must keep their original service day");
      assert.match(html, /2 stops scheduled/);

      const dayCells = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
        .map(([button]) => button)
        .filter((button) => button.includes("pp-calendar-day "));
      const selected = dayCells.filter((button) => button.includes("pp-calendar-day--active"));
      assert.equal(selected.length, 1);
      assert.match(selected[0], new RegExp(`>${fixture.number}</span>`));
      assert.match(selected[0], /API string stop/);
      assert.match(selected[0], /API Date stop/);
      assert.equal(
        dayCells.filter((button) => button.includes("API string stop")).length,
        1,
        "a stop must appear in exactly its labeled calendar cell",
      );
    } finally {
      mock.timers.reset();
      if (originalZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalZone;
    }
  });
}
