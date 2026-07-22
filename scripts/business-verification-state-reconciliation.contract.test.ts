import { readFileSync } from "node:fs";

const helper = readFileSync("server/services/businessVerificationState.ts", "utf8");
const continuation = readFileSync("server/services/loginContinuation.ts", "utf8");
const restaurantOps = readFileSync("server/routes/restaurantOperationsRoutes.ts", "utf8");
const ownerDashboard = readFileSync("client/src/pages/restaurant-owner-dashboard.tsx", "utf8");

const helperSnippets = [
  "export function getBusinessVerificationState(",
  "isVerifiedForSetup",
  "isVerifiedForDiscovery",
  "verificationLabel",
  "blockingReasons",
  "setupWarnings",
  "isAdminUploadDraft",
  "isImportDraft",
  "hasEmailOrAdminVerification",
  "hasInsurance",
];
for (const snippet of helperSnippets) {
  if (!helper.includes(snippet)) {
    throw new Error(`Missing canonical verification helper snippet: ${snippet}`);
  }
}

const continuationSnippets = [
  "import { getBusinessVerificationState } from \"./businessVerificationState\";",
  "verificationState = getBusinessVerificationState({",
  "verificationRequired = !verificationState.isVerifiedForSetup;",
];
for (const snippet of continuationSnippets) {
  if (!continuation.includes(snippet)) {
    throw new Error(`Missing login continuation reconciliation snippet: ${snippet}`);
  }
}

const routeSnippets = [
  "verificationState: getBusinessVerificationState({",
  "emailVerified: req.user?.emailVerified === true",
  "businessInsuranceSubmitted",
  "claimedFromImportId: restaurant.claimedFromImportId",
];
for (const snippet of routeSnippets) {
  if (!restaurantOps.includes(snippet)) {
    throw new Error(`Missing my-restaurants verification state snippet: ${snippet}`);
  }
}

for (const snippet of [
  ".verificationState",
  "verificationState?.verificationLabel",
  'data-testid="business-verification-information"',
  "does not affect the four profile-completion",
]) {
  if (!ownerDashboard.includes(snippet)) {
    throw new Error(
      `Owner dashboard must show canonical verification outside completion scoring: ${snippet}`,
    );
  }
}

console.log("business-verification-state-reconciliation.contract: PASS");
