import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = readFileSync(
  path.join(process.cwd(), "server/routes/publicDiscoveryRoutes.ts"),
  "utf8",
);

assert(
  source.includes('const isMissingRelationError = (error: unknown, relationName?: string) =>'),
  "Missing relation guard helper must exist in public discovery routes",
);

assert(
  source.includes('isMissingRelationError(error, "menu_item_photos")'),
  "buildPublicMenuPayload must detect missing menu_item_photos relation",
);

assert(
  source.includes(
    '[public-profile] menu_item_photos missing; continuing without menu photos',
  ),
  "Missing relation should be logged as non-fatal warning",
);

assert(
  source.includes("publicPhotoRows = await db"),
  "Menu photo query should still run when table is present",
);

assert(
  source.includes("throw error;"),
  "Non-relation query errors must continue to fail loudly",
);

console.log("public-profile-menu-photo-schema.contract: PASS");

