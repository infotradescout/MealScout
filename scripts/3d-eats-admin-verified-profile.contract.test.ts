import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  planApprovedMenuAdditions,
  type PlannedMenuItem,
} from "./lib/3dEatsAdminVerifiedProfilePlan";

const verificationPath =
  "docs/evidence/3d-eats-admin-verification-2026-07-26.json";
const menuEvidencePath =
  "docs/evidence/3d-eats-tea-append-only-profile-read-2026-06-07.json";
const applyScriptPath = "scripts/apply3dEatsAdminVerifiedProfile.ts";
const evidenceLogoPath =
  "artifacts/mealscout-onboarding/3d-eats-and-tea/images/logo.jpg";
const publicLogoPath = "client/public/business-assets/3d-eats-and-tea/logo.jpg";

const verification = JSON.parse(readFileSync(verificationPath, "utf8"));
const menuEvidence = JSON.parse(readFileSync(menuEvidencePath, "utf8"));
const applySource = readFileSync(applyScriptPath, "utf8");
const publicProjectionSource = readFileSync(
  "server/publicProfiles/toPublicRestaurantProfile.ts",
  "utf8",
);
const evidenceLogo = readFileSync(evidenceLogoPath);
const publicLogo = readFileSync(publicLogoPath);

const jpegDimensions = (image: Buffer) => {
  assert.equal(image[0], 0xff);
  assert.equal(image[1], 0xd8);
  for (let offset = 2; offset + 9 < image.length; ) {
    if (image[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = image[offset + 1];
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      return {
        height: image.readUInt16BE(offset + 5),
        width: image.readUInt16BE(offset + 7),
      };
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const segmentLength = image.readUInt16BE(offset + 2);
    assert.ok(segmentLength >= 2, `Invalid JPEG segment at ${offset}`);
    offset += 2 + segmentLength;
  }
  throw new Error("JPEG dimensions were not found");
};

const approvedMenuItemCount = menuEvidence.menu.reduce(
  (total: number, section: any) =>
    total +
    section.items.reduce(
      (sectionTotal: number, item: any) =>
        sectionTotal +
        (Array.isArray(item.variants) && item.variants.length > 0
          ? item.variants.length
          : 1),
      0,
    ),
  0,
);

test("Thomas's admin verification targets the canonical 3D Eats profile", () => {
  assert.equal(verification.authority.verified, true);
  assert.equal(verification.authority.verifiedBy, "Thomas");
  assert.equal(
    verification.authority.role,
    "MealScout admin and profile creator",
  );
  assert.equal(
    verification.business.id,
    "95c4e656-f3cc-46ab-ae18-53f549cecfd1",
  );
  assert.equal(verification.business.name, "3D Eats & Tea");
  assert.equal(
    verification.canonicalTruth.existingMealScoutProfile,
    "authoritative",
  );
  assert.equal(
    verification.canonicalTruth.menuEvidence,
    "admin_approved_for_reversible_apply",
  );
});

test("the approved evidence contains 74 priced menu rows in 12 categories", () => {
  assert.equal(menuEvidence.menu.length, 12);
  assert.equal(approvedMenuItemCount, 74);
  for (const section of menuEvidence.menu) {
    assert.ok(String(section.category || "").trim());
    for (const item of section.items) {
      const prices =
        Array.isArray(item.variants) && item.variants.length > 0
          ? item.variants.map((variant: any) => variant.price)
          : [item.price];
      prices.forEach((price: unknown) => {
        assert.ok(Number.isFinite(Number(price)));
        assert.ok(Number(price) > 0);
      });
    }
  }
  assert.deepEqual(verification.productionBaseline.activeMenuItems, [
    {
      menuItemId: "60e3ff75-7df4-44cd-8ffa-49577b9fe164",
      category: "Menu Items",
      name: "Classic Burger",
      description:
        "Our Custom Blend Filet Mignon Burger that's seared and seasoned on our sizzling flatop..",
      priceCents: 500,
      itemType: "food",
    },
  ]);
});

test("the official website logo is exact, public, and reproducible", () => {
  const expectedHash =
    "f1791c958039b2b7437b86824295baf59f0bb123241a0c83cd388bcdc4fd9692";
  assert.equal(
    verification.approvedSources.logoWebsitePage,
    "https://3deats.us/",
  );
  assert.match(
    verification.approvedSources.logoWebsiteAsset,
    /^https:\/\/img1\.wsimg\.com\//,
  );
  assert.equal(
    createHash("sha256").update(evidenceLogo).digest("hex"),
    expectedHash,
  );
  assert.equal(
    createHash("sha256").update(publicLogo).digest("hex"),
    expectedHash,
  );
  assert.deepEqual(jpegDimensions(publicLogo), {
    width: 2560,
    height: 1793,
  });
  assert.equal(
    verification.approvedSources.logoPublicUrl,
    "https://www.mealscout.us/business-assets/3d-eats-and-tea/logo.jpg",
  );
  assert.equal(
    verification.approvedSources.menuEvidenceSha256,
    createHash("sha256").update(readFileSync(menuEvidencePath)).digest("hex"),
  );
  assert.equal(
    verification.approvedSources.menuCanonicalSha256,
    createHash("sha256")
      .update(JSON.stringify(menuEvidence.menu))
      .digest("hex"),
  );
});

test("the apply path is target-locked, guarded, and revision-bound", () => {
  assert.match(
    applySource,
    /const TARGET_ID = "95c4e656-f3cc-46ab-ae18-53f549cecfd1"/,
  );
  assert.match(applySource, /const TARGET_NAME = "3D Eats & Tea"/);
  assert.match(applySource, /--allow-production/);
  assert.match(applySource, /--confirm-admin-verification/);
  assert.match(applySource, /assertEvidenceIntegrity\(\)/);
  assert.match(applySource, /assertCanonicalMenuMatchesBaseline/);
  assert.match(applySource, /db\.transaction/);
  assert.match(applySource, /isolationLevel: "serializable"/);
  assert.match(applySource, /pg_advisory_xact_lock/);
  assert.match(applySource, /\.for\("update"\)/);
  assert.match(applySource, /createStructuredMenuRevision/);
  assert.match(applySource, /approvedMenuRevision: menuRevision/);
  assert.match(applySource, /MENU_REVISION_ALGORITHM/);
  assert.match(applySource, /appliedOwnerMenuApprovalSha256/);
  assert.match(applySource, /insertedCategorySnapshots/);
  assert.match(applySource, /insertedItemSnapshots/);
});

test("the pure planner preserves canonical rows and distinguishes duplicates from conflicts", () => {
  const item = (overrides: Partial<PlannedMenuItem> = {}): PlannedMenuItem => ({
    category: "Menu Items",
    categoryDescription: null,
    name: "Classic Burger",
    description: "Original",
    priceCents: 500,
    itemType: "food",
    categorySortOrder: 0,
    itemSortOrder: 0,
    ...overrides,
  });
  const canonical = [item()];
  const approved = [
    item({ category: "  menu   ITEMS ", name: "classic burger" }),
    item({ name: "New Burger", priceCents: 900 }),
    item({ name: "Classic Burger", priceCents: 700 }),
  ];
  const canonicalBefore = structuredClone(canonical);
  const approvedBefore = structuredClone(approved);
  const plan = planApprovedMenuAdditions(canonical, approved);

  assert.deepEqual(canonical, canonicalBefore);
  assert.deepEqual(approved, approvedBefore);
  assert.equal(plan.exactDuplicatesSkipped, 1);
  assert.deepEqual(
    plan.rowsToInsert.map((row) => row.name),
    ["New Burger"],
  );
  assert.deepEqual(plan.conflicts, [
    {
      category: "Menu Items",
      name: "Classic Burger",
      canonicalPriceCents: 500,
      approvedPriceCents: 700,
    },
  ]);
});

test("the production mutation is additive, reversible, and truthful", () => {
  assert.match(applySource, /planApprovedMenuAdditions/);
  assert.match(applySource, /merge\.conflicts\.length !== 0/);
  assert.match(applySource, /existingMenuIdPreserved: true/);
  assert.match(applySource, /existingMenuItemIdsPreserved: true/);
  assert.match(applySource, /insertedRowsReversibleByDeactivation: true/);
  assert.match(applySource, /mode: "rollback"/);
  assert.match(applySource, /logoApplied \? previousLogoUrl : locked\.logoUrl/);
  assert.match(applySource, /logoApplied \? LOGO_PUBLIC_URL : locked\.logoUrl/);
  assert.match(applySource, /assertNoRollbackDependencies/);
  assert.match(applySource, /noOp: true/);
  assert.doesNotMatch(applySource, /\.delete\(/);
  assert.doesNotMatch(applySource, /\.insert\(menus\)|\.update\(menus\)/);
  assert.doesNotMatch(applySource, /truckManualSchedules|truckLiveLocations/);
  assert.match(applySource, /addressWrites: 0/);
  assert.match(applySource, /scheduleWrites: 0/);
  assert.match(applySource, /const ADMIN_APPROVAL_STATUS = "admin_verified"/);
  assert.match(publicProjectionSource, /label: "MealScout-verified menu"/);
  assert.match(publicProjectionSource, /adminVerified: true/);
});
