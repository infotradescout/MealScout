import "dotenv/config";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import {
  menuCategories,
  menuItemModifiers,
  menuItemPhotos,
  menuItemRecommendations,
  menuItems,
  menuItemVariants,
  menus,
  pickupOrderItems,
  restaurants,
} from "../shared/schema";
import {
  createStructuredMenuRevision,
  MENU_REVISION_ALGORITHM,
} from "../server/services/menuRevision";
import {
  planApprovedMenuAdditions,
  type PlannedMenuItem,
} from "./lib/3dEatsAdminVerifiedProfilePlan";

const TARGET_ID = "95c4e656-f3cc-46ab-ae18-53f549cecfd1";
const TARGET_NAME = "3D Eats & Tea";
const VERIFICATION_ARTIFACT =
  "docs/evidence/3d-eats-admin-verification-2026-07-26.json";
const MENU_EVIDENCE_ARTIFACT =
  "docs/evidence/3d-eats-tea-append-only-profile-read-2026-06-07.json";
const LOGO_REPO_PATH = "client/public/business-assets/3d-eats-and-tea/logo.jpg";
const LOGO_PUBLIC_URL =
  "https://www.mealscout.us/business-assets/3d-eats-and-tea/logo.jpg";
const ADMIN_APPROVAL_STATUS = "admin_verified";

const apply = process.argv.includes("--apply");
const rollback = process.argv.includes("--rollback");
const allowProduction = process.argv.includes("--allow-production");
const confirmAdminVerification = process.argv.includes(
  "--confirm-admin-verification",
);

type JsonRecord = Record<string, unknown>;

type SourceMenuItem = {
  name?: unknown;
  description?: unknown;
  price?: unknown;
  size?: unknown;
  options?: unknown;
  no_refills?: unknown;
  variants?: Array<{
    label?: unknown;
    price?: unknown;
  }>;
};

type SourceMenuSection = {
  category?: unknown;
  section_note?: unknown;
  items?: SourceMenuItem[];
};

type MenuEvidence = {
  menu?: SourceMenuSection[];
};

type FlatMenuItem = PlannedMenuItem;

type LockedMenuState = {
  menuRows: Array<Record<string, unknown>>;
  categoryRows: Array<Record<string, unknown>>;
  itemRows: Array<Record<string, unknown>>;
  variantRows: Array<Record<string, unknown>>;
  modifierRows: Array<Record<string, unknown>>;
};

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};

const normalizedText = (value: unknown) => String(value || "").trim();

const sha256File = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const sha256Json = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(normalizeForComparison(value)))
    .digest("hex");

const normalizeForComparison = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeForComparison);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonRecord)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeForComparison(entry)]),
    );
  }
  if (value === undefined) return null;
  return value;
};

const sameJson = (left: unknown, right: unknown) =>
  JSON.stringify(normalizeForComparison(left)) ===
  JSON.stringify(normalizeForComparison(right));

const sameStringArrays = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const priceToCents = (value: unknown, itemName: string) => {
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(
      `Approved menu item ${itemName} has no valid positive price.`,
    );
  }
  return Math.round(price * 100);
};

const buildDescription = (item: SourceMenuItem) => {
  const parts = [normalizedText(item.description)].filter(Boolean);
  const options = Array.isArray(item.options)
    ? item.options.map(normalizedText).filter(Boolean)
    : [];
  if (options.length > 0) {
    parts.push(`Options: ${options.join(", ")}.`);
  }
  if (item.no_refills === true) {
    parts.push("No refills.");
  }
  return parts.join(" ").trim() || null;
};

export const flattenApprovedMenu = (evidence: MenuEvidence): FlatMenuItem[] => {
  const sections = Array.isArray(evidence.menu) ? evidence.menu : [];
  const rows: FlatMenuItem[] = [];
  let itemSortOrder = 0;

  sections.forEach((section, categorySortOrder) => {
    const category = normalizedText(section.category);
    if (!category) {
      throw new Error(
        `Approved menu section ${categorySortOrder + 1} has no name.`,
      );
    }
    const categoryDescription = normalizedText(section.section_note) || null;
    const itemType: FlatMenuItem["itemType"] = /beverage|drink/i.test(category)
      ? "drink"
      : "food";
    const items = Array.isArray(section.items) ? section.items : [];

    for (const item of items) {
      const baseName = normalizedText(item.name);
      if (!baseName) {
        throw new Error(
          `Approved menu section ${category} has an unnamed item.`,
        );
      }
      const description = buildDescription(item);
      const variants = Array.isArray(item.variants) ? item.variants : [];

      if (variants.length > 0) {
        for (const variant of variants) {
          const label = normalizedText(variant.label);
          if (!label) {
            throw new Error(
              `Approved menu item ${baseName} has an unnamed variant.`,
            );
          }
          const name = `${baseName} (${label})`;
          rows.push({
            category,
            categoryDescription,
            name,
            description,
            priceCents: priceToCents(variant.price, name),
            itemType,
            categorySortOrder,
            itemSortOrder: itemSortOrder++,
          });
        }
        continue;
      }

      const size = normalizedText(item.size);
      const name =
        size && !baseName.toLowerCase().includes(size.toLowerCase())
          ? `${baseName} (${size})`
          : baseName;
      rows.push({
        category,
        categoryDescription,
        name,
        description,
        priceCents: priceToCents(item.price, name),
        itemType,
        categorySortOrder,
        itemSortOrder: itemSortOrder++,
      });
    }
  });

  if (rows.length === 0) {
    throw new Error("Approved 3D Eats menu evidence is empty.");
  }
  return rows;
};

