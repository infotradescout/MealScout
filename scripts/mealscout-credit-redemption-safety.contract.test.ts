import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const dashboard = read("client/src/pages/restaurant-owner-dashboard.tsx");
const userRoutes = read("server/userRoutes.ts");
const redemptionRoutes = read("server/redemptionRoutes.ts");
const redemptionService = read("server/redemptionService.ts");
const creditService = read("server/creditService.ts");
const financialAccess = read("server/businessFinancialAccess.ts");
const actionRoutes = read("server/routes/actionRoutes.ts");
const stripeWebhookRoutes = read("server/routes/stripeWebhookRoutes.ts");

// The unfinished settlement flow must not be represented as a usable owner
// control or promise weekly Stripe payments.
for (const unsupportedSurface of [
  "RestaurantCreditRedemptionForm",
  "Accept MealScout Credits",
  "settled weekly via Stripe",
]) {
  assert.ok(
    !dashboard.includes(unsupportedSurface),
    `Unsupported credit surface remains: ${unsupportedSurface}`,
  );
}
assert.ok(!redemptionRoutes.includes("Every Sunday UTC"));
assert.ok(!redemptionRoutes.includes("awaiting weekly settlement"));

// User lookup, balance, history, summary, redemption, and dispute reads are all
// authenticated and business-financial access is owner-only (plus internal
// support roles). Collaborator permissions cannot grant payment access.
assert.match(userRoutes, /router\.get\("\/:userId\/balance", isAuthenticated/);
assert.match(userRoutes, /router\.get\("\/search", isAuthenticated/);
assert.match(userRoutes, /restaurantId: rawRestaurantId/);
assert.ok(
  (userRoutes.match(/canManageBusinessFinancials/g) || []).length >= 3,
  "User lookup and balance routes must enforce business financial access",
);
assert.match(financialAccess, /isInternalTeamUserType\(userType\)/);
assert.match(
  financialAccess,
  /storage\.verifyRestaurantOwnership\(restaurantId, userId\)/,
);
assert.ok(!financialAccess.includes("requiredPermission"));
assert.ok(
  (redemptionRoutes.match(/canManageBusinessFinancials/g) || []).length >= 6,
  "Every redemption endpoint must enforce business financial access",
);
assert.match(redemptionRoutes, /getRedemptionRestaurantId\(redemptionId\)/);

// Balance is an immutable accounting sum. Debit rows carry redeemedAt metadata
// and must not be filtered out of the available balance.
assert.match(
  creditService,
  /\.where\(eq\(creditLedger\.userId, userId\)\)/,
);
assert.ok(!creditService.includes("isNull(creditLedger.redeemedAt)"));

// A restaurant redemption is serialized per user and commits the redemption
// record and negative ledger entry in one transaction.
assert.match(redemptionService, /db\.transaction/);
assert.match(redemptionService, /pg_advisory_xact_lock/);
assert.match(redemptionService, /credit_balance:\$\{userId\}/);
assert.match(redemptionService, /tx\s*\.insert\(restaurantCreditRedemptions\)/);
assert.match(redemptionService, /tx\s*\.insert\(creditLedger\)/);
assert.match(redemptionService, /new InsufficientCreditsError/);

// The token-protected action API must use the same negative, balance-checked
// debit path instead of creating a positive "redemption" credit.
assert.match(actionRoutes, /await debitCredit\(/);
assert.match(actionRoutes, /await getUserCreditBalance\(params\.userId\)/);
assert.ok(!actionRoutes.includes("amount: params.amount"));
assert.match(creditService, /class InsufficientCreditBalanceError/);
assert.match(creditService, /class CreditDebitReferenceConflictError/);
assert.match(creditService, /pg_advisory_xact_lock/);
assert.match(creditService, /lt\(creditLedger\.amount, "0"\)/);
assert.match(creditService, /existingCents !== requestedCents/);
assert.match(creditService, /externalValueAlreadyCommitted\?: boolean/);
assert.match(
  creditService,
  /!options\.externalValueAlreadyCommitted[\s\S]*availableCents < requestedCents/,
);

// Once Stripe has granted monetary value, its exact discount must always be
// represented by an idempotent ledger debit. A concurrent spend may produce a
// negative balance, but it must never produce unrecorded free value.
assert.match(
  stripeWebhookRoutes,
  /creditAppliedCents \/ 100,[\s\S]*externalValueAlreadyCommitted: true/,
);
assert.ok(!stripeWebhookRoutes.includes("Math.min(\n                    creditAppliedCents"));

console.log("mealscout-credit-redemption-safety.contract: PASS");
