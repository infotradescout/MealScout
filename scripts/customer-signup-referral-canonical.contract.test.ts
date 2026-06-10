import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildTrackedAttributedPath,
  buildTrackedAttributedUrl,
} from "../server/shareTargetPolicy";

const canonicalBusinessPath = buildTrackedAttributedPath(
  "efpjv02e",
  "/customer-signup?role=business",
);
assert.equal(
  canonicalBusinessPath,
  "/customer-signup/efpjv02e",
  "Business signup links must be simplified to canonical /customer-signup/<code> format when role is not required.",
);
assert.equal(
  canonicalBusinessPath.includes("/ref/"),
  false,
  "Canonical customer signup links must not include /ref/ path wrappers.",
);
assert.equal(
  canonicalBusinessPath.includes("to=%2Fcustomer-signup"),
  false,
  "Canonical customer signup links must not nest customer-signup into a to= parameter.",
);

const canonicalSignupPath = buildTrackedAttributedPath(
  "efpjv02e",
  "/customer-signup",
);
assert.equal(
  canonicalSignupPath,
  "/customer-signup/efpjv02e",
  "Signup links without role must append referral code as the final path segment.",
);

const canonicalUrl = buildTrackedAttributedUrl(
  "https://mealscout.us",
  "efpjv02e",
  "/customer-signup?role=business",
);
assert.equal(
  canonicalUrl,
  "https://mealscout.us/customer-signup/efpjv02e",
  "Canonical signup share URL must be direct and not wrapped.",
);

const universalNonSignup = buildTrackedAttributedUrl(
  "https://mealscout.us",
  "efpjv02e",
  "/claim-truck",
);
assert.equal(
  universalNonSignup,
  "https://mealscout.us/claim-truck/efpjv02e",
  "Non-signup paths should also use direct clean path-segment ref links.",
);
assert.equal(
  universalNonSignup.includes("/ref/"),
  false,
  "Generated links must not include /ref/ wrappers.",
);
assert.equal(
  universalNonSignup.includes("to="),
  false,
  "Generated links must not include nested destination query params.",
);
assert.equal(
  universalNonSignup.includes("%2F"),
  false,
  "Generated links must not URL-encode destination path into params.",
);

const customerSignupSource = readFileSync(
  "client/src/pages/customer-signup.tsx",
  "utf8",
);
assert(
  customerSignupSource.includes('searchParams.get("ref")'),
  "Customer signup must read ref directly from query parameters.",
);

console.log("customer-signup-referral-canonical.contract: PASS");
