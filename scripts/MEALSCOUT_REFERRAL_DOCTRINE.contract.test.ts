import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildTrackedAttributedPath,
  buildTrackedAttributedUrl,
  buildUniversalAttributedPath,
} from "../server/shareTargetPolicy.ts";

const TAG = "alpha-tag";

const canonicalTargets = [
  "/customer-signup",
  "/claim-truck",
  "/directory",
] as const;

for (const target of canonicalTargets) {
  const path = buildTrackedAttributedPath(TAG, target);
  assert.equal(
    path,
    `${target}/${encodeURIComponent(TAG)}`,
    `Canonical generated link must be direct for ${target}.`,
  );

  assert.equal(
    /\/ref\//i.test(path),
    false,
    `Canonical generated link for ${target} must not use legacy /ref wrapper.`,
  );
  assert.equal(
    /(^|[?&])to=/i.test(path),
    false,
    `Canonical generated link for ${target} must not include nested to=.`,
  );
  assert.equal(
    path.includes("%2F"),
    false,
    `Canonical generated link for ${target} must not include encoded destination path params.`,
  );
}

const signupWithRole = buildTrackedAttributedPath(
  TAG,
  "/customer-signup?role=business",
);
assert.equal(
  signupWithRole,
  "/customer-signup/alpha-tag",
  "Generated signup links must not keep role=business when canonicalizing.",
);

const directoryUrl = buildTrackedAttributedUrl(
  "https://www.mealscout.us",
  TAG,
  "/directory",
);
assert.equal(
  directoryUrl,
  "https://www.mealscout.us/directory/alpha-tag",
  "Canonical generated absolute URL must use path-segment attribution.",
);

const legacyCompatible = buildUniversalAttributedPath(TAG, "/claim-truck");
assert.equal(
  legacyCompatible,
  "/ref/alpha-tag?to=%2Fclaim-truck",
  "Legacy universal wrapper must remain available for backward compatibility.",
);

const appSource = readFileSync("client/src/App.tsx", "utf8");
assert(
  appSource.includes('<Route path="/customer-signup/:refTag" component={CustomerSignup} />'),
  "Compatibility routing must continue accepting /customer-signup/:refTag.",
);
assert(
  appSource.includes('<Route path="/claim-truck/:refTag" component={ClaimTruckPage} />'),
  "Compatibility routing must continue accepting /claim-truck/:refTag.",
);
assert(
  appSource.includes('<Route path="/directory/:refTag" component={ScoutPageV2} />'),
  "Compatibility routing must continue accepting /directory/:refTag.",
);
assert(
  appSource.includes('<Route path="/ref/:tag" component={ReferralRedirect} />'),
  "Legacy routing must continue accepting /ref/:tag redirect links.",
);

const useAuthSource = readFileSync("client/src/hooks/useAuth.ts", "utf8");
assert(
  useAuthSource.includes('urlParams.get("ref")'),
  "Compatibility query ref capture (?ref=) must remain supported.",
);

const forbiddenSource = [
  signupWithRole,
  directoryUrl,
  ...canonicalTargets.map((target) => buildTrackedAttributedPath(TAG, target)),
].join("\n");

for (const forbidden of ["role=business", "to=", "%2F", "/ref/"]) {
  assert.equal(
    forbiddenSource.includes(forbidden),
    false,
    `Generated canonical output must not contain forbidden fragment: ${forbidden}`,
  );
}

console.log("MEALSCOUT_REFERRAL_DOCTRINE.contract: PASS");
