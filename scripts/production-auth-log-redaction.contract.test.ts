import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

const read = (relativePath: string) =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

const authAccountRoutes = read("server/routes/authAccountRoutes.ts");
const unifiedAuth = read("server/unifiedAuth.ts");
const authLogUtil = read("server/utils/authLog.ts");

assert(
  authAccountRoutes.includes('authLog("auth_user_request"'),
  "Expected authAccountRoutes to use authLog for auth user request logging",
);
assert(
  authAccountRoutes.includes('authLog("auth_user_authenticated"'),
  "Expected authAccountRoutes to use authLog for authenticated user logging",
);
assert(
  !authAccountRoutes.includes('console.log("📋 Session ID:"'),
  "Raw session ID log should not exist in authAccountRoutes",
);
assert(
  !authAccountRoutes.includes('console.log("📋 Session data:"'),
  "Raw session data log should not exist in authAccountRoutes",
);

assert(
  unifiedAuth.includes('authLog("google_customer_oauth_callback"'),
  "Expected unifiedAuth to use authLog for Google customer callback logging",
);
assert(
  unifiedAuth.includes('authLog("google_restaurant_oauth_callback"'),
  "Expected unifiedAuth to use authLog for Google restaurant callback logging",
);
assert(
  unifiedAuth.includes('authLog("facebook_oauth_callback"'),
  "Expected unifiedAuth to use authLog for Facebook callback logging",
);
assert(
  !unifiedAuth.includes("query: req.query"),
  "Raw OAuth query payload should not be logged in unifiedAuth",
);

assert(
  authLogUtil.includes("sanitizeForProduction"),
  "Expected production auth log sanitizer to exist",
);
assert(
  authLogUtil.includes("normalizedKey.includes(\"session\")"),
  "Expected session fields to be redacted in production auth logs",
);
assert(
  authLogUtil.includes("normalizedKey.includes(\"email\")"),
  "Expected email fields to be redacted in production auth logs",
);

console.log("production-auth-log-redaction.contract: PASS");

