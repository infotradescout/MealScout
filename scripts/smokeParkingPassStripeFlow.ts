import "dotenv/config";

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

type HttpResult<T = JsonObject> = {
  status: number;
  data: T | null;
};

async function httpJson<T = JsonObject>(
  url: string,
  opts: {
    method?: string;
    cookie?: string;
    body?: JsonObject;
    headers?: Record<string, string>;
  } = {},
): Promise<HttpResult<T>> {
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });

  const text = await res.text();
  let data: T | null = null;
  if (text.trim().length > 0) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }

  return { status: res.status, data };
}

function parseBool(value: string | undefined): boolean | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return undefined;
}

function parseSlotTypes(raw: string | undefined): string[] {
  const source = String(raw || "daily");
  const parts = source
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  return Array.from(new Set(parts));
}

function requireEnv(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function asRecord(value: unknown): Record<string, any> {
  if (value && typeof value === "object") {
    return value as Record<string, any>;
  }
  return {};
}

function extractCookieByName(
  setCookieHeader: string,
  cookieName: string,
): string | null {
  const match = String(setCookieHeader || "").match(
    new RegExp(`${cookieName}=([^;]+)`),
  );
  if (!match || !match[1]) return null;
  return `${cookieName}=${match[1]}`;
}

async function loginAndGetCookie(opts: {
  apiBase: string;
  email: string;
  password: string;
  cookieName?: string;
}): Promise<string> {
  const cookieName = String(opts.cookieName || "connect.sid").trim();
  const res = await fetch(`${opts.apiBase}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: opts.email,
      password: opts.password,
    }),
    redirect: "manual",
  });
  if (res.status !== 200) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Login failed for ${opts.email} status=${res.status} body=${text}`,
    );
  }
  const headerBag: any = res.headers as any;
  const setCookies: string[] = Array.isArray(headerBag?.getSetCookie?.())
    ? headerBag.getSetCookie()
    : [];
  for (const row of setCookies) {
    const parsed = extractCookieByName(row, cookieName);
    if (parsed) return parsed;
  }
  const raw = String(res.headers.get("set-cookie") || "");
  const parsed = extractCookieByName(raw, cookieName);
  if (parsed) return parsed;
  throw new Error(
    `Login succeeded but ${cookieName} cookie was not found in response headers.`,
  );
}

function extractDateKeyFromPassId(passId: string): string | null {
  const normalized = String(passId || "").trim();
  if (!normalized) return null;
  const tail = normalized.split(":").pop() || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(tail)) {
    return tail;
  }
  return null;
}

