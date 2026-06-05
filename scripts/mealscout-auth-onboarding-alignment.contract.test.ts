import { readFileSync, existsSync } from "node:fs";

const auditPath = "MEALSCOUT_AUTH_ONBOARDING_ALIGNMENT_AUDIT.md";
if (!existsSync(auditPath)) {
  throw new Error("MEALSCOUT_AUTH_ONBOARDING_ALIGNMENT_AUDIT.md must exist");
}

const audit = readFileSync(auditPath, "utf8");
const accountSetup = readFileSync("client/src/pages/account-setup.tsx", "utf8");
const login = readFileSync("client/src/pages/login.tsx", "utf8");
const app = readFileSync("client/src/App.tsx", "utf8");
const useAuth = readFileSync("client/src/hooks/useAuth.ts", "utf8");
const api = readFileSync("client/src/lib/api.ts", "utf8");
const postVerification = readFileSync("client/src/pages/post-verification.tsx", "utf8");
const unifiedAuth = readFileSync("server/unifiedAuth.ts", "utf8");
const authAccountRoutes = readFileSync("server/routes/authAccountRoutes.ts", "utf8");
const restaurantSignupRoutes = readFileSync("server/routes/restaurantSignupRoutes.ts", "utf8");
const truckClaimRoutes = readFileSync("server/routes/truckClaimRoutes.ts", "utf8");
const accountSetupUtils = readFileSync("server/utils/accountSetup.ts", "utf8");
const loginContinuation = readFileSync("server/services/loginContinuation.ts", "utf8");
const adminTruth = readFileSync("MEALSCOUT_ADMIN_TRUTH_AUDIT.md", "utf8");

const requiredAuditSnippets = [
  "email/password login",
  "Google login",
  "Facebook login",
  "customer signup",
  "restaurant signup",
  "claim truck",
  "account setup invite",
  "owner verification link",
  "admin-created user",
  "mobile/capacitor web session",
  "Expected continuation route",
  "Email verification, business/profile verification, insurance verification, and claim verification are separate checks.",
  "Customer accounts do not require business attachment.",
  "Host Parking Pass management must remain free from unrelated paid business gates",
  "OAuth success query params are hints only",
  "`/api/auth/user` is the only confirmed signed-in state",
  "Protected account endpoints such as `/api/affiliate/tag` and `/api/business-access/me` must wait for confirmed auth",
  "Missing token while unauthenticated: show `Setup Link Required`",
  "Missing token while authenticated: immediately continue to the normal dashboard/continuation target",
  "Normal login must not route to `/account-setup` unless a setup token or explicit setup invite context exists.",
  "Invalid token:",
  "Expired token:",
  "Used token:",
  "`/account-setup` must not be used as an OAuth fallback or account handoff target without a `token`.",
  "must reject stored/query redirects back to `/account-setup` unless the URL includes a setup token.",
  "No roles were added.",
  "No payment, verification, claim, or permission logic was changed.",
];

const auditLower = audit.toLowerCase();
for (const snippet of requiredAuditSnippets) {
  if (!auditLower.includes(snippet.toLowerCase())) {
    throw new Error(`Missing auth onboarding audit snippet: ${snippet}`);
  }
}

const requiredAccountSetupSnippets = [
  "Validating setup link...",
  "if (!token) {",
  "Setup Link Required",
  "Go to Login",
  "Continuing to your dashboard...",
  "getNoTokenContinuationPath",
  "setLocation(\"/login\")",
  "!continuationPath.startsWith(\"/account-setup\")",
  "isAuthLoading || isAuthenticated",
  "if (isValidatingToken) {",
  "Token not found or already used",
  "Token has expired",
];

for (const snippet of requiredAccountSetupSnippets) {
  const source =
    snippet === "Token not found or already used" || snippet === "Token has expired"
      ? unifiedAuth
      : accountSetup;
  if (!source.includes(snippet)) {
    throw new Error(`Missing account setup guard snippet: ${snippet}`);
  }
}

const missingTokenIndex = accountSetup.indexOf("\n  if (!token) {", accountSetup.indexOf("Continuing to your dashboard..."));
const loadingIndex = accountSetup.indexOf("if (isValidatingToken) {");
if (missingTokenIndex === -1 || loadingIndex === -1 || missingTokenIndex > loadingIndex) {
  throw new Error("Missing setup token must resolve before validating/loading state");
}

