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
  'const TRUCK_ID = "f3b76054-f355-43b0-ae18-53f549cecfd1";',
  "Sweet Love menu script must target only the known Sweet Love truck id.",
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
  "await db\n      .update(truckImportListings)",
  "Apply path must update only Sweet Love's linked source listing menu payload.",
);
requireExcludes(
  applyScript,
  ".insert(menuItems)",
  "Sweet Love menu update must not insert canonical priced menu rows.",
);
requireExcludes(
  applyScript,
  ".insert(menus)",
  "Sweet Love menu update must not insert canonical menu rows.",
);

requireIncludes(
  publicDiscoveryRoutes,
  "const priceCents = priceRaw && Number.isFinite(numericPrice)",
  "Public menu payload must not convert missing prices to zero.",
);
requireIncludes(
  publicProfileMapper,
  "const hasPrice = item?.priceCents !== null && item?.priceCents !== undefined;",
  "Public profile mapper must not convert null missing prices to $0.00.",
);

console.log("sweet-love-partial-menu.contract: PASS");
