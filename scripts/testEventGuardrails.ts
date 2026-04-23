/**
 * Event guardrail regression checks.
 *
 * Validates:
 * 1) Private events cannot be paid/recurring via /api/event-coordinator/events
 * 2) Admin intake endpoint accepts visibility=unknown and only returns unknown visibility rows
 *
 * Usage (PowerShell):
 * $env:ADMIN_SMOKE_BASE_URL="http://127.0.0.1:5200"
 * $env:ADMIN_SMOKE_EMAIL="admin@example.com"
 * $env:ADMIN_SMOKE_PASSWORD="..."
 * npm run test:event-guardrails
 */

type TestResult = {
  name: string;
  passed: boolean;
  details: string;
};

const BASE_URL = String(
  process.env.ADMIN_SMOKE_BASE_URL || "http://127.0.0.1:5200",
)
  .trim()
  .replace(/\/$/, "");
const ORIGIN = String(
  process.env.ADMIN_SMOKE_ORIGIN || "http://localhost:5000",
).trim();
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
    return cookies
      .map((entry) => String(entry || "").split(";")[0])
      .filter(Boolean)
      .join("; ");
  }
  const fallback = res.headers.get("set-cookie");
  return fallback ? String(fallback).split(";")[0] : "";
}

async function loginAsAdmin(): Promise<string> {
  if (ADMIN_COOKIE) return ADMIN_COOKIE;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    failFast(
      "Set ADMIN_SMOKE_COOKIE or ADMIN_SMOKE_EMAIL + ADMIN_SMOKE_PASSWORD before running this script",
    );
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
    failFast(
      `Admin login failed (${response.status}): ${JSON.stringify(payload)}`,
    );
  }

  const cookie = parseCookieHeader(response);
  if (!cookie) {
    failFast("Admin login did not return a session cookie");
  }
  return cookie;
}

async function callJson(
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

const tomorrowDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

async function run(): Promise<void> {
  const cookie = await loginAsAdmin();
  const stamp = Date.now();
  const testDate = tomorrowDate();

  const tests: TestResult[] = [];

  const privatePaid = await callJson(
    cookie,
    "POST",
    "/api/event-coordinator/events",
    {
      businessName: `Guardrail Org ${stamp}`,
      address: "100 Main St",
      city: "Austin",
      state: "TX",
      contactPhone: "555-123-4567",
      name: `Guardrail Private Paid ${stamp}`,
      description: "Regression test",
      date: testDate,
      startTime: "10:00",
      endTime: "14:00",
      maxTrucks: 3,
      eventVisibility: "private",
      eventCadence: "one_time",
      requiresPayment: true,
      hostPriceCents: 2500,
    },
  );
  tests.push({
    name: "Private one-time paid event is rejected",
    passed: privatePaid.status === 400,
    details: `status=${privatePaid.status}`,
  });

  const privateRecurring = await callJson(
    cookie,
    "POST",
    "/api/event-coordinator/events",
    {
      businessName: `Guardrail Org ${stamp}`,
      address: "100 Main St",
      city: "Austin",
      state: "TX",
      contactPhone: "555-123-4567",
      name: `Guardrail Private Recurring ${stamp}`,
      description: "Regression test",
      date: testDate,
      startTime: "10:00",
      endTime: "14:00",
      maxTrucks: 3,
      eventVisibility: "private",
      eventCadence: "recurring",
      recurringDaysOfWeek: [1, 3],
      recurrenceEndDate: testDate,
      requiresPayment: false,
    },
  );
  tests.push({
    name: "Private recurring event is rejected",
    passed: privateRecurring.status === 400,
    details: `status=${privateRecurring.status}`,
  });

  const unknownVisibility = await callJson(
    cookie,
    "GET",
    "/api/admin/event-intake-requests?limit=50&visibility=unknown&claimType=all",
  );
  const unknownItems = Array.isArray(unknownVisibility.payload?.items)
    ? unknownVisibility.payload.items
    : [];
  const unknownOnly = unknownItems.every((item: any) => {
    const v = String(item?.eventVisibility || "").toLowerCase();
    return v !== "public" && v !== "private";
  });
  tests.push({
    name: "Unknown intake visibility filter returns only unknown rows",
    passed: unknownVisibility.status === 200 && unknownOnly,
    details: `status=${unknownVisibility.status}, items=${unknownItems.length}`,
  });

  console.log("Event guardrail regression results:");
  for (const test of tests) {
    console.log(
      `${test.passed ? "PASS" : "FAIL"} - ${test.name} (${test.details})`,
    );
  }

  const failed = tests.filter((test) => !test.passed);
  if (failed.length > 0) {
    console.error("\nFailed checks:");
    for (const test of failed) {
      console.error(`- ${test.name} (${test.details})`);
    }
    process.exit(1);
  }

  console.log("\nAll event guardrail checks passed.");
}

run().catch((error) => {
  console.error("Event guardrail regression failed:", error);
  process.exit(1);
});