const missingTokenSlice = accountSetup.slice(missingTokenIndex, loadingIndex);
if (
  missingTokenSlice.includes("Validating setup link...") ||
  !missingTokenSlice.includes("Setup Link Required") ||
  missingTokenSlice.includes("setLocation(\"/post-verification\")") ||
  missingTokenSlice.includes("setLocation(\"/account-setup")
) {
  throw new Error("Missing setup token must not render endless validation or route back to account setup");
}

const authenticatedNoTokenIndex = accountSetup.indexOf(
  "if (!token && (isAuthLoading || isAuthenticated))",
);
if (authenticatedNoTokenIndex === -1 || authenticatedNoTokenIndex > missingTokenIndex) {
  throw new Error("Authenticated no-token account setup must redirect before setup-link-required UI");
}
const authenticatedNoTokenSlice = accountSetup.slice(
  authenticatedNoTokenIndex,
  missingTokenIndex,
);
if (
  authenticatedNoTokenSlice.includes("Setup Link Required") ||
  authenticatedNoTokenSlice.includes("Account handoff") ||
  !authenticatedNoTokenSlice.includes("Continuing to your dashboard...") ||
  !accountSetup.includes("setLocation(getNoTokenContinuationPath(user))")
) {
  throw new Error("Authenticated no-token account setup must not render setup-link or handoff UI");
}

const noTokenContinuationIndex = accountSetup.indexOf("function getNoTokenContinuationPath");
const noTokenContinuationSlice = accountSetup.slice(
  noTokenContinuationIndex,
  accountSetup.indexOf("export default function AccountSetup"),
);
if (
  noTokenContinuationIndex === -1 ||
  !noTokenContinuationSlice.includes("!continuationPath.startsWith(\"/account-setup\")") ||
  noTokenContinuationSlice.includes("return \"/account-setup\"")
) {
  throw new Error("Authenticated no-token account setup continuation must never return /account-setup");
}

const postVerificationSafePathIndex = postVerification.indexOf("function getSafePath");
const postVerificationSafePathSlice = postVerification.slice(
  postVerificationSafePathIndex,
  postVerification.indexOf("function getStoredValue"),
);
if (
  postVerificationSafePathIndex === -1 ||
  !postVerificationSafePathSlice.includes("path === \"/account-setup\"") ||
  !postVerificationSafePathSlice.includes("path.startsWith(\"/account-setup?\")") ||
  !postVerificationSafePathSlice.includes("if (!params.get(\"token\")) return null;")
) {
  throw new Error("Account handoff must reject /account-setup redirects unless a setup token is present");
}

const oauthSnippets = [
  "/api/auth/google/customer",
  "/api/auth/google/restaurant",
  "/api/auth/facebook",
  "oauthUserType",
  "oauthRedirectPath",
  "resolveOAuthContinuationPath",
  "getOAuthRedirectPath(req) ||",
  "buildOAuthSuccessRedirect",
  "isAccountSetupPathWithoutToken",
];

for (const snippet of oauthSnippets) {
  if (!unifiedAuth.includes(snippet)) {
    throw new Error(`OAuth route/continuation inventory missing: ${snippet}`);
  }
}

const safeRedirectIndex = unifiedAuth.indexOf("const getSafeRedirectPath");
const safeRedirectSlice = unifiedAuth.slice(
  safeRedirectIndex,
  unifiedAuth.indexOf("const getOAuthRedirectPath"),
);
if (
  safeRedirectIndex === -1 ||
  !safeRedirectSlice.includes("isAccountSetupPathWithoutToken(path)") ||
  !safeRedirectSlice.includes("return null")
) {
  throw new Error("Normal OAuth/login redirects must reject /account-setup without a token");
}

const oauthContinuationIndex = unifiedAuth.indexOf("const resolveOAuthContinuationPath");
const oauthContinuationSlice = unifiedAuth.slice(
  oauthContinuationIndex,
  unifiedAuth.indexOf("const normalizeEmailForLookup"),
);
if (
  oauthContinuationIndex === -1 ||
  !oauthContinuationSlice.includes("getSafeRedirectPath(continuation.continuationPath)") ||
  oauthContinuationSlice.includes("return (\n      continuation.continuationPath")
) {
  throw new Error("OAuth continuation must sanitize /account-setup without setup token/context");
}

