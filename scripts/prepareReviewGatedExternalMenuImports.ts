import { readFileSync, writeFileSync } from "node:fs";

const baselineSha = "b895a14eaf3d7605d998be389d08c9e2bf62921d";
const generatedAt = "2026-06-14T00:00:00.000-05:00";
const outputPath =
  "docs/evidence/live-scout-truck-review-gated-menu-import-2026-06-14.json";

type MenuVariant = {
  label: string;
  price: number;
};

type SourceMenuItem = {
  name: string;
  description?: string;
  price?: number;
  variants?: MenuVariant[];
  options?: string[];
  no_refills?: boolean;
  size?: string;
};

type SourceMenuSection = {
  category: string;
  section_note?: string;
  items: SourceMenuItem[];
};

type ThreeDEvidence = {
  menu: SourceMenuSection[];
};

type BatchTwoEntry = {
  truckName: string;
  truckId: string;
  profileId: string;
  publicProfilePath: string;
  currentProductionDisplayName: string;
  currentProductionWebsiteUrl: string | null;
  currentExternalMenuUrl: string | null;
  currentStructuredMenuSummary?: {
    observedItems?: Array<{
      name: string;
      priceLabel?: string;
      ownerApprovalNeeded?: boolean;
    }>;
  };
  sourceUrls: string[];
  sourceArtifactPaths: string[];
};

