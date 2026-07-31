import "dotenv/config";
import Stripe from "stripe";

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

async function run() {
  const API_BASE = String(process.env.API_BASE || "http://localhost:5000").replace(
    /\/+$/,
    "",
  );
  const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));
  const PASS_ID = requireEnv("TEST_PARKING_PASS_ID");
  const TRUCK_ID = requireEnv("TEST_TRUCK_ID");
  const TRUCK_AUTH_COOKIE = requireEnv("TEST_TRUCK_AUTH_COOKIE");
  const HOST_AUTH_COOKIE = String(process.env.TEST_HOST_AUTH_COOKIE || "").trim();

  const SLOT_TYPES = parseSlotTypes(process.env.TEST_SLOT_TYPES);
  const APPLY_CREDITS_CENTS = Number(process.env.TEST_APPLY_CREDITS_CENTS || 0);
  const CANCEL_PENDING_AFTER_CHECK = parseBool(process.env.CANCEL_PENDING_AFTER_CHECK) ?? true;

  const EXPECT_HOST_CONNECTED = parseBool(process.env.EXPECT_HOST_CONNECTED);
  const EXPECT_HOST_CHARGES_ENABLED = parseBool(process.env.EXPECT_HOST_CHARGES_ENABLED);
  const EXPECT_HOST_ONBOARDING_COMPLETED = parseBool(
    process.env.EXPECT_HOST_ONBOARDING_COMPLETED,
  );

  console.log(`Smoke base URL: ${API_BASE}`);
  console.log(`Pass: ${PASS_ID}`);
  console.log(`Truck: ${TRUCK_ID}`);
  console.log(`Slot types: ${SLOT_TYPES.join(",")}`);

  if (HOST_AUTH_COOKIE) {
    const hostStatusRes = await httpJson(`${API_BASE}/api/hosts/stripe/status`, {
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
  } else {
    console.log("Skipping host Stripe status check (TEST_HOST_AUTH_COOKIE not set).");
  }

  const bookingPayload: Record<string, any> = {
    truckId: TRUCK_ID,
    slotTypes: SLOT_TYPES,
  };
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
  const expectedTotalCents = Number(bookingData.totalCents);
  const expectedPlatformFeeCents = Number(
    asRecord(bookingData.breakdown).platformFee,
  );
  if (!Number.isFinite(expectedTotalCents) || expectedTotalCents <= 0) {
    throw new Error(`Invalid totalCents in booking response: ${JSON.stringify(bookingRes.data)}`);
  }
  if (!Number.isFinite(expectedPlatformFeeCents) || expectedPlatformFeeCents < 0) {
    throw new Error(`Invalid platform fee in booking response: ${JSON.stringify(bookingRes.data)}`);
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (paymentIntent.amount !== expectedTotalCents) {
    throw new Error(
      `PaymentIntent amount mismatch: intent=${paymentIntent.amount} expected=${expectedTotalCents}`,
    );
  }
  if (Number(paymentIntent.metadata?.platformFeeCents || -1) !== expectedPlatformFeeCents) {
    throw new Error(
      `PaymentIntent fee metadata mismatch: intent=${paymentIntent.metadata?.platformFeeCents} expected=${expectedPlatformFeeCents}`,
    );
  }
  if (
    bookingData.hostPaymentsReady === true &&
    Number(paymentIntent.application_fee_amount || 0) !== expectedPlatformFeeCents
  ) {
    throw new Error(
      `Application fee mismatch: intent=${paymentIntent.application_fee_amount} expected=${expectedPlatformFeeCents}`,
    );
  }
  console.log(`Created booking checkout intent: ${paymentIntentId}`);
  console.log(
    `Verified booking amount=${expectedTotalCents} platformFee=${expectedPlatformFeeCents} hostPaymentsReady=${bookingData.hostPaymentsReady === true}`,
  );

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