const verification = JSON.parse(
  readFileSync(VERIFICATION_ARTIFACT, "utf8"),
) as JsonRecord;
const menuEvidence = JSON.parse(
  readFileSync(MENU_EVIDENCE_ARTIFACT, "utf8"),
) as MenuEvidence;
const approvedMenuRows = flattenApprovedMenu(menuEvidence);

const assertEvidenceIntegrity = () => {
  const authority = asRecord(verification.authority);
  const business = asRecord(verification.business);
  const canonicalTruth = asRecord(verification.canonicalTruth);
  const approvedSources = asRecord(verification.approvedSources);
  const expectedDimensions = asRecord(approvedSources.logoDimensions);
  if (
    authority.verified !== true ||
    normalizedText(authority.verifiedBy) !== "Thomas" ||
    normalizedText(authority.role) !== "MealScout admin and profile creator"
  ) {
    throw new Error("The 3D Eats admin verification authority is incomplete.");
  }
  if (
    normalizedText(business.id) !== TARGET_ID ||
    normalizedText(business.name) !== TARGET_NAME
  ) {
    throw new Error(
      "The admin verification artifact targets a different profile.",
    );
  }
  if (
    canonicalTruth.existingMealScoutProfile !== "authoritative" ||
    canonicalTruth.menuEvidence !== "admin_approved_for_reversible_apply" ||
    canonicalTruth.logoEvidence !== "admin_approved"
  ) {
    throw new Error(
      "The admin verification artifact does not approve this apply.",
    );
  }
  if (
    normalizedText(approvedSources.profileAndMenuEvidence) !==
      MENU_EVIDENCE_ARTIFACT ||
    normalizedText(approvedSources.logoPublicUrl) !== LOGO_PUBLIC_URL
  ) {
    throw new Error("The approved evidence sources changed unexpectedly.");
  }
  if (
    approvedMenuRows.length !== 74 ||
    new Set(approvedMenuRows.map((row) => row.category)).size !== 12
  ) {
    throw new Error(
      "The approved menu must contain exactly 74 rows in 12 sections.",
    );
  }
  if (
    sha256File(MENU_EVIDENCE_ARTIFACT) !==
      normalizedText(approvedSources.menuEvidenceSha256) ||
    createHash("sha256")
      .update(JSON.stringify(menuEvidence.menu))
      .digest("hex") !== normalizedText(approvedSources.menuCanonicalSha256) ||
    sha256File(LOGO_REPO_PATH) !== normalizedText(approvedSources.logoSha256)
  ) {
    throw new Error(
      "Approved 3D Eats evidence failed its SHA-256 integrity check.",
    );
  }
  if (
    Number(expectedDimensions.width) !== 2560 ||
    Number(expectedDimensions.height) !== 1793
  ) {
    throw new Error("The approved logo dimensions changed unexpectedly.");
  }
};

const storedRowsToFlatMenu = (
  categories: Array<Record<string, unknown>>,
  items: Array<Record<string, unknown>>,
): FlatMenuItem[] => {
  const orderedCategories = [...categories].sort((left, right) => {
    const order = Number(left.sortOrder) - Number(right.sortOrder);
    return (
      order || normalizedText(left.id).localeCompare(normalizedText(right.id))
    );
  });
  const categoryNameById = new Map(
    orderedCategories.map((category) => [
      normalizedText(category.id),
      normalizedText(category.name),
    ]),
  );
  const categoryDescriptionById = new Map(
    orderedCategories.map((category) => [
      normalizedText(category.id),
      normalizedText(category.description) || null,
    ]),
  );
  const categoryOrderByName = new Map<string, number>();
  orderedCategories.forEach((category, index) => {
    const name = normalizedText(category.name) || "Menu";
    if (!categoryOrderByName.has(name)) categoryOrderByName.set(name, index);
  });

  return [...items]
    .sort((left, right) => {
      const leftCategory =
        categoryNameById.get(normalizedText(left.categoryId)) || "Menu";
      const rightCategory =
        categoryNameById.get(normalizedText(right.categoryId)) || "Menu";
      const categoryOrder =
        (categoryOrderByName.get(leftCategory) ?? Number.MAX_SAFE_INTEGER) -
        (categoryOrderByName.get(rightCategory) ?? Number.MAX_SAFE_INTEGER);
      const itemOrder = Number(left.sortOrder) - Number(right.sortOrder);
      return (
        categoryOrder ||
        itemOrder ||
        normalizedText(left.id).localeCompare(normalizedText(right.id))
      );
    })
    .map((item, itemSortOrder) => {
      const categoryId = normalizedText(item.categoryId);
      const category = categoryNameById.get(categoryId) || "Menu";
      return {
        category,
        categoryDescription: categoryDescriptionById.get(categoryId) || null,
        name: normalizedText(item.name),
        description: normalizedText(item.description) || null,
        priceCents: Number(item.priceCents),
        itemType: normalizedText(item.itemType) === "drink" ? "drink" : "food",
        categorySortOrder:
          categoryOrderByName.get(category) ?? categoryOrderByName.size,
        itemSortOrder,
      };
    });
};

