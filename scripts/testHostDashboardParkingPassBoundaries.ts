import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const hostDashboardPath = path.join(repoRoot, "client/src/pages/host-dashboard.tsx");
const navigationPath = path.join(repoRoot, "client/src/components/navigation.tsx");

const forbiddenHostDashboardPatterns = [
  {
    pattern: /\/api\/hosts\/event-series/,
    message: "Host dashboard must not call event/open-call series APIs.",
  },
  {
    pattern: /Events\s+And\s+Open\s+Calls/i,
    message: "Host dashboard must not show the old Events And Open Calls heading.",
  },
  {
    pattern: /Open\s+Calls/i,
    message: "Host dashboard must not expose open-call wording.",
  },
  {
    pattern: /setLocation\(\s*["'`]\/parking-pass(?:[?#][^"'`]*)?["'`]\s*\)/,
    message: "Host dashboard must not send hosts to the parking-pass booking map.",
  },
  {
    pattern: /href=\s*["'`]\/parking-pass(?:[?#][^"'`]*)?["'`]/,
    message: "Host dashboard must not link hosts to the parking-pass booking map.",
  },
];

const run = async () => {
  const [hostDashboardSource, navigationSource] = await Promise.all([
    readFile(hostDashboardPath, "utf8"),
    readFile(navigationPath, "utf8"),
  ]);

  for (const { pattern, message } of forbiddenHostDashboardPatterns) {
    assert.equal(pattern.test(hostDashboardSource), false, message);
  }

  assert.match(
    hostDashboardSource,
    /Parking\s+Pass\s+Only/,
    "Host dashboard should explicitly state that it is Parking Pass only.",
  );
  assert.match(
    hostDashboardSource,
    /HostBookingsSection/,
    "Host dashboard should keep the host booking management section.",
  );

  assert.match(
    navigationSource,
    /shouldUseHostNav[\s\S]*?path:\s*["'`]\/map["'`][\s\S]*?fallbackLabel:\s*["'`]Map["'`]/,
    "Host navigation should keep the regular food discovery map.",
  );
  assert.match(
    navigationSource,
    /canSeeParkingPassNav\s*=\s*canManageParkingPass/,
    "Host role alone must not expose the parking-pass booking map nav item.",
  );
  assert.match(
    navigationSource,
    /canSeeParkingPassNav\s*&&\s*!shouldUseHostNav/,
    "Parking Pass nav should be suppressed inside host-management navigation.",
  );

  console.log("host dashboard parking pass boundaries test passed");
};

run().catch((error) => {
  console.error("host dashboard parking pass boundaries test failed:", error);
  process.exit(1);
});