async function run() {
  const API_BASE = String(process.env.API_BASE || "http://localhost:5000").replace(
    /\/+$/,
    "",
  );
  let PASS_ID = String(process.env.TEST_PARKING_PASS_ID || "").trim();
  let TRUCK_ID = String(process.env.TEST_TRUCK_ID || "").trim();
  const SESSION_COOKIE_NAME = String(
    process.env.TEST_SESSION_COOKIE_NAME || "connect.sid",
  ).trim();
  let TRUCK_AUTH_COOKIE = String(process.env.TEST_TRUCK_AUTH_COOKIE || "").trim();
  let HOST_AUTH_COOKIE = String(process.env.TEST_HOST_AUTH_COOKIE || "").trim();
  let HOST_ID = String(process.env.TEST_HOST_ID || "").trim();
  const TEST_BOOKING_DATE = String(process.env.TEST_BOOKING_DATE || "").trim();
  const TRUCK_EMAIL = String(process.env.TEST_TRUCK_EMAIL || "").trim();
  const TRUCK_PASSWORD = String(process.env.TEST_TRUCK_PASSWORD || "").trim();
  const HOST_EMAIL = String(process.env.TEST_HOST_EMAIL || "").trim();
  const HOST_PASSWORD = String(process.env.TEST_HOST_PASSWORD || "").trim();

  const SLOT_TYPES = parseSlotTypes(process.env.TEST_SLOT_TYPES);
  const APPLY_CREDITS_CENTS = Number(process.env.TEST_APPLY_CREDITS_CENTS || 0);
  const CANCEL_PENDING_AFTER_CHECK = parseBool(process.env.CANCEL_PENDING_AFTER_CHECK) ?? true;

  const EXPECT_HOST_CONNECTED = parseBool(process.env.EXPECT_HOST_CONNECTED);
  const EXPECT_HOST_CHARGES_ENABLED = parseBool(process.env.EXPECT_HOST_CHARGES_ENABLED);
  const EXPECT_HOST_ONBOARDING_COMPLETED = parseBool(
    process.env.EXPECT_HOST_ONBOARDING_COMPLETED,
  );

  console.log(`Smoke base URL: ${API_BASE}`);
  console.log(`Slot types: ${SLOT_TYPES.join(",")}`);

  if (!TRUCK_AUTH_COOKIE) {
    if (!TRUCK_EMAIL || !TRUCK_PASSWORD) {
      throw new Error(
        "Provide either TEST_TRUCK_AUTH_COOKIE or TEST_TRUCK_EMAIL + TEST_TRUCK_PASSWORD.",
      );
    }
    TRUCK_AUTH_COOKIE = await loginAndGetCookie({
      apiBase: API_BASE,
      email: TRUCK_EMAIL,
      password: TRUCK_PASSWORD,
      cookieName: SESSION_COOKIE_NAME,
    });
    console.log(`Truck login session established for ${TRUCK_EMAIL}.`);
  }

  if (!HOST_AUTH_COOKIE && HOST_EMAIL && HOST_PASSWORD) {
    HOST_AUTH_COOKIE = await loginAndGetCookie({
      apiBase: API_BASE,
      email: HOST_EMAIL,
      password: HOST_PASSWORD,
      cookieName: SESSION_COOKIE_NAME,
    });
    console.log(`Host login session established for ${HOST_EMAIL}.`);
  }
  if (!HOST_AUTH_COOKIE && HOST_ID) {
    throw new Error(
      "TEST_HOST_ID provided without host auth. Add TEST_HOST_AUTH_COOKIE or TEST_HOST_EMAIL + TEST_HOST_PASSWORD.",
    );
  }

  if ((HOST_AUTH_COOKIE && !HOST_ID) || (!HOST_AUTH_COOKIE && HOST_ID)) {
    if (HOST_AUTH_COOKIE && !HOST_ID) {
      const hostMeRes = await httpJson(`${API_BASE}/api/hosts/me`, {
        method: "GET",
        cookie: HOST_AUTH_COOKIE,
      });
      if (hostMeRes.status === 200) {
        HOST_ID = String(asRecord(hostMeRes.data).id || "").trim();
      }
      if (!HOST_ID) {
        throw new Error(
          `Unable to resolve TEST_HOST_ID from /api/hosts/me (status=${hostMeRes.status}).`,
        );
      }
    }
  }

  if (!TRUCK_ID) {
    const truckRes = await httpJson<any[]>(`${API_BASE}/api/restaurants/my`, {
      method: "GET",
      cookie: TRUCK_AUTH_COOKIE,
    });
    if (truckRes.status !== 200 || !Array.isArray(truckRes.data)) {
      throw new Error(
        `Unable to load truck list for TEST_TRUCK_ID discovery status=${truckRes.status} body=${JSON.stringify(truckRes.data)}`,
      );
    }
    const trucks = truckRes.data;
    const candidate =
      trucks.find((row: any) => Boolean(row?.isFoodTruck)) ||
      trucks.find(
        (row: any) => String(row?.businessType || "").toLowerCase() === "food_truck",
      );
    TRUCK_ID = String(candidate?.id || "").trim();
    if (!TRUCK_ID) {
      throw new Error(
        "No owned food truck found. Set TEST_TRUCK_ID or create a truck first.",
      );
    }
  }

  if (!PASS_ID) {
    if (HOST_AUTH_COOKIE && HOST_ID) {
      const hostPassesRes = await httpJson<any[]>(
        `${API_BASE}/api/hosts/parking-pass?hostId=${encodeURIComponent(HOST_ID)}`,
        {
          method: "GET",
          cookie: HOST_AUTH_COOKIE,
        },
      );
      if (hostPassesRes.status === 200 && Array.isArray(hostPassesRes.data)) {
        const candidate = hostPassesRes.data.find((row: any) => String(row?.id || "").trim());
        PASS_ID = String(candidate?.id || "").trim();
      }
    }
    if (!PASS_ID) {
      const publicPassesRes = await httpJson<any[]>(`${API_BASE}/api/parking-pass`, {
        method: "GET",
      });
      if (publicPassesRes.status === 200 && Array.isArray(publicPassesRes.data)) {
        const candidate = publicPassesRes.data.find((row: any) => String(row?.id || "").trim());
        PASS_ID = String(candidate?.id || "").trim();
      }
    }
    if (!PASS_ID) {
      throw new Error(
        "Unable to resolve TEST_PARKING_PASS_ID from host/public feeds. Set TEST_PARKING_PASS_ID.",
      );
    }
  }

  console.log(`Pass: ${PASS_ID}`);
  console.log(`Truck: ${TRUCK_ID}`);
  if (HOST_ID) console.log(`Host: ${HOST_ID}`);

  if (HOST_AUTH_COOKIE && HOST_ID) {
    const hostStatusPath = `/api/hosts/stripe/status?hostId=${encodeURIComponent(HOST_ID)}`;
    const hostStatusRes = await httpJson(`${API_BASE}${hostStatusPath}`, {
      method: "GET",
      cookie: HOST_AUTH_COOKIE,
    });
    if (hostStatusRes.status !== 200) {
      throw new Error(
        `Host Stripe status failed status=${hostStatusRes.status} body=${JSON.stringify(hostStatusRes.data)}`,
      );
    }

    const hostStatus = asRecord(hostStatusRes.data);
    const connected = Boolean(hostStatus.connected);
    const chargesEnabled = Boolean(hostStatus.chargesEnabled);
    const onboardingCompleted = Boolean(hostStatus.onboardingCompleted);

    if (typeof EXPECT_HOST_CONNECTED === "boolean" && connected !== EXPECT_HOST_CONNECTED) {
      throw new Error(
        `Expected host connected=${EXPECT_HOST_CONNECTED}, got ${connected}`,
      );
    }
    if (
      typeof EXPECT_HOST_CHARGES_ENABLED === "boolean" &&
      chargesEnabled !== EXPECT_HOST_CHARGES_ENABLED
    ) {
      throw new Error(
        `Expected host chargesEnabled=${EXPECT_HOST_CHARGES_ENABLED}, got ${chargesEnabled}`,
      );
    }
    if (
      typeof EXPECT_HOST_ONBOARDING_COMPLETED === "boolean" &&
      onboardingCompleted !== EXPECT_HOST_ONBOARDING_COMPLETED
    ) {
      throw new Error(
        `Expected host onboardingCompleted=${EXPECT_HOST_ONBOARDING_COMPLETED}, got ${onboardingCompleted}`,
      );
    }

    console.log(
      `Host Stripe status: connected=${connected} chargesEnabled=${chargesEnabled} onboardingCompleted=${onboardingCompleted}`,
    );

    const hostPassesRes = await httpJson<any[]>(
      `${API_BASE}/api/hosts/parking-pass?hostId=${encodeURIComponent(HOST_ID)}`,
      {
        method: "GET",
        cookie: HOST_AUTH_COOKIE,
      },
    );
    if (hostPassesRes.status !== 200 || !Array.isArray(hostPassesRes.data)) {
      throw new Error(
        `Host parking-pass listing fetch failed status=${hostPassesRes.status} body=${JSON.stringify(hostPassesRes.data)}`,
      );
    }
    const hostPasses = hostPassesRes.data;
    if (hostPasses.length === 0) {
      throw new Error("Host has no parking pass listings to validate.");
    }
    console.log(`Host listings available: ${hostPasses.length}`);

    const managedPass =
      hostPasses.find((row: any) => String(row?.id || "") === PASS_ID) || hostPasses[0];
    const managedPassId = String(managedPass?.id || "").trim();
    if (!managedPassId) {
      throw new Error("Unable to resolve a host-managed parking pass id for PATCH check.");
    }
    const safeMaxTrucks = Math.max(1, Number(managedPass?.maxTrucks || 1));
    const patchRes = await httpJson(
      `${API_BASE}/api/hosts/parking-pass/${encodeURIComponent(managedPassId)}`,
      {
        method: "PATCH",
        cookie: HOST_AUTH_COOKIE,
        body: {
          maxTrucks: safeMaxTrucks,
          applyToFuture: false,
        },
      },
    );
    if (patchRes.status !== 200) {
      throw new Error(
        `Host parking-pass update failed status=${patchRes.status} body=${JSON.stringify(patchRes.data)}`,
      );
    }
    console.log(`Host listing PATCH check passed: ${managedPassId}`);

    const hostBookingsRes = await httpJson<any[]>(
      `${API_BASE}/api/bookings/my-host`,
      {
        method: "GET",
        cookie: HOST_AUTH_COOKIE,
      },
    );
    if (hostBookingsRes.status !== 200 || !Array.isArray(hostBookingsRes.data)) {
      throw new Error(
        `Host bookings fetch failed status=${hostBookingsRes.status} body=${JSON.stringify(hostBookingsRes.data)}`,
      );
    }
    console.log(`Host bookings endpoint reachable (rows=${hostBookingsRes.data.length}).`);
  } else {
    console.log(
      "Skipping host-management checks (set host cookie or host email/password).",
    );
  }

  const bookingPayload: Record<string, any> = {
    truckId: TRUCK_ID,
    slotTypes: SLOT_TYPES,
  };
  const resolvedDateKey =
    TEST_BOOKING_DATE || extractDateKeyFromPassId(PASS_ID) || "";
  if (resolvedDateKey) {
    bookingPayload.selectedDates = [resolvedDateKey];
    console.log(`Booking date key: ${resolvedDateKey}`);
  }
  if (Number.isFinite(APPLY_CREDITS_CENTS) && APPLY_CREDITS_CENTS > 0) {
    bookingPayload.applyCreditsCents = Math.max(0, Math.floor(APPLY_CREDITS_CENTS));
  }

  const bookingRes = await httpJson(`${API_BASE}/api/parking-pass/${encodeURIComponent(PASS_ID)}/book`, {
    method: "POST",
    cookie: TRUCK_AUTH_COOKIE,
    headers: {
      "Idempotency-Key": `parking-pass-smoke-${Date.now()}`,
    },
    body: bookingPayload as JsonObject,
  });

  if (bookingRes.status !== 200) {
    const body = asRecord(bookingRes.data);
    const code = String(body.code || "");
    if (code === "host_payments_not_enabled") {
      throw new Error(
        "Booking blocked: host payments are not enabled (host_payments_not_enabled).",
      );
    }
    throw new Error(
      `Create booking checkout failed status=${bookingRes.status} body=${JSON.stringify(bookingRes.data)}`,
    );
  }

  const bookingData = asRecord(bookingRes.data);
  const paymentIntentId = String(bookingData.paymentIntentId || "").trim();
  if (!paymentIntentId) {
    throw new Error(`Missing paymentIntentId in booking response: ${JSON.stringify(bookingRes.data)}`);
  }
  console.log(`Created booking checkout intent: ${paymentIntentId}`);

  const statusRes = await httpJson(
    `${API_BASE}/api/bookings/payment-intent/${encodeURIComponent(paymentIntentId)}?truckId=${encodeURIComponent(TRUCK_ID)}`,
    {
      method: "GET",
      cookie: TRUCK_AUTH_COOKIE,
    },
  );
  if (statusRes.status !== 200) {
    throw new Error(
      `Lookup booking by payment intent failed status=${statusRes.status} body=${JSON.stringify(statusRes.data)}`,
    );
  }

  const bookingStatus = String(asRecord(statusRes.data).status || "").trim();
  if (!["pending", "confirmed", "cancelled", "credited"].includes(bookingStatus)) {
    throw new Error(`Unexpected booking status from payment-intent lookup: ${bookingStatus}`);
  }
  console.log(`Booking status after intent creation: ${bookingStatus}`);

  const truckBookingsRes = await httpJson<any[]>(`${API_BASE}/api/bookings/my-truck`, {
    method: "GET",
    cookie: TRUCK_AUTH_COOKIE,
  });
  if (truckBookingsRes.status !== 200 || !Array.isArray(truckBookingsRes.data)) {
    throw new Error(
      `Truck bookings fetch failed status=${truckBookingsRes.status} body=${JSON.stringify(truckBookingsRes.data)}`,
    );
  }
  console.log(`Truck bookings endpoint reachable (rows=${truckBookingsRes.data.length}).`);

  const duplicateRes = await httpJson(
    `${API_BASE}/api/parking-pass/${encodeURIComponent(PASS_ID)}/book`,
    {
      method: "POST",
      cookie: TRUCK_AUTH_COOKIE,
      body: bookingPayload as JsonObject,
    },
  );
  if (![400, 409].includes(duplicateRes.status)) {
    throw new Error(
      `Expected duplicate-protection failure (400/409), got status=${duplicateRes.status} body=${JSON.stringify(duplicateRes.data)}`,
    );
  }
  console.log(`Duplicate booking attempt blocked as expected (status=${duplicateRes.status}).`);

  if (CANCEL_PENDING_AFTER_CHECK) {
    const cancelRes = await httpJson(
      `${API_BASE}/api/bookings/payment-intent/${encodeURIComponent(paymentIntentId)}/cancel?truckId=${encodeURIComponent(TRUCK_ID)}`,
      {
        method: "POST",
        cookie: TRUCK_AUTH_COOKIE,
      },
    );

    if (![200, 409].includes(cancelRes.status)) {
      throw new Error(
        `Cancel checkout failed status=${cancelRes.status} body=${JSON.stringify(cancelRes.data)}`,
      );
    }

    const postCancelStatusRes = await httpJson(
      `${API_BASE}/api/bookings/payment-intent/${encodeURIComponent(paymentIntentId)}?truckId=${encodeURIComponent(TRUCK_ID)}`,
      {
        method: "GET",
        cookie: TRUCK_AUTH_COOKIE,
      },
    );
    if (postCancelStatusRes.status !== 200) {
      throw new Error(
        `Post-cancel booking lookup failed status=${postCancelStatusRes.status} body=${JSON.stringify(postCancelStatusRes.data)}`,
      );
    }

    const postCancelStatus = String(asRecord(postCancelStatusRes.data).status || "").trim();
    console.log(`Post-cancel booking status: ${postCancelStatus}`);
  }

  console.log("PASS: parking pass Stripe smoke checks passed.");
}

run().catch((error) => {
  console.error("FAIL:", error?.stack || error?.message || error);
  process.exit(1);
});
