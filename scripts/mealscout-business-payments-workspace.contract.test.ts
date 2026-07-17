import { readFileSync } from "node:fs";

const page = readFileSync("client/src/pages/subscribe.tsx", "utf8");
const routes = readFileSync("server/routes/subscriptionRoutes.ts", "utf8");
const accessPolicy = readFileSync(
  "server/routes/accessPolicyDependencies.ts",
  "utf8",
);

for (const snippet of [
  "<BusinessWorkspaceShell",
  'activeModule="payments"',
  'queryParams.get("restaurantId")',
  'queryKey: ["/api/restaurants/my-restaurants"]',
  "onBusinessChange={handleBusinessChange}",
  "selectedBusinessReturnPath",
  'stripeReturnParams.set("restaurantId", requestedRestaurantId)',
  "Plan &amp; billing",
  "This plan belongs to your MealScout business account",
  "PaymentBrowserGate",
  '"/api/subscriptions/initialize"',
  '"/api/create-subscription"',
  'queryKey: ["/api/subscription/status"]',
  'queryKey: ["/api/payout/balance"]',
  '"/api/subscription/cancel"',
  '"/api/business/premium-weekly-summary"',
  "isPaidActive && !subscriptionStatus.cancelAtPeriodEnd",
  'const hasExistingPlan = currentPlanStatus !== "none"',
  "Checkout is disabled so a second subscription cannot be created by mistake.",
  "No plan or payment change can be made here.",
]) {
  if (!page.includes(snippet)) {
    throw new Error(`Business payments workspace contract missing: ${snippet}`);
  }
}

for (const safeNextGuard of [
  'if (!raw.startsWith("/")) return null',
  'if (raw.startsWith("//")) return null',
  'if (raw.includes("://")) return null',
]) {
  if (!page.includes(safeNextGuard)) {
    throw new Error(`Subscription return-path guard missing: ${safeNextGuard}`);
  }
}

for (const staleOrUnsafeSurface of [
  "join before April 1, 2026",
  "Billing History",
  "Manage Plan & Promo",
  "button-change-plan",
  "You can switch plans",
  "Back to Home",
]) {
  if (page.includes(staleOrUnsafeSurface)) {
    throw new Error(
      `Stale or unsafe payment surface remains: ${staleOrUnsafeSurface}`,
    );
  }
}

for (const routeSnippet of [
  '"/api/subscriptions/initialize"',
  '"/api/create-subscription"',
  '"/api/subscription/status"',
  '"/api/subscription/cancel"',
  "isAuthenticated",
  "cancel_at_period_end: true",
  "applyCreditsCents",
  "promoCode",
]) {
  if (!routes.includes(routeSnippet)) {
    throw new Error(`Subscription behavior contract missing: ${routeSnippet}`);
  }
}

for (const pricingSnippet of [
  "PRICE_MONTHLY_25",
  'const label = "$25 (was $50)"',
]) {
  if (!accessPolicy.includes(pricingSnippet)) {
    throw new Error(`Server pricing contract missing: ${pricingSnippet}`);
  }
}

console.log("mealscout-business-payments-workspace.contract: PASS");
