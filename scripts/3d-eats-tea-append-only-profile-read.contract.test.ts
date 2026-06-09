import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const sourcePath = "docs/evidence/3d-eats-tea-append-only-profile-read-2026-06-07.json";
const evidence = JSON.parse(readFileSync(sourcePath, "utf8"));
const locationSemantics = readFileSync("server/utils/truckLocationSemantics.ts", "utf8");

assert.equal(evidence.apply_mode, "append_only_enrichment");
assert.equal(evidence.business_display_name, "3-D Eats & Tea Pensacola");
assert.equal(evidence.email, "threedtea@gmail.com");
assert.equal(evidence.instagram_handle, "3deats");
assert.equal(evidence.tiktok_handle, "3deatspensacola");
assert.deepEqual(evidence.youtube_candidates, ["eatin3d", "@3deats"]);

assert.equal(evidence.static_business_address_candidate.street, "6881 US 98 E");
assert.equal(evidence.static_business_address_candidate.zip, "32506");
assert.ok(
  evidence.static_business_address_candidate.note.includes("business/admin/static"),
  "static address must remain admin/static evidence only",
);
assert.ok(
  evidence.customer_location_rule.value.includes("Do not use static profile/menu address"),
  "customer-facing location rule must block static address map use",
);
assert.ok(
  locationSemantics.includes("THREE_D_EATS_STATIC_ADMIN_ADDRESS"),
  "3D Eats static address must be enforced by location semantics",
);

const youtubeConflict = evidence.contact_conflicts.find(
  (conflict: any) => conflict.field === "youtube",
);
assert.equal(youtubeConflict.values.prior_details_screenshot, "eatin3d");
assert.equal(youtubeConflict.values.menu_screenshot, "@3deats");

const addressConflict = evidence.address_conflicts.find(
  (conflict: any) => conflict.field === "address",
);
assert.equal(
  addressConflict.values.prior_details_screenshot,
  "Pensacola, FL, United States, 32505",
);
assert.equal(
  addressConflict.values.menu_screenshot,
  "6881 US 98 E, Pensacola, FL 32506",
);

for (const protectedField of [
  "existing_account",
  "owner_user_id",
  "claim_status",
  "subscription_status",
  "payment_status",
  "profile_id",
  "business_id",
  "analytics_history",
  "reviews",
]) {
  assert.ok(
    evidence.do_not_replace.includes(protectedField),
    `protected field missing: ${protectedField}`,
  );
}

assert.ok(
  evidence.review_required_before_overwrite.includes("public map location"),
);
assert.ok(evidence.missing_fields.includes("confirmed_live_operating_location"));
assert.ok(evidence.missing_fields.includes("owner approval that this menu is current"));
assert.equal(evidence.cover_photo_upload.image_type, "restaurant_cover");
assert.equal(evidence.cover_photo_upload.entity_type, "restaurant");
assert.equal(
  evidence.cover_photo_upload.public_url,
  "/business-assets/3d-eats-and-tea/cover-photo.png",
);
assert.equal(
  evidence.cover_photo_upload.image_upload_id,
  "5f663d13-88d5-41ca-9021-97873c591732",
);

const profileEnrichment = JSON.parse(
  readFileSync("artifacts/mealscout-onboarding/3d-eats-and-tea/profile-enrichment.json", "utf8"),
);
const evidenceAssets = readFileSync(
  "artifacts/mealscout-onboarding/3d-eats-and-tea/evidence-assets.md",
  "utf8",
);
assert.equal(profileEnrichment.cover_photo_evidence.candidate_cover_photo, true);
assert.equal(
  profileEnrichment.cover_photo_evidence.repo_path,
  "artifacts/mealscout-onboarding/3d-eats-and-tea/images/cover-photo.png",
);
assert.equal(
  profileEnrichment.cover_photo_evidence.image_upload_id,
  "5f663d13-88d5-41ca-9021-97873c591732",
);
assert.equal(profileEnrichment.cover_photo_evidence.image_type, "restaurant_cover");
assert.equal(
  profileEnrichment.cover_photo_evidence.public_url,
  "/business-assets/3d-eats-and-tea/cover-photo.png",
);
assert.ok(
  profileEnrichment.cover_photo_evidence.apply_rule.includes("public/served asset location"),
  "cover photo must not be published from a repo artifact path directly",
);
assert.ok(
  profileEnrichment.cover_photo_evidence.apply_rule.includes("image_uploads row"),
  "cover photo must document the upload-equivalent image_uploads row",
);
assert.ok(
  evidenceAssets.includes("client/public/business-assets/3d-eats-and-tea/cover-photo.png"),
  "cover photo public asset path must be documented",
);
assert.ok(
  evidenceAssets.includes("/business-assets/3d-eats-and-tea/cover-photo.png"),
  "cover photo public URL path must be documented",
);
assert.ok(
  evidenceAssets.includes("image_upload_id: 5f663d13-88d5-41ca-9021-97873c591732"),
  "cover photo image_uploads id must be documented",
);

const categoryNames = evidence.menu.map((section: any) => section.category);
for (const requiredCategory of [
  "Hot Dogs",
  "3-D's Taste of Chicago",
  "Beverages",
  "Crafted Burgers",
  "Sandwiches",
]) {
  assert.ok(categoryNames.includes(requiredCategory), `menu category missing: ${requiredCategory}`);
}

const flatItems = evidence.menu.flatMap((section: any) => section.items || []);
for (const requiredItem of [
  "Chicago Style Dog",
  "Italian Beef",
  "3D Tea",
  "Loaded Fries",
  "Patty Melt",
  "B.F.C.",
]) {
  assert.ok(
    flatItems.some((item: any) => item.name === requiredItem),
    `menu item missing: ${requiredItem}`,
  );
}

console.log("3d-eats-tea-append-only-profile-read.contract: PASS");