const loadLockedMenuState = async (tx: any): Promise<LockedMenuState> => {
  const menuRows = await tx
    .select()
    .from(menus)
    .where(eq(menus.restaurantId, TARGET_ID))
    .for("update");
  const menuIds = menuRows
    .map((menu: any) => normalizedText(menu.id))
    .filter(Boolean);
  if (menuIds.length === 0) {
    return {
      menuRows: [],
      categoryRows: [],
      itemRows: [],
      variantRows: [],
      modifierRows: [],
    };
  }
  const [categoryRows, itemRows] = await Promise.all([
    tx
      .select()
      .from(menuCategories)
      .where(inArray(menuCategories.menuId, menuIds))
      .for("update"),
    tx
      .select()
      .from(menuItems)
      .where(inArray(menuItems.menuId, menuIds))
      .for("update"),
  ]);
  const itemIds = itemRows
    .map((item: any) => normalizedText(item.id))
    .filter(Boolean);
  const [variantRows, modifierRows] =
    itemIds.length > 0
      ? await Promise.all([
          tx
            .select()
            .from(menuItemVariants)
            .where(inArray(menuItemVariants.menuItemId, itemIds))
            .for("update"),
          tx
            .select()
            .from(menuItemModifiers)
            .where(inArray(menuItemModifiers.menuItemId, itemIds))
            .for("update"),
        ])
      : [[], []];
  return {
    menuRows,
    categoryRows,
    itemRows,
    variantRows,
    modifierRows,
  };
};

const publicRevisionForState = (state: LockedMenuState) => {
  const activeMenus = state.menuRows.filter((menu) => menu.isActive === true);
  const activeMenuIds = new Set(
    activeMenus.map((menu) => normalizedText(menu.id)),
  );
  const activeCategories = state.categoryRows.filter(
    (category) =>
      category.isActive === true &&
      activeMenuIds.has(normalizedText(category.menuId)),
  );
  const availableItems = state.itemRows.filter(
    (item) =>
      item.isAvailable === true &&
      normalizedText(item.restaurantId) === TARGET_ID &&
      activeMenuIds.has(normalizedText(item.menuId)),
  );
  const availableItemIds = new Set(
    availableItems.map((item) => normalizedText(item.id)),
  );
  return createStructuredMenuRevision({
    menus: activeMenus,
    categories: activeCategories,
    items: availableItems,
    variants: state.variantRows.filter((variant) =>
      availableItemIds.has(normalizedText(variant.menuItemId)),
    ),
    modifiers: state.modifierRows.filter((modifier) =>
      availableItemIds.has(normalizedText(modifier.menuItemId)),
    ),
  });
};

const activeCanonicalRows = (state: LockedMenuState) => {
  const activeMenuIds = new Set(
    state.menuRows
      .filter((menu) => menu.isActive === true)
      .map((menu) => normalizedText(menu.id)),
  );
  const activeCategories = state.categoryRows.filter(
    (category) =>
      category.isActive === true &&
      activeMenuIds.has(normalizedText(category.menuId)),
  );
  const availableItems = state.itemRows.filter(
    (item) =>
      item.isAvailable === true &&
      activeMenuIds.has(normalizedText(item.menuId)),
  );
  return storedRowsToFlatMenu(activeCategories, availableItems);
};

const assertCanonicalMenuMatchesBaseline = (state: LockedMenuState) => {
  const baseline = asRecord(verification.productionBaseline);
  const baselineItems = Array.isArray(baseline.activeMenuItems)
    ? baseline.activeMenuItems.map(asRecord)
    : [];
  const activeMenus = state.menuRows.filter((menu) => menu.isActive === true);
  const activeMenuIds = new Set(
    activeMenus.map((menu) => normalizedText(menu.id)),
  );
  if (
    activeMenus.length !== 1 ||
    normalizedText(activeMenus[0].id) !== normalizedText(baseline.activeMenuId)
  ) {
    throw new Error(
      "The active 3D Eats menu changed after the production baseline; refusing to guess.",
    );
  }
  const baselineMenuItemIds = baselineItems
    .map((item) => normalizedText(item.menuItemId))
    .filter(Boolean)
    .sort();
  const currentMenuItemIds = state.itemRows
    .filter(
      (item) =>
        item.isAvailable === true &&
        activeMenuIds.has(normalizedText(item.menuId)),
    )
    .map((item) => normalizedText(item.id))
    .filter(Boolean)
    .sort();
  const baselineSignatures = baselineItems
    .map((item) =>
      [
        normalizedText(item.category),
        normalizedText(item.name),
        Number(item.priceCents),
        normalizedText(item.description),
        normalizedText(item.itemType) || "food",
      ].join("\u0000"),
    )
    .sort();
  const currentSignatures = activeCanonicalRows(state)
    .map((row) =>
      [
        row.category,
        row.name,
        row.priceCents,
        normalizedText(row.description),
        row.itemType,
      ].join("\u0000"),
    )
    .sort();
  if (
    baselineSignatures.length === 0 ||
    !sameStringArrays(currentMenuItemIds, baselineMenuItemIds) ||
    !sameStringArrays(currentSignatures, baselineSignatures)
  ) {
    throw new Error(
      "The current 3D Eats menu changed after the recorded production baseline; refusing to overwrite newer menu truth.",
    );
  }
};

