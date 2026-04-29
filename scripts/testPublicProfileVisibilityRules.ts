import assert from "node:assert/strict";

import {
  getPublicBusinessVisibilityChecks,
  isPublicBusinessVisible,
} from "../server/utils/publicBusinessVisibility";

const run = async () => {
  const completeProfile = {
    name: "Harbor Grill",
    address: "123 Ocean Ave",
    city: "San Diego",
    state: "CA",
    cuisineType: "Seafood",
    description: "Fresh-catch coastal kitchen with seasonal dishes and daily specials.",
    coverImageUrl: "https://example.com/cover.jpg",
  };

  const completeChecks = getPublicBusinessVisibilityChecks(completeProfile);
  assert.deepEqual(completeChecks.blockers, []);
  assert.deepEqual(completeChecks.warnings, []);
  assert.equal(isPublicBusinessVisible(completeProfile), true);

  const missingLocation = {
    name: "Harbor Grill",
    cuisineType: "Seafood",
    description: "Fresh-catch coastal kitchen with seasonal dishes and daily specials.",
  };
  const missingLocationChecks = getPublicBusinessVisibilityChecks(missingLocation);
  assert.equal(missingLocationChecks.blockers.includes("missing_location"), true);
  assert.equal(isPublicBusinessVisible(missingLocation), false);

  const missingCategory = {
    name: "Harbor Grill",
    address: "123 Ocean Ave",
    city: "San Diego",
    state: "CA",
    description: "Fresh-catch coastal kitchen with seasonal dishes and daily specials.",
  };
  const missingCategoryChecks = getPublicBusinessVisibilityChecks(missingCategory);
  assert.equal(missingCategoryChecks.blockers.includes("missing_category"), true);
  assert.equal(isPublicBusinessVisible(missingCategory), false);

  const warningOnlyProfile = {
    name: "Harbor Grill",
    address: "123 Ocean Ave",
    city: "San Diego",
    state: "CA",
    cuisineType: "Seafood",
  };
  const warningOnlyChecks = getPublicBusinessVisibilityChecks(warningOnlyProfile);
  assert.deepEqual(warningOnlyChecks.blockers, []);
  assert.equal(
    warningOnlyChecks.warnings.includes("missing_description_or_photo"),
    true,
  );
  assert.equal(isPublicBusinessVisible(warningOnlyProfile), true);

  const testDataProfile = {
    name: "Demo Restaurant 123",
    address: "999 Test Street",
    city: "Demo City",
    state: "TX",
    businessType: "restaurant",
  };
  const testDataChecks = getPublicBusinessVisibilityChecks(testDataProfile);
  assert.equal(testDataChecks.blockers.includes("flagged_test_data"), true);
  assert.equal(isPublicBusinessVisible(testDataProfile), false);

  console.log("public profile visibility rules test passed");
};

run().catch((error) => {
  console.error("public profile visibility rules test failed:", error);
  process.exit(1);
});
