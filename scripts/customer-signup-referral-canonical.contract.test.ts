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
  "/customer-signup?role=business&ref=efpjv02e",
  "Business signup links must use canonical /customer-signup?role=business&ref=<code> format.",
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
  "/customer-signup?ref=efpjv02e",
  "Signup links without role must still append referral code as direct ref query param.",
);

const canonicalUrl = buildTrackedAttributedUrl(
  "https://mealscout.us",
  "efpjv02e",
  "/customer-signup?role=business",
);
assert.equal(
  canonicalUrl,
  "https://mealscout.us/customer-signup?role=business&ref=efpjv02e",
  "Canonical signup share URL must be direct and not wrapped.",
);

const universalNonSignup = buildTrackedAttributedUrl(
  "https://mealscout.us",
  "efpjv02e",
  "/claim-truck",
);
assert.equal(
  universalNonSignup,
  "https://mealscout.us/ref/efpjv02e?to=%2Fclaim-truck",
  "Non-signup paths should keep universal /ref/:code?to= format for compatibility.",
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
