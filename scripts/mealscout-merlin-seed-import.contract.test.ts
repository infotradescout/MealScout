import assert from "node:assert/strict";
import { __testables } from "./import-merlin-profile-seeds";

const { normalizeSeed, validateSeed, mergeSeedRawData } = __testables;

const baseRow = {
  brand_lane: "MEALSCOUT",
  target_profile_type: "food_truck",
  seeded_from_evidence: true,
  profile_origin: "evidence_seed",
  import_decision: "clean",
  onboarding_source: "screenshot_seed",
  claim_status: "unclaimed",
  email_verified: false,
  insurance_verified: false,
  owner_user_id: null,
  invited_user_id: null,
  city: "Pensacola",
  state: "FL",
  profile_name: "Boundary Taco Truck",
  profile_email: "boundary@example.org",
  phone: "850-555-0101",
};

const assertRejected = (row: Record<string, unknown>, reason: string) => {
  const result = validateSeed(normalizeSeed(row));
  assert.equal(result.ok, false, `${reason} must be rejected`);
  if (!result.ok) assert.equal(result.reason, reason);
};

const clean = normalizeSeed(baseRow);
assert.equal(validateSeed(clean).ok, true, "clean evidence_seed row should import");

const rawData = mergeSeedRawData({}, clean) as any;
assert.equal(rawData.merlinSeed.profile_origin, "evidence_seed");
assert.notEqual(rawData.merlinSeed.profile_origin, "auto_onboarded");
assert.equal(rawData.merlinSeed.seeded_from_evidence, true);
assert.equal(rawData.merlinSeed.claim_status, "unclaimed");
assert.equal(rawData.merlinSeed.email_verified, false);
assert.equal(rawData.merlinSeed.insurance_verified, false);
assert.equal(rawData.merlinSeed.owner_user_id, null);
assert.equal(rawData.merlinSeed.invited_user_id, null);
assert.equal(rawData.merlinSeed.affiliate_user_id, null);
assert.equal(rawData.merlinSeed.affiliate_tag, null);
assert.equal(rawData.merlinSeed.referral_code, null);
assert.deepEqual(rawData.merlinSeed.original_seed_payload, baseRow);

assertRejected(
  { ...baseRow, profile_name: "Blocked Taco Truck", import_decision: "blocked" },
  "import_decision_blocked",
);

assertRejected(
  { ...baseRow, profile_name: "Review Taco Truck", import_decision: "review_required" },
  "review_required",
);

assertRejected(
  { ...baseRow, profile_name: "Auto Origin Truck", profile_origin: "auto_onboarded" },
  "invalid_safety_flags",
);

assertRejected(
  { ...baseRow, profile_name: "Verified Email Truck", email_verified: true },
  "invalid_safety_flags",
);

assertRejected(
  { ...baseRow, profile_name: "Insured Truck", insurance_verified: true },
  "invalid_safety_flags",
);

assertRejected(
  { ...baseRow, profile_name: "Claimed Owner Truck", owner_user_id: "user_123" },
  "invalid_safety_flags",
);

const adminUnattributed = normalizeSeed({
  ...baseRow,
  profile_name: "Admin Unattributed Truck",
  source_actor: "admin_unattributed",
  affiliate_user_id: null,
  affiliate_tag: null,
  referral_code: null,
});
assert.equal(
  validateSeed(adminUnattributed).ok,
  true,
  "admin_unattributed rows with null affiliate fields should import",
);
const adminRawData = mergeSeedRawData({}, adminUnattributed) as any;
assert.equal(adminRawData.merlinSeed.affiliate_user_id, null);
assert.equal(adminRawData.merlinSeed.affiliate_tag, null);
assert.equal(adminRawData.merlinSeed.referral_code, null);

assertRejected(
  {
    ...baseRow,
    profile_name: "Bad Affiliate Truck",
    source_actor: "admin_unattributed",
    affiliate_user_id: "affiliate_123",
  },
  "admin_unattributed_affiliate_attribution",
);

console.log("mealscout-merlin-seed-import.contract: PASS");
