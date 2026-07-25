import express from "express";
import http from "node:http";
import Stripe from "stripe";

// Runtime behavior test for POST /api/stripe/webhook.
//
// This exercises the REAL Express route registration and the REAL Stripe
// Node SDK signature crypto (Stripe.webhooks.constructEvent /
// generateTestHeaderString), which are pure local HMAC operations that
// never call the Stripe API and never require a real Stripe account.
//
// Every fixture key below is a fabricated string, not a live credential:
//   - STRIPE_SECRET_KEY is only used to construct a local Stripe SDK
//     instance; constructing the SDK makes no network call.
//   - STRIPE_WEBHOOK_SECRET is only used as an HMAC key for local signature
//     generation/verification.
//   - DATABASE_URL points at a fixture host that is never dialed for most
//     cases below, because most event payloads are deliberately shaped
//     (unhandled event type, or payment_intent.succeeded with empty
//     metadata) to short-circuit stripeWebhookRoutes.ts before any query is
//     issued. The one deliberate exception is documented at case 13:
//     payment_intent.payment_failed always attempts a DB write regardless
//     of metadata, so that branch's (unreachable, fixture-host) query fails
//     and is caught -- which is itself the thing being verified.
//
// This file proves: signature verification (valid/invalid/missing/
// tampered/wrong-secret), raw-body enforcement, generic error responses,
// the hardened development default, the FORCE_VERIFY override, malformed
// unsigned-development payload rejection, fail-closed server
// misconfiguration, fail-closed processing errors, and envelope-level
// replay safety for protected unchanged/unhandled events.
//
// It intentionally does NOT prove DB-level idempotency of the booking/
// order/subscription mutation branches -- that requires a running server
// wired to an approved isolated test database plus test-mode Stripe keys,
// which is out of scope here per the "no live credentials" constraint and
// C9-F5 in MEALSCOUT_PAYMENT_WEBHOOK_SAFETY_MAP.md. Those mutation
// branches' idempotency and out-of-order guards are locked in statically by
// mealscout-stripe-webhook-idempotency-guards.contract.test.ts instead.

const FIXTURE_STRIPE_SECRET_KEY =
  "sk_test_FIXTURE_NOT_REAL_0000000000000000000000";
const FIXTURE_WEBHOOK_SECRET =
  "whsec_test_fixture_not_real_00000000000000000000";
const WRONG_WEBHOOK_SECRET =
  "whsec_test_WRONG_fixture_000000000000000000000000";

process.env.DATABASE_URL =
  "postgres://fixture:fixture@127.0.0.1:59999/fixture_do_not_use";
process.env.STRIPE_SECRET_KEY = FIXTURE_STRIPE_SECRET_KEY;
process.env.STRIPE_WEBHOOK_SECRET = FIXTURE_WEBHOOK_SECRET;

