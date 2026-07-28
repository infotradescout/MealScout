import { readFileSync } from "node:fs";

const readText = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const applyScript = readText("scripts/applySweetLovePartialMenu.ts");
const publicDiscoveryRoutes = readText("server/routes/publicDiscoveryRoutes.ts");
const publicProfileMapper = readText("server/publicProfiles/toPublicRestaurantProfile.ts");

const requireIncludes = (source: string, snippet: string, message: string) => {
  if (!source.includes(snippet)) throw new Error(message);
};

const requireExcludes = (source: string, snippet: string, message: string) => {
  if (source.includes(snippet)) throw new Error(message);
};

requireIncludes(
  applyScript,
  'const TRUCK_ID = "f3b76054-f355-43b0-a2d3-901277748557";',
  "Sweet Love menu script must target only the active Sweet Love public truck profile id.",
);
requireExcludes(
  applyScript,
  "f3b76054-f355-43b0-ae18-53f549cecfd1",
  "Sweet Love menu script must not keep the stale expected id.",
);
requireExcludes(
  applyScript,
  "6c60d5c0-3e68-4cf6-b48f-804a51921291",
  "Sweet Love menu script must not target the inactive Sweet Love-like row.",
);
requireIncludes(
  applyScript,
  'const targetId = getArg("--target-id");',
  "Sweet Love menu script must accept an explicit target id.",
);
requireIncludes(
  applyScript,
  "if (apply && allowProduction && !targetId)",
  "Production apply without explicit --target-id must fail closed.",
);
requireIncludes(
  applyScript,
  "Production apply requires explicit --target-id <ACTUAL_PRODUCTION_ID>",
  "Production apply failure must clearly explain the required target id.",
);
requireIncludes(
  applyScript,
  "const resolvedTargetId = targetId || TRUCK_ID;",
  "Dry-run may use the known Sweet Love id, while production apply must use --target-id.",
);
requireIncludes(
  applyScript,
  'String((restaurant as any).id || "").trim() !== TRUCK_ID',
  "Resolved target id must be verified against the expected Sweet Love profile before writing.",
);
requireIncludes(
  applyScript,
  "price: null",
  "Sweet Love menu must preserve missing prices as null.",
);
requireIncludes(
  applyScript,
  'priceStatus: "not_listed"',
  "Sweet Love menu must mark prices as not listed.",
);
requireIncludes(
  applyScript,
  "pricesProvided: false",
  "Sweet Love menu must explicitly say prices were not provided.",
);
requireIncludes(
  applyScript,
  "activeMenuItemCount > 0",
  "Menu update must block if existing active rows would create a confusing layered menu.",
);
requireIncludes(
  applyScript,
  "operator-upload:sweet-love-menu-pdf",
  "Sweet Love menu update must identify the uploaded PDF source.",
);
requireIncludes(
  applyScript,
  "await db.transaction(async (tx: any)",
  "Apply path must create the native menu and evidence atomically.",
);
requireIncludes(
  applyScript,
  "await tx.insert(menuItems).values(",
  "Sweet Love menu update must insert native menu rows.",
);
requireIncludes(
  applyScript,
  "priceCents: null",
  "Sweet Love native items must preserve missing prices as null.",
);
requireIncludes(
  applyScript,
  'orderingPolicy: "unpriced_items_are_browse_only"',
  "Sweet Love native items must be explicitly browse-only until priced.",
);

requireIncludes(
  publicDiscoveryRoutes,
  "const priceCents =",
  "Public menu payload must not convert missing prices to zero.",
);
requireIncludes(
  publicDiscoveryRoutes,
  "priceRaw && Number.isFinite(numericPrice)",
  "Public menu payload must not convert missing prices to zero.",
);
requireIncludes(
  publicProfileMapper,
  "item?.priceCents !== null && item?.priceCents !== undefined;",
  "Public profile mapper must not convert null missing prices to $0.00.",
);

console.log("sweet-love-partial-menu.contract: PASS");
