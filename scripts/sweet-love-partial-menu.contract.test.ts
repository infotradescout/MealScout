import { readFileSync } from "node:fs";

const applyScript = readFileSync("scripts/applySweetLovePartialMenu.ts", "utf8");
const publicDiscoveryRoutes = readFileSync("server/routes/publicDiscoveryRoutes.ts", "utf8");
const publicProfileMapper = readFileSync("server/publicProfiles/toPublicRestaurantProfile.ts", "utf8");

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
