import assert from "node:assert/strict";

import {
  mirrorInfinitySignup,
  mirrorInfinityTouch,
} from "../server/integrations/infinityShadow";

delete process.env.INFINITY_API_URL;
delete process.env.INFINITY_API_KEY;
delete process.env.INFINITY_TENANT_ID;
delete process.env.INFINITY_PROGRAM_ID;

assert.equal(
  await mirrorInfinityTouch({
    partnerId: "partner-1",
    affiliateTag: "MEAL1234",
    canonicalPath: "/restaurant/example?ref=MEAL1234",
    carrier: "query_ref",
  }),
  "disabled",
);

assert.equal(
  await mirrorInfinitySignup({
    partnerId: "partner-1",
    referralProofId: "referral-1",
    restaurantId: "restaurant-1",
  }),
  "disabled",
);

console.log("MealScout Infinity shadow adapter contract passed");
