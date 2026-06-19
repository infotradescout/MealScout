import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveRequestLogDateRange,
} from "../server/utils/requestLogDateRange.ts";

const fixedNow = new Date("2026-06-19T18:30:00.000Z");
const defaultRange = resolveRequestLogDateRange({ now: fixedNow });

assert.equal(defaultRange.ok, true, "missing filters should resolve");
if (!defaultRange.ok) {
  throw new Error("Expected default request-log range to resolve.");
}

assert.equal(
  defaultRange.endDate.toISOString(),
  fixedNow.toISOString(),
  "missing endDate should default to now",
);
assert.equal(
  defaultRange.startDate.toISOString(),
  new Date(fixedNow.getTime() - 48 * 60 * 60 * 1000).toISOString(),
  "missing startDate should default to the last 48 hours",
);

const explicitDateOnlyRange = resolveRequestLogDateRange({
  startDate: "2026-06-17",
  endDate: "2026-06-19",
  now: fixedNow,
});

assert.equal(explicitDateOnlyRange.ok, true, "valid date-only filters should resolve");
if (!explicitDateOnlyRange.ok) {
  throw new Error("Expected valid date-only request-log range to resolve.");
}

assert.equal(
  explicitDateOnlyRange.startDate.getFullYear(),
  2026,
  "startDate should keep the requested calendar date",
);
assert.equal(
  explicitDateOnlyRange.startDate.getMonth(),
  5,
  "startDate should keep the requested month",
);
assert.equal(
  explicitDateOnlyRange.startDate.getDate(),
  17,
  "startDate should keep the requested day",
);
assert.equal(
  explicitDateOnlyRange.startDate.getHours(),
  0,
  "startDate should normalize to local start-of-day",
);
assert.equal(
  explicitDateOnlyRange.startDate.getMinutes(),
  0,
  "startDate should normalize to local start-of-day minutes",
);
assert.equal(
  explicitDateOnlyRange.endDate.getFullYear(),
  2026,
  "endDate should keep the requested calendar date",
);
assert.equal(
  explicitDateOnlyRange.endDate.getMonth(),
  5,
  "endDate should keep the requested month",
);
assert.equal(
  explicitDateOnlyRange.endDate.getDate(),
  19,
  "endDate should keep the requested day",
);
assert.equal(
  explicitDateOnlyRange.endDate.getHours(),
  23,
  "endDate should normalize to local end-of-day",
);
assert.equal(
  explicitDateOnlyRange.endDate.getMinutes(),
  59,
  "endDate should normalize to local end-of-day minutes",
);
assert.equal(
  explicitDateOnlyRange.endDate.getSeconds(),
  59,
  "endDate should normalize to local end-of-day seconds",
);
assert.equal(
  explicitDateOnlyRange.endDate.getMilliseconds(),
  999,
  "endDate should normalize to local end-of-day milliseconds",
);

const explicitIsoRange = resolveRequestLogDateRange({
  startDate: "2026-06-17T12:00:00.000Z",
  endDate: "2026-06-19T15:45:00.000Z",
  now: fixedNow,
});

assert.equal(explicitIsoRange.ok, true, "valid ISO date filters should resolve");
if (!explicitIsoRange.ok) {
  throw new Error("Expected valid ISO request-log range to resolve.");
}

assert.equal(
  explicitIsoRange.startDate.toISOString(),
  "2026-06-17T12:00:00.000Z",
);
assert.equal(
  explicitIsoRange.endDate.toISOString(),
  "2026-06-19T15:45:00.000Z",
);

const invalidStart = resolveRequestLogDateRange({
  startDate: "not-a-date",
  now: fixedNow,
});

assert.equal(invalidStart.ok, false, "invalid startDate should be rejected");
if (invalidStart.ok) {
  throw new Error("Expected invalid startDate to be rejected.");
}

assert.equal(invalidStart.field, "startDate");

const invalidEnd = resolveRequestLogDateRange({
  endDate: "2026-02-31",
  now: fixedNow,
});

assert.equal(invalidEnd.ok, false, "invalid endDate should be rejected");
if (invalidEnd.ok) {
  throw new Error("Expected invalid endDate to be rejected.");
}

assert.equal(invalidEnd.field, "endDate");

const emptyStringRange = resolveRequestLogDateRange({
  startDate: "",
  endDate: "   ",
  now: fixedNow,
});

assert.equal(emptyStringRange.ok, true, "empty string filters should fall back to defaults");
if (!emptyStringRange.ok) {
  throw new Error("Expected empty string request-log filters to resolve.");
}

assert.equal(emptyStringRange.endDate.toISOString(), fixedNow.toISOString());
assert.equal(
  emptyStringRange.startDate.toISOString(),
  new Date(fixedNow.getTime() - 48 * 60 * 60 * 1000).toISOString(),
);

const edgeDateRange = resolveRequestLogDateRange({
  startDate: "1900-01-01",
  endDate: "2100-12-31",
  now: fixedNow,
});

assert.equal(edgeDateRange.ok, true, "far past and future dates should still parse");
if (!edgeDateRange.ok) {
  throw new Error("Expected edge request-log dates to resolve.");
}

assert.equal(
  Number.isFinite(edgeDateRange.startDate.getTime()),
  true,
  "edge startDate must stay finite",
);
assert.equal(
  Number.isFinite(edgeDateRange.endDate.getTime()),
  true,
  "edge endDate must stay finite",
);

const adminRoutes = readFileSync("server/adminRoutes.ts", "utf8");
assert.match(
  adminRoutes,
  /resolveRequestLogDateRange\(\{\s*startDate: req\.query\.startDate,\s*endDate: req\.query\.endDate,\s*\}\)/m,
  "admin request-log route must use the shared date guard",
);
assert.match(
  adminRoutes,
  /return res\.status\(400\)\.json\(\{\s*error: dateRange\.error,\s*field: dateRange\.field,/m,
  "admin request-log route must return a controlled 400 for invalid date filters",
);

console.log("admin-request-logs-date-guard.contract: PASS");
