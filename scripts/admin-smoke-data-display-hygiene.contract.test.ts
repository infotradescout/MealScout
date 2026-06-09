import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  formatOwnerEmailDisplay,
  formatSignalsDisplay,
  formatSignupDateDisplay,
  formatVacScoreDisplay,
  getAdminSmokeRowStatus,
} from "../shared/adminSmokeDisplay";

const adminVacLogs = readFileSync("client/src/pages/AdminVacLogs.tsx", "utf8");
const adminDashboard = readFileSync("client/src/pages/admin-dashboard.tsx", "utf8");
const adminRoutes = readFileSync("server/adminRoutes.ts", "utf8");
const adminCoreOpsRoutes = readFileSync(
  "server/routes/admin/adminCoreOpsRoutes.ts",
  "utf8",
);
const scheduler = readFileSync("server/bootstrap/registerSchedulers.ts", "utf8");
const emailService = readFileSync("server/emailService.ts", "utf8");

assert.equal(
  formatSignalsDisplay({ phoneMatches: true, hasSocial: true }),
  "Phone match + Social",
);
assert.notEqual(formatSignalsDisplay({ phoneMatches: true }), "[object Object]");
assert.equal(formatSignalsDisplay(null), "No signals");

assert.equal(formatVacScoreDisplay(25, 70), "36 / 100");
assert.equal(formatVacScoreDisplay(25, 100), "25 / 100");
assert.equal(formatOwnerEmailDisplay("deleted+abc@mealscout.invalid"), "Deleted owner");
assert.equal(formatOwnerEmailDisplay(""), "No active owner");
assert.equal(
  getAdminSmokeRowStatus({ name: "Test Truck 1776139610690" }),
  "test_smoke",
);
assert.equal(
  getAdminSmokeRowStatus({ ownerEmail: "deleted+abc@mealscout.invalid" }),
  "deleted_system",
);
assert.equal(
  formatSignupDateDisplay("2099-01-01T00:00:00.000Z", new Date("2026-06-09T00:00:00.000Z")),
  "Future/test date",
);

[
  "formatVacScoreDisplay",
  "formatSignalsDisplay",
  "scoreDisplay",
  "data-admin-vac-mobile-cards",
].forEach((snippet) => {
  if (!adminVacLogs.includes(snippet)) {
    throw new Error(`VAC logs screen missing hygiene snippet: ${snippet}`);
  }
});

[
  "formatSignalsDisplay(signals)",
  "formatVacScoreDisplay(score, threshold)",
].forEach((snippet) => {
  if (!adminRoutes.includes(snippet)) {
    throw new Error(`VAC logs API missing hygiene snippet: ${snippet}`);
  }
});

[
  "formatOwnerEmailDisplay",
  "getAdminSmokeRowStatus",
  "rowStatus",
].forEach((snippet) => {
  if (!adminCoreOpsRoutes.includes(snippet)) {
    throw new Error(`Food truck inventory API missing hygiene snippet: ${snippet}`);
  }
});

[
  "rowStatus",
  "data-admin-truck-inventory-mobile-cards",
  "data-admin-truck-inventory-desktop-table",
].forEach((snippet) => {
  if (!adminDashboard.includes(snippet)) {
    throw new Error(`Admin truck inventory UI missing hygiene snippet: ${snippet}`);
  }
});

[
  "formatOwnerEmailDisplay",
  "formatSignalsDisplay",
  "formatSignupDateDisplay",
  "formatVacScoreDisplay",
  "getAdminSmokeRowStatus",
].forEach((snippet) => {
  if (!scheduler.includes(snippet)) {
    throw new Error(`VAC digest scheduler missing hygiene snippet: ${snippet}`);
  }
});

if (scheduler.includes("String(meta.signalSummary || meta.signals || \"\")")) {
  throw new Error("VAC digest scheduler must not stringify signal objects.");
}

if (emailService.includes("${e.vacScore}</strong> / ${e.threshold}")) {
  throw new Error("VAC digest email must not render legacy /70 threshold scores.");
}

console.log("admin-smoke-data-display-hygiene.contract: PASS");
