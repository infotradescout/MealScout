import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("client/src/pages/subscribe.tsx", "utf8");
const routes = readFileSync("server/routes/subscriptionRoutes.ts", "utf8");
const policy = readFileSync("shared/profileAccessPolicy.ts", "utf8");

for (const snippet of [
  "<BackHeader",
  'title="Profile access"',
  'params.get("restaurantId")',
  "The profile is the product.",
  "Free trial active",
  "No expiration",
  "No card required",
  "No monthly bill",
  "An order, delivery, booking, or other paid transaction",
]) {
  assert.ok(page.includes(snippet), `Profile-access workspace missing: ${snippet}`);
}

for (const retiredClientSurface of [
  "PaymentElement",
  "Elements",
  'queryKey: ["/api/subscription/status"]',
  'apiRequest("POST", "/api/create-subscription"',
  "BusinessWorkspaceShell",
  "Plan &amp; billing",
  "PaymentBrowserGate",
  "promoCode",
  "applyCreditsCents",
]) {
  assert.ok(
    !page.includes(retiredClientSurface),
    `Retired monthly-billing surface remains: ${retiredClientSurface}`,
  );
}

for (const compatibilityRoute of [
  '"/api/subscriptions/initialize"',
  '"/api/create-subscription"',
  '"/api/subscription/status"',
  '"/api/subscription/cancel"',
]) {
  assert.ok(
    routes.includes(compatibilityRoute),
    `Missing legacy-client compatibility route: ${compatibilityRoute}`,
  );
}

for (const routePromise of [
  "hasAccess: true",
  "trialEndsAt: null",
  "subscriptionRequired: false",
  "cardRequired: false",
  "convertsToPaid: false",
  "monthlyBilling: false",
]) {
  assert.ok(routes.includes(routePromise), `Access response missing: ${routePromise}`);
}

for (const forbiddenServerBehavior of [
  "stripe.subscriptions.create",
  "stripe.subscriptions.update",
  "PRICE_MONTHLY_25",
  "cancel_at_period_end",
]) {
  assert.ok(
    !routes.includes(forbiddenServerBehavior),
    `Recurring billing behavior remains: ${forbiddenServerBehavior}`,
  );
}

for (const policyPromise of [
  'label: "Free trial"',
  "expires: false",
  "cardRequired: false",
  "convertsToPaid: false",
  "monthlySubscriptionEnabled: false",
]) {
  assert.ok(policy.includes(policyPromise), `Canonical policy missing: ${policyPromise}`);
}

console.log("mealscout-business-profile-access-workspace.contract: PASS");
