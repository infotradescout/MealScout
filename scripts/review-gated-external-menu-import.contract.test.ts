import { existsSync, readFileSync } from "node:fs";

const artifactPath =
  "docs/evidence/live-scout-truck-review-gated-menu-import-2026-06-14.json";
const prepareScriptPath = "scripts/prepareReviewGatedExternalMenuImports.ts";

type ImportItem = {
  itemName: string;
  category: string;
  ownerApprovalNeeded: boolean;
  ownerApproved: boolean;
};

type ImportEntry = {
  truckId: string;
  profileId: string;
  businessName: string;
  publicProfilePath: string;
  sourceType: string;
  sourceUrl: string;
  capturedAt: string;
  importStatus: string;
  importedSections: unknown[];
  importedItems: ImportItem[];
  confidence: string;
  ownerApprovalNeeded: boolean;
  ownerApproved: boolean;
  currentness: string;
  productionApplied: boolean;
  notes: string[];
};

type Artifact = {
  artifactType: string;
  repo: string;
  workflowMode: string;
  productionMutationAllowed: boolean;
  productionApplied: boolean;
  storageDecision: {
    productionRecordMutation: boolean;
  };
  preservedContracts: string[];
  entries: ImportEntry[];
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function entryByName(artifact: Artifact, businessName: string): ImportEntry {
  const entry = artifact.entries.find(
    (candidate) => candidate.businessName === businessName,
  );
  assert(entry, `Missing review-gated menu import entry for ${businessName}`);
  return entry;
}

assert(existsSync(artifactPath), `Missing artifact: ${artifactPath}`);

const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as Artifact;

assert(
  artifact.artifactType === "review_gated_external_menu_import",
  "Artifact type must identify review-gated external menu import workflow",
);
assert(artifact.repo === "MealScout", "Artifact repo must be MealScout");
assert(
  artifact.workflowMode === "review_gated_menu_import_prepare_only",
  "Workflow must remain prepare-only",
);
assert(
  artifact.productionMutationAllowed === false,
  "Artifact must not allow production mutation",
);
assert(
  artifact.productionApplied === false,
  "Artifact-level productionApplied must stay false",
);
assert(
  artifact.storageDecision.productionRecordMutation === false,
  "Storage decision must not mutate production records",
);

for (const preserved of [
  "/truck/{slug}--{uuid} compatibility paths",
  "invalid UUID safe 404",
  "missing logo/menu/schedule no-500 behavior",
  "clean affiliate / clean URL doctrine",
  "public profile does not claim draft menu data is approved/current",
]) {
  assert(
    artifact.preservedContracts.includes(preserved),
    `Missing preserved contract: ${preserved}`,
  );
}

assert(
  artifact.entries.length === 2,
  "Batch must only contain Sweet Love and 3D Eats & Tea review imports",
);

const allowedConfidence = new Set(["low", "medium", "high"]);
const allowedCurrentness = new Set([
  "confirmed_current",
  "likely_current",
  "unknown",
  "stale",
]);
const allowedStatuses = new Set([
  "needs_manual_extraction",
  "structured_draft_prepared",
]);

for (const entry of artifact.entries) {
  assert(entry.truckId, `${entry.businessName} truckId is required`);
  assert(entry.profileId, `${entry.businessName} profileId is required`);
  assert(
    entry.publicProfilePath.startsWith("/truck/") &&
      entry.publicProfilePath.includes("--"),
    `${entry.businessName} must preserve clean truck path shape`,
  );
  assert(entry.sourceType, `${entry.businessName} sourceType is required`);
  assert(entry.sourceUrl, `${entry.businessName} sourceUrl is required`);
  assert(entry.capturedAt, `${entry.businessName} capturedAt is required`);
  assert(
    allowedStatuses.has(entry.importStatus),
    `${entry.businessName} importStatus must be review-gated`,
  );
  assert(
    Array.isArray(entry.importedSections),
    `${entry.businessName} importedSections must be an array`,
  );
  assert(
    Array.isArray(entry.importedItems),
    `${entry.businessName} importedItems must be an array`,
  );
  assert(
    allowedConfidence.has(entry.confidence),
    `${entry.businessName} confidence must use a known value`,
  );
  assert(
    allowedCurrentness.has(entry.currentness),
    `${entry.businessName} currentness must use a known value`,
  );
  assert(
    entry.ownerApprovalNeeded === true,
    `${entry.businessName} must require owner approval`,
  );
  assert(
    entry.ownerApproved === false,
    `${entry.businessName} must not be owner-approved by this artifact`,
  );
  assert(
    entry.productionApplied === false,
    `${entry.businessName} must not be production-applied`,
  );

  for (const item of entry.importedItems) {
    assert(item.itemName, `${entry.businessName} imported item needs itemName`);
    assert(item.category, `${entry.businessName} imported item needs category`);
    assert(
      item.ownerApprovalNeeded === true,
      `${entry.businessName} imported item must require owner approval`,
    );
    assert(
      item.ownerApproved === false,
      `${entry.businessName} imported item must not be owner-approved`,
    );
  }
}

const sweetLove = entryByName(artifact, "Sweet Love");
assert(
  sweetLove.sourceType === "square",
  "Sweet Love must start from the Square external menu candidate",
);
assert(
  sweetLove.importStatus === "needs_manual_extraction",
  "Sweet Love must remain source-only until reliable item-level extraction exists",
);
assert(
  sweetLove.importedItems.length === 0,
  "Sweet Love must not invent structured menu items from low-confidence extraction",
);
assert(
  sweetLove.confidence === "low",
  "Sweet Love item extraction confidence must remain low",
);

const threeD = entryByName(artifact, "3D Eats & Tea");
assert(
  threeD.importStatus === "structured_draft_prepared",
  "3D Eats & Tea should have structured draft rows prepared for review",
);
assert(
  threeD.importedSections.length >= 10,
  "3D Eats & Tea should preserve sourced menu sections",
);
assert(
  threeD.importedItems.length >= 70,
  "3D Eats & Tea should include sourced draft menu items",
);
for (const expectedItem of [
  "Classic Burger",
  "Chicago Style Dog",
  "Italian Beef",
  "3D Tea (16oz)",
]) {
  assert(
    threeD.importedItems.some((item) => item.itemName === expectedItem),
    `3D Eats & Tea missing expected review draft item: ${expectedItem}`,
  );
}

const prepareScript = readFileSync(prepareScriptPath, "utf8");
for (const forbidden of [
  "server/db",
  "drizzle",
  "insert(menus",
  "insert(menuItems",
  "update(restaurants",
]) {
  assert(
    !prepareScript.includes(forbidden),
    `Prepare script must not contain production mutation dependency: ${forbidden}`,
  );
}

console.log("review-gated-external-menu-import.contract: PASS");
