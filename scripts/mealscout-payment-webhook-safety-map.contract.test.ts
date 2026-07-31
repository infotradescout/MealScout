import { existsSync, readFileSync } from "node:fs";

const mapPath = "MEALSCOUT_PAYMENT_WEBHOOK_SAFETY_MAP.md";
const cleanupMapPath = "CLEANUP_MAP.md";

const requiredFiles = [
  mapPath,
  cleanupMapPath,
  "server/routes.ts",
  "server/routes/subscriptionRoutes.ts",
  "server/routes/stripeWebhookRoutes.ts",
  "server/routes/hostRoutes.ts",
  "server/routes/bookingRoutes.ts",
  "server/routes/eventRoutes.ts",
  "server/routes/pickupOrderRoutes.ts",
  "server/routes/suppliers/paymentsRoutes.ts",
  "server/routes/suppliers/onboardingRoutes.ts",
  "server/routes/hostPayoutAdminRoutes.ts",
  "server/routes/accessPolicyDependencies.ts",
  "server/utils/supplierPaymentIntent.ts",
  "scripts/preLaunchGate.mjs",
  "scripts/productionReadinessGate.mjs",
  "scripts/testParkingPassWebhookReplay.ts",
  "scripts/auditParkingPassWebhookReconciliation.ts",
  "scripts/smokeParkingPassStripeFlow.ts",
  "scripts/testSupplierPaymentIntentFlow.ts",
  "scripts/testSupplierPayIntentMethodSwitch.ts",
  ".env.example",
  ".env.production.example",
];

for (const file of requiredFiles) {
  if (!existsSync(file)) {
    throw new Error(`C9 payment/webhook safety map missing required file: ${file}`);
  }
}

const read = (path: string) => readFileSync(path, "utf8");
const map = read(mapPath);
const cleanupMap = read(cleanupMapPath);
const routes = read("server/routes.ts");
const subscriptionRoutes = read("server/routes/subscriptionRoutes.ts");
const stripeWebhookRoutes = read("server/routes/stripeWebhookRoutes.ts");
const hostRoutes = read("server/routes/hostRoutes.ts");
const bookingRoutes = read("server/routes/bookingRoutes.ts");
const eventRoutes = read("server/routes/eventRoutes.ts");
const pickupOrderRoutes = read("server/routes/pickupOrderRoutes.ts");
const supplierPaymentRoutes = read("server/routes/suppliers/paymentsRoutes.ts");
const supplierOnboardingRoutes = read("server/routes/suppliers/onboardingRoutes.ts");
const hostPayoutAdminRoutes = read("server/routes/hostPayoutAdminRoutes.ts");
const supplierIntent = read("server/utils/supplierPaymentIntent.ts");
const preLaunchGate = read("scripts/preLaunchGate.mjs");
const productionGate = read("scripts/productionReadinessGate.mjs");
const envExample = read(".env.example");
const prodEnvExample = read(".env.production.example");

