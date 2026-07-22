import assert from "node:assert/strict";

import {
  mirrorInfinitySelectiveInheritance,
  mirrorInfinitySignup,
  mirrorInfinityTouch,
  sanitizeInfinityAffiliateTag,
  sanitizeInfinityCanonicalPath,
} from "../server/integrations/infinityShadow";
import { mealScoutSelectiveInheritancePolicy } from "../server/integrations/infinitySelectiveInheritance";

const envNames = [
  "INFINITY_API_URL",
  "INFINITY_API_KEY",
  "INFINITY_TENANT_ID",
  "INFINITY_PROGRAM_ID",
] as const;
const originalEnv = Object.fromEntries(
  envNames.map((name) => [name, process.env[name]]),
);
const originalFetch = globalThis.fetch;

for (const name of envNames) delete process.env[name];

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

assert.equal(
  await mirrorInfinitySelectiveInheritance({
    evaluationId: "inheritance-1",
    profileId: "restaurant-1",
    targetVersion: "profile-v1",
    candidates: [],
  }),
  "disabled",
);

const inheritancePolicy = mealScoutSelectiveInheritancePolicy("tenant-1");
assert.equal(inheritancePolicy.defaultAction, "exclude");
assert.equal(
  inheritancePolicy.fields.find((field) => field.field === "menu")?.action,
  "inherit",
);
for (const protectedField of [
  "liveAvailability",
  "ordering",
  "payment",
  "commission",
  "ownerIdentity",
]) {
  assert.equal(
    inheritancePolicy.fields.find((field) => field.field === protectedField)
      ?.action,
    "exclude",
  );
}

assert.equal(
  sanitizeInfinityCanonicalPath(
    "/restaurant/example?ref=MEAL1234&token=secret&email=scout@example.com#private",
  ),
  "/restaurant/example",
);
assert.equal(
  sanitizeInfinityCanonicalPath("/restaurant/scout%40example.com"),
  "/restaurant/_redacted",
);
assert.equal(
  sanitizeInfinityCanonicalPath("/restaurant/850-555-1212"),
  "/restaurant/_redacted",
);
assert.equal(sanitizeInfinityAffiliateTag("MEAL1234"), "MEAL1234");
assert.equal(sanitizeInfinityAffiliateTag("scout@example.com"), null);
assert.equal(sanitizeInfinityAffiliateTag("8505551212"), null);

const calls: Array<{ url: string; body: string }> = [];
process.env.INFINITY_API_URL = "https://infinity.example";
process.env.INFINITY_API_KEY = "adapter-key";
process.env.INFINITY_TENANT_ID = "tenant-1";
process.env.INFINITY_PROGRAM_ID = "program-1";
globalThis.fetch = (async (input, init) => {
  calls.push({
    url: String(input),
    body: String(init?.body || ""),
  });
  return new Response(null, { status: 204 });
}) as typeof fetch;

try {
  assert.equal(
    await mirrorInfinityTouch({
      partnerId: "partner-1",
      affiliateTag: "MEAL1234",
      canonicalPath:
        "/restaurant/example?ref=MEAL1234&token=top-secret&email=scout@example.com&phone=8505551212&auth_code=654321&authorization=Bearer-secret&unknown=discard-me#private",
      carrier: "query_ref",
    }),
    "sent",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://infinity.example/v1/attribution-touches");

  const body = JSON.parse(calls[0].body);
  assert.deepEqual(Object.keys(body).sort(), [
    "carrier",
    "evidence",
    "partnerId",
    "programId",
    "target",
  ]);
  assert.equal(body.partnerId, "partner-1");
  assert.equal(body.carrier, "query_ref");
  assert.deepEqual(body.evidence, {
    affiliateTag: "MEAL1234",
    source: "mealscout_referral",
  });
  assert.equal(body.target.canonicalPath, "/restaurant/example");

  for (const leaked of [
    "?ref=",
    "top-secret",
    "scout@example.com",
    "8505551212",
    "654321",
    "Bearer-secret",
    "discard-me",
    "unknown",
  ]) {
    assert.ok(
      !calls[0].body.includes(leaked),
      `Infinity body leaked forbidden query material: ${leaked}`,
    );
  }

  assert.equal(
    await mirrorInfinityTouch({
      partnerId: "partner-1",
      affiliateTag: "scout@example.com",
      canonicalPath: "/restaurant/example?ref=scout@example.com",
      carrier: "query_ref",
    }),
    "disabled",
  );
  assert.equal(calls.length, 1, "Unsafe attribution must not call Infinity");

  assert.equal(
    await mirrorInfinitySelectiveInheritance({
      evaluationId: "inheritance-2",
      profileId: "restaurant-1",
      targetVersion: "profile-v1",
      candidates: [
        {
          field: "menu",
          value: { sections: [] },
          sourceKind: "owner_verified",
          sourceReference: "owner-packet:menu-1",
          evidenceDigest: "sha256:menu",
          observedAt: "2026-07-19T15:00:00.000Z",
          confidence: 1,
          verified: true,
        },
        {
          field: "payment",
          value: { account: "must-not-cross" },
          sourceKind: "product_record",
          sourceReference: "private:payment",
          evidenceDigest: "sha256:payment",
          observedAt: "2026-07-19T15:00:00.000Z",
          confidence: 1,
          verified: true,
        },
      ],
      overrides: [
        {
          field: "description",
          value: "Allowed owner-approved description",
          reason: "owner correction",
          evidenceDigest: "sha256:description",
          actorReference: "owner:restaurant-1",
          authorizedAt: "2026-07-19T15:05:00.000Z",
        },
        {
          field: "payment",
          value: { account: "override-must-not-cross" },
          reason: "invalid protected override",
          evidenceDigest: "sha256:payment-override",
          actorReference: "owner:restaurant-1",
          authorizedAt: "2026-07-19T15:05:00.000Z",
        },
      ],
    }),
    "sent",
  );
  assert.equal(calls.length, 2);
  assert.equal(
    calls[1].url,
    "https://infinity.example/v1/selective-inheritance/evaluations",
  );
  const inheritanceBody = JSON.parse(calls[1].body);
  assert.equal(inheritanceBody.policy.defaultAction, "exclude");
  assert.deepEqual(
    inheritanceBody.candidates.map(
      (candidate: { field: string }) => candidate.field,
    ),
    ["menu"],
  );
  assert.equal(inheritanceBody.candidates[0].value.sections.length, 0);
  assert.deepEqual(
    inheritanceBody.overrides.map((override: { field: string }) => override.field),
    ["description"],
  );
  assert.ok(!calls[1].body.includes("must-not-cross"));
  assert.ok(!calls[1].body.includes("override-must-not-cross"));
} finally {
  globalThis.fetch = originalFetch;
  for (const name of envNames) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

console.log("MealScout Infinity shadow adapter contract passed");
