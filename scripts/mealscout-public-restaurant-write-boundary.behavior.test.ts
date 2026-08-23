import assert from "node:assert/strict";

import { publicInsertRestaurantSchema } from "../shared/schema";

const parsed = publicInsertRestaurantSchema.parse({
  name: "Boundary Test Kitchen",
  address: "100 Test Ave",
  city: "Pensacola",
  state: "FL",
  businessType: "restaurant",
  isVerified: true,
  isActive: true,
  claimedFromImportId: "forged-import",
  rawData: { imported: true },
  stripeConnectAccountId: "acct_forged",
  stripeConnectStatus: "active",
  stripeOnboardingCompleted: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  orderingApprovedAt: new Date("2026-08-23T12:00:00.000Z"),
  orderingApprovedByUserId: "admin-forged",
  orderingApprovalEvidenceUrl: "https://example.com/forged-evidence",
  orderingApprovalReviewNote: "forged approval",
  pickupAcknowledgementMinutes: 30,
});

for (const protectedField of [
  "isVerified",
  "isActive",
  "claimedFromImportId",
  "rawData",
  "stripeConnectAccountId",
  "stripeConnectStatus",
  "stripeOnboardingCompleted",
  "stripeChargesEnabled",
  "stripePayoutsEnabled",
  "orderingApprovedAt",
  "orderingApprovedByUserId",
  "orderingApprovalEvidenceUrl",
  "orderingApprovalReviewNote",
  "pickupAcknowledgementMinutes",
]) {
  assert.equal(
    Object.prototype.hasOwnProperty.call(parsed, protectedField),
    false,
    `${protectedField} must be stripped from public business writes`,
  );
}

assert.equal(parsed.name, "Boundary Test Kitchen");
assert.equal(parsed.city, "Pensacola");

console.log("MealScout public restaurant write boundary: PASS");