let passed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) {
    throw new Error(
      `FAIL ${name}${detail !== undefined ? " -- " + JSON.stringify(detail) : ""}`,
    );
  }
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function run() {
  // Dynamic import so the fixture env vars above are set before
  // stripeWebhookRoutes.ts (and the `../db` module it imports) evaluate
  // their top-level `const stripe = ...` / DATABASE_URL checks.
  const { registerStripeWebhookRoutes } = await import(
    "../server/routes/stripeWebhookRoutes"
  );

  const app = express();
  // Mirrors server/index.ts: the webhook route needs the raw request body
  // for Stripe signature verification, not JSON-parsed.
  app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

  let capacityWarningCalls = 0;
  registerStripeWebhookRoutes(app, {
    notifyHostCapacityWarning: async () => {
      capacityWarningCalls += 1;
    },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const stripe = new Stripe(FIXTURE_STRIPE_SECRET_KEY);

  function buildPayload(
    eventId: string,
    type: string,
    object: Record<string, unknown>,
  ) {
    return JSON.stringify({
      id: eventId,
      object: "event",
      type,
      data: { object },
    });
  }

  function sign(payload: string, secret = FIXTURE_WEBHOOK_SECRET) {
    return stripe.webhooks.generateTestHeaderString({ payload, secret });
  }

  async function postTo(
    targetBaseUrl: string,
    payload: string,
    signatureHeader?: string,
  ) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (signatureHeader !== undefined) {
      headers["stripe-signature"] = signatureHeader;
    }
    const res = await fetch(`${targetBaseUrl}/api/stripe/webhook`, {
      method: "POST",
      headers,
      body: payload,
    });
    const text = await res.text();
    return { status: res.status, text };
  }

  function post(payload: string, signatureHeader?: string) {
    return postTo(baseUrl, payload, signatureHeader);
  }

  try {
    // Baseline: production-shaped NODE_ENV, no dev opt-outs.
    process.env.NODE_ENV = "production";
    process.env.STRIPE_WEBHOOK_FORCE_VERIFY = "";
    process.env.STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED = "";

    // 1. Valid signature, unhandled event type -> accepted.
    {
      const payload = buildPayload("evt_test_1", "charge.succeeded", {
        id: "ch_test_1",
      });
      const res = await post(payload, sign(payload));
      check("valid signature accepted (200)", res.status === 200, res);
      check(
        "response acknowledges receipt",
        JSON.parse(res.text).received === true,
      );
    }

    // 2. Invalid signature -> rejected with a stable, non-diagnostic body.
    {
      const payload = buildPayload("evt_test_2", "charge.succeeded", {
        id: "ch_test_2",
      });
      const res = await post(payload, "t=1,v1=deadbeef");
      check("invalid signature rejected (400)", res.status === 400, res);
      check(
        "signature failure response does not expose Stripe verifier details",
        res.text === "Webhook Error: signature verification failed",
        res.text,
      );
    }

    // 3. Missing signature header entirely -> rejected.
    {
      const payload = buildPayload("evt_test_3", "charge.succeeded", {
        id: "ch_test_3",
      });
      const res = await post(payload, undefined);
      check("missing signature header rejected (400)", res.status === 400, res);
    }

    // 4. Tampered payload after signing -> rejected.
    {
      const payload = buildPayload("evt_test_4", "charge.succeeded", {
        id: "ch_test_4",
      });
      const signature = sign(payload);
      const tampered = payload.replace("ch_test_4", "ch_test_4_TAMPERED");
      const res = await post(tampered, signature);
      check("tampered payload rejected (400)", res.status === 400, res);
    }

    // 5. Signature generated with the wrong secret -> rejected.
    {
      const payload = buildPayload("evt_test_5", "charge.succeeded", {
        id: "ch_test_5",
      });
      const res = await post(payload, sign(payload, WRONG_WEBHOOK_SECRET));
      check(
        "wrong-secret signature rejected (400)",
        res.status === 400,
        res,
      );
    }

    // 6. HARDENED DEFAULT: development + no explicit dev opt-in still
    //    requires a valid signature (this is the core regression test for
    //    the chore/payment-safety-week1 fix).
    {
      process.env.NODE_ENV = "development";
      process.env.STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED = "";
      const payload = buildPayload("evt_test_6", "charge.succeeded", {
        id: "ch_test_6",
      });
      const res = await post(payload, undefined);
      check(
        "development with no dev opt-in still rejects unsigned payload",
        res.status === 400,
        res,
      );
    }

    // 7. development + explicit STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED=true
    //    accepts unsigned payloads (dev convenience preserved, opt-in).
    {
      process.env.NODE_ENV = "development";
      process.env.STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED = "true";
      const payload = buildPayload("evt_test_7", "charge.succeeded", {
        id: "ch_test_7",
      });
      const res = await post(payload, undefined);
      check(
        "development with explicit dev opt-in accepts unsigned payload",
        res.status === 200,
        res,
      );
    }

    // 8. STRIPE_WEBHOOK_FORCE_VERIFY=true overrides the dev opt-in.
    {
      process.env.NODE_ENV = "development";
      process.env.STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED = "true";
      process.env.STRIPE_WEBHOOK_FORCE_VERIFY = " TRUE ";
      const payload = buildPayload("evt_test_8", "charge.succeeded", {
        id: "ch_test_8",
      });
      const res = await post(payload, undefined);
      check(
        "FORCE_VERIFY=true (trimmed/case-insensitive) overrides dev opt-in",
        res.status === 400,
        res,
      );
      process.env.STRIPE_WEBHOOK_FORCE_VERIFY = "";
    }

    // 9. The explicit unsigned-development escape hatch still rejects
    //    malformed JSON; opting out of HMAC verification is not permission
    //    to pass an unparseable envelope into the handler.
    {
      process.env.NODE_ENV = "development";
      process.env.STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED = "true";
      const res = await post("{not-json", undefined);
      check(
        "malformed unsigned development payload rejected (400)",
        res.status === 400,
        res,
      );
    }

    // 10. A missing server-side signing secret is an operational outage,
    //     not a bad client signature. Return 503 so it is visibly
    //     distinguishable and remains retryable.
    {
      process.env.NODE_ENV = "production";
      process.env.STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED = "";
      process.env.STRIPE_WEBHOOK_SECRET = "";
      const payload = buildPayload("evt_test_10", "charge.succeeded", {
        id: "ch_test_10",
      });
      const res = await post(payload, sign(payload));
      check(
        "missing webhook secret fails closed as unavailable (503)",
        res.status === 503,
        res,
      );
      process.env.STRIPE_WEBHOOK_SECRET = FIXTURE_WEBHOOK_SECRET;
    }

    // 11. If middleware order regresses and JSON parsing runs before the
    //     route, a valid signature must still be rejected because Stripe
    //     verification requires the exact raw bytes.
    {
      const jsonParsedApp = express();
      jsonParsedApp.use(express.json());
      registerStripeWebhookRoutes(jsonParsedApp, {
        notifyHostCapacityWarning: async () => {
          capacityWarningCalls += 1;
        },
      });
      const jsonParsedServer = http.createServer(jsonParsedApp);
      await new Promise<void>((resolve) =>
        jsonParsedServer.listen(0, resolve),
      );
      const jsonParsedAddress = jsonParsedServer.address();
      if (!jsonParsedAddress || typeof jsonParsedAddress === "string") {
        throw new Error("Failed to bind JSON-parsed test server");
      }
      try {
        const payload = buildPayload("evt_test_11", "charge.succeeded", {
          id: "ch_test_11",
        });
        const res = await postTo(
          `http://127.0.0.1:${jsonParsedAddress.port}`,
          payload,
          sign(payload),
        );
        check(
          "JSON-parsed body rejected even with otherwise valid signature (400)",
          res.status === 400,
          res,
        );
      } finally {
        await new Promise<void>((resolve) =>
          jsonParsedServer.close(() => resolve()),
        );
      }
    }

    process.env.NODE_ENV = "production";
    process.env.STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED = "";

    // 12. Duplicate delivery / replay of the identical signed event -> both
    //    accepted, no crash. (Envelope-level replay safety; DB-level
    //    idempotency of the mutation branches is covered separately -- see
    //    mealscout-stripe-webhook-idempotency-guards.contract.test.ts.)
    {
      const payload = buildPayload(
        "evt_test_12_dup",
        "payment_intent.succeeded",
        { id: "pi_test_dup", amount: 500, metadata: {} },
      );
      const signature = sign(payload);
      const first = await post(payload, signature);
      const second = await post(payload, signature);
      check("first delivery accepted", first.status === 200, first);
      check(
        "replayed duplicate delivery also accepted (at-least-once safe)",
        second.status === 200,
        second,
      );
    }

    // 13. A primary processing write against an unavailable database must
    //     return 500. A 200 here would acknowledge and permanently drop a
    //     payment-state mutation instead of letting Stripe retry it.
    {
      const originalConsoleError = console.error;
      const loggedErrors: unknown[][] = [];
      console.error = (...args: unknown[]) => {
        loggedErrors.push(args);
        originalConsoleError(...args);
      };

      let res: { status: number; text: string };
      try {
        const payload = buildPayload(
          "evt_test_13_db_unreachable",
          "payment_intent.payment_failed",
          { id: "pi_test_db_unreachable", amount: 500, metadata: {} },
        );
        res = await post(payload, sign(payload));
      } finally {
        console.error = originalConsoleError;
      }

      const sawLoggedFailure = loggedErrors.some((args) =>
        args.some(
          (a) =>
            typeof a === "string" && a.includes("Error updating failed booking"),
        ),
      );
      check(
        "DB failure during payment_intent.payment_failed is logged server-side",
        sawLoggedFailure,
      );
      check(
        "DB failure returns 500 so Stripe can retry the delivery",
        res.status === 500,
        res,
      );
      check(
        "processing failure response is generic",
        JSON.parse(res.text).error === "Webhook processing failed",
        res,
      );
    }

    check(
      "host capacity warning never invoked by these DB-free fixtures (sanity check on test isolation)",
      capacityWarningCalls === 0,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log(
    `mealscout-stripe-webhook-signature-verification: PASS (${passed} checks)`,
  );
}

run().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