const buildAdminApproval = (
  currentApproval: JsonRecord,
  menuRevision: string,
  appliedAt: string,
) => ({
  ...currentApproval,
  status: ADMIN_APPROVAL_STATUS,
  ownerApproved: false,
  adminApproved: true,
  ownerApprovalRequired: false,
  reviewedAt: appliedAt,
  reviewedByAuthority: "MealScout admin and profile creator",
  approvalAuthority: "mealscout_admin_profile_creator",
  verificationArtifact: VERIFICATION_ARTIFACT,
  previousStatus: normalizedText(currentApproval.status) || null,
  approvedMenuRevision: menuRevision,
  approvedMenuRevisionAlgorithm: MENU_REVISION_ALGORITHM,
  rejectedMenuRevision: null,
  rejectedMenuRevisionAlgorithm: null,
});

const exactAppliedApproval = (approval: JsonRecord, lane: JsonRecord) =>
  sameJson(approval, lane.appliedOwnerMenuApproval) &&
  sha256Json(approval) ===
    normalizedText(lane.appliedOwnerMenuApprovalSha256) &&
  normalizedText(approval.status) === ADMIN_APPROVAL_STATUS &&
  approval.adminApproved === true &&
  approval.ownerApproved === false &&
  normalizedText(approval.approvedMenuRevision) ===
    normalizedText(lane.menuRevision);

const idsFromLane = (lane: JsonRecord, key: string) =>
  Array.isArray(lane[key])
    ? (lane[key] as unknown[]).map(normalizedText).filter(Boolean)
    : [];

const categorySnapshot = (row: Record<string, unknown>) => ({
  id: normalizedText(row.id),
  menuId: normalizedText(row.menuId),
  restaurantId: normalizedText(row.restaurantId),
  name: normalizedText(row.name),
  description: normalizedText(row.description) || null,
  sortOrder: Number(row.sortOrder),
});

const itemSnapshot = (row: Record<string, unknown>) => ({
  id: normalizedText(row.id),
  menuId: normalizedText(row.menuId),
  categoryId: normalizedText(row.categoryId),
  restaurantId: normalizedText(row.restaurantId),
  name: normalizedText(row.name),
  description: normalizedText(row.description) || null,
  priceCents: Number(row.priceCents),
  itemType: normalizedText(row.itemType),
  imageUrl: normalizedText(row.imageUrl) || null,
  sku: normalizedText(row.sku) || null,
  calories: row.calories == null ? null : Number(row.calories),
  proteinG: row.proteinG == null ? null : normalizedText(row.proteinG),
  carbsG: row.carbsG == null ? null : normalizedText(row.carbsG),
  fatG: row.fatG == null ? null : normalizedText(row.fatG),
  allergens: row.allergens ?? [],
  dietaryTags: row.dietaryTags ?? [],
  trackInventory: row.trackInventory === true,
  inventoryQty: row.inventoryQty == null ? null : Number(row.inventoryQty),
  availableFrom: normalizedText(row.availableFrom) || null,
  availableTo: normalizedText(row.availableTo) || null,
  sortOrder: Number(row.sortOrder),
});

const insertedSnapshots = (
  state: LockedMenuState,
  insertedCategoryIds: string[],
  insertedMenuItemIds: string[],
) => ({
  categorySnapshots: state.categoryRows
    .filter((row) => insertedCategoryIds.includes(normalizedText(row.id)))
    .map(categorySnapshot)
    .sort((left, right) => left.id.localeCompare(right.id)),
  itemSnapshots: state.itemRows
    .filter((row) => insertedMenuItemIds.includes(normalizedText(row.id)))
    .map(itemSnapshot)
    .sort((left, right) => left.id.localeCompare(right.id)),
});

