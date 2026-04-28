/**
 * Admin manual provisioning + verification smoke checks.
 *
 * Usage (PowerShell):
 * $env:ADMIN_SMOKE_BASE_URL="http://127.0.0.1:5200"
 * $env:ADMIN_SMOKE_EMAIL="admin@example.com"
 * $env:ADMIN_SMOKE_PASSWORD="..."
 * npm run test:admin-manual-provisioning
 */

type TestCase = {
  name: string;
  passed: boolean;
  details: string;
};

const BASE_URL = (process.env.ADMIN_SMOKE_BASE_URL || "http://127.0.0.1:5200").replace(/\/$/, "");
const ORIGIN = String(process.env.ADMIN_SMOKE_ORIGIN || "http://localhost:5200").trim();
const ADMIN_EMAIL = String(process.env.ADMIN_SMOKE_EMAIL || "").trim();
const ADMIN_PASSWORD = String(process.env.ADMIN_SMOKE_PASSWORD || "").trim();
const ADMIN_COOKIE = String(process.env.ADMIN_SMOKE_COOKIE || "").trim();

function failFast(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseCookieHeader(res: Response): string {
  const getSetCookie = (res.headers as any).getSetCookie;
  if (typeof getSetCookie === "function") {
    const cookies = getSetCookie.call(res.headers) as string[];
    return cookies.map((entry) => String(entry || "").split(";")[0]).filter(Boolean).join("; ");
  }
  const fallback = res.headers.get("set-cookie");
  return fallback ? String(fallback).split(";")[0] : "";
}

async function loginAsAdmin(): Promise<string> {
  if (ADMIN_COOKIE) {
    return ADMIN_COOKIE;
  }

  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: ORIGIN,
    },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    failFast(`Admin login failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  const cookie = parseCookieHeader(response);
  if (!cookie) {
    failFast("Admin login did not return a session cookie");
  }
  return cookie;
}

async function callAdmin(
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; payload: any }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Cookie: cookie,
      Origin: ORIGIN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function run(): Promise<void> {
  if (!ADMIN_COOKIE && (!ADMIN_EMAIL || !ADMIN_PASSWORD)) {
    failFast("Set ADMIN_SMOKE_EMAIL and ADMIN_SMOKE_PASSWORD before running this script");
  }

  const cookie = await loginAsAdmin();
  const stamp = Date.now();
  const tests: TestCase[] = [];

  const missingBusiness = await callAdmin(cookie, "POST", "/api/admin/users/create", {
    email: `smoke-host-missing-${stamp}@example.test`,
    userType: "host",
  });
  tests.push({
    name: "Host provisioning requires businessName/address",
    passed: missingBusiness.status === 400,
    details: `status=${missingBusiness.status}`,
  });

  const partialCoords = await callAdmin(cookie, "POST", "/api/admin/users/create", {
    email: `smoke-host-partial-coords-${stamp}@example.test`,
    userType: "host",
    businessName: "Smoke Host Partial Coords",
    address: "100 Test Blvd, Test City, FL",
    city: "Test City",
    state: "FL",
    latitude: 30.42,
  });
  tests.push({
    name: "Coordinate validation requires lat/lng pair",
    passed: partialCoords.status === 400,
    details: `status=${partialCoords.status}`,
  });

  const createdEmail = `smoke-host-created-${stamp}@example.test`;
  const createHost = await callAdmin(cookie, "POST", "/api/admin/users/create", {
    email: createdEmail,
    firstName: "Smoke",
    lastName: "Host",
    userType: "host",
    businessName: "Smoke Host Site",
    address: "200 Provisioning Way, Test City, FL",
    city: "Test City",
    state: "FL",
    footTraffic: "medium",
    locationType: "other",
    amenities: ["power", "wifi"],
    latitude: 30.4383,
    longitude: -84.2807,
  });
  tests.push({
    name: "Host provisioning succeeds with valid payload",
    passed: createHost.status === 200 || createHost.status === 201,
    details: `status=${createHost.status}`,
  });

  const duplicateHost = await callAdmin(cookie, "POST", "/api/admin/users/create", {
    email: createdEmail,
    userType: "host",
    businessName: "Smoke Host Duplicate",
    address: "201 Provisioning Way, Test City, FL",
    city: "Test City",
    state: "FL",
  });
  tests.push({
    name: "Duplicate user create returns conflict",
    passed: duplicateHost.status === 400 || duplicateHost.status === 409,
    details: `status=${duplicateHost.status}`,
  });

  const fakeApprove = await callAdmin(
    cookie,
    "POST",
    "/api/admin/verifications/nonexistent-verification-id/approve",
  );
  tests.push({
    name: "Verification approve missing id returns 404",
    passed: fakeApprove.status === 404,
    details: `status=${fakeApprove.status}`,
  });

  const fakeReject = await callAdmin(
    cookie,
    "POST",
    "/api/admin/verifications/nonexistent-verification-id/reject",
    { reason: "Smoke test" },
  );
  tests.push({
    name: "Verification reject missing id returns 404",
    passed: fakeReject.status === 404,
    details: `status=${fakeReject.status}`,
  });

  const failed = tests.filter((test) => !test.passed);
  console.log("Admin manual provisioning smoke results:");
  for (const test of tests) {
    console.log(`${test.passed ? "PASS" : "FAIL"} - ${test.name} (${test.details})`);
  }

  if (failed.length > 0) {
    console.error("\nFailed tests:");
    for (const test of failed) {
      console.error(`- ${test.name} (${test.details})`);
    }
    process.exit(1);
  }

  console.log("\nAll admin manual provisioning checks passed.");
}

run().catch((error) => {
  console.error("Admin manual provisioning smoke failed:", error);
  process.exit(1);
});
