import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import {
  mapTradeScoutRolesToUserType,
  resolveTradeScoutSsoConfig,
  verifyTradeScoutSsoToken,
} from "../server/services/tradescoutSsoPolicy.ts";

const secret = "s".repeat(64);
const issuer = "https://www.thetradescout.com";
const audience = "mealscout";
const now = 1_788_200_000;
const config = { secret, issuer, audience, maxAgeSeconds: 300 };

const sign = (
  payload: Record<string, unknown>,
  options: jwt.SignOptions = {},
) =>
  jwt.sign(payload, secret, {
    algorithm: "HS256",
    issuer,
    audience,
    ...options,
  });

const validPayload = {
  sub: "tradescout-user-123",
  iat: now - 30,
  exp: now + 120,
  email: "owner@example.com",
  email_verified: true,
  given_name: "Meal",
  family_name: "Owner",
  roles: ["mealscout_restaurant_owner"],
};

const accepted = verifyTradeScoutSsoToken(sign(validPayload), config, now);
assert.equal(accepted.ok, true);
if (accepted.ok) {
  assert.equal(accepted.identity.tradescoutId, "tradescout-user-123");
  assert.equal(accepted.identity.email, "owner@example.com");
  assert.equal(accepted.identity.emailVerified, true);
  assert.equal(accepted.identity.userType, "restaurant_owner");
}

const unverifiedEmail = verifyTradeScoutSsoToken(
  sign({ ...validPayload, email_verified: false }),
  config,
  now,
);
assert.equal(unverifiedEmail.ok, true);
if (unverifiedEmail.ok) {
  assert.equal(unverifiedEmail.identity.email, null);
  assert.equal(unverifiedEmail.identity.emailVerified, false);
}

for (const payload of [
  { ...validPayload, sub: undefined },
  { ...validPayload, sub: "undefined" },
  { ...validPayload, sub: "null" },
]) {
  const result = verifyTradeScoutSsoToken(sign(payload), config, now);
  assert.equal(result.ok, false, "missing or placeholder subjects must fail closed");
}

assert.equal(
  verifyTradeScoutSsoToken(
    jwt.sign(validPayload, secret, {
      algorithm: "HS256",
      issuer: "https://wrong.example",
      audience,
    }),
    config,
    now,
  ).ok,
  false,
  "wrong issuer must be rejected",
);
assert.equal(
  verifyTradeScoutSsoToken(
    jwt.sign(validPayload, secret, {
      algorithm: "HS256",
      issuer,
      audience: "wrong-audience",
    }),
    config,
    now,
  ).ok,
  false,
  "wrong audience must be rejected",
);
assert.equal(
  verifyTradeScoutSsoToken(
    jwt.sign(validPayload, secret, {
      algorithm: "HS384",
      issuer,
      audience,
    }),
    config,
    now,
  ).ok,
  false,
  "non-HS256 tokens must be rejected",
);
assert.equal(
  verifyTradeScoutSsoToken(
    sign({ ...validPayload, iat: now - 600, exp: now + 100 }),
    config,
    now,
  ).ok,
  false,
  "overlong token lifetimes must be rejected",
);

assert.equal(mapTradeScoutRolesToUserType(["admin"]), "customer");
assert.equal(mapTradeScoutRolesToUserType(["mealscout_admin"]), "admin");
assert.equal(
  mapTradeScoutRolesToUserType(["mealscout_super_admin"]),
  "super_admin",
);

assert.equal(resolveTradeScoutSsoConfig({}).ok, false);
assert.equal(
  resolveTradeScoutSsoConfig({
    TRADESCOUT_JWT_SECRET: "short",
    TRADESCOUT_JWT_ISSUER: issuer,
    TRADESCOUT_JWT_AUDIENCE: audience,
  }).ok,
  false,
);
assert.equal(
  resolveTradeScoutSsoConfig({
    TRADESCOUT_JWT_SECRET: secret,
    TRADESCOUT_JWT_ISSUER: issuer,
    TRADESCOUT_JWT_AUDIENCE: audience,
  }).ok,
  true,
);

const authSource = readFileSync("server/unifiedAuth.ts", "utf8");
const userRepositorySource = readFileSync(
  "server/storage/usersRepository.ts",
  "utf8",
);
assert.doesNotMatch(authSource, /jwt\.verify\(token, secret\)/);
assert.doesNotMatch(authSource, /r\.includes\("admin"\)/);
assert.match(
  userRepositorySource,
  /tsData\.emailVerified === true \? normalizedEmail : null/,
  "TradeScout email linking must require a verified-email claim",
);
assert.match(
  userRepositorySource,
  /current\.tradescoutId !== tsData\.tradescoutId/,
  "one MealScout account must not be silently relinked to another TradeScout subject",
);

console.log("tradescout-sso-policy.behavior: PASS");