const assertInsertedRowsMatchReceipt = (
  state: LockedMenuState,
  lane: JsonRecord,
  expectPublic: boolean,
) => {
  const insertedCategoryIds = idsFromLane(lane, "insertedCategoryIds").sort();
  const insertedMenuItemIds = idsFromLane(lane, "insertedMenuItemIds").sort();
  const foundCategories = state.categoryRows
    .filter((row) => insertedCategoryIds.includes(normalizedText(row.id)))
    .sort((left, right) =>
      normalizedText(left.id).localeCompare(normalizedText(right.id)),
    );
  const foundItems = state.itemRows
    .filter((row) => insertedMenuItemIds.includes(normalizedText(row.id)))
    .sort((left, right) =>
      normalizedText(left.id).localeCompare(normalizedText(right.id)),
    );
  const unrecordedCategoryItemIds = state.itemRows
    .filter(
      (row) =>
        insertedCategoryIds.includes(normalizedText(row.categoryId)) &&
        !insertedMenuItemIds.includes(normalizedText(row.id)),
    )
    .map((row) => normalizedText(row.id));
  const currentSnapshots = insertedSnapshots(
    state,
    insertedCategoryIds,
    insertedMenuItemIds,
  );
  if (
    insertedCategoryIds.length !== 12 ||
    insertedMenuItemIds.length !== 74 ||
    foundCategories.length !== insertedCategoryIds.length ||
    foundItems.length !== insertedMenuItemIds.length ||
    foundCategories.some((row) => row.isActive !== expectPublic) ||
    foundItems.some((row) => row.isAvailable !== expectPublic) ||
    unrecordedCategoryItemIds.length > 0 ||
    !sameJson(
      currentSnapshots.categorySnapshots,
      lane.insertedCategorySnapshots,
    ) ||
    !sameJson(currentSnapshots.itemSnapshots, lane.insertedItemSnapshots)
  ) {
    throw new Error(
      "The inserted 3D Eats menu rows changed after the recorded apply; refusing to overwrite them.",
    );
  }
};

const assertNoRollbackDependencies = async (
  tx: any,
  lockedRestaurant: Record<string, unknown>,
  insertedMenuItemIds: string[],
) => {
  const [recommendations, photos, orderItems] = await Promise.all([
    tx
      .select({ id: menuItemRecommendations.id })
      .from(menuItemRecommendations)
      .where(inArray(menuItemRecommendations.menuItemId, insertedMenuItemIds))
      .limit(1)
      .for("update"),
    tx
      .select({ id: menuItemPhotos.id })
      .from(menuItemPhotos)
      .where(inArray(menuItemPhotos.menuItemId, insertedMenuItemIds))
      .limit(1)
      .for("update"),
    tx
      .select({ id: pickupOrderItems.id })
      .from(pickupOrderItems)
      .where(inArray(pickupOrderItems.menuItemId, insertedMenuItemIds))
      .limit(1)
      .for("update"),
  ]);
  if (
    recommendations.length > 0 ||
    photos.length > 0 ||
    orderItems.length > 0 ||
    insertedMenuItemIds.includes(
      normalizedText(lockedRestaurant.featuredMenuItemId),
    )
  ) {
    throw new Error(
      "An inserted menu item has customer, photo, order, or featured-item activity; refusing to hide it during rollback.",
    );
  }
};

async function dryRun() {
  const [current] = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      logoUrl: restaurants.logoUrl,
      rawData: restaurants.rawData,
      updatedAt: restaurants.updatedAt,
    })
    .from(restaurants)
    .where(eq(restaurants.id, TARGET_ID))
    .limit(1);
  if (!current || current.name !== TARGET_NAME) {
    throw new Error(
      `Verified ${TARGET_NAME} profile was not found at ${TARGET_ID}.`,
    );
  }
  const activeMenus = await db
    .select()
    .from(menus)
    .where(and(eq(menus.restaurantId, TARGET_ID), eq(menus.isActive, true)));
  const activeMenuIds = activeMenus
    .map((menu: any) => normalizedText(menu.id))
    .filter(Boolean);
  const [categories, items] =
    activeMenuIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(menuCategories)
            .where(inArray(menuCategories.menuId, activeMenuIds)),
          db
            .select()
            .from(menuItems)
            .where(inArray(menuItems.menuId, activeMenuIds)),
        ])
      : [[], []];
  const canonicalRows = storedRowsToFlatMenu(
    (categories as Array<Record<string, unknown>>).filter(
      (category) => category.isActive === true,
    ),
    (items as Array<Record<string, unknown>>).filter(
      (item) => item.isAvailable === true,
    ),
  );
  const merge = planApprovedMenuAdditions(canonicalRows, approvedMenuRows);

  return {
    lane: "3d_eats_admin_verified_profile",
    mode: "dry_run",
    target: { id: current.id, name: current.name },
    authorityVerified: true,
    approvedMenu: { sections: 12, items: 74 },
    current: {
      logoUrl: current.logoUrl || null,
      activeMenus: activeMenus.map((menu: any) => ({
        id: menu.id,
        name: menu.name,
        serviceType: menu.serviceType,
      })),
      canonicalItemsPreservedInPlace: canonicalRows.length,
      updatedAt: current.updatedAt,
    },
    plan: {
      menuRowsToInsert: merge.rowsToInsert.length,
      exactDuplicatesSkipped: merge.exactDuplicatesSkipped,
      conflictsWhereCanonicalWins: merge.conflicts,
      existingMenuAndItemIdsPreserved: true,
      reversibleByDeactivation: true,
      bindAdminApprovalToExactRevision: true,
      applyWebsiteLogoOnlyIfBlank: true,
      addressWrites: 0,
      scheduleWrites: 0,
    },
    productionApplied: false,
  };
}

