import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const actionRoutes = readFileSync("server/routes/actionRoutes.ts", "utf8");
const actionContainment = readFileSync(
  "server/security/actionApiContainment.ts",
  "utf8",
);

const unavailableActions = [
  "GET_COUNTY_TRANSPARENCY",
  "GET_COUNTY_LEDGER",
  "GET_COUNTY_VAULT",
];

const unavailableBlock = actionRoutes.match(
  /const UNAVAILABLE_ACTIONS = new Set\(\[([\s\S]*?)\]\);/,
);
assert.ok(unavailableBlock, "action routes must declare unavailable actions");

for (const action of unavailableActions) {
  assert.match(
    unavailableBlock[1],
    new RegExp(`"${action}"`),
    `${action} must remain explicitly unavailable until implemented`,
  );
  assert.doesNotMatch(
    actionRoutes,
    new RegExp(`case "${action}"`),
    `${action} must not be routed as an implemented action`,
  );
}

const unavailableGuardIndex = actionRoutes.indexOf(
  "if (UNAVAILABLE_ACTIONS.has(action))",
);
const switchIndex = actionRoutes.indexOf("switch (action)");
assert.ok(unavailableGuardIndex >= 0, "unavailable actions must be guarded");
assert.ok(
  unavailableGuardIndex < switchIndex,
  "unavailable actions must fail before implemented-action dispatch",
);

const unavailableGuard = actionRoutes.slice(unavailableGuardIndex, switchIndex);
assert.match(unavailableGuard, /res\.status\(501\)\.json\(/);
assert.match(unavailableGuard, /success: false/);
assert.match(unavailableGuard, /code: "ACTION_NOT_IMPLEMENTED"/);

assert.match(
  actionRoutes,
  /supportedActions: ACTION_API_PUBLIC_READ_ACTIONS/,
  "unknown-action response must use the executable public-read allowlist",
);
for (const action of unavailableActions) {
  assert.doesNotMatch(
    actionContainment,
    new RegExp(action),
    `${action} must not be advertised as supported`,
  );
}

assert.doesNotMatch(actionRoutes, /feature coming soon/i);

console.log("mealscout-action-availability.contract: PASS");