function requireIncludes(source: string, snippet: string, label = snippet) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing ${label}`);
  }
}

function requireMatch(source: string, pattern: RegExp, label: string) {
  if (!pattern.test(source)) {
    throw new Error(`Missing ${label}`);
  }
}

[
  "Profile access is a non-expiring, no-card free trial",
  "## Payment Route Entry Points",
  "## Stripe And Payment Intent Creation Routes",
  "## Booking Payment Handoff Routes",
  "## Webhook Route And Signature Behavior",
  "## Webhook Reconciliation Effects",
  "## Payment Status Mutation Paths",
  "## Admin And Staff Payment Visibility",
  "## Environment And Secret Requirements",
  "## Test And Smoke Coverage",
  "## Audit Findings And Follow-Ups",
  "C9-F1",
  "C9-F2",
  "C9-F3",
  "C9-F4",
  "C9-F5",
  "Do not introduce a recurring profile price",
  "Do not mark C10 complete from C9",
].forEach((snippet) => requireIncludes(map, snippet, `map snippet ${snippet}`));

[
  "STRIPE_SECRET_KEY",
  "VITE_STRIPE_PUBLIC_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_WEBHOOK_FORCE_VERIFY",
  "MEALSCOUT_BYPASS_STRIPE",
  "MEALSCOUT_TEST_MODE",
  "PICKUP_ORDER_MEALSCOUT_FEE_CENTS",
  "SUPPLIER_ORDER_ACH_DEFAULT_THRESHOLD_CENTS",
].forEach((snippet) => requireIncludes(map, snippet, `env snippet ${snippet}`));

[
  "## C9 - Payment/Webhook Safety Map",
  "Status: `DONE`",
  "MEALSCOUT_PAYMENT_WEBHOOK_SAFETY_MAP.md",
  "scripts/mealscout-payment-webhook-safety-map.contract.test.ts",
  "## C10 - Production Smoke Fixture Plan",
  "Status: `DONE`",
].forEach((snippet) => requireIncludes(cleanupMap, snippet, `cleanup map snippet ${snippet}`));

requireMatch(
  cleanupMap,
  /## C9 - Payment\/Webhook Safety Map[\s\S]*Status: `DONE`[\s\S]*## C10 - Production Smoke Fixture Plan[\s\S]*Status: `DONE`/,
  "C9 and C10 done",
);

[
  "registerSubscriptionRoutes(app",
  "registerStripeWebhookRoutes(app",
  "registerHostRoutes(app)",
  "registerBookingRoutes(app",
  "registerSupplierMarketplaceRoutes(app)",
  "registerHostPayoutAdminRoutes(app)",
].forEach((snippet) => requireIncludes(routes, snippet, `route registration ${snippet}`));

[
  '"/api/subscriptions/initialize"',
  '"/api/create-subscription"',
  '"/api/subscription/status"',
  '"/api/subscription/pause"',
  '"/api/subscription/cancel"',
  "subscriptionRequired: false",
  "cardRequired: false",
  "convertsToPaid: false",
  "monthlyBilling: false",
].forEach((snippet) => requireIncludes(subscriptionRoutes, snippet, `subscription route snippet ${snippet}`));

for (const retiredRecurringBehavior of [
  "stripe.subscriptions.create",
  "stripe.subscriptions.update",
  "stripe.customers.create",
  "PRICE_MONTHLY_25",
]) {
  if (subscriptionRoutes.includes(retiredRecurringBehavior)) {
    throw new Error(`Recurring profile billing remains: ${retiredRecurringBehavior}`);
  }
}

[
  'app.post("/api/stripe/webhook"',
  "stripe.webhooks.constructEvent",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_WEBHOOK_FORCE_VERIFY",
  'case "invoice.payment_succeeded"',
  'case "payment_intent.succeeded"',
  'case "payment_intent.payment_failed"',
  'case "customer.subscription.updated"',
  'case "customer.subscription.deleted"',
  'case "account.updated"',
  'case "account.application.deauthorized"',
].forEach((snippet) => requireIncludes(stripeWebhookRoutes, snippet, `webhook snippet ${snippet}`));

[
  '"/api/payments/stripe-config"',
  "stripe.accounts.create",
  "stripe.accountLinks.create",
  '"/api/hosts/stripe/status"',
  '"/api/parking-pass/:passId/book"',
  "requireIdempotencyKey",
  "distributedRateLimit",
  "MEALSCOUT_BYPASS_STRIPE",
  "stripe.paymentIntents.create",
].forEach((snippet) => requireIncludes(hostRoutes, snippet, `host payment snippet ${snippet}`));

[
  '"/api/bookings/payment-intent/:paymentIntentId"',
  '"/api/bookings/payment-intent/:paymentIntentId/cancel"',
  "stripe.paymentIntents.cancel",
].forEach((snippet) => requireIncludes(bookingRoutes, snippet, `booking route snippet ${snippet}`));

[
  '"/api/events/:eventId/book"',
  '"/api/bookings/:bookingId/confirm"',
  "stripe.paymentIntents.create",
  "intent.status !== \"succeeded\"",
].forEach((snippet) => requireIncludes(eventRoutes, snippet, `event payment snippet ${snippet}`));

[
  '"/api/pickup-orders"',
  "paymentMethod: z.enum([\"card\", \"cash\"])",
  "stripe.paymentIntents.create",
  "automatic_payment_methods",
  "stripeTransferGroupId",
  '"/api/pickup-orders/by-intent/:paymentIntentId"',
].forEach((snippet) => requireIncludes(pickupOrderRoutes, snippet, `pickup payment snippet ${snippet}`));

[
  '"/api/supplier-orders/:orderId/pay-intent"',
  "requireIdempotencyKey",
  "distributedRateLimit",
  "decideSupplierIntentHandling",
  "stripe.paymentIntents.create",
  "payment_method_types",
  "transfer_data",
].forEach((snippet) => requireIncludes(supplierPaymentRoutes, snippet, `supplier payment snippet ${snippet}`));

[
  '"/api/supplier/stripe/onboard"',
  'type: "express"',
  "stripe.accountLinks.create",
  '"/api/supplier/stripe/status"',
].forEach((snippet) => requireIncludes(supplierOnboardingRoutes, snippet, `supplier onboarding snippet ${snippet}`));

[
  '"/api/admin/host-payout-requests"',
  '"/api/admin/host-payout-requests/:requestId"',
  "stripe.transfers.create",
  "isAdmin",
].forEach((snippet) => requireIncludes(hostPayoutAdminRoutes, snippet, `host payout admin snippet ${snippet}`));

[
  "cancel_and_recreate",
  "conflict",
  "requires_payment_method",
  "requires_confirmation",
  "CANCELLABLE_STATUSES",
].forEach((snippet) => requireIncludes(supplierIntent, snippet, `supplier intent snippet ${snippet}`));

[
  "STRIPE_SECRET_KEY",
  "VITE_STRIPE_PUBLIC_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "MEALSCOUT_BYPASS_STRIPE",
  "MEALSCOUT_TEST_MODE",
].forEach((snippet) => requireIncludes(preLaunchGate, snippet, `prelaunch gate snippet ${snippet}`));

[
  "STRIPE_SECRET_KEY",
  "VITE_STRIPE_PUBLIC_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "paymentsEnabled",
].forEach((snippet) => requireIncludes(productionGate, snippet, `production gate snippet ${snippet}`));

for (const envSource of [envExample, prodEnvExample]) {
  for (const requiredPaymentEnv of [
    "STRIPE_SECRET_KEY",
    "VITE_STRIPE_PUBLIC_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]) {
    requireIncludes(envSource, requiredPaymentEnv, `payment env ${requiredPaymentEnv}`);
  }
  if (envSource.includes("PRICE_MONTHLY_25")) {
    throw new Error("Retired recurring profile price remains in an env example");
  }
}

for (const forbidden of [
  "runtime behavior changed",
  "webhook behavior changed",
  "Stripe logic changed",
  "schema changed",
  "added feature",
]) {
  if (map.toLowerCase().includes(forbidden.toLowerCase())) {
    throw new Error(`Map appears to claim forbidden scope: ${forbidden}`);
  }
}

console.log("mealscout-payment-webhook-safety-map.contract: PASS");
