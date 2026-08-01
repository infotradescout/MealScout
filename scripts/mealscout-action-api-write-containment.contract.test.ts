import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTION_API_PUBLIC_READ_ACTIONS,
  ACTION_API_USER_SCOPED_ACTIONS,
  ACTION_API_WRITE_CONTAINMENT_CODE,
  isActionApiPublicRead,
  isKnownActionApiAction,
} from "../server/security/actionApiContainment";

const allowedReads = [
  "FIND_DEALS",
  "FIND_RESTAURANTS",
  "GET_RESTAURANT_DETAILS",
  "GET_FOOD_TRUCKS",
  "GET_PARKING_PASS_SPOTS",
];

const blockedUserScopedActions = [
  "CREATE_RESTAURANT",
  "UPDATE_RESTAURANT",
  "UPDATE_RESTAURANT_PROFILE",
  "UPDATE_RESTAURANT_LOCATION",
  "UPDATE_RESTAURANT_OPERATING_HOURS",
  "LIST_MENUS",
  "CREATE_MENU",
  "UPDATE_MENU",
  "DELETE_MENU",
  "CREATE_MENU_CATEGORY",
  "UPDATE_MENU_CATEGORY",
  "DELETE_MENU_CATEGORY",
  "CREATE_MENU_ITEM",
  "UPDATE_MENU_ITEM",
  "DELETE_MENU_ITEM",
  "GET_MANUAL_SCHEDULES",
  "UPSERT_MANUAL_SCHEDULE",
  "DELETE_MANUAL_SCHEDULE",
  "BOOK_PARKING_SPOT",
  "REDEEM_CREDITS",
  "GET_CREDITS_BALANCE",
  "SUBMIT_BUILDER_APPLICATION",
];

assert.deepEqual([...ACTION_API_PUBLIC_READ_ACTIONS], allowedReads);
for (const action of allowedReads) {
  assert.equal(isActionApiPublicRead(action), true, `${action} must remain readable`);
  assert.equal(isKnownActionApiAction(action), true);
}
assert.deepEqual([...ACTION_API_USER_SCOPED_ACTIONS], blockedUserScopedActions);
for (const action of blockedUserScopedActions) {
  assert.equal(
    isActionApiPublicRead(action),
    false,
    `${action} must fail closed for integration-only credentials`,
  );
  assert.equal(isKnownActionApiAction(action), true);
}
assert.equal(isActionApiPublicRead(undefined), false);
assert.equal(isActionApiPublicRead("UNKNOWN_ACTION"), false);
assert.equal(isKnownActionApiAction(undefined), false);
assert.equal(isKnownActionApiAction("UNKNOWN_ACTION"), false);
assert.equal(ACTION_API_WRITE_CONTAINMENT_CODE, "ACTION_REQUIRES_TRUSTED_PRINCIPAL");

const routes = readFileSync("server/routes/actionRoutes.ts", "utf8");
const unknownIndex = routes.indexOf("if (!isKnownActionApiAction(action))");
const containmentIndex = routes.indexOf("if (!isActionApiPublicRead(action))");
const dispatchIndex = routes.indexOf("switch (action)");
assert.ok(unknownIndex >= 0, "unknown actions must retain a distinct guard");
assert.ok(containmentIndex >= 0, "action router must enforce containment");
assert.ok(
  unknownIndex < containmentIndex && containmentIndex < dispatchIndex,
  "unknown and user-scoped actions must fail before handler dispatch",
);
const containmentBlock = routes.slice(containmentIndex, dispatchIndex);
assert.match(containmentBlock, /res\.status\(403\)\.json\(/);
assert.match(containmentBlock, /ACTION_API_WRITE_CONTAINMENT_CODE/);
const routeCases = [...routes.matchAll(/case "([A-Z_]+)":/g)].map(
  (match) => match[1],
);
assert.deepEqual(
  new Set(routeCases),
  new Set([...allowedReads, ...blockedUserScopedActions]),
  "every implemented action must be explicitly classified",
);
assert.doesNotMatch(
  readFileSync("server/security/actionApiContainment.ts", "utf8"),
  /process\.env|WRITE_ENABLED|ALLOW_WRITE/,
  "containment must not have an environment escape hatch",
);

console.log("mealscout-action-api-write-containment.contract: PASS");
