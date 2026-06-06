import { readFileSync } from "node:fs";

const scriptPath = "scripts/import-merlin-profile-seeds.ts";
const script = readFileSync(scriptPath, "utf8");

const requiredSnippets = [
  'const inputFile = getArg("--input") || "merlin-profile-seed-export.json"',
  'throw new Error("Input file must be a JSON array of seed records.")',
  'throw new Error("DATABASE_URL is required.")',
  'System import owner not found for IMPORT_SYSTEM_EMAIL=',
  'Refusing to create users automatically.',
  'const validation = validateSeed(seed);',
  'invalid_extraction_identity',
  'invalid_brand_lane',
  'invalid_target_profile_type',
  'invalid_email',
  'missing_contact_identity',
  'invalid_safety_flags',
  'if (isEmailLike(rawWebsite)) {',
  'droppedFields.push("website")',
  'isInvalidSocialEmailFragment',
  'droppedFields.push("instagram")',
  'canonicalName',
  'MANN Kettle Corn',
  'status: "unclaimed"',
  'invitedUserId: null',
  'insuranceVerified: false',
  'isVerified: false',
  'ownerId: systemOwnerId',
  'seeded_from_evidence: true',
  'profile_origin: "auto_onboarded"',
  'onboarding_source: seed.onboardingSource',
  'claim_status: "unclaimed"',
  'email_verified: false',
  'insurance_verified: false',
  'original_seed_payload: seed.raw',
  'records_imported_count:',
  'normalization_changes:',
  'const reportPath =',
  'mealscout-merlin-profile-seed-import-report.txt',
  'missing_required_identity',
  'missing_required_fields_for_create',
  'admin_visibility_proof:',
  'public_customer_visibility_proof:',
];

for (const snippet of requiredSnippets) {
  if (!script.includes(snippet)) {
    throw new Error(`Missing required importer behavior snippet: ${snippet}`);
  }
}

const forbiddenSnippets = [
  "createUserInvite(",
  "sendEmail",
  "claim_status: \"claimed\"",
  "insuranceVerified: true",
  "emailVerified: true",
  "seed fake",
  "[cite:",
];

for (const snippet of forbiddenSnippets) {
  if (script.includes(snippet)) {
    throw new Error(`Forbidden importer snippet found: ${snippet}`);
  }
}

console.log("import-merlin-profile-seeds.contract: PASS");
