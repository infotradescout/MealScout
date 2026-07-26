import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PublicMenuSection } from "../shared/publicProfiles";
import {
  buildPublicMenuPreview,
  getPublicMenuSectionKind,
  organizePublicMenuSections,
  partitionPublicMenuSections,
} from "../client/src/lib/publicProfileMenu";
import { getDishCategoryPhoto } from "../client/src/lib/dishCategoryPhoto";

const page = readFileSync(
  "client/src/pages/public-profile.tsx",
  "utf8",
).replace(/\r\n/g, "\n");
const menu = readFileSync(
  "client/src/components/public-profile/PublicProfileMenu.tsx",
  "utf8",
).replace(/\r\n/g, "\n");

const item = (id: string | null, name: string, priceLabel: string | null) => ({
  menuItemId: id,
  name,
  priceLabel,
  description: null,
  imageUrl: null,
  featured: false,
});

test("public profiles render one canonical organized menu surface", () => {
  assert.match(page, /<PublicProfileMenu/);
  assert.doesNotMatch(page, /<MenuHighlightsRail/);
  assert.doesNotMatch(page, /<FullMenuSection/);
  assert.match(menu, /data-public-profile-menu="organized"/);
  assert.match(menu, /data-public-menu-items="true"/);
  assert.match(menu, /data-public-menu-supporting="true"/);
  assert.match(menu, /Sides, drinks & extras/);
  assert.match(menu, />\s*View full menu\s*<MenuSquare/);
  assert.doesNotMatch(menu, /bg-\[#0f0d0b\]/);
});

test("duplicate items are removed without collapsing different prices", () => {
  const sections: PublicMenuSection[] = [
    {
      name: "Lunch",
      items: [item("dish-1", "Cuban sandwich", "$16")],
    },
    {
      name: "Favorites",
      items: [
        item("dish-1", "Cuban sandwich", "$16"),
        item(null, "Ahi tuna poke", "$18"),
        item(null, "Ahi tuna poke", "$22"),
      ],
    },
    {
      name: "lunch",
      items: [item("dish-2", "Lunch salad", "$9")],
    },
  ];

  const organized = organizePublicMenuSections(sections);
  assert.deepEqual(
    organized.map((section) => section.items.map((entry) => entry.priceLabel)),
    [
      ["$16", "$9"],
      ["$18", "$22"],
    ],
  );
});

test("sides, add-ons, drinks, desserts, and merchandise are explicit supporting sections", () => {
  const sections: PublicMenuSection[] = [
    { name: "Entrees", items: [item("m1", "Main plate", "$18")] },
    { name: "Side Dishes", items: [item("s1", "Fries", "$5")] },
    { name: "Add-ons & Sauces", items: [item("a1", "Hot sauce", "$1")] },
    { name: "Drinks", items: [item("d1", "Lemonade", "$4")] },
    { name: "Desserts", items: [item("x1", "Cake", "$7")] },
    { name: "Merchandise", items: [item("r1", "T-shirt", "$20")] },
  ];
  const partitioned = partitionPublicMenuSections(sections);

  assert.deepEqual(
    partitioned.primarySections.map((section) => section.name),
    ["Entrees"],
  );
  assert.deepEqual(
    partitioned.supportingSections.map((section) =>
      getPublicMenuSectionKind(section.name),
    ),
    ["side", "add_on", "drink", "dessert", "merchandise"],
  );
  assert.equal(getPublicMenuSectionKind("Tea Sandwiches"), "main");
  assert.equal(getPublicMenuSectionKind("Coffee & Breakfast"), "main");
  assert.equal(getPublicMenuSectionKind("Beer, Wine & Cocktails"), "drink");
});

test("drink- or dessert-led businesses keep those sections primary", () => {
  const sections: PublicMenuSection[] = [
    { name: "Coffee", items: [item("c1", "Cold brew", "$5")] },
    { name: "Sweet Treats", items: [item("t1", "Cookie", "$4")] },
  ];
  const partitioned = partitionPublicMenuSections(sections);
  assert.deepEqual(partitioned.primarySections, sections);
  assert.deepEqual(partitioned.supportingSections, []);
});

test("profile preview gives categories turns before repeating a category", () => {
  const sections: PublicMenuSection[] = [
    {
      name: "Bowls",
      items: [item("b1", "Bowl one", "$10"), item("b2", "Bowl two", "$11")],
    },
    {
      name: "Sandwiches",
      items: [
        item("s1", "Sandwich one", "$12"),
        item("s2", "Sandwich two", "$13"),
      ],
    },
    {
      name: "Desserts",
      items: [item("d1", "Dessert one", "$7")],
    },
  ];

  const preview = buildPublicMenuPreview(sections, {
    maxItems: 4,
    maxPerSection: 3,
  });
  assert.deepEqual(
    preview.sections.map((section) =>
      section.items.map((entry) => entry.menuItemId),
    ),
    [["b1", "b2"], ["s1"], ["d1"]],
  );
  assert.equal(preview.hiddenItemCount, 1);
});

test("food is presented before menu provenance and update details", () => {
  const itemsIndex = menu.indexOf('data-public-menu-items="true"');
  const trustIndex = menu.indexOf('data-public-menu-trust="true"');
  assert.ok(itemsIndex >= 0 && trustIndex > itemsIndex);
  assert.match(menu, /Limited menu/);
  assert.match(menu, /menuApproval\.label/);
  assert.match(menu, /data-public-menu-source="mealscout_sourced"/);
  assert.match(menu, /menuApproval\.sourceAttribution\.label/);
  assert.match(menu, /Updated \{updatedLabel\}/);
});

test("fallback food art requires an actual dish-category match", () => {
  assert.equal(getDishCategoryPhoto("Orange Slices"), null);
  assert.equal(getDishCategoryPhoto("Pizza slice")?.label, "Pizza");
  assert.equal(getDishCategoryPhoto("Ahi tuna poke")?.label, "Poke & Sushi");
});

console.log("public-profile-menu-organization.contract: PASS");