if (
  !useAuth.includes("isAccountSetupWithoutToken") ||
  !useAuth.includes("nextRequiredStep === \"account_onboarding\" && isAccountSetupWithoutToken") ||
  useAuth.includes("nextRequiredStep === \"account_onboarding\" ||")
) {
  throw new Error("Authenticated normal login must not be pushed to /account-setup by useAuth without token");
}

const oauthConfirmationSnippets = [
  "oauthConfirmationPending",
  "hasOAuthCompletionHint",
  "clearOAuthCompletionParams",
  "urlParams.get(\"auth\") === \"success\"",
  "refetch()",
  "if (!result.data)",
  "setAffiliateRef(null)",
  "setLocation(\"/login?error=session_not_completed\")",
  "user: oauthConfirmationPending ? undefined : user",
];

for (const snippet of oauthConfirmationSnippets) {
  if (!useAuth.includes(snippet)) {
    throw new Error(`OAuth auth-success confirmation guard missing: ${snippet}`);
  }
}

if (
  !useAuth.includes("isLoading || oauthConfirmationPending") ||
  !useAuth.includes("clearOAuthCompletionParams();") ||
  !useAuth.includes("setOauthConfirmationPending(false)")
) {
  throw new Error("OAuth auth-success must remain pending until /api/auth/user confirms or fails");
}

if (!login.includes("session_not_completed") || !login.includes("Login Session Not Completed")) {
  throw new Error("Login page must show recovery copy when OAuth session confirmation fails");
}

if (
  !api.includes("isProtectedAccountPath") ||
  !api.includes("path.startsWith(\"/api/affiliate/\")") ||
  !api.includes("path.startsWith(\"/api/business-access/\")") ||
  !api.includes("isAuthPath || isAdminPath || isProtectedAccountPath")
) {
  throw new Error("Protected affiliate/business-access calls must use same-origin routing on MealScout hosts");
}

const routeInventory = [
  [login, "client login", "buildAuthPath(\"/api/auth/google/customer\")"],
  [login, "client facebook login", "buildAuthPath(\"/api/auth/facebook?userType=customer\")"],
  [app, "account setup route", "<Route path=\"/account-setup\" component={AccountSetup} />"],
  [app, "post verification route", "<Route path=\"/post-verification\" component={PostVerification} />"],
  [postVerification, "account handoff safe redirect", "if (!params.get(\"token\")) return null;"],
  [useAuth, "oauth refresh", "OAuth redirect detected"],
  [authAccountRoutes, "auth account route continuation", "resolveUserContinuation"],
  [restaurantSignupRoutes, "restaurant signup route", "userType"],
  [truckClaimRoutes, "truck claim route", "userType: \"food_truck\""],
  [accountSetupUtils, "account setup invite token", "setupToken"],
  [loginContinuation, "login continuation path", "continuationPath"],
];

for (const [source, label, snippet] of routeInventory) {
  if (!String(source).includes(String(snippet))) {
    throw new Error(`Missing ${label} inventory snippet: ${snippet}`);
  }
}

const verificationSnippets = [
  "email verification",
  "business/profile verification",
  "insurance verification",
  "claim verification",
];

for (const snippet of verificationSnippets) {
  if (!auditLower.includes(snippet.toLowerCase())) {
    throw new Error(`Verification separation missing: ${snippet}`);
  }
}

if (
  !auditLower.includes("customer accounts do not require business attachment") &&
  !adminTruth.toLowerCase().includes("customer does not require business attachment")
) {
  throw new Error("Customer business-attachment truth must remain documented");
}

if (!audit.includes("Parking Pass management cannot be blocked by unrelated paid business onboarding gates.")) {
  throw new Error("Host Parking Pass free-management boundary must be documented");
}

const forbiddenAuditSnippets = [
  "new role",
  "new OAuth provider",
  "new payment gate",
  "new verification shortcut",
  "sample user",
  "fake user",
  "placeholder record",
];

for (const snippet of forbiddenAuditSnippets) {
  if (auditLower.includes(snippet)) {
    throw new Error(`Audit must not introduce product features or fake data: ${snippet}`);
  }
}

console.log("mealscout-auth-onboarding-alignment.contract: PASS");
