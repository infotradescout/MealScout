import { existsSync, readFileSync } from "node:fs";

const files = {
  audit: "MEALSCOUT_ADMIN_ACCOUNT_RECOVERY_AUDIT.md",
  dashboard: "client/src/pages/admin-dashboard.tsx",
  adminCoreOps: "server/routes/admin/adminCoreOpsRoutes.ts",
  userAdminRoutes: "server/routes/admin/userAdminRoutes.ts",
  unifiedAuth: "server/unifiedAuth.ts",
  sanitize: "server/utils/sanitize.ts",
  login: "client/src/pages/login.tsx",
  loginRecoveryContract: "scripts/mealscout-login-recovery.contract.test.ts",
};

for (const path of Object.values(files)) {
  if (!existsSync(path)) {
    throw new Error(`Admin account recovery guard missing required file: ${path}`);
  }
}

const read = (path: string) => readFileSync(path, "utf8");
const audit = read(files.audit);
const dashboard = read(files.dashboard);
const adminCoreOps = read(files.adminCoreOps);
const userAdminRoutes = read(files.userAdminRoutes);
const unifiedAuth = read(files.unifiedAuth);
const sanitize = read(files.sanitize);
const login = read(files.login);
const loginRecoveryContract = read(files.loginRecoveryContract);

function requireIncludes(source: string, snippet: string, label = snippet) {
  if (!source.includes(snippet)) {
    throw new Error(`Missing ${label}`);
  }
}

[
  "Passwords are stored as hashes only.",
  "Admin API responses must not expose `passwordHash`",
  "ACCOUNT RECOVERY",
  "POST /api/admin/users/:id/send-password-reset",
  "POST /api/admin/users/:id/force-password-reset",
  "Admin resend verification already existed",
  "No plaintext passwords are exposed.",
  "No password hashes are exposed in admin UI or API responses.",
  "No reset tokens are exposed in admin UI or API responses.",
  "No role, Parking Pass, affiliate, payout, registration, onboarding, or payment behavior was changed.",
].forEach((snippet) => requireIncludes(audit, snippet, `audit snippet ${snippet}`));

[
  "const getSafeAuthDiagnostics = (user: any) =>",
  "hasPasswordLogin",
  "hasGoogleAuth",
  "hasFacebookAuth",
  "authProvider",
  "requiresPasswordReset",
  "const sanitized = sanitizeUsers(allUsers, { includeStripe: true });",
].forEach((snippet) => requireIncludes(adminCoreOps, snippet, `admin core safe diagnostic ${snippet}`));

const adminUsersRoute = adminCoreOps.slice(
  adminCoreOps.indexOf('"/api/admin/users"'),
  adminCoreOps.indexOf('"/api/admin/profile-quarantine/suspects"'),
);
for (const forbidden of ["passwordHash:", "resetToken:", "tokenHash:", "googleAccessToken", "facebookAccessToken"]) {
  if (adminUsersRoute.includes(forbidden)) {
    throw new Error(`Admin users response must not expose secret field: ${forbidden}`);
  }
}

[
  '"/api/admin/users/:id/send-password-reset"',
  '"/api/admin/users/:id/force-password-reset"',
  "denyStaffEdits(req, res)",
  "deleteUserResetTokens(user.id)",
  "createPasswordResetToken",
  "sendPasswordResetEmail(user, resetUrl)",
  "If the account supports password reset, a reset link has been sent.",
  "mustResetPassword: true",
  "If the account supports password login, password reset will be required on next login.",
].forEach((snippet) => requireIncludes(userAdminRoutes, snippet, `admin recovery route ${snippet}`));

const sendResetRoute = userAdminRoutes.slice(
  userAdminRoutes.indexOf('"/api/admin/users/:id/send-password-reset"'),
  userAdminRoutes.indexOf('"/api/admin/users/:id/force-password-reset"'),
);
if (!sendResetRoute.includes("resetToken") || !sendResetRoute.includes("resetUrl")) {
  throw new Error("Admin reset action must create a reset token internally and email a reset URL");
}
for (const forbiddenResponse of [
  "res.json({ resetToken",
  "res.json({ tokenHash",
  "res.json({ resetUrl",
  "passwordHash: user.passwordHash",
  "googleAccessToken",
  "facebookAccessToken",
]) {
  if (sendResetRoute.includes(forbiddenResponse)) {
    throw new Error(`Admin reset action must not expose secret response data: ${forbiddenResponse}`);
  }
}

[
  "getSafeAuthProviderLabel",
  "ACCOUNT RECOVERY",
  "account-recovery-status",
  "Auth Provider",
  "Password Login",
  "Force Reset",
  "Email Verified",
  "selectedUser.hasPasswordLogin",
  "selectedUser.requiresPasswordReset",
  "button-send-password-reset",
  "button-force-password-reset",
  "button-card-resend-verification",
  "Passwords, password hashes, reset tokens, OAuth tokens, and",
  "`/api/admin/users/${userId}/send-password-reset`",
  "`/api/admin/users/${userId}/force-password-reset`",
].forEach((snippet) => requireIncludes(dashboard, snippet, `dashboard recovery snippet ${snippet}`));

for (const forbidden of [
  "selectedUser.passwordHash",
  "selectedUser.resetToken",
  "selectedUser.tokenHash",
  "selectedUser.googleAccessToken",
  "selectedUser.facebookAccessToken",
]) {
  if (dashboard.includes(forbidden)) {
    throw new Error(`Admin dashboard must not reference secret-bearing user field: ${forbidden}`);
  }
}

[
  "passwordHash",
  "googleAccessToken",
  "facebookAccessToken",
].forEach((snippet) => requireIncludes(sanitize, snippet, `sanitize stripped field ${snippet}`));

[
  'app.post("/api/auth/forgot-password"',
  'app.get("/api/auth/reset-password/validate"',
  'app.post("/api/auth/reset-password"',
  "sendPasswordResetEmail",
  "createPasswordResetToken",
  "deleteUserResetTokens",
].forEach((snippet) => requireIncludes(unifiedAuth, snippet, `existing reset infrastructure ${snippet}`));

[
  'href="/forgot-password"',
  'data-recovery-action="navigate-only"',
  "Invalid email or password. If you cannot sign in, reset your password.",
].forEach((snippet) => requireIncludes(login, snippet, `login recovery remains visible ${snippet}`));

requireIncludes(
  loginRecoveryContract,
  "Login page must not trigger reset email flow",
  "login recovery regression guard",
);

for (const forbidden of [
  "new role",
  "business_owner",
  "parking pass booking",
  "affiliatePayout",
  "affiliateCommission",
  "fake user",
  "sample data",
]) {
  const recoveryDashboardSlice = dashboard.slice(
    dashboard.indexOf("ACCOUNT RECOVERY") - 1000,
    dashboard.indexOf("ACCOUNT ACTIVITY"),
  );
  const offenders = `${audit}\n${recoveryDashboardSlice}\n${sendResetRoute}\n${adminUsersRoute}`
    .split(/\r?\n/)
    .filter((line) => line.toLowerCase().includes(forbidden.toLowerCase()))
    .filter((line) => !/(no |not |do not|must not|without|unchanged|never)/i.test(line));
  if (offenders.length) {
    throw new Error(`Admin recovery slice appears to introduce forbidden scope: ${offenders[0]}`);
  }
}

console.log("mealscout-admin-account-recovery.contract: PASS");
