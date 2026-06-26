import { readFileSync } from "node:fs";

const readText = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const restaurantOps = readText("server/routes/restaurantOperationsRoutes.ts");
const publicProfileMapper = readText("server/publicProfiles/toPublicRestaurantProfile.ts");
const publicProfilePage = readText("client/src/pages/public-profile.tsx");
const ownerDashboard = readText("client/src/pages/restaurant-owner-dashboard.tsx");
const sweetLoveApply = readText("scripts/applySweetLovePartialMenu.ts");

const requireIncludes = (source: string, snippet: string, message: string) => {
  if (!source.includes(snippet)) throw new Error(message);
};

const requireExcludes = (source: string, snippet: string, message: string) => {
  if (source.includes(snippet)) throw new Error(message);
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
  "ownerApprovalRequired: body.action === \"skip\"",
  "Skipping review must keep approval required instead of approving the menu.",
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