async function applyVerifiedProfile() {
  return db.transaction(
    async (tx: any) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${TARGET_ID}))`,
      );
      const [locked] = await tx
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, TARGET_ID))
        .limit(1)
        .for("update");
      if (!locked || locked.name !== TARGET_NAME) {
        throw new Error(
          `Verified ${TARGET_NAME} profile changed or disappeared before apply.`,
        );
      }

      const currentRawData = asRecord(locked.rawData);
      const lane = asRecord(currentRawData.threeDEatsAdminVerifiedProfile);
      const currentApproval = asRecord(currentRawData.ownerMenuApproval);
      const currentApprovalWasPresent = Object.prototype.hasOwnProperty.call(
        currentRawData,
        "ownerMenuApproval",
      );
      const beforeState = await loadLockedMenuState(tx);
      const beforeRevision = publicRevisionForState(beforeState).revision;
      const laneStatus = normalizedText(lane.status);

      if (laneStatus === "applied") {
        assertInsertedRowsMatchReceipt(beforeState, lane, true);
        if (
          beforeRevision !== normalizedText(lane.menuRevision) ||
          !exactAppliedApproval(currentApproval, lane) ||
          (lane.logoApplied === true &&
            normalizedText(locked.logoUrl) !== LOGO_PUBLIC_URL)
        ) {
          throw new Error(
            "3D Eats changed after the recorded apply; refusing to overwrite newer truth.",
          );
        }
        return {
          lane: "3d_eats_admin_verified_profile",
          mode: "apply",
          target: { id: TARGET_ID, name: TARGET_NAME },
          menuRevision: beforeRevision,
          noOp: true,
          productionApplied: true,
        };
      }

      if (laneStatus === "rolled_back") {
        assertInsertedRowsMatchReceipt(beforeState, lane, false);
        if (
          beforeRevision !== normalizedText(lane.previousMenuRevision) ||
          !sameJson(currentApproval, lane.previousOwnerMenuApproval) ||
          currentApprovalWasPresent !==
            (lane.previousOwnerMenuApprovalWasPresent === true) ||
          (lane.logoApplied === true &&
            normalizedText(locked.logoUrl) !==
              normalizedText(lane.previousLogoUrl))
        ) {
          throw new Error(
            "3D Eats changed after rollback; refusing to overwrite newer truth.",
          );
        }
        const insertedCategoryIds = idsFromLane(lane, "insertedCategoryIds");
        const insertedMenuItemIds = idsFromLane(lane, "insertedMenuItemIds");
        await tx
          .update(menuCategories)
          .set({ isActive: true } as any)
          .where(inArray(menuCategories.id, insertedCategoryIds));
        await tx
          .update(menuItems)
          .set({ isAvailable: true } as any)
          .where(inArray(menuItems.id, insertedMenuItemIds));
        const reactivatedState = await loadLockedMenuState(tx);
        const reactivatedRevision =
          publicRevisionForState(reactivatedState).revision;
        if (reactivatedRevision !== normalizedText(lane.menuRevision)) {
          throw new Error(
            "Reactivated menu does not match the recorded approved revision.",
          );
        }
        const reappliedAt = new Date().toISOString();
        const appliedOwnerMenuApproval = buildAdminApproval(
          currentApproval,
          reactivatedRevision,
          reappliedAt,
        );
        const nextLane = {
          ...lane,
          status: "applied",
          appliedAt: reappliedAt,
          reappliedAt,
          appliedOwnerMenuApproval,
          appliedOwnerMenuApprovalSha256: sha256Json(appliedOwnerMenuApproval),
        };
        const logoApplied = lane.logoApplied === true;
        await tx
          .update(restaurants)
          .set({
            logoUrl: logoApplied ? LOGO_PUBLIC_URL : locked.logoUrl,
            rawData: {
              ...currentRawData,
              ownerMenuApproval: appliedOwnerMenuApproval,
              threeDEatsAdminVerifiedProfile: nextLane,
            },
            updatedAt: new Date(reappliedAt),
          } as any)
          .where(eq(restaurants.id, TARGET_ID));
        return {
          lane: "3d_eats_admin_verified_profile",
          mode: "apply",
          target: { id: TARGET_ID, name: TARGET_NAME },
          menuRevision: reactivatedRevision,
          reactivatedMenuItemIds: insertedMenuItemIds,
          reactivatedCategoryIds: insertedCategoryIds,
          noOp: false,
          productionApplied: true,
        };
      }

      if (laneStatus) {
        throw new Error(
          `Unknown prior 3D Eats apply state ${laneStatus}; refusing to guess.`,
        );
      }

      assertCanonicalMenuMatchesBaseline(beforeState);
      if (!beforeRevision) {
        throw new Error("The canonical 3D Eats menu has no public revision.");
      }
      const activeMenus = beforeState.menuRows.filter(
        (menu) => menu.isActive === true,
      );
      const activeMenuId = normalizedText(activeMenus[0].id);
      const canonicalRows = activeCanonicalRows(beforeState);
      const merge = planApprovedMenuAdditions(canonicalRows, approvedMenuRows);
      if (
        merge.rowsToInsert.length !== 74 ||
        merge.exactDuplicatesSkipped !== 0 ||
        merge.conflicts.length !== 0
      ) {
        throw new Error(
          "The approved menu no longer adds exactly 74 non-conflicting rows.",
        );
      }

      const maxCategorySortOrder = beforeState.categoryRows
        .filter((category) => normalizedText(category.menuId) === activeMenuId)
        .reduce(
          (maximum, category) =>
            Math.max(maximum, Number(category.sortOrder) || 0),
          -1,
        );
      const categoryIdByName = new Map<string, string>();
      const insertedCategoryIds: string[] = [];
      for (const [index, categoryName] of Array.from(
        new Set(merge.rowsToInsert.map((row) => row.category)),
      ).entries()) {
        const source = merge.rowsToInsert.find(
          (row) => row.category === categoryName,
        )!;
        const [category] = await tx
          .insert(menuCategories)
          .values({
            menuId: activeMenuId,
            restaurantId: TARGET_ID,
            name: categoryName,
            description: source.categoryDescription,
            sortOrder: maxCategorySortOrder + index + 1,
            isActive: true,
          } as any)
          .returning();
        insertedCategoryIds.push(normalizedText(category.id));
        categoryIdByName.set(categoryName, normalizedText(category.id));
      }

      const maxItemSortOrder = beforeState.itemRows
        .filter((item) => normalizedText(item.menuId) === activeMenuId)
        .reduce(
          (maximum, item) => Math.max(maximum, Number(item.sortOrder) || 0),
          -1,
        );
      const insertedMenuItemIds: string[] = [];
      for (const [index, row] of merge.rowsToInsert.entries()) {
        const [item] = await tx
          .insert(menuItems)
          .values({
            menuId: activeMenuId,
            categoryId: categoryIdByName.get(row.category),
            restaurantId: TARGET_ID,
            name: row.name,
            description: row.description,
            priceCents: row.priceCents,
            itemType: row.itemType,
            isAvailable: true,
            sortOrder: maxItemSortOrder + index + 1,
          } as any)
          .returning();
        insertedMenuItemIds.push(normalizedText(item.id));
      }

      const afterState = await loadLockedMenuState(tx);
      const afterRevision = publicRevisionForState(afterState).revision;
      if (!afterRevision || afterRevision === beforeRevision) {
        throw new Error(
          "The approved menu rows did not produce a new revision.",
        );
      }
      const appliedAt = new Date().toISOString();
      const appliedOwnerMenuApproval = buildAdminApproval(
        currentApproval,
        afterRevision,
        appliedAt,
      );
      const snapshots = insertedSnapshots(
        afterState,
        insertedCategoryIds,
        insertedMenuItemIds,
      );
      const logoApplied = !normalizedText(locked.logoUrl);
      const nextLane = {
        status: "applied",
        targetId: TARGET_ID,
        targetName: TARGET_NAME,
        verificationArtifact: VERIFICATION_ARTIFACT,
        menuEvidenceArtifact: MENU_EVIDENCE_ARTIFACT,
        menuEvidenceSha256: sha256File(MENU_EVIDENCE_ARTIFACT),
        menuRevisionAlgorithm: MENU_REVISION_ALGORITHM,
        menuId: activeMenuId,
        previousMenuRevision: beforeRevision,
        menuRevision: afterRevision,
        canonicalMenuItemCount: canonicalRows.length,
        approvedEvidenceItemCount: approvedMenuRows.length,
        insertedCategoryIds,
        insertedMenuItemIds,
        insertedCategorySnapshots: snapshots.categorySnapshots,
        insertedItemSnapshots: snapshots.itemSnapshots,
        previousOwnerMenuApproval: currentApproval,
        previousOwnerMenuApprovalWasPresent: currentApprovalWasPresent,
        appliedOwnerMenuApproval,
        appliedOwnerMenuApprovalSha256: sha256Json(appliedOwnerMenuApproval),
        previousLogoUrl: normalizedText(locked.logoUrl) || null,
        logoApplied,
        logoPublicUrl: logoApplied ? LOGO_PUBLIC_URL : locked.logoUrl,
        logoSha256: sha256File(LOGO_REPO_PATH),
        appliedAt,
        safeguards: {
          existingMenuIdPreserved: true,
          existingMenuItemIdsPreserved: true,
          insertedRowsReversibleByDeactivation: true,
          accountRowsCreated: 0,
          accountRowsDeleted: 0,
          addressWrites: 0,
          scheduleWrites: 0,
        },
      };
      await tx
        .update(restaurants)
        .set({
          logoUrl: logoApplied ? LOGO_PUBLIC_URL : locked.logoUrl,
          rawData: {
            ...currentRawData,
            ownerMenuApproval: appliedOwnerMenuApproval,
            threeDEatsAdminVerifiedProfile: nextLane,
          },
          updatedAt: new Date(appliedAt),
        } as any)
        .where(eq(restaurants.id, TARGET_ID));

      return {
        lane: "3d_eats_admin_verified_profile",
        mode: "apply",
        appliedAt,
        target: { id: TARGET_ID, name: TARGET_NAME },
        verificationArtifact: VERIFICATION_ARTIFACT,
        menu: {
          id: activeMenuId,
          previousRevision: beforeRevision,
          revision: afterRevision,
          revisionAlgorithm: MENU_REVISION_ALGORITHM,
          canonicalItemsPreservedInPlace: canonicalRows.length,
          approvedEvidenceItems: approvedMenuRows.length,
          insertedCategoryIds,
          insertedMenuItemIds,
          existingMenuIdPreserved: true,
          existingMenuItemIdsPreserved: true,
        },
        logo: {
          publicUrl: logoApplied ? LOGO_PUBLIC_URL : locked.logoUrl,
          applied: logoApplied,
          existingLogoPreserved: !logoApplied,
        },
        safeguards: nextLane.safeguards,
        noOp: false,
        productionApplied: true,
      };
    },
    { isolationLevel: "serializable" },
  );
}

async function rollbackVerifiedProfile() {
  return db.transaction(
    async (tx: any) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${TARGET_ID}))`,
      );
      const [locked] = await tx
        .select()
        .from(restaurants)
        .where(eq(restaurants.id, TARGET_ID))
        .limit(1)
        .for("update");
      if (!locked || locked.name !== TARGET_NAME) {
        throw new Error(`Verified ${TARGET_NAME} profile was not found.`);
      }

      const currentRawData = asRecord(locked.rawData);
      const lane = asRecord(currentRawData.threeDEatsAdminVerifiedProfile);
      if (normalizedText(lane.status) !== "applied") {
        throw new Error(
          "No applied 3D Eats admin-verified revision to roll back.",
        );
      }
      const currentApproval = asRecord(currentRawData.ownerMenuApproval);
      const beforeState = await loadLockedMenuState(tx);
      assertInsertedRowsMatchReceipt(beforeState, lane, true);
      const beforeRevision = publicRevisionForState(beforeState).revision;
      if (
        beforeRevision !== normalizedText(lane.menuRevision) ||
        !exactAppliedApproval(currentApproval, lane)
      ) {
        throw new Error(
          "The menu or approval changed after this apply; refusing to overwrite newer truth.",
        );
      }

      const logoApplied = lane.logoApplied === true;
      if (logoApplied && normalizedText(locked.logoUrl) !== LOGO_PUBLIC_URL) {
        throw new Error(
          "The logo changed after this apply; refusing to overwrite the newer logo.",
        );
      }
      const insertedMenuItemIds = idsFromLane(lane, "insertedMenuItemIds");
      const insertedCategoryIds = idsFromLane(lane, "insertedCategoryIds");
      await assertNoRollbackDependencies(
        tx,
        locked as Record<string, unknown>,
        insertedMenuItemIds,
      );
      await tx
        .update(menuItems)
        .set({ isAvailable: false } as any)
        .where(inArray(menuItems.id, insertedMenuItemIds));
      await tx
        .update(menuCategories)
        .set({ isActive: false } as any)
        .where(inArray(menuCategories.id, insertedCategoryIds));
      const afterState = await loadLockedMenuState(tx);
      const afterRevision = publicRevisionForState(afterState).revision;
      if (afterRevision !== normalizedText(lane.previousMenuRevision)) {
        throw new Error(
          "Rollback did not restore the exact previous public menu revision.",
        );
      }

      const previousOwnerMenuApproval = asRecord(
        lane.previousOwnerMenuApproval,
      );
      const nextRawData: JsonRecord = {
        ...currentRawData,
        threeDEatsAdminVerifiedProfile: {
          ...lane,
          status: "rolled_back",
          rolledBackAt: new Date().toISOString(),
        },
      };
      if (lane.previousOwnerMenuApprovalWasPresent === true) {
        nextRawData.ownerMenuApproval = previousOwnerMenuApproval;
      } else {
        delete nextRawData.ownerMenuApproval;
      }
      const previousLogoUrl = normalizedText(lane.previousLogoUrl) || null;
      await tx
        .update(restaurants)
        .set({
          logoUrl: logoApplied ? previousLogoUrl : locked.logoUrl,
          rawData: nextRawData,
          updatedAt: new Date(),
        } as any)
        .where(eq(restaurants.id, TARGET_ID));

      return {
        lane: "3d_eats_admin_verified_profile",
        mode: "rollback",
        target: { id: TARGET_ID, name: TARGET_NAME },
        restoredMenuRevision: afterRevision,
        deactivatedMenuItemIds: insertedMenuItemIds,
        deactivatedCategoryIds: insertedCategoryIds,
        restoredLogoUrl: logoApplied ? previousLogoUrl : locked.logoUrl,
        logoRestored: logoApplied,
        rowsDeleted: 0,
        productionApplied: false,
        rollbackApplied: true,
      };
    },
    { isolationLevel: "serializable" },
  );
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }
  if (apply && rollback) {
    throw new Error("Choose either --apply or --rollback, not both.");
  }
  if ((apply || rollback) && !allowProduction) {
    throw new Error("Production mutation requires --allow-production.");
  }
  if (apply && !confirmAdminVerification) {
    throw new Error(
      "Apply requires --confirm-admin-verification to acknowledge the recorded authority decision.",
    );
  }
  assertEvidenceIntegrity();

  const result = rollback
    ? await rollbackVerifiedProfile()
    : apply
      ? await applyVerifiedProfile()
      : await dryRun();
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error("apply3dEatsAdminVerifiedProfile failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end?.();
  });
