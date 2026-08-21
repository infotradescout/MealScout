import { readFileSync } from "node:fs";

const importRoutes = readFileSync(
  "server/routes/admin/truckImportAdminRoutes.ts",
  "utf8",
);
const accountSetupUtil = readFileSync("server/utils/accountSetup.ts", "utf8");
const safeInternalPath = readFileSync("shared/safeInternalPath.ts", "utf8");
const authRoutes = readFileSync("server/unifiedAuth.ts", "utf8");
const accountSetupCompletion = readFileSync(
  "server/services/accountSetupCompletion.ts",
  "utf8",
);
const authTokensRepo = readFileSync(
  "server/storage/authTokensRepository.ts",
  "utf8",
);
const appRouter = readFileSync("client/src/App.tsx", "utf8");

const requiredImportSnippets = [
  "storage.getUserByEmail(email)",
  "storage.createUserInvite({",
  "value.length > 0",
  "sendAccountSetupInvite({",
  'setupPath: "/owner/verify"',
  "recordListingInviteEvidence",
  "ownerVerificationInvite",
  "invitedUserId",
  "emailSent",
];

for (const snippet of requiredImportSnippets) {
  if (!importRoutes.includes(snippet)) {
    throw new Error(
      `Import owner verification flow missing required snippet: ${snippet}`,
    );
  }
}

const requiredAccountSetupSnippets = ["setupPath", "buildSafeAccountSetupPath"];
for (const snippet of requiredAccountSetupSnippets) {
  if (!accountSetupUtil.includes(snippet)) {
    throw new Error(`Account setup invite missing snippet: ${snippet}`);
  }
}

for (const snippet of ["safeSetupPath", "normalizeSafeInternalPath"]) {
  if (!safeInternalPath.includes(snippet)) {
    throw new Error(`Shared account setup path safety missing snippet: ${snippet}`);
  }
}

const requiredAuthSnippets = [
  "/api/auth/complete-setup",
  "completeAccountSetupTransaction",
  "ACCOUNT_SETUP_ALREADY_COMPLETED_CODE",
];
for (const snippet of requiredAuthSnippets) {
  if (!authRoutes.includes(snippet)) {
    throw new Error(`Owner verify completion missing snippet: ${snippet}`);
  }
}

for (const snippet of [
  "db.transaction",
  "for update",
  "isNull(users.passwordHash)",
  ".delete(accountSetupTokens)",
  "emailVerified: true",
]) {
  if (!accountSetupCompletion.includes(snippet)) {
    throw new Error(`Atomic owner setup completion missing snippet: ${snippet}`);
  }
}

const requiredTokenSafetySnippets = [
  "getAccountSetupTokenByTokenHash",
  "gte(accountSetupTokens.expiresAt, new Date())",
  "isNull(accountSetupTokens.usedAt)",
  "deleteAccountSetupToken",
];
for (const snippet of requiredTokenSafetySnippets) {
  if (!authTokensRepo.includes(snippet)) {
    throw new Error(`Token safety requirement missing snippet: ${snippet}`);
  }
}

if (!appRouter.includes('path="/owner/verify"')) {
  throw new Error("Owner verify page route is missing in client router.");
}

console.log("import-owner-verification.contract: PASS");
