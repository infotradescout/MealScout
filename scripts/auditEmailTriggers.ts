import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const EMAIL_TRIGGER_DOC = "docs/EMAIL_TRIGGER_INVENTORY.md";
const SERVER_DIR = "server";
const SEND_PATTERN =
  /emailService\.(sendBasicEmail|send[A-Z][A-Za-z]+Email|sendBookingConfirmationEmail|sendHostBookingNotification|sendInterestNotification|sendInterestStatusUpdate|sendSeriesCancellationNotification|sendVacPendingDigest)|notifyUser\(/g;

const baseline: Record<string, number> = {
  "server/bootstrap/registerSchedulers.ts": 2,
  "server/dinerDigestService.ts": 1,
  "server/emailNotifications.ts": 5,
  "server/eventNotificationCron.ts": 1,
  "server/incidentManager.ts": 1,
  "server/mapEndpointWatchdog.ts": 1,
  "server/onboardingDripService.ts": 2,
  "server/productNotifications.ts": 2,
  "server/restaurantActivationService.ts": 1,
  "server/routes/admin/adminCoreOpsRoutes.ts": 1,
  "server/routes/admin/userAdminRoutes.ts": 2,
  "server/routes/admin/verificationRoutes.ts": 4,
  "server/routes/adminManagementRoutes.ts": 1,
  "server/routes/bookingRoutes.ts": 1,
  "server/routes/dealRouteDependencies.ts": 3,
  "server/routes/eventRoutes.ts": 2,
  "server/routes/hostInterestRoutes.ts": 1,
  "server/routes/hosts/eventsRoutes.ts": 1,
  "server/routes/locationDemandRoutes.ts": 1,
  "server/routes/notificationRoutes.ts": 2,
  "server/routes/openCallSeriesRoutes.ts": 2,
  "server/routes/restaurantCoreRoutes.ts": 1,
  "server/routes/restaurantOperationsRoutes.ts": 1,
  "server/routes/restaurantSignupRoutes.ts": 1,
  "server/routes/stripeWebhookRoutes.ts": 5,
  "server/routes/supportRoutes.ts": 2,
  "server/routes/supplierMarketplaceRoutes.ts": 1,
  "server/routes/suppliers/requestsRoutes.ts": 3,
  "server/routes/truckClaimRoutes.ts": 1,
  "server/services/hostPartnerLeadDrip.ts": 1,
  "server/services/hostPartnerLeadMagnet.ts": 1,
  "server/services/locationDemandActivation.ts": 1,
  "server/services/pensacolaFoodTruckDrip.ts": 1,
  "server/services/pensacolaReportDrip.ts": 1,
  "server/services/pensacolaReportLeadMagnet.ts": 1,
  "server/truckEventMatchService.ts": 2,
  "server/unifiedAuth.ts": 2,
  "server/utils/accountSetup.ts": 1,
  "server/utils/emailVerification.ts": 1,
};

function normalize(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const normalized = normalize(fullPath);
    if (normalized.startsWith("server/public/")) continue;
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listTsFiles(fullPath));
    } else if (entry.endsWith(".ts")) {
      files.push(normalized);
    }
  }
  return files;
}

function countSendSites(filePath: string): number {
  const content = readFileSync(filePath, "utf8");
  return Array.from(content.matchAll(SEND_PATTERN)).length;
}

assert.equal(
  existsSync(EMAIL_TRIGGER_DOC),
  true,
  `${EMAIL_TRIGGER_DOC} must exist before auditing email triggers.`,
);

const actual = Object.fromEntries(
  listTsFiles(SERVER_DIR)
    .map((filePath) => [filePath, countSendSites(filePath)] as const)
    .filter(([, count]) => count > 0),
);

const allFiles = new Set([...Object.keys(baseline), ...Object.keys(actual)]);
const diffs: string[] = [];

for (const filePath of [...allFiles].sort()) {
  const expected = baseline[filePath] ?? 0;
  const found = actual[filePath] ?? 0;
  if (expected !== found) {
    diffs.push(`${filePath}: expected ${expected}, found ${found}`);
  }
}

if (diffs.length > 0) {
  console.error("Email trigger audit failed. Review new/changed send sites:");
  for (const diff of diffs) console.error(`- ${diff}`);
  console.error(
    `Update ${EMAIL_TRIGGER_DOC} and this script's baseline if the change is intentional.`,
  );
  process.exit(1);
}

console.log(
  `email trigger audit passed (${Object.values(actual).reduce((sum, count) => sum + count, 0)} send sites)`,
);
