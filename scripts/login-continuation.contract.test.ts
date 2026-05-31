import { readFileSync } from "node:fs";

const authAccountRoutes = readFileSync("server/routes/authAccountRoutes.ts", "utf8");
const continuationService = readFileSync("server/services/loginContinuation.ts", "utf8");
const useAuthHook = readFileSync("client/src/hooks/useAuth.ts", "utf8");

const requiredServiceSnippets = [
  "export async function resolveUserContinuation(params: {",
  "nextRequiredStep: \"account_onboarding\"",
  "nextRequiredStep: \"business_setup\"",
  "nextRequiredStep = \"profile_visual\";",
  "nextRequiredStep = \"verification\";",
  "nextRequiredStep = \"menu\";",
  "nextRequiredStep = \"schedule\";",
  "continuationPath = \"/menu-builder\";",
];

for (const snippet of requiredServiceSnippets) {
  if (!continuationService.includes(snippet)) {
    throw new Error(`Missing continuation resolver snippet: ${snippet}`);
  }
}

const requiredAuthPayloadSnippets = [
  "const continuation = await resolveUserContinuation({",
  "accountOnboardingComplete: continuation.accountOnboardingComplete,",
  "nextRequiredStep: continuation.nextRequiredStep,",
  "continuationPath: continuation.continuationPath,",
  "continuationReason: continuation.reason,",
];

for (const snippet of requiredAuthPayloadSnippets) {
  if (!authAccountRoutes.includes(snippet)) {
    throw new Error(`Missing auth continuation payload snippet: ${snippet}`);
  }
}

const requiredClientSnippets = [
  "const continuationPath = String(user.continuationPath || \"\").trim();",
  "if (!continuationPath) return;",
  "if (window.location.pathname + window.location.search === continuationTarget) {",
  "if (isAdminUser && pathname.startsWith(\"/admin\")) return;",
  "setLocation(continuationTarget);",
];

for (const snippet of requiredClientSnippets) {
  if (!useAuthHook.includes(snippet)) {
    throw new Error(`Missing continuation redirect guard snippet: ${snippet}`);
  }
}

console.log("login-continuation.contract: PASS");
