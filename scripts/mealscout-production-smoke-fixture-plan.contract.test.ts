import { existsSync, readFileSync } from "node:fs";

const requiredFiles = [
  "MEALSCOUT_PRODUCTION_SMOKE_FIXTURE_PLAN.md",
  "MEALSCOUT_PAYMENT_WEBHOOK_SAFETY_MAP.md",
  "MEALSCOUT_PUBLIC_AUTH_ROUTE_BOUNDARY_AUDIT.md",
  "CLEANUP_MAP.md",
  "scripts/productionReadinessGate.mjs",
  "scripts/preLaunchGate.mjs",
  "scripts/smokeParkingPassStripeFlow.ts",
  "scripts/testParkingPassWebhookReplay.ts",
  "scripts/testAdminManualProvisioning.ts",
  "server/emailService.ts",
  "server/smsService.ts",
  "server/routes/stripeWebhookRoutes.ts",
  "server/routes/hostRoutes.ts",
  "server/routes/bookingRoutes.ts",
  "server/utils/publicBusinessVisibility.ts",
];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    throw new Error(`C10 production smoke fixture plan missing required file: ${file}`);
  }
}

const read = (path: string) => readFileSync(path, "utf8");

const plan = read("MEALSCOUT_PRODUCTION_SMOKE_FIXTURE_PLAN.md");
const cleanupMap = read("CLEANUP_MAP.md");
const productionGate = read("scripts/productionReadinessGate.mjs");
const preLaunchGate = read("scripts/preLaunchGate.mjs");
const parkingPassSmoke = read("scripts/smokeParkingPassStripeFlow.ts");
const webhookReplay = read("scripts/testParkingPassWebhookReplay.ts");
const adminSmoke = read("scripts/testAdminManualProvisioning.ts");
const emailService = read("server/emailService.ts");
const smsService = read("server/smsService.ts");
const stripeWebhookRoutes = read("server/routes/stripeWebhookRoutes.ts");
const hostRoutes = read("server/routes/hostRoutes.ts");
const bookingRoutes = read("server/routes/bookingRoutes.ts");
const publicBusinessVisibility = read("server/utils/publicBusinessVisibility.ts");

