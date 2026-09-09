export const FINANCIAL_TEST_PROMO_CODES = [
  "TEST1",
  "FREE100",
  "SCOUT100",
] as const;

const FINANCIAL_TEST_PROMO_SET = new Set<string>(FINANCIAL_TEST_PROMO_CODES);

export function normalizeRuntimeEnvironment(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export function isNormalizedProduction(value: unknown): boolean {
  return normalizeRuntimeEnvironment(value) === "production";
}

export function isTruthyFinancialTestFlag(value: unknown): boolean {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase(),
  );
}

export function isFinancialTestPromoCode(value: unknown): boolean {
  return FINANCIAL_TEST_PROMO_SET.has(String(value || "").trim().toUpperCase());
}

export function isProductionFinancialTestPromo(input: {
  nodeEnv: unknown;
  promoCode: unknown;
}): boolean {
  return (
    isNormalizedProduction(input.nodeEnv) &&
    isFinancialTestPromoCode(input.promoCode)
  );
}

export function productionFinancialSafetyViolations(input: {
  nodeEnv: unknown;
  mealscoutBypassStripe: unknown;
  mealscoutTestMode: unknown;
}): string[] {
  if (!isNormalizedProduction(input.nodeEnv)) return [];
  const violations: string[] = [];
  if (isTruthyFinancialTestFlag(input.mealscoutBypassStripe)) {
    violations.push("MEALSCOUT_BYPASS_STRIPE");
  }
  if (isTruthyFinancialTestFlag(input.mealscoutTestMode)) {
    violations.push("MEALSCOUT_TEST_MODE");
  }
  return violations;
}
