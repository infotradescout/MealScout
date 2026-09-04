import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

const routes = read("server/routes.ts");
const server = read("server/index.ts");
const auth = read("server/unifiedAuth.ts");
const storage = read("server/storage/usersRepository.ts");
const schema = read("shared/schema/legacy.ts");
const packageJson = JSON.parse(read("package.json"));

assert.match(routes, /await setupUnifiedAuth\(app\)/);
assert.equal((routes.match(/await setupUnifiedAuth\(app\)/g) || []).length, 1);
assert.match(server, /app\.use\(getSession\(\)\)/);

for (const retiredPath of [
  "server/facebookAuth.ts",
  "server/restaurantAuth.ts",
  "client/src/MealScoutApp.tsx",
  "TRADEDESCOUT_SSO.md",
  "vite.lib.config.ts",
]) {
  assert.equal(existsSync(path.join(root, retiredPath)), false, retiredPath);
}

for (const retiredClaim of [
  "/api/auth/tradescout/sso",
  "TRADESCOUT_JWT_SECRET",
  "TradeScoutUserData",
  "performMealScoutSSO",
]) {
  assert.equal(auth.includes(retiredClaim), false, retiredClaim);
  assert.equal(storage.includes(retiredClaim), false, retiredClaim);
}

assert.doesNotMatch(storage, /authType:\s*[^\n]*tradescout/);
assert.match(schema, /Legacy dormant cross-product link/);
assert.match(schema, /tradescoutId: varchar\("tradescout_id"\)\.unique\(\)/);

assert.equal(packageJson.scripts?.["build:lib"], undefined);
assert.equal(packageJson.main, undefined);
assert.equal(packageJson.module, undefined);
assert.equal(packageJson.exports, undefined);

console.log("MealScout canonical auth owner contract passed");
