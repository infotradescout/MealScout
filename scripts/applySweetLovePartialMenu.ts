import "dotenv/config";
import { count, eq } from "drizzle-orm";

import { db, pool } from "../server/db";
import { menuItems, restaurants, truckImportListings } from "../shared/schema";

const TRUCK_ID = "f3b76054-f355-43b0-ae18-53f549cecfd1";
const TRUCK_NAME = "Sweet Love";
const SOURCE_TYPE = "uploaded_menu_pdf";
const SOURCE_LABEL = "uploaded Sweet Love menu PDF";

const apply = process.argv.includes("--apply");
const allowProduction = process.argv.includes("--allow-production");

type SweetLoveMenuItem = {
  section: string;
  item_name: string;
  description?: string;
  options?: string[];
  price: null;
  priceStatus: "not_listed";
  ownerConfirmationNeeded: string[];
  source: string;
};

const ownerConfirmationNeeded = [
  "prices",
  "current availability",
  "seasonal item availability",
];

const item = (
  section: string,
  item_name: string,
  extra: Pick<SweetLoveMenuItem, "description" | "options"> = {},
): SweetLoveMenuItem => ({
  section,
  item_name,
  price: null,
  priceStatus: "not_listed",
  ownerConfirmationNeeded,
  source: SOURCE_LABEL,
  ...extra,
});

const menuItemsPayload: SweetLoveMenuItem[] = [
  item("Cones / Cups", "Cake cone", { options: ["Vanilla", "Chocolate", "Twist"] }),
  item("Cones / Cups", "Small cup", { options: ["Vanilla", "Chocolate", "Twist"] }),
  item("Cones / Cups", "Medium cup", { options: ["Vanilla", "Chocolate", "Twist"] }),
  item("Cones / Cups", "Waffle cone", { options: ["Vanilla", "Chocolate", "Twist"] }),
  item("Cones / Cups", "Waffle bowl", { options: ["Vanilla", "Chocolate", "Twist"] }),
  item("Love Bombs", "Love Bomb 12oz", {
    description: "Ice cream with choice of 1 topping or mix-in.",
    options: ["M&M", "Oreo", "Cookie dough", "Reese's peanut butter", "More"],
  }),
  item("Love Bombs", "Love Bomb Extra 16oz", {
    description: "Ice cream with choice of 2 toppings or mix-ins.",
    options: ["M&M", "Oreo", "Cookie dough", "Reese's peanut butter", "More"],
  }),
  item("Afternoon Delights", "Love Boat", {
    description: "Sweet Love's version of a banana split.",
  }),
  item("Afternoon Delights", "Blended Love Shake", {
    options: ["Vanilla", "Chocolate", "Strawberry"],
  }),
  item("Afternoon Delights", "Big Tickle Float", {
    options: ["Root beer", "Cherry Coke", "More"],
  }),
  item("Love Shack Ice Cream Sundaes", "Love Shack Sundae", {
    options: [
      "Chocolate",
      "Strawberry",
      "Hot Fudge",
      "Caramel",
      "Pineapple",
      "Whipped cream",
      "Nuts",
      "Cherry",
    ],
  }),
  item("Love Me Tender Favorites", "Passion Pit", {
    description: "Hot fudge brownie sundae.",
  }),
  item("Love Me Tender Favorites", "Raz My Berries", {
    description: "Strawberry shortcake-style sundae.",
  }),
  item("Love Me Tender Favorites", "Sweet Peach Sundae", {
    description:
      "Seasonal sundae with vanilla ice cream, peaches, caramel sauce, waffle bits, whipped cream, and cherry.",
  }),
  item("Love Me Tender Favorites", "The Lil King", {
    description:
      "Banana, peanut butter, and Reese's over vanilla ice cream with whipped cream and cherry.",
  }),
  item("Paletas / Frozen Treats", "Strawberries & Cream"),
  item("Paletas / Frozen Treats", "Cacao, Banana, Peanut Butter & Cream"),
  item("Paletas / Frozen Treats", "Watermelon & Strawberry"),
  item("Paletas / Frozen Treats", "Mango & Strawberry"),
  item("Paletas / Frozen Treats", "Watermelon"),
  item("Paletas / Frozen Treats", "Horchata"),
  item("Paletas / Frozen Treats", "Mixed Fruits", {
    description:
      "Selections vary based on availability. Paletas include vegan, gluten-free, and no-sugar-added selections.",
  }),
];

