import assert from "node:assert/strict";

const baseUrl = String(process.env.SMOKE_BASE_URL || "http://127.0.0.1:5000").replace(
  /\/+$/,
  "",
);
const presetAuthCookie = String(process.env.TEST_AUTH_COOKIE || "").trim();
const presetRestaurantId = String(process.env.TEST_RESTAURANT_ID || "").trim();
const ownerEmail = String(process.env.TEST_OWNER_EMAIL || "").trim();
const ownerPassword = String(process.env.TEST_OWNER_PASSWORD || "").trim();

const getSetCookieHeader = (response: Response): string[] => {
  const anyHeaders = response.headers as any;
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
};

const cookieFromLogin = async (): Promise<string> => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ email: ownerEmail, password: ownerPassword }),
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(
    response.ok,
    true,
    `login failed (${response.status}): ${JSON.stringify(payload)}`,
  );

  const cookie = getSetCookieHeader(response)
    .map((part) => String(part || "").split(";")[0])
    .filter(Boolean)
    .join("; ");
  assert.ok(cookie, "login succeeded but no auth cookie was returned");
  return cookie;
};

const resolveRestaurantId = async (authCookie: string): Promise<string> => {
  if (presetRestaurantId) return presetRestaurantId;

  const response = await fetch(`${baseUrl}/api/restaurants/my`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: authCookie,
    },
  });
  const payload = await response.json().catch(() => []);
  assert.equal(
    response.ok,
    true,
    `failed to load owner restaurants (${response.status}): ${JSON.stringify(payload)}`,
  );
  assert.equal(Array.isArray(payload), true, "expected /api/restaurants/my to return an array");
  const firstRestaurantId = String(payload?.[0]?.id || "").trim();
  assert.ok(
    firstRestaurantId,
    "no restaurant found for owner; set TEST_RESTAURANT_ID explicitly",
  );
  return firstRestaurantId;
};

const run = async () => {
  let authCookie = presetAuthCookie;
  if (!authCookie) {
    if (!ownerEmail || !ownerPassword) {
      console.log(
        "onboarding completion endpoint test skipped: set TEST_AUTH_COOKIE + TEST_RESTAURANT_ID, or TEST_OWNER_EMAIL + TEST_OWNER_PASSWORD",
      );
      process.exit(0);
    }
    authCookie = await cookieFromLogin();
  }

  const restaurantId = await resolveRestaurantId(authCookie);

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

