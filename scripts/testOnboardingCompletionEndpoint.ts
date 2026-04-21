import assert from "node:assert/strict";

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000").replace(
  /\/+$/,
  "",
);
const authCookie = String(process.env.TEST_AUTH_COOKIE || "").trim();
const restaurantId = String(process.env.TEST_RESTAURANT_ID || "").trim();

if (!authCookie || !restaurantId) {
  console.log(
    "onboarding completion endpoint test skipped: set TEST_AUTH_COOKIE and TEST_RESTAURANT_ID",
  );
  process.exit(0);
}

const run = async () => {
  const response = await fetch(
    `${baseUrl}/api/restaurants/${encodeURIComponent(
      restaurantId,
    )}/onboarding/completion`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: authCookie,
      },
    },
  );

  const payload = await response.json().catch(() => ({}));
  assert.equal(
    response.ok,
    true,
    `expected 2xx, got ${response.status} with ${JSON.stringify(payload)}`,
  );

  assert.equal(typeof payload.restaurantId, "string");
  assert.equal(typeof payload.overallPct, "number");
  assert.equal(typeof payload.required?.done, "number");
  assert.equal(typeof payload.required?.total, "number");
  assert.equal(Array.isArray(payload.required?.missing), true);
  assert.equal(typeof payload.recommended?.done, "number");
  assert.equal(typeof payload.recommended?.total, "number");
  assert.equal(Array.isArray(payload.recommended?.missing), true);
  assert.equal(typeof payload.verification?.status, "string");
  assert.equal(typeof payload.verification?.isVerified, "boolean");
  assert.equal(typeof payload.verification?.needsSubmission, "boolean");

  assert.ok(
    payload.overallPct >= 0 && payload.overallPct <= 100,
    `overallPct out of range: ${payload.overallPct}`,
  );
  assert.ok(
    payload.required.done <= payload.required.total,
    "required.done must be <= required.total",
  );
  assert.ok(
    payload.recommended.done <= payload.recommended.total,
    "recommended.done must be <= recommended.total",
  );
  assert.ok(
    ["verified", "pending", "not_submitted"].includes(payload.verification.status),
    `unexpected verification.status: ${payload.verification.status}`,
  );

  console.log("onboarding completion endpoint test passed");
};

run().catch((error) => {
  console.error("onboarding completion endpoint test failed:", error);
  process.exit(1);
});

