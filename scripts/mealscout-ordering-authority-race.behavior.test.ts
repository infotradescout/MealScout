import assert from "node:assert/strict";

import { isRestaurantOrderingAuthorityVersionCurrent } from "../server/services/restaurantOrderingAuthorityVersion";

type AuthorityModel = {
  version: number;
  locked: boolean;
  orderWrites: number;
  transfers: number;
};

function mutateOrderingAuthority(model: AuthorityModel) {
  if (model.locked) return false;
  model.version += 1;
  return true;
}

function lockAndAuthorize(
  model: AuthorityModel,
  preflightVersion: number,
  effect: "order" | "transfer",
) {
  model.locked = true;
  const authorized = isRestaurantOrderingAuthorityVersionCurrent({
    preflightVersion,
    lockedVersion: model.version,
  });
  if (authorized) {
    if (effect === "order") model.orderWrites += 1;
    else model.transfers += 1;
  }
  model.locked = false;
  return authorized;
}

// Failure injection: approval/menu/location changes after readiness but before
// the lock. The trigger bump is visible under the lock and no durable order is
// allowed.
{
  const model: AuthorityModel = {
    version: 11,
    locked: false,
    orderWrites: 0,
    transfers: 0,
  };
  const preflightVersion = model.version;
  assert.equal(mutateOrderingAuthority(model), true);
  assert.equal(lockAndAuthorize(model, preflightVersion, "order"), false);
  assert.equal(model.orderWrites, 0);
}

// The same mutation-before-lock sequence must fail closed before a first
// merchant transfer.
{
  const model: AuthorityModel = {
    version: 23,
    locked: false,
    orderWrites: 0,
    transfers: 0,
  };
  const readinessVersion = model.version;
  assert.equal(mutateOrderingAuthority(model), true);
  assert.equal(lockAndAuthorize(model, readinessVersion, "transfer"), false);
  assert.equal(model.transfers, 0);
}

// Once the authority row is locked, a dependent mutation cannot commit ahead
// of the authorized effect; it must retry after the transaction releases.
{
  const model: AuthorityModel = {
    version: 31,
    locked: true,
    orderWrites: 0,
    transfers: 0,
  };
  assert.equal(mutateOrderingAuthority(model), false);
  assert.equal(
    isRestaurantOrderingAuthorityVersionCurrent({
      preflightVersion: 31,
      lockedVersion: model.version,
    }),
    true,
  );
  model.transfers += 1;
  model.locked = false;
  assert.equal(mutateOrderingAuthority(model), true);
  assert.equal(model.transfers, 1);
  assert.equal(model.version, 32);
}

for (const invalid of [null, undefined, -1, 1.5, "future"]) {
  assert.equal(
    isRestaurantOrderingAuthorityVersionCurrent({
      preflightVersion: invalid,
      lockedVersion: 1,
    }),
    false,
  );
}

console.log("MealScout ordering authority race model: PASS (4/4)");
