import { readFileSync } from "node:fs";

const schema = readFileSync("shared/schema/legacy.ts", "utf8");
const ordering = readFileSync("shared/schema/ordering.ts", "utf8");
const menuRoutes = readFileSync("server/routes/menuRoutes.ts", "utf8");
const migration = readFileSync(
  "migrations/108_menu_draft_review_tables.sql",
  "utf8",
);
const publicProfileMapper = readFileSync(
  "server/publicProfiles/toPublicRestaurantProfile.ts",
  "utf8",
);
const publicProfilePage = readFileSync(
  "client/src/pages/public-profile.tsx",
  "utf8",
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

for (const snippet of [
  "export const menuDraftReviews = pgTable",
  '"menu_draft_reviews"',
  "ownerApprovalNeeded",
  "ownerApproved",
  "productionApplied",
  "appliedMenuId",
  "export const menuDraftReviewItems = pgTable",
  '"menu_draft_review_items"',
  "sourceConfidence",
]) {
  assert(schema.includes(snippet), `Schema missing draft review snippet: ${snippet}`);
}

for (const snippet of [
  "menuDraftReviews",
  "menuDraftReviewItems",
  "MenuDraftReview",
  "MenuDraftReviewItem",
]) {
  assert(ordering.includes(snippet), `Ordering barrel missing export: ${snippet}`);
}

for (const snippet of [
  "CREATE TABLE IF NOT EXISTS menu_draft_reviews",
  "owner_approval_needed boolean NOT NULL DEFAULT true",
  "owner_approved boolean NOT NULL DEFAULT false",
  "production_applied boolean NOT NULL DEFAULT false",
  "CREATE TABLE IF NOT EXISTS menu_draft_review_items",
  "idx_menu_draft_reviews_status",
  "idx_menu_draft_review_items_review",
]) {
  assert(migration.includes(snippet), `Migration missing snippet: ${snippet}`);
}

for (const snippet of [
  '"/api/admin/menu-draft-reviews"',
  '"/api/admin/menu-draft-reviews/import-artifact"',
  '"/api/admin/menu-draft-reviews/:reviewId/review"',
  '"/api/admin/menu-draft-reviews/:reviewId/apply-plan"',
  "menuDraftArtifactSchema",
  "productionApplied === true",
  "entry.productionApplied === true || entry.ownerApproved === true",
  "approved_for_apply requires ownerApproved=true",
  "Owner approval requires evidence URL or review note",
  "mode: z.literal(\"plan\")",
  "confirmOwnerApproved: z.literal(true)",
  "confirmNoOverwrite: z.literal(true)",
  "status: \"apply_plan_only\"",
  "productionApplied: false",
]) {
  assert(menuRoutes.includes(snippet), `Menu routes missing safety snippet: ${snippet}`);
}

const draftRouteStart = menuRoutes.indexOf('"/api/admin/menu-draft-reviews/import-artifact"');
const draftRouteEnd = menuRoutes.indexOf('"/api/admin/menu-draft-reviews/:reviewId/apply-plan"');
assert(draftRouteStart > -1 && draftRouteEnd > draftRouteStart, "Draft route block not found");
const draftImportBlock = menuRoutes.slice(draftRouteStart, draftRouteEnd);
for (const forbidden of [
  "insert(menuItems)",
  "insert(menus)",
  "update(menus)",
  "importSource:",
  "isActive: true",
]) {
  assert(
    !draftImportBlock.includes(forbidden),
    `Draft import block must not publish canonical menu data: ${forbidden}`,
  );
}

assert(
  !publicProfileMapper.includes("menuDraftReviews") &&
    !publicProfileMapper.includes("menuDraftReviewItems"),
  "Public profile mapper must not render unapproved menu drafts",
);
assert(
  !publicProfilePage.includes("menuDraftReviews") &&
    !publicProfilePage.includes("menuDraftReviewItems"),
  "Public profile page must not render unapproved menu drafts",
);

console.log("menu-draft-review-apply-path.contract: PASS");
