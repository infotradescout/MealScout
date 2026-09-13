import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

// Execute the actual registered route with an in-memory conditional-update
// adapter. No database or Stripe connection is opened by this test.
const source = readFileSync(new URL("../server/routes/restaurantPaymentRoutes.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const nativeRequire = createRequire(import.meta.url);

async function refresh(account: Record<string, unknown>, mutate?: (row: any) => void) {
  const row: any = {
    id: "restaurant", ownerId: "owner-a", stripeConnectAccountId: "acct-a",
    stripeConnectGeneration: 3, stripeConnectStatus: "pending",
    stripeChargesEnabled: false, stripePayoutsEnabled: false,
    stripeOnboardingCompleted: false,
  };
  const table = new Proxy({}, { get: (_, name) => String(name) });
  let writes = 0;
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ ...row }] }) }) }),
    update: () => ({ set: (values: any) => ({ where: (matches: any) => ({
      returning: async () => {
        if (!matches(row)) return [];
        Object.assign(row, values);
        writes++;
        return [{ id: row.id }];
      },
    }) }) }),
  };
  const noop = () => {};
  const dependencies: Record<string, any> = {
    "drizzle-orm": {
      eq: (column: string, expected: unknown) => (current: any) => current[column] === expected,
      and: (...predicates: any[]) => (current: any) => predicates.every((predicate) => predicate(current)),
      desc: noop,
    },
    "@shared/schema": { restaurants: table, users: table, orderingReviewRequests: table },
    "../db": { db },
    "../middleware/distributedRateLimit": { distributedRateLimit: () => noop },
    "../businessFinancialAccess": { canManageBusinessFinancials: async () => true },
    "../unifiedAuth": { isAuthenticated: noop, isStaffOrAdmin: noop },
    "../roleAccess": { isAdminUserType: () => false, isInternalTeamUserType: () => false },
    "../utils/restaurantConnectOnboarding": {},
    "./menuRoutes": {},
  };
  const loaded = { exports: {} as any };
  new Function("require", "module", "exports", compiled)(
    (id: string) => dependencies[id] ?? nativeRequire(id), loaded, loaded.exports,
  );
  let handler: any;
  loaded.exports.registerRestaurantPaymentRoutes({
    get: noop,
    post: (path: string, ...handlers: any[]) => {
      if (path.endsWith("/stripe/status")) handler = handlers.at(-1);
    },
  }, { stripe: { accounts: { retrieve: async () => { mutate?.(row); return account; } } } });
  let status = 200;
  let body: any;
  const response = { status: (value: number) => { status = value; return response; }, json: (value: any) => { body = value; } };
  await handler({ params: { restaurantId: row.id }, user: { id: "owner-a" } }, response);
  return { row, writes, status, body };
}

for (const account of [
  { id: "acct-a", deleted: true },
  { id: "acct-a", charges_enabled: true, payouts_enabled: true, details_submitted: true },
]) {
  const kind = "deleted" in account ? "deleted" : "active";
  for (const [name, mutation] of Object.entries({
    replacement: (row: any) => { row.stripeConnectAccountId = "acct-b"; },
    transfer: (row: any) => { row.ownerId = "owner-b"; },
    generation: (row: any) => { row.stripeConnectGeneration++; },
  })) {
    test(`${kind} response cannot overwrite a concurrent ${name}`, async () => {
      const result = await refresh(account, mutation);
      assert.equal(result.status, 409);
      assert.equal(result.body.code, "STRIPE_CONNECT_STATUS_STALE");
      assert.equal(result.writes, 0);
      assert.equal(result.row.stripeConnectStatus, "pending");
      assert.equal(result.row.stripeChargesEnabled, false);
      if (name === "replacement") assert.equal(result.row.stripeConnectAccountId, "acct-b");
    });
  }
  test(`${kind} response updates an unchanged Connect lifecycle`, async () => {
    const result = await refresh(account);
    assert.equal(result.status, 200);
    assert.equal(result.writes, 1);
    assert.equal(result.row.stripeConnectStatus, kind === "deleted" ? "revoked" : "active");
    assert.equal(result.row.stripeConnectAccountId, kind === "deleted" ? null : "acct-a");
  });
}