function requireIncludes(source: string, snippet: string, label: string) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing C10 fixture-plan snippet (${label}): ${snippet}`);
  }
}

function requireMatch(source: string, pattern: RegExp, label: string) {
  if (!pattern.test(source)) {
    throw new Error(`Missing C10 fixture-plan pattern: ${label}`);
  }
}

[
  "# MealScout Production Smoke Fixture Plan",
  "Muted Notification Isolation Boundary",
  "Payment Transaction No-Op Enclosure",
  "Idempotent Reset Blueprint",
  "## Customer Smoke",
  "## Owner/Business Smoke",
  "## Admin/Staff/Superadmin Smoke",
  "## Env Vars/Secrets",
  "## Evidence Artifacts",
  "## Cleanup/Reset Expectations",
  "C10-F1",
  "C10-F2",
  "C10-F3",
  "No queued cleanup items remain",
].forEach((snippet) => requireIncludes(plan, snippet, `plan section ${snippet}`));

[
  "Docs/contracts only",
  "does not create users",
  "does not create users, businesses, bookings, payments, webhooks, secrets, telemetry, or runtime feature flags",
  "No authenticated production smoke may dispatch external notifications",
  "Smoke accounts must use smoke-only email addresses",
  "Production smoke must not create real charges",
  "withdrawable balances",
  "payouts",
  "transfers",
  "live Stripe mode",
  "Reset must support dry-run mode",
  "Reset must select only rows with durable smoke markers",
  "Evidence must not include session cookies",
].forEach((snippet) => requireIncludes(plan, snippet, `safety language ${snippet}`));

[
  "scripts/productionReadinessGate.mjs",
  "scripts/preLaunchGate.mjs",
  "scripts/smokeParkingPassStripeFlow.ts",
  "scripts/testParkingPassWebhookReplay.ts",
  "scripts/testAdminManualProvisioning.ts",
  "server/utils/publicBusinessVisibility.ts",
].forEach((snippet) => requireIncludes(plan, snippet, `source inventory ${snippet}`));

requireMatch(cleanupMap, /## C8 - Public\/Auth Route Boundary Audit[\s\S]*?Status: `DONE`/, "C8 DONE");
requireMatch(cleanupMap, /## C9 - Payment\/Webhook Safety Map[\s\S]*?Status: `DONE`/, "C9 DONE");
requireMatch(cleanupMap, /## C10 - Production Smoke Fixture Plan[\s\S]*?Status: `DONE`/, "C10 DONE");
requireIncludes(cleanupMap, "MEALSCOUT_PRODUCTION_SMOKE_FIXTURE_PLAN.md", "C10 artifact in cleanup map");
requireIncludes(cleanupMap, "scripts/mealscout-production-smoke-fixture-plan.contract.test.ts", "C10 contract in cleanup map");
requireIncludes(cleanupMap, "No queued cleanup items remain", "C10 handoff queue close");

if (/Status: `(QUEUED|NEXT)`/.test(cleanupMap)) {
  throw new Error("C10 cleanup map must not leave queued cleanup items after C10 completion.");
}

[
  "live probe is read-only",
  "mutableMethods",
  "SKIP_LIVE_PROBES",
  "STRIPE_WEBHOOK_SECRET",
  "BREVO_API_KEY",
].forEach((snippet) => requireIncludes(productionGate, snippet, `production gate ${snippet}`));

[
  "MEALSCOUT_BYPASS_STRIPE",
  "MEALSCOUT_TEST_MODE",
  "Stripe Webhook Events",
  "/api/stripe/webhook",
].forEach((snippet) => requireIncludes(preLaunchGate, snippet, `prelaunch gate ${snippet}`));

[
  "TEST_PARKING_PASS_ID",
  "TEST_TRUCK_ID",
  "TEST_TRUCK_AUTH_COOKIE",
  "/api/parking-pass/",
  "/api/bookings/payment-intent/",
  "CANCEL_PENDING_AFTER_CHECK",
].forEach((snippet) => requireIncludes(parkingPassSmoke, snippet, `parking smoke ${snippet}`));

[
  "STRIPE_WEBHOOK_SECRET",
  "stripe.webhooks.generateTestHeaderString",
  "/api/stripe/webhook",
  "payment_intent.succeeded",
].forEach((snippet) => requireIncludes(webhookReplay, snippet, `webhook replay ${snippet}`));

[
  "ADMIN_SMOKE_EMAIL",
  "ADMIN_SMOKE_PASSWORD",
  "/api/admin/users/create",
  "smoke-host-created",
].forEach((snippet) => requireIncludes(adminSmoke, snippet, `admin smoke ${snippet}`));

[
  "EMAIL_NOTIFICATIONS_MODE",
  "sendTransacEmail",
  "sendBasicEmail",
  "sendBookingConfirmationEmail",
  "sendHostBookingNotification",
].forEach((snippet) => requireIncludes(emailService, snippet, `email surface ${snippet}`));

["BREVO_API_KEY", "sendTransacSms", "BREVO_SMS_SENDER"].forEach((snippet) =>
  requireIncludes(smsService, snippet, `sms surface ${snippet}`),
);

[
  'app.post("/api/stripe/webhook"',
  "stripe.webhooks.constructEvent",
  "invoice.payment_succeeded",
  "payment_intent.succeeded",
  "sendBookingConfirmationEmail",
].forEach((snippet) => requireIncludes(stripeWebhookRoutes, snippet, `webhook route ${snippet}`));

if (emailService.includes("sendPaymentConfirmation")) {
  throw new Error("Retired recurring-profile payment email still exists");
}

[
  '"/api/parking-pass/:passId/book"',
  "MEALSCOUT_BYPASS_STRIPE",
  "MEALSCOUT_TEST_MODE",
  "stripe.paymentIntents.create",
  "status: \"pending\"",
].forEach((snippet) => requireIncludes(hostRoutes, snippet, `host payment path ${snippet}`));

[
  '"/api/bookings/payment-intent/:paymentIntentId"',
  '"/api/bookings/payment-intent/:paymentIntentId/cancel"',
  "stripe.paymentIntents.cancel",
  "status: \"cancelled\"",
].forEach((snippet) => requireIncludes(bookingRoutes, snippet, `booking cancel path ${snippet}`));

[
  "PUBLIC_TEST_BUSINESS_TOKENS",
  "isLikelyTestBusiness",
  "isPublicBusinessVisible",
].forEach((snippet) =>
  requireIncludes(publicBusinessVisibility, snippet, `public visibility ${snippet}`),
);

console.log("mealscout-production-smoke-fixture-plan.contract: PASS");
