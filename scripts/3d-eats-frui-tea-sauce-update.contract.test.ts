import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const evidencePath =
  "docs/evidence/3d-eats-frui-tea-sauce-update-2026-07-17.json";
const receiptPath =
  "docs/evidence/3d-eats-frui-tea-sauce-update-apply-2026-07-17.json";
const scriptPath = "scripts/apply3dEatsFruiTeaSauceUpdate.ts";

const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
const source = readFileSync(scriptPath, "utf8");

test("3D Eats update classifies FRUI-TEA as sauce, not a drink", () => {
  assert.equal(evidence.source.classificationCorrection.value, "sauce_not_drink");
  assert.equal(evidence.productLine.category, "Sauces & Add-ons");
  assert.equal(evidence.productLine.productType, "BBQ sauce");
  assert.equal(evidence.productLine.flavorCount, 7);
  assert.doesNotMatch(evidence.productLine.category, /beverage|drink/i);
  assert.match(source, /classification: "sauce_not_drink"/);
});

test("3D Eats update targets only the verified owned profile", () => {
  assert.equal(
    evidence.business.id,
    "95c4e656-f3cc-46ab-ae18-53f549cecfd1",
  );
  assert.match(source, /const TARGET_NAME = "3D Eats & Tea"/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /db\.transaction/);
  assert.match(source, /Production apply requires --allow-production/);
});

test("ambiguous prices, flavor labels, images, and expired stops are not fabricated", () => {
  assert.equal(evidence.productLine.priceEvidence, null);
  assert.equal(evidence.applyDecision.menuItems.startsWith("not_created"), true);
  assert.equal(evidence.applyDecision.scheduleRows.startsWith("not_created"), true);
  assert.equal(evidence.applyDecision.publicImage.startsWith("not_published"), true);
  assert.match(source, /menuRowsCreated: 0/);
  assert.match(source, /scheduleRowsCreated: 0/);
  assert.doesNotMatch(source, /menuItems/);
  assert.doesNotMatch(source, /truckManualSchedules/);
});

test("production receipt preserves menu and schedule truth", () => {
  assert.equal(receipt.productionApplied, true);
  assert.equal(receipt.after.classification, "sauce_not_drink");
  assert.equal(receipt.safeguards.menuRowsCreated, 0);
  assert.equal(receipt.safeguards.scheduleRowsCreated, 0);
  assert.equal(receipt.publicVerification.scheduleStatus, "No schedule posted");
  assert.equal(receipt.publicVerification.existingMenuPreserved, true);
});
