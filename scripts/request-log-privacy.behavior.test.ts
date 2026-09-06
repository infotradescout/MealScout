import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  sanitizeRequestLogPath,
  sanitizeRequestLogReferrer,
} from "../server/piiRedaction.ts";

const secret = "do-not-store-this-secret";

assert.equal(
  sanitizeRequestLogPath(`/reset-password?token=${secret}&email=person@example.com`),
  "/reset-password",
);
assert.equal(
  sanitizeRequestLogPath(
    `https://www.mealscout.us/api/auth/google/callback?code=${secret}&state=${secret}#done`,
  ),
  "/api/auth/google/callback",
);
assert.equal(
  sanitizeRequestLogPath(`/truck/example-slug?ref=${secret}`),
  "/truck/example-slug",
);
assert.equal(sanitizeRequestLogPath("not a URL"), "/not%20a%20URL");

assert.equal(
  sanitizeRequestLogReferrer(
    `https://www.mealscout.us/verify-email?token=${secret}#complete`,
  ),
  "https://www.mealscout.us/verify-email",
);
assert.equal(
  sanitizeRequestLogReferrer(`javascript:alert('${secret}')`),
  null,
);
assert.equal(sanitizeRequestLogReferrer("not a URL"), null);

const serverEntry = readFileSync("server/index.ts", "utf8");
assert.match(
  serverEntry,
  /sanitizeRequestLogPath\(req\.originalUrl \|\| req\.url \|\| "\/"\)/,
  "central request logging must strip URL queries before persistence",
);
assert.match(
  serverEntry,
  /referrer: sanitizeRequestLogReferrer\(req\.get\("referer"\)\)/,
  "central request logging must sanitize referrers before persistence",
);
assert.doesNotMatch(
  serverEntry,
  /metadata:\s*\{\s*referrer:[\s\S]{0,160}query:\s*req\.query/,
  "central request logging must not persist raw request queries",
);

console.log("request-log-privacy.behavior: PASS");