const run = async () => {
  if (apply && !allowProduction && /mealscout/i.test(String(process.env.DATABASE_URL || ""))) {
    throw new Error("Production-looking DATABASE_URL requires --allow-production.");
  }

  const [restaurant] = await db
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, TRUCK_ID))
    .limit(1);
  if (!restaurant) throw new Error(`Missing restaurant ${TRUCK_ID}`);
  if (String((restaurant as any).name || "").trim() !== TRUCK_NAME) {
    throw new Error(`Restaurant name mismatch for ${TRUCK_ID}`);
  }
  const listingId = String((restaurant as any).claimedFromImportId || "").trim();
  if (!listingId) {
    throw new Error("Sweet Love is not linked to its source listing; refusing menu update.");
  }

  const [listing] = await db
    .select()
    .from(truckImportListings)
    .where(eq(truckImportListings.id, listingId))
    .limit(1);
  if (!listing) throw new Error(`Missing linked listing ${listingId}`);

  const [activeMenuCountRow] = await db
    .select({ value: count(menuItems.id) })
    .from(menuItems)
    .where(eq(menuItems.restaurantId, TRUCK_ID));
  const activeMenuItemCount = Number(activeMenuCountRow?.value || 0);
  if (activeMenuItemCount > 0) {
    throw new Error(
      `Sweet Love already has ${activeMenuItemCount} active menu item(s); refusing to layer this menu on top.`,
    );
  }

  const existingRawData =
    (listing as any).rawData && typeof (listing as any).rawData === "object"
      ? ((listing as any).rawData as Record<string, any>)
      : {};
  const existingEvidence =
    existingRawData.evidenceIngest && typeof existingRawData.evidenceIngest === "object"
      ? existingRawData.evidenceIngest
      : {};
  const existingExtracted =
    existingEvidence.extracted && typeof existingEvidence.extracted === "object"
      ? existingEvidence.extracted
      : {};

  const nextRawData = {
    ...existingRawData,
    evidenceIngest: {
      ...existingEvidence,
      sourceType: SOURCE_TYPE,
      sourceUrls: Array.from(
        new Set([
          ...((Array.isArray(existingEvidence.sourceUrls) ? existingEvidence.sourceUrls : []) as string[]),
          "operator-upload:sweet-love-menu-pdf",
        ]),
      ),
      extracted: {
        ...existingExtracted,
        business_name: TRUCK_NAME,
        menuStatus: "partial_menu_from_uploaded_pdf",
        pricesProvided: false,
        pricePolicy: "prices_not_listed",
        availabilityNote: "Some items vary based on availability.",
        seasonalItems: ["Sweet Peach Sundae"],
        ownerConfirmationNeeded,
        menuItems: menuItemsPayload,
        menuNotes: [
          "Prices are not listed.",
          "Selections vary based on availability.",
          "Specials and novelty items are posted on the bus.",
        ],
      },
      updatedAt: new Date().toISOString(),
    },
  };

  const result = {
    mode: apply ? "apply" : "dry_run",
    truckId: TRUCK_ID,
    truckName: TRUCK_NAME,
    listingId,
    activeMenuItemCount,
    menuItemCount: menuItemsPayload.length,
    pricesProvided: false,
    productionApplied: apply,
  };

  if (apply) {
    await db
      .update(truckImportListings)
      .set({ rawData: nextRawData as any, updatedAt: new Date() } as any)
      .where(eq(truckImportListings.id, listingId));
  }

  console.log(JSON.stringify(result, null, 2));
};

run()
  .catch((error) => {
    console.error("applySweetLovePartialMenu failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end?.();
  });
