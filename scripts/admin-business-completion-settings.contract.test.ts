import { readFileSync } from "node:fs";

const source = readFileSync(
  "server/routes/adminManagementRoutes.ts",
  "utf8",
).replace(/\r\n/g, "\n");

const routeStart = source.indexOf(
  '"/api/admin/business-profiles/:businessId/completion"',
);
const routeEnd = source.indexOf("\n  app.get(", routeStart);
if (routeStart < 0 || routeEnd < 0) {
  throw new Error("Could not isolate the admin business completion route.");
}
const route = source.slice(routeStart, routeEnd);

const helperStart = source.indexOf(
  "export const createLockedAdminBusinessCompletionMutation",
);
const helperEnd = source.indexOf(
  "const safeAdminCompletionErrorContext",
  helperStart,
);
if (helperStart < 0 || helperEnd < 0) {
  throw new Error("Could not isolate the locked completion helper.");
}
const helper = source.slice(helperStart, helperEnd);

for (const snippet of [
  "database.transaction(async (tx: any)",
  "pg_advisory_xact_lock",
  '.for("update")',
]) {
  if (!helper.includes(snippet)) {
    throw new Error(`Locked completion helper is missing: ${snippet}`);
  }
}

for (const snippet of [
  "withLockedAdminBusinessCompletion(",
  "settingsValue: lockedRestaurant.socialAutopostSettings",
  "mergeAdminBusinessCompletionSettings({",
  ".update(restaurants)",
  "...updates",
  "socialAutopostSettings",
  "safeAdminCompletionErrorContext(error)",
  '"Failed to update business completion fields"',
]) {
  if (!route.includes(snippet)) {
    throw new Error(`Admin completion route is missing: ${snippet}`);
  }
}

for (const unsafeSnippet of [
  "storage.updateRestaurant(businessId",
  "error.message",
  'console.error("Error updating business completion fields:", error)',
  "settingsValue: restaurant.socialAutopostSettings",
]) {
  if (route.includes(unsafeSnippet)) {
    throw new Error(`Admin completion route retained unsafe behavior: ${unsafeSnippet}`);
  }
}

const mergeStart = source.indexOf(
  "export const mergeAdminBusinessCompletionSettings",
);
const mergeEnd = source.indexOf(
  "export const createLockedAdminBusinessCompletionMutation",
  mergeStart,
);
const mergeHelper = source.slice(mergeStart, mergeEnd);
for (const snippet of [
  "...settings",
  "...asAdminCompletionRecord(settings.publicActionLinks)",
  "...asAdminCompletionRecord(settings.completionReview)",
  "...settings.publicGalleryImages",
]) {
  if (!mergeHelper.includes(snippet)) {
    throw new Error(`Completion settings merge is missing preservation: ${snippet}`);
  }
}

console.log("admin-business-completion-settings.contract: PASS");
