import { readFileSync } from "node:fs";

const readText = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const restaurantOps = readText("server/routes/restaurantOperationsRoutes.ts");
const publicProfileMapper = readText(
  "server/publicProfiles/toPublicRestaurantProfile.ts",
);
const publicProfilePage = readText("client/src/pages/public-profile.tsx");
const publicDiscovery = readText("server/routes/publicDiscoveryRoutes.ts");
const menuRevision = readText("server/services/menuRevision.ts");
const ownerDashboard = readText(
  "client/src/pages/restaurant-owner-dashboard.tsx",
);
const sweetLoveApply = readText("scripts/applySweetLovePartialMenu.ts");
const normalizeWhitespace = (value: string) =>
  value.replace(/\s+/g, " ").trim();

const requireIncludes = (source: string, snippet: string, message: string) => {
  if (!normalizeWhitespace(source).includes(normalizeWhitespace(snippet)))
    throw new Error(message);
};

const requireExcludes = (source: string, snippet: string, message: string) => {
  if (normalizeWhitespace(source).includes(normalizeWhitespace(snippet)))
    throw new Error(message);
};

requireIncludes(
  restaurantOps,
  "const buildOwnerMenuApprovalState",
  "Owner restaurant payload must derive a truck menu approval state.",
);
requireIncludes(
  restaurantOps,
  '"/api/restaurants/:restaurantId/menu-approval"',
  "Owner dashboard must have an explicit menu approval action endpoint.",
);
requireIncludes(
  restaurantOps,
  'z.enum(["approve", "reject", "skip"])',
  "Owner menu review must support approve, reject, and skip actions.",
);
requireIncludes(
  restaurantOps,
  "ownerApprovalRequired",
  "Unapproved truck menus must keep an owner approval requirement active.",
);
requireIncludes(
  restaurantOps,
  '? "approved"',
  "Owner approval action must explicitly mark the menu approved.",
);
requireIncludes(
  restaurantOps,
  '? "rejected"',
  "Owner rejection action must explicitly mark the menu not current.",
);
requireIncludes(
  restaurantOps,
  ': "skipped"',
  "Skipping review must be stored separately from approval.",
);
requireIncludes(
  restaurantOps,
  'ownerApprovalRequired: body.action === "skip"',
  "Skipping review must keep approval required instead of approving the menu.",
);
requireIncludes(
  restaurantOps,
  "approvedMenuRevision",
  "Owner approval must bind to the exact structured menu revision.",
);
requireIncludes(
  restaurantOps,
  "rejectedMenuRevision",
  "Menu rejection must bind to the rejected revision so a rebuilt menu can be reviewed again.",
);
requireIncludes(
  restaurantOps,
  "canApproveCurrentMenu",
  "Fallback-only menus must not expose an approval action that the server rejects.",
);
requireIncludes(
  restaurantOps,
  "!rejected && claimsOwnerApproval",
  "A contradictory rejected menu must not retain owner-approved state.",
);

requireIncludes(
  ownerDashboard,
  'data-testid="truck-menu-owner-approval-task"',
  "Owner dashboard must show a required truck menu review task.",
);
requireIncludes(
  ownerDashboard,
  "Approve menu as current",
  "Owner dashboard must let owners approve the menu.",
);
requireIncludes(
  ownerDashboard,
  "Edit menu items/prices",
  "Owner dashboard must route owners to edit menu items/prices before approval.",
);
requireIncludes(
  ownerDashboard,
  "Mark menu not current",
  "Owner dashboard must let owners reject or mark a menu not current.",
);
requireIncludes(
  ownerDashboard,
  "Skip for now",
  "Owner dashboard must let owners skip while keeping review required.",
);
requireIncludes(
  ownerDashboard,
  "Viewing this page never approves the menu automatically.",
  "Dashboard copy must make clear that viewing does not auto-approve a menu.",
);

requireIncludes(
  publicProfileMapper,
  "Menu added from available source — needs owner confirmation",
  "Public truck profiles must label unapproved menus honestly.",
);
requireIncludes(
  publicProfileMapper,
  "Owner-approved menu",
  "Public truck profiles must label explicitly approved menus.",
);
requireIncludes(
  publicProfileMapper,
  "approvedMenuRevision === currentMenuRevision",
  "Public profiles must not inherit approval from an older menu revision.",
);
requireIncludes(
  publicProfileMapper,
  "!ownerMenuRejected && menuRevisionCoversRenderedMenu && Boolean(currentMenuRevision)",
  "Public rejected state must take precedence over stale owner-approved flags.",
);
requireIncludes(
  publicDiscovery,
  "menuRevision: menuRevisionEvidence.revision",
  "Public profile assembly must supply the current structured-menu revision.",
);
requireIncludes(
  publicDiscovery,
  "const menuRevisionEvidence = createStructuredMenuRevision",
  "Public menu revision must be computed from the exact rows used for the payload.",
);
requireIncludes(
  publicDiscovery,
  "String(row.importUrl || \"\").trim()",
  "The rendered external menu URL must come from the same full menu row included in the revision.",
);
requireIncludes(
  publicDiscovery,
  "menuRevisionCoversRenderedMenu: true",
  "The owner-approved label must be scoped to the exact structured payload revision.",
);
requireIncludes(
  publicProfileMapper,
  'menuApproval.status === "rejected" || ownerMenuApproved',
  "Unrevisioned external menu image and PDF surfaces must not inherit the structured owner-approved label.",
);
requireIncludes(
  publicDiscovery,
  "eq(menuItems.restaurantId, restaurantId)",
  "Public menu items must belong to the requested restaurant as well as its active menu.",
);
requireExcludes(
  publicDiscovery,
  "loadMenuRevisionEvidence(restaurantId)",
  "Public payload must not fetch an independent revision before fetching rendered content.",
);
requireIncludes(
  menuRevision,
  'MENU_REVISION_ALGORITHM = "structured-menu-sha256-v1"',
  "Menu approval must use a deterministic versioned revision algorithm.",
);
requireIncludes(
  menuRevision,
  "isMenuItemOwnedByRestaurantActiveMenu",
  "Completion revisions must exclude cross-linked items outside the restaurant's own active menus.",
);
requireIncludes(
  publicProfileMapper,
  "Menu unavailable / pending update",
  "Public truck profiles must label rejected menus as unavailable or pending update.",
);
requireIncludes(
  publicProfileMapper,
  'menuApproval.status === "rejected" ? [] : menuSections',
  "Rejected menus must not continue showing structured menu sections.",
);
requireIncludes(
  publicProfilePage,
  "menuApproval.ownerApproved",
  "Public profile UI must render owner-approved menu labels distinctly.",
);
requireIncludes(
  publicProfilePage,
  "Limited menu info",
  "Public profile menu copy must keep partial-menu truth compact and customer-facing.",
);

requireIncludes(
  sweetLoveApply,
  'const TRUCK_ID = "f3b76054-f355-43b0-a2d3-901277748557";',
  "Sweet Love partial menu script must keep the active production target id.",
);
requireExcludes(
  sweetLoveApply,
  "f3b76054-f355-43b0-ae18-53f549cecfd1",
  "Sweet Love partial menu script must not regress to the stale target id.",
);

console.log("truck-menu-owner-approval-gate.contract: PASS");
