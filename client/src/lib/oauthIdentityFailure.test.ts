import assert from "node:assert/strict";
import test from "node:test";
import { getOAuthIdentityFailureMessage } from "./oauthIdentityFailure";

test("approved OAuth identity failures have honest user-facing messages", () => {
  assert.match(
    getOAuthIdentityFailureMessage("auth_account_link_required") || "",
    /no accounts were linked or changed/i,
  );
  assert.match(
    getOAuthIdentityFailureMessage("AUTH_IDENTITY_COLLISION") || "",
    /account recovery/i,
  );
  assert.match(
    getOAuthIdentityFailureMessage("auth_account_disabled") || "",
    /contact support/i,
  );
});

test("unknown callback details are not reflected to the person", () => {
  assert.equal(getOAuthIdentityFailureMessage("provider_internal_detail"), null);
  assert.equal(getOAuthIdentityFailureMessage(null), null);
});
