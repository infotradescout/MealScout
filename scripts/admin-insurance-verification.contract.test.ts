import { readFileSync } from "node:fs";

const dashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const userAdminRoutes = readFileSync("server/routes/admin/userAdminRoutes.ts", "utf8");
const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const verificationRoutes = readFileSync(
  "server/routes/admin/verificationRoutes.ts",
  "utf8",
);
const schema = readFileSync("shared/schema/legacy.ts", "utf8");
const migration = readFileSync(
  "migrations/105_restaurant_insurance_verification_expiry.sql",
  "utf8",
);
const verificationState = readFileSync(
  "server/services/businessVerificationState.ts",
  "utf8",
);

[
  '"/api/admin/users/:id/verify-insurance"',
  "insuranceVerified: true",
  "insuranceVerifiedAt: now",
  "insuranceExpiresAt: expiresAt",
  "insuranceVerifiedByUserId: req.user?.id || null",
  "365 * 24 * 60 * 60 * 1000",
].forEach((snippet) => {
  if (!userAdminRoutes.includes(snippet)) {
    throw new Error(`Missing admin insurance verify route snippet: ${snippet}`);
  }
});

[
  "insuranceVerified: restaurants.insuranceVerified",
  "insuranceVerifiedAt: restaurants.insuranceVerifiedAt",
  "insuranceExpiresAt: restaurants.insuranceExpiresAt",
].forEach((snippet) => {
  if (!adminCoreOpsRoutes.includes(snippet)) {
    throw new Error(`Missing admin users insurance payload snippet: ${snippet}`);
  }
});

[
  "const verifyUserInsurance = useMutation",
  "verify-insurance",
  "data-testid={`button-verify-insurance-${user.id}`}",
  "Verify Insurance",
  "Auto insurance verification is valid for 365 days.",
].forEach((snippet) => {
  if (!dashboard.includes(snippet)) {
    throw new Error(`Missing admin insurance UI snippet: ${snippet}`);
  }
});

[
  'insuranceVerified: boolean("insurance_verified").default(false)',
  'insuranceVerifiedAt: timestamp("insurance_verified_at")',
  'insuranceExpiresAt: timestamp("insurance_expires_at")',
  'insuranceVerifiedByUserId: varchar("insurance_verified_by_user_id")',
].forEach((snippet) => {
  if (!schema.includes(snippet)) {
    throw new Error(`Missing restaurant insurance schema snippet: ${snippet}`);
  }
});

[
  "ADD COLUMN IF NOT EXISTS insurance_verified",
  "ADD COLUMN IF NOT EXISTS insurance_verified_at",
  "ADD COLUMN IF NOT EXISTS insurance_expires_at",
  "ADD COLUMN IF NOT EXISTS insurance_verified_by_user_id",
].forEach((snippet) => {
  if (!migration.includes(snippet)) {
    throw new Error(`Missing insurance migration snippet: ${snippet}`);
  }
});

[
  "insuranceExpiresAt?: Date | string | null",
  "const insuranceNotExpired",
  "isFutureDate(input.insuranceExpiresAt)",
  "const hasInsurance = input.insuranceVerified === true && insuranceNotExpired",
].forEach((snippet) => {
  if (!verificationState.includes(snippet)) {
    throw new Error(`Missing 365-day insurance expiry helper snippet: ${snippet}`);
  }
});

const hasInsuranceLine = verificationState
  .split(/\r?\n/)
  .find((line) => line.includes("const hasInsurance")) || "";
if (hasInsuranceLine.includes("input.isVerified")) {
  throw new Error("Business verification must not bypass insurance expiry.");
}

[
  "insuranceVerified: true",
  "insuranceVerifiedAt: now",
  "insuranceExpiresAt",
  "insuranceVerifiedByUserId: user.id",
  "365 * 24 * 60 * 60 * 1000",
].forEach((snippet) => {
  if (!verificationRoutes.includes(snippet)) {
    throw new Error(`Verification approval must set insurance expiry: ${snippet}`);
  }
});

console.log("admin-insurance-verification.contract: PASS");
