import { existsSync, readFileSync } from "node:fs";

const auditPath = "MEALSCOUT_LOGIN_RECOVERY_AUDIT.md";
const appPath = "client/src/App.tsx";
const loginPath = "client/src/pages/login.tsx";
const forgotPasswordPath = "client/src/pages/forgot-password.tsx";
const resetPasswordPath = "client/src/pages/reset-password.tsx";
const changePasswordPath = "client/src/pages/change-password.tsx";
const useAuthPath = "client/src/hooks/useAuth.ts";
const unifiedAuthPath = "server/unifiedAuth.ts";
const emailServicePath = "server/emailService.ts";
const schemaPath = "shared/schema.ts";
const userSchemaPath = "shared/schema/users.ts";

for (const path of [
  auditPath,
  appPath,
  loginPath,
  forgotPasswordPath,
  resetPasswordPath,
  changePasswordPath,
  useAuthPath,
  unifiedAuthPath,
  emailServicePath,
  schemaPath,
  userSchemaPath,
]) {
  if (!existsSync(path)) {
    throw new Error(`Login recovery guard missing required file: ${path}`);
  }
}

const audit = readFileSync(auditPath, "utf8");
const app = readFileSync(appPath, "utf8");
const login = readFileSync(loginPath, "utf8");
const forgotPassword = readFileSync(forgotPasswordPath, "utf8");
const resetPassword = readFileSync(resetPasswordPath, "utf8");
const useAuth = readFileSync(useAuthPath, "utf8");
const unifiedAuth = readFileSync(unifiedAuthPath, "utf8");
const emailService = readFileSync(emailServicePath, "utf8");
const schema = readFileSync(schemaPath, "utf8");
const userSchema = readFileSync(userSchemaPath, "utf8");

const requiredAppSnippets = [
  'const ForgotPassword = lazy(() => import("@/pages/forgot-password"))',
  'const ResetPassword = lazy(() => import("@/pages/reset-password"))',
  'const ChangePassword = lazy(() => import("@/pages/change-password"))',
  '<Route path="/forgot-password" component={ForgotPassword} />',
  '<Route path="/reset-password" component={ResetPassword} />',
  '<Route path="/change-password" component={ChangePassword} />',
];
for (const snippet of requiredAppSnippets) {
  if (!app.includes(snippet)) {
    throw new Error(`App route registration missing: ${snippet}`);
  }
}

const requiredLoginSnippets = [
  'href="/forgot-password"',
  "Forgot or need to reset your password?",
  "showRecoveryHelp",
  "Having trouble signing in?",
  "Reset your password",
  "link-login-error-reset-password",
  "Invalid email or password. If you cannot sign in, reset your password.",
  "button-resend-verification",
];
for (const snippet of requiredLoginSnippets) {
  if (!login.includes(snippet)) {
    throw new Error(`Login recovery UI missing: ${snippet}`);
  }
}

if (
  !forgotPassword.includes('apiRequest("POST", "/api/auth/forgot-password"') ||
  !forgotPassword.includes("If an account with that email exists")
) {
  throw new Error("Forgot password page must use the existing generic reset request flow");
}

if (
  !resetPassword.includes("/api/auth/reset-password/validate") ||
  !resetPassword.includes('apiRequest("POST", "/api/auth/reset-password"')
) {
  throw new Error("Reset password page must use the existing reset validation and submit routes");
}

if (
  !useAuth.includes("requiresPasswordReset") ||
  !useAuth.includes('window.location.pathname !== "/change-password"') ||
  !useAuth.includes('setLocation("/change-password")')
) {
  throw new Error("Forced password reset behavior must remain documented by useAuth");
}

const forgotRouteIndex = unifiedAuth.indexOf('app.post("/api/auth/forgot-password"');
const validateRouteIndex = unifiedAuth.indexOf('app.get("/api/auth/reset-password/validate"');
const resetRouteIndex = unifiedAuth.indexOf('app.post("/api/auth/reset-password"');
if (forgotRouteIndex === -1 || validateRouteIndex === -1 || resetRouteIndex === -1) {
  throw new Error("Backend password reset routes must exist");
}

const forgotRoute = unifiedAuth.slice(forgotRouteIndex, validateRouteIndex);
const genericMessage =
  "If an account with that email exists, a password reset link has been sent.";
const genericCount = forgotRoute.split(genericMessage).length - 1;
if (genericCount < 4) {
  throw new Error("Forgot password route must return generic success for all account-existence branches");
}

if (
  !forgotRoute.includes("if (!user)") ||
  !forgotRoute.includes("if (!user.passwordHash)") ||
  !forgotRoute.includes("if (!emailService.isAvailable())") ||
  !forgotRoute.includes("crypto.randomBytes(16)") ||
  !forgotRoute.includes("crypto.randomBytes(32)") ||
  !forgotRoute.includes(".createHash(\"sha256\")") ||
  !forgotRoute.includes("Date.now() + 60 * 60 * 1000") ||
  !forgotRoute.includes("deleteUserResetTokens") ||
  !forgotRoute.includes("createPasswordResetToken") ||
  !forgotRoute.includes("sendPasswordResetEmail")
) {
  throw new Error("Forgot password route must keep secure, non-enumerating token flow");
}

const resetRoute = unifiedAuth.slice(resetRouteIndex, unifiedAuth.indexOf("// Validate account setup token"));
if (
  !resetRoute.includes("getPasswordResetTokenByTokenHash") ||
  !resetRoute.includes("resetToken.expiresAt") ||
  !resetRoute.includes("updateUserPassword") ||
  !resetRoute.includes("markPasswordResetTokenUsed")
) {
  throw new Error("Reset password route must validate expiry, update password, and mark token used");
}

if (
  !unifiedAuth.includes('app.post("/api/auth/resend-verification"') ||
  !unifiedAuth.includes("Always respond success to avoid account enumeration.")
) {
  throw new Error("Unverified account recovery must remain non-enumerating");
}

if (
  !emailService.includes("sendPasswordResetEmail") ||
  !emailService.includes("getPasswordResetTemplate") ||
  !emailService.includes("This password reset link is valid for")
) {
  throw new Error("Existing password reset email infrastructure must remain available");
}

if (!schema.includes('export * from "./schema/users"') || !userSchema.includes("passwordResetTokens")) {
  throw new Error("Shared schema must continue to expose password reset token storage");
}

const requiredAuditSnippets = [
  "Login included a `/forgot-password` link",
  "wrong-password toast",
  "Password reset requests must not reveal whether an email exists.",
  "expire after one hour",
  "Resend verification is public and non-enumerating.",
  "No role, Parking Pass, affiliate, payout, verification, pricing, or onboarding behavior was changed.",
];
for (const snippet of requiredAuditSnippets) {
  if (!audit.includes(snippet)) {
    throw new Error(`Login recovery audit missing: ${snippet}`);
  }
}

const forbiddenRuntimeSnippets = [
  "add a new role",
  "create a new role",
  "add new Parking Pass",
  "create new affiliate",
  "add payout",
  "create fake user",
  "add sample data",
  "create placeholder account",
];
for (const snippet of forbiddenRuntimeSnippets) {
  if (audit.toLowerCase().includes(snippet.toLowerCase())) {
    throw new Error(`Login recovery audit must not introduce forbidden behavior: ${snippet}`);
  }
}

console.log("mealscout-login-recovery.contract: PASS");
