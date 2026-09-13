import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  FINANCIAL_TEST_PROMO_CODES,
  isNormalizedProduction,
  isProductionFinancialTestPromo,
  productionFinancialSafetyViolations,
} from "../shared/financialTestSafety";

assert.equal(isNormalizedProduction(" ProDucTion "), true);
for (const promoCode of FINANCIAL_TEST_PROMO_CODES) {
  assert.equal(
    isProductionFinancialTestPromo({
      nodeEnv: " ProDucTion ",
      promoCode: ` ${promoCode.toLowerCase()} `,
    }),
    true,
    `${promoCode} must be rejected in normalized production`,
  );
}

assert.deepEqual(
  productionFinancialSafetyViolations({
    nodeEnv: "production",
    mealscoutBypassStripe: " YES ",
    mealscoutTestMode: "on",
  }),
  ["MEALSCOUT_BYPASS_STRIPE", "MEALSCOUT_TEST_MODE"],
);
assert.deepEqual(
  productionFinancialSafetyViolations({
    nodeEnv: "test",
    mealscoutBypassStripe: "true",
    mealscoutTestMode: "true",
  }),
  [],
);

for (const [variable, value] of [
  ["MEALSCOUT_BYPASS_STRIPE", "true"],
  ["MEALSCOUT_TEST_MODE", "1"],
] as const) {
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", resolve("scripts/runParkingPassReadinessSuite.ts")],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: " ProDucTion ",
        MEALSCOUT_BYPASS_STRIPE: "",
        MEALSCOUT_TEST_MODE: "",
        [variable]: value,
      },
    },
  );
  const output = `${child.stdout || ""}\n${child.stderr || ""}`;
  assert.equal(child.status, 1, `${variable} must fail production readiness`);
  assert.match(output, new RegExp(variable));
  assert.doesNotMatch(
    output,
    /\[readiness\] typecheck/,
    "unsafe configuration must fail before readiness subprocesses",
  );
}

const service = readFileSync(
  "server/services/parkingPassBookingService.ts",
  "utf8",
);
const earlyGuard = service.indexOf(
  "if (bypassProvider && isNormalizedProduction(process.env.NODE_ENV))",
);
const firstDatabaseRead = service.indexOf("const [prior] = await db", earlyGuard);
assert.ok(
  earlyGuard >= 0 && firstDatabaseRead > earlyGuard,
  "canonical bypass rejection must precede its first database read",
);

const hostRoute = readFileSync("server/routes/hostRoutes.ts", "utf8");
const hostPromoGuard = hostRoute.indexOf("isProductionFinancialTestPromo({");
const hostStripeConfigCheck = hostRoute.indexOf(
  "if (!stripe && !bypassStripe)",
  hostPromoGuard,
);
assert.ok(
  hostPromoGuard >= 0 && hostStripeConfigCheck > hostPromoGuard,
  "Parking Pass test promo rejection must precede payment configuration and writes",
);

const supplierPaymentsRoute = readFileSync(
  "server/routes/suppliers/paymentsRoutes.ts",
  "utf8",
);
const supplierPromoGuard = supplierPaymentsRoute.indexOf(
  "isProductionFinancialTestPromo({",
);
const supplierPaymentRead = supplierPaymentsRoute.indexOf(
  "const [order] = await db",
);
assert.ok(
  supplierPromoGuard >= 0 && supplierPaymentRead > supplierPromoGuard,
  "supplier test promo rejection must precede database access",
);

const supplierOrdersRoute = readFileSync(
  "server/routes/suppliers/ordersRoutes.ts",
  "utf8",
);
const supplierBypassGuard = supplierOrdersRoute.indexOf(
  "isNormalizedProduction(process.env.NODE_ENV)",
);
const supplierOrderRead = supplierOrdersRoute.indexOf(
  "await storage.getRestaurant",
);
const supplierOrderWrite = supplierOrdersRoute.indexOf(
  "const created = await db.transaction",
);
assert.ok(
  supplierBypassGuard >= 0 &&
    supplierOrderRead > supplierBypassGuard &&
    supplierOrderWrite > supplierBypassGuard,
  "supplier order bypass rejection must precede database reads and writes",
);

console.log("production-financial-safety: PASS");
