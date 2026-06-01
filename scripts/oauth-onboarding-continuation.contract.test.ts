import { readFileSync } from "node:fs";

const unifiedAuth = readFileSync("server/unifiedAuth.ts", "utf8");
const loginContinuation = readFileSync("server/services/loginContinuation.ts", "utf8");

const requiredUnifiedAuthSnippets = [
  "resolveOAuthContinuationPath",
  "resolveUserContinuation",
  "getBusinessAccessContext",
  "getOAuthRedirectPath(req) || (await resolveOAuthContinuationPath(user))",
  "normalized === \"bar_owner\"",
  "normalized === \"caterer\"",
  "normalized === \"private_chef\"",
];

const requiredLoginContinuationSnippets = [
  "resolveUserContinuation",
  "continuationPath",
  "business_setup",
];

for (const snippet of requiredUnifiedAuthSnippets) {
  if (!unifiedAuth.includes(snippet)) {
    throw new Error(`Missing OAuth continuation snippet: ${snippet}`);
  }
}

for (const snippet of requiredLoginContinuationSnippets) {
  if (!loginContinuation.includes(snippet)) {
    throw new Error(`Missing login continuation snippet: ${snippet}`);
  }
}

if (!unifiedAuth.includes("getOAuthRedirectPath(req) || fallbackRedirectPath")) {
  throw new Error("Facebook callback must preserve redirect override before fallback.");
}

console.log("oauth-onboarding-continuation.contract: PASS");
