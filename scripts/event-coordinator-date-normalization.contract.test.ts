import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  eventDateInputSchema,
  formatEventDateOnly,
  parseEventDateOnly,
} from "../server/utils/eventDateInput";
import { insertEventSchema } from "../shared/schema";

const validDate = eventDateInputSchema.parse("2026-08-15");
assert(validDate instanceof Date);
assert.equal(validDate.toISOString(), "2026-08-15T12:00:00.000Z");
assert.equal(formatEventDateOnly(validDate), "2026-08-15");

assert.equal(parseEventDateOnly("2026-02-29"), null);
assert.equal(parseEventDateOnly("08/15/2026"), null);
assert.throws(
  () => eventDateInputSchema.parse("2026-02-29"),
  (error) => error instanceof z.ZodError,
);

const insertResult = insertEventSchema.safeParse({
  hostId: "host-1",
  name: "Public food event",
  date: validDate,
  startTime: "10:00",
  endTime: "12:00",
  maxTrucks: 1,
  requiresPayment: false,
});
assert.equal(
  insertResult.success,
  true,
  "normalized coordinator dates must satisfy the canonical event insert schema",
);

const routePath = fileURLToPath(
  new URL("../server/routes/eventCoordinatorRoutes.ts", import.meta.url),
);
const routeSource = readFileSync(routePath, "utf8");
assert.equal(
  routeSource.match(/date: eventDateInputSchema(?:\.optional\(\))?,/g)?.length,
  2,
  "create and edit routes must share the same event-date input contract",
);
assert.match(routeSource, /date: parsed\.date,/);
assert.doesNotMatch(routeSource, /date: z\.string\(\)(?:\.min\(1\))?[,\.]/);

console.log("event coordinator date normalization contract: PASS");
