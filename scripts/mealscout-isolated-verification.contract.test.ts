import assert from "node:assert/strict";
import { test } from "node:test";
import { isIsolatedVerificationMode, useLocalPostgresRuntime } from "../server/bootstrap/isolatedVerification";

test("isolated verification requires an explicit true value", () => {
  assert.equal(isIsolatedVerificationMode({}), false);
  assert.equal(isIsolatedVerificationMode({ MEALSCOUT_ISOLATED_VERIFICATION: "false" }), false);
  assert.equal(isIsolatedVerificationMode({ MEALSCOUT_ISOLATED_VERIFICATION: " TRUE " }), true);
});

test("the live MealScout Render service cannot disable its startup jobs", () => {
  assert.throws(
    () => isIsolatedVerificationMode({
      MEALSCOUT_ISOLATED_VERIFICATION: "true",
      RENDER_SERVICE_ID: "srv-d5escdh5pdvs73foo41g",
    }),
    /cannot disable jobs on the live MealScout service/,
  );
  assert.equal(isIsolatedVerificationMode({
    MEALSCOUT_ISOLATED_VERIFICATION: "true",
    RENDER_SERVICE_ID: "srv-disposable-verification",
  }), true);
});

test("local runtime cannot escape a disposable numeric-loopback database", () => {
  const env = {
    MEALSCOUT_ISOLATED_VERIFICATION: "true",
    MEALSCOUT_LOCAL_POSTGRES_RUNTIME: "true",
  };
  assert.equal(useLocalPostgresRuntime("postgresql://fixture@127.0.0.1:55494/mealscout_isolated_fixture", env), true);
  assert.equal(useLocalPostgresRuntime("postgres://fixture@[::1]:55494/mealscout_isolated_fixture", env), true);
  for (const url of [
    "postgresql://fixture@localhost:55494/mealscout_isolated_fixture",
    "postgresql://fixture@example.com:55494/mealscout_isolated_fixture",
    "postgresql://fixture@127.0.0.1:55494/mealscout_isolated_fixture?host=example.com",
    "postgresql://fixture@127.0.0.1:55494/mealscout_isolated_fixture#override",
    "postgresql://fixture@127.0.0.1:55494/mealscout",
    "postgresql://fixture@127.0.0.1:55494/mealscout_isolated_fixture/extra",
    "https://fixture@127.0.0.1:55494/mealscout_isolated_fixture",
  ]) {
    assert.throws(() => useLocalPostgresRuntime(url, env));
  }
  assert.throws(() => useLocalPostgresRuntime(
    "postgresql://fixture@127.0.0.1:55494/mealscout_isolated_fixture",
    { ...env, RENDER_SERVICE_ID: "srv-disposable-verification" },
  ));
  assert.throws(() => useLocalPostgresRuntime(
    "postgresql://fixture@127.0.0.1:55494/mealscout_isolated_fixture",
    { MEALSCOUT_LOCAL_POSTGRES_RUNTIME: "true" },
  ));
});
