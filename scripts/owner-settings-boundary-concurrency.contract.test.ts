import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const operations = read("server/routes/restaurantOperationsRoutes.ts");
const media = read("server/routes/mediaRoutes.ts");

function route(source: string, marker: string) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing route ${marker}`);
  const end = source.indexOf("\n  app.", start + marker.length);
  return source.slice(start, end < 0 ? source.length : end);
}

function requireAll(source: string, snippets: string[], label: string) {
  for (const snippet of snippets) {
    if (!source.includes(snippet)) {
      throw new Error(`${label} is missing required behavior: ${snippet}`);
    }
  }
}

requireAll(
  operations,
  [
    "const { rawData: _rawData, ...safeRestaurant } = restaurant",
    "sanitizeOwnerMutationRestaurant(updatedRestaurant)",
    "sanitizeOwnerMutationRestaurant(updated)",
    "withLockedRestaurantSettings",
    "pg_advisory_xact_lock",
    '.for("update")',
    "safePersistenceErrorContext(error)",
  ],
  "owner mutation boundary",
);

for (const marker of [
  '"/api/restaurants/:restaurantId/profile-basics"',
  '"/api/restaurants/:restaurantId/mobile-settings"',
  '"/api/restaurants/:restaurantId/location"',
  '"/api/restaurants/:restaurantId/operating-hours"',
  '"/api/restaurants/:restaurantId/social-settings"',
]) {
  const mutationRoute = route(operations, marker);
  if (!mutationRoute.includes("sanitizeOwnerMutationRestaurant(")) {
    throw new Error(`${marker} returns an unsanitized restaurant row.`);
  }
}

for (const marker of [
  '"/api/restaurants/:restaurantId/profile-basics"',
  '"/api/restaurants/:restaurantId/social-settings"',
]) {
  const settingsRoute = route(operations, marker);
  if (settingsRoute.includes('console.error("Error') || settingsRoute.includes("error.message")) {
    throw new Error(`${marker} may expose raw persistence error details.`);
  }
}

requireAll(
  route(operations, '"/api/restaurants/:restaurantId/profile-basics"'),
  ["withLockedRestaurantSettings(", "mergeOwnerProfileActionLinks("],
  "profile action-link writer",
);
requireAll(
  route(operations, '"/api/restaurants/:restaurantId/social-settings"'),
  ["withLockedRestaurantSettings(", "mergeOwnerSocialSettings("],
  "social settings writer",
);
requireAll(
  route(operations, '"/api/restaurants/:restaurantId/menu-approval"'),
  [
    "loadMenuRevisionEvidence(restaurantId)",
    "menuRevisionEvidence.publicItemCount",
    "approvedMenuRevision:",
    "MENU_REVISION_ALGORITHM",
    "menuRevisionEvidence.revision",
  ],
  "menu revision approval gate",
);

const sanitizerStart = operations.indexOf(
  "export const sanitizeOwnerWorkspaceSettings",
);
const sanitizerEnd = operations.indexOf(
  "export const sanitizeOwnerWorkspaceRestaurant",
  sanitizerStart,
);
const settingsSanitizer = operations.slice(sanitizerStart, sanitizerEnd);
for (const privateKey of ["evidenceApply", "ownerReview", "sourceIdentity"]) {
  if (settingsSanitizer.includes(privateKey)) {
    throw new Error(`Owner settings sanitizer exposes private key ${privateKey}.`);
  }
}

requireAll(
  media,
  [
    "createLockedRestaurantSettingsMutation",
    "database.transaction(async (tx: any)",
    "pg_advisory_xact_lock",
    '.for("update")',
    "appendRestaurantGalleryEntry(",
    "updateRestaurantGalleryEntry({",
    "safePersistenceErrorContext(error)",
  ],
  "media settings serialization",
);

for (const marker of [
  '"/api/upload/restaurant-logo"',
  '"/api/upload/restaurant-cover"',
  '"/api/upload/restaurant-gallery"',
  '"/api/restaurants/:restaurantId/media-gallery/:mediaId"',
]) {
  const mediaRoute = route(media, marker);
  if (!mediaRoute.includes("withLockedRestaurantSettings(")) {
    throw new Error(`${marker} does not use the restaurant settings lock.`);
  }
  if (mediaRoute.includes("storage.updateRestaurant(restaurantId, {\n          socialAutopostSettings")) {
    throw new Error(`${marker} still performs an unlocked settings write.`);
  }
  if (mediaRoute.includes('console.error("Error')) {
    throw new Error(`${marker} may log raw persistence error details.`);
  }
}

console.log("owner-settings-boundary-concurrency.contract: PASS");
