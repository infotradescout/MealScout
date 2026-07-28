import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const schema = read("shared/schema/legacy.ts");
const migration = read("migrations/116_allow_unpriced_menu_items.sql");
const publicMenu = read("client/src/pages/online-menu.tsx");
const menuBuilder = read("client/src/pages/menu-builder.tsx");
const pickupOrders = read("server/routes/pickupOrderRoutes.ts");

const requireIncludes = (source: string, snippet: string, message: string) => {
  if (!source.includes(snippet)) throw new Error(message);
};

requireIncludes(
  schema,
  'priceCents: integer("price_cents"),',
  "Canonical menu prices must be nullable.",
);
requireIncludes(
  schema,
  "priceCents: z.number().int().min(0).nullable()",
  "Menu item writes must accept a deliberate null price.",
);
requireIncludes(
  migration,
  "ALTER COLUMN price_cents DROP NOT NULL",
  "The database migration must allow unpriced items.",
);
requireIncludes(
  publicMenu,
  '"Price unavailable"',
  "The public menu must label missing prices truthfully.",
);
requireIncludes(
  publicMenu,
  "orderingEnabled && item.priceCents !== null",
  "The public menu must not expose Add for an unpriced item.",
);
requireIncludes(
  menuBuilder,
  "Unpriced items cannot",
  "The owner editor must explain the ordering consequence.",
);
requireIncludes(
  menuBuilder,
  "priceCents: hasValidPrice ? Math.round(parsedPrice * 100) : null",
  "A blank owner-entered price must persist as null, never zero.",
);
requireIncludes(
  pickupOrders,
  "cannot be ordered until the business adds a price",
  "Checkout must reject unpriced items server-side.",
);

console.log("native-unpriced-menu-items.contract: PASS");