type BatchTwoEvidence = {
  entries: BatchTwoEntry[];
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function findEntry(batch: BatchTwoEvidence, truckName: string): BatchTwoEntry {
  const entry = batch.entries.find((candidate) => candidate.truckName === truckName);
  if (!entry) {
    throw new Error(`Missing Batch 2 evidence entry for ${truckName}`);
  }
  return entry;
}

function toPriceLabel(price: number | null): string | null {
  return typeof price === "number" ? `$${price.toFixed(2)}` : null;
}

function buildThreeDImportedItems(menu: SourceMenuSection[]) {
  const importedItems = [];

  for (const section of menu) {
    for (const item of section.items) {
      if (item.variants?.length) {
        for (const variant of item.variants) {
          importedItems.push({
            itemName: `${item.name} (${variant.label})`,
            baseItemName: item.name,
            variantLabel: variant.label,
            description: item.description ?? null,
            price: variant.price,
            priceLabel: toPriceLabel(variant.price),
            category: section.category,
            options: item.options ?? [],
            sourceConfidence: "medium",
            ownerApprovalNeeded: true,
            ownerApproved: false,
            sourceRef: "docs/evidence/3d-eats-tea-append-only-profile-read-2026-06-07.json",
          });
        }
        continue;
      }

      importedItems.push({
        itemName: item.name,
        baseItemName: item.name,
        variantLabel: item.size ?? null,
        description: item.description ?? null,
        price: item.price ?? null,
        priceLabel: toPriceLabel(item.price ?? null),
        category: section.category,
        options: item.options ?? [],
        sourceConfidence: "medium",
        ownerApprovalNeeded: true,
        ownerApproved: false,
        sourceRef: "docs/evidence/3d-eats-tea-append-only-profile-read-2026-06-07.json",
      });
    }
  }

  return importedItems;
}

const threeD = readJson<ThreeDEvidence>(
  "docs/evidence/3d-eats-tea-append-only-profile-read-2026-06-07.json",
);
const batchTwo = readJson<BatchTwoEvidence>(
  "docs/evidence/live-scout-truck-evidence-batch-2-2026-06-13.json",
);

const threeDEntry = findEntry(batchTwo, "3D Eats & Tea");
const sweetLoveEntry = findEntry(batchTwo, "Sweet Love");

const threeDImportedItems = buildThreeDImportedItems(threeD.menu);
const liveObservedThreeDItems =
  threeDEntry.currentStructuredMenuSummary?.observedItems?.map((item) => ({
    itemName: item.name,
    baseItemName: item.name,
    variantLabel: null,
    description: null,
    price: item.priceLabel ? Number(item.priceLabel.replace(/[$,]/g, "")) : null,
    priceLabel: item.priceLabel ?? null,
    category: "Live MealScout structured menu observation",
    options: [],
    sourceConfidence: "medium",
    ownerApprovalNeeded: true,
    ownerApproved: false,
    sourceRef: "docs/evidence/live-scout-truck-evidence-batch-2-2026-06-13.json",
    note: "Observed in live public profile API evidence. Included for review comparison only; this artifact does not overwrite canonical active menu rows.",
  })) ?? [];

const artifact = {
  artifactType: "review_gated_external_menu_import",
  repo: "MealScout",
  generatedAt,
  baselineSha,
  workflowMode: "review_gated_menu_import_prepare_only",
  productionMutationAllowed: false,
  productionApplied: false,
  storageDecision: {
    selectedPath: "docs/evidence review artifact plus contract",
    reason:
      "Canonical menu tables are active public menu data, and the current admin evidence apply route can dry-run or write canonical records. No production-safe persistent menu draft table was found in the inspected repo state.",
    productionRecordMutation: false,
  },
  rules: [
    "Do not invent logos, menus, schedules, social links, covers, or descriptions.",
    "Do not publish external menu evidence as current or owner-approved until owner/operator review is complete.",
    "Do not overwrite existing active menu records from this review packet.",
    "Treat low-confidence external menu evidence as source-only review material.",
    "Keep ownerApprovalNeeded true and ownerApproved false until explicit owner/operator approval exists.",
  ],
  preservedContracts: [
    "/truck/{slug}--{uuid} compatibility paths",
    "invalid UUID safe 404",
    "missing logo/menu/schedule no-500 behavior",
    "clean affiliate / clean URL doctrine",
    "public profile does not claim draft menu data is approved/current",
  ],
  entries: [
    {
      truckId: sweetLoveEntry.truckId,
      profileId: sweetLoveEntry.profileId,
      businessName: sweetLoveEntry.currentProductionDisplayName,
      publicProfilePath: sweetLoveEntry.publicProfilePath,
      sourceType: "square",
      sourceUrl: "https://ursweetlove.square.site/",
      sourceUrls: Array.from(new Set(sweetLoveEntry.sourceUrls)),
      sourceArtifactPaths: sweetLoveEntry.sourceArtifactPaths,
      capturedAt: generatedAt,
      importStatus: "needs_manual_extraction",
      importedSections: [],
      importedItems: [],
      confidence: "low",
      ownerApprovalNeeded: true,
      ownerApproved: false,
      currentness: "unknown",
      productionApplied: false,
      notes: [
        "Live MealScout already exposes the Square site as the external menu CTA candidate.",
        "The fetched Square page shell did not expose reliable item-level menu data suitable for structured import in this review-only lane.",
        "Keep this as a first candidate source for manual browser capture, OCR, owner export, or owner confirmation before any structured items are drafted.",
      ],
    },
    {
      truckId: threeDEntry.truckId,
      profileId: threeDEntry.profileId,
      businessName: threeDEntry.currentProductionDisplayName,
      publicProfilePath: threeDEntry.publicProfilePath,
      sourceType: "local_append_only_evidence",
      sourceUrl: "docs/evidence/3d-eats-tea-append-only-profile-read-2026-06-07.json",
      sourceUrls: Array.from(
        new Set([
          ...threeDEntry.sourceUrls,
          "docs/evidence/3d-eats-tea-append-only-profile-read-2026-06-07.json",
        ]),
      ),
      sourceArtifactPaths: Array.from(
        new Set([
          ...threeDEntry.sourceArtifactPaths,
          "docs/evidence/3d-eats-tea-append-only-profile-read-2026-06-07.json",
        ]),
      ),
      capturedAt: "2026-06-07T00:00:00.000-05:00",
      preparedAt: generatedAt,
      importStatus: "structured_draft_prepared",
      importedSections: threeD.menu.map((section, index) => ({
        category: section.category,
        displayOrder: index + 1,
        sectionNote: section.section_note ?? null,
        importedItemCount: section.items.reduce(
          (count, item) => count + (item.variants?.length ?? 1),
          0,
        ),
      })),
      importedItems: [...liveObservedThreeDItems, ...threeDImportedItems],
      confidence: "medium",
      ownerApprovalNeeded: true,
      ownerApproved: false,
      currentness: "unknown",
      productionApplied: false,
      notes: [
        "Structured draft rows are prepared from existing local append-only 3D evidence and the live API observed item.",
        "The source evidence itself says owner approval that this menu is current is missing.",
        "This artifact is not an apply payload and must not overwrite existing active menu records.",
      ],
    },
  ],
};

writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`review-gated external menu import artifact written: ${outputPath}`);
