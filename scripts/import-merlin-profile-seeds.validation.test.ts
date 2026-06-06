import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { __testables } from "./import-merlin-profile-seeds";

const {
  normalizeSeed,
  validateSeed,
  canonicalName,
} = __testables;

const baseSeed = {
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
};

const validRaw = {
  ...baseSeed,
  profile_name: "Rolling In The Dough Handmade",
  profile_email: "RollingInTheDough@example.org",
  phone: "(850) 555-0123",
  website: "rollingdough.com",
  instagram: "@rollingdoughtruck",
};

const valid = normalizeSeed(validRaw);
assert.equal(valid.name, "Rolling In The Dough Handmade");
assert.equal(valid.email, "rollinginthedough@example.org");
assert.equal(valid.phone, "8505550123");
assert.equal(validateSeed(valid).ok, true, "valid record should pass");

const invalidIdentity = normalizeSeed({
  ...baseSeed,
  profile_name: "eee",
  profile_email: "www.theflaminpepper@yahoo.com",
  website: "www.theflaminpepper@yahoo.com",
  instagram: "@yahoo.com",
});
assert.equal(
  validateSeed(invalidIdentity).ok,
  false,
  "eee extraction record must be blocked",
);
assert.equal(
  invalidIdentity.droppedFields.includes("website"),
  true,
  "website-as-email must be dropped",
);
assert.equal(
  invalidIdentity.droppedFields.includes("instagram"),
  true,
  "@yahoo.com social fragment must be dropped",
);

const mann = normalizeSeed({
  ...baseSeed,
  profile_name: "MANN Kettle Corn 2",
  profile_email: "hello@mannkettlecorn.com",
  instagram: "@gmail.com",
  phone: "850-555-7777",
});
assert.equal(canonicalName("MANN Kettle Corn 2"), "MANN Kettle Corn");
assert.equal(mann.name, "MANN Kettle Corn");
assert.equal(mann.droppedFields.includes("instagram"), true);
assert.equal(validateSeed(mann).ok, true, "normalized MANN record should pass");

const missingContact = normalizeSeed({
  ...baseSeed,
  profile_name: "No Contact Truck",
});
assert.equal(validateSeed(missingContact).ok, false);

const badBrand = normalizeSeed({
  ...baseSeed,
  brand_lane: "OTHER",
  profile_name: "Brand Lane Truck",
  profile_email: "owner@brandlane.com",
});
assert.equal(validateSeed(badBrand).ok, false);

const badType = normalizeSeed({
  ...baseSeed,
  target_profile_type: "restaurant",
  profile_name: "Wrong Type Truck",
  profile_email: "owner@type.com",
});
assert.equal(validateSeed(badType).ok, false);

const badSafety = normalizeSeed({
  ...baseSeed,
  profile_name: "Unsafe Flags Truck",
  profile_email: "owner@safety.com",
  claim_status: "claimed",
});
assert.equal(validateSeed(badSafety).ok, false);

const badOrigin = normalizeSeed({
  ...baseSeed,
  profile_name: "Auto Onboarded Truck",
  profile_email: "owner@autoorigin.com",
  profile_origin: "auto_onboarded",
});
assert.equal(validateSeed(badOrigin).ok, false);

const importerScript = readFileSync("scripts/import-merlin-profile-seeds.ts", "utf8");
assert.equal(
  importerScript.includes("ownerId: systemOwnerId"),
  true,
  "import must use system owner",
);
assert.equal(
  importerScript.includes("status: \"unclaimed\""),
  true,
  "listing status must remain unclaimed",
);
assert.equal(
  importerScript.includes("invitedUserId: null"),
  true,
  "listing invited user must remain null",
);
assert.equal(
  importerScript.includes("isVerified: false") && importerScript.includes("insuranceVerified: false"),
  true,
  "restaurant must remain unverified",
);
assert.equal(
  importerScript.includes("original_seed_payload: seed.raw"),
  true,
  "rawData must preserve original Merlin payload",
);
assert.equal(
  importerScript.includes("insert(users)") || importerScript.includes("createUser"),
  false,
  "importer must not create users",
);

console.log("import-merlin-profile-seeds.validation: PASS");
