import assert from "node:assert/strict";
import test from "node:test";
import {
  OAuthIdentityBoundaryError,
  assertOAuthIdentityCanProceed,
  decideOAuthIdentity,
  oauthIdentityRedirectCode,
} from "./oauthIdentityPolicy";

test("provider subject identifies an existing OAuth account", () => {
  assert.deepEqual(
    decideOAuthIdentity({
      providerUserId: "user-1",
      emailUserId: "user-1",
    }),
    { kind: "existing", userId: "user-1" },
  );
});

test("a new account is allowed only without provider or email matches", () => {
  assert.deepEqual(decideOAuthIdentity({}), { kind: "create" });
});

test("email-only evidence requires authenticated linking without mutation", () => {
  const decision = decideOAuthIdentity({ emailUserId: "local-user" });
  assert.deepEqual(decision, {
    kind: "link_required",
    existingUserId: "local-user",
  });
  assert.throws(
    () => assertOAuthIdentityCanProceed("google", decision),
    (error: unknown) =>
      error instanceof OAuthIdentityBoundaryError &&
      error.code === "AUTH_ACCOUNT_LINK_REQUIRED",
  );
});

test("different provider and email rows fail as an identity collision", () => {
  const decision = decideOAuthIdentity({
    providerUserId: "provider-user",
    emailUserId: "email-user",
  });
  assert.deepEqual(decision, {
    kind: "identity_collision",
    providerUserId: "provider-user",
    emailUserId: "email-user",
  });
  assert.throws(
    () => assertOAuthIdentityCanProceed("facebook", decision),
    (error: unknown) =>
      error instanceof OAuthIdentityBoundaryError &&
      error.code === "AUTH_IDENTITY_COLLISION",
  );
});

test("callback redirects expose only approved identity codes", () => {
  assert.equal(
    oauthIdentityRedirectCode({ code: "AUTH_ACCOUNT_LINK_REQUIRED" }),
    "auth_account_link_required",
  );
  assert.equal(
    oauthIdentityRedirectCode({ code: "AUTH_IDENTITY_COLLISION" }),
    "auth_identity_collision",
  );
  assert.equal(
    oauthIdentityRedirectCode({ code: "AUTH_ACCOUNT_DISABLED" }),
    "auth_account_disabled",
  );
  assert.equal(
    oauthIdentityRedirectCode({ code: "UNTRUSTED_DETAIL" }),
    "auth_failed",
  );
});
