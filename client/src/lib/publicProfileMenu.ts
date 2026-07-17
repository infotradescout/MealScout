import type { PublicMenuItem, PublicMenuSection } from "@shared/publicProfiles";

export type PublicMenuSectionKind =
  "main" | "side" | "add_on" | "drink" | "dessert" | "merchandise";

const SECTION_KIND_RULES: Array<{
  kind: Exclude<PublicMenuSectionKind, "main">;
  match: RegExp;
}> = [
  {
    kind: "add_on",
    match:
      /\b(add[\s-]?ons?|extras?|toppings?|sauces?|condiments?|upgrades?|modifiers?)\b/i,
  },
  { kind: "side", match: /\b(sides?|side dishes?)\b/i },
  {
    kind: "drink",
    match:
      /\b(drinks?|beverages?|soft drinks?|sodas?|coffee|tea|lemonade|boba|juices?|smoothies?|shakes?|water|beer|wine|cocktails?|alcohol)\b/i,
  },
  {
    kind: "dessert",
    match: /\b(desserts?|sweets?|sweet treats?|pastries?|ice cream)\b/i,
  },
  { kind: "merchandise", match: /\b(merch|merchandise|retail)\b/i },
];

const MAIN_SECTION_SIGNAL =
  /\b(entrees?|mains?|plates?|combos?|sandwiches?|burgers?|tacos?|burritos?|pizza|wings?|bowls?|breakfast|lunch|dinner|specialties|favorites|delights)\b/i;

export function getPublicMenuSectionKind(
  sectionName: string | null | undefined,
): PublicMenuSectionKind {
  const name = String(sectionName || "").trim();
  if (MAIN_SECTION_SIGNAL.test(name)) return "main";
  return (
    SECTION_KIND_RULES.find((rule) => rule.match.test(name))?.kind || "main"
  );
}

const normalizedItemKey = (item: PublicMenuItem) => {
  const id = String(item.menuItemId || "").trim();
  if (id) return `id:${id}`;

  const name = String(item.name || "")
    .trim()
    .toLowerCase();
  const price = String(item.priceLabel || "")
    .trim()
    .toLowerCase();
  return name ? `item:${name}:${price}` : "";
};

/**
 * Keeps the published menu order while preventing the same item from appearing
 * in multiple profile sections. Different prices remain distinct so sizes and
 * variants are not collapsed together.
 */
export function organizePublicMenuSections(
  sections: PublicMenuSection[] | null | undefined,
): PublicMenuSection[] {
  const seen = new Set<string>();
  const sectionIndexByName = new Map<string, number>();
  const organized: PublicMenuSection[] = [];

  for (const section of Array.isArray(sections) ? sections : []) {
    const name = String(section?.name || "").trim();
    if (!name) continue;
    const sectionKey = name.toLowerCase();
    let sectionIndex = sectionIndexByName.get(sectionKey);
    if (sectionIndex === undefined) {
      sectionIndex = organized.length;
      sectionIndexByName.set(sectionKey, sectionIndex);
      organized.push({ name, items: [] });
    }

    for (const item of Array.isArray(section?.items) ? section.items : []) {
      const key = normalizedItemKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      organized[sectionIndex].items.push(item);
    }
  }

  return organized.filter((section) => section.items.length > 0);
}

/**
 * Main dishes lead mixed menus. Supporting categories remain explicit and
 * available without crowding the food people usually came to decide on. A
 * drink-, dessert-, or sides-only business keeps its entire menu primary.
 */
export function partitionPublicMenuSections(sections: PublicMenuSection[]): {
  primarySections: PublicMenuSection[];
  supportingSections: PublicMenuSection[];
} {
  const primarySections = sections.filter(
    (section) => getPublicMenuSectionKind(section.name) === "main",
  );
  if (primarySections.length === 0) {
    return { primarySections: sections, supportingSections: [] };
  }

  return {
    primarySections,
    supportingSections: sections.filter(
      (section) => getPublicMenuSectionKind(section.name) !== "main",
    ),
  };
}

/**
 * Public profiles preview a menu; the dedicated menu route remains the place
 * for the complete ordering-oriented catalog. Preview space is shared across
 * categories so one large category cannot crowd every other category out.
 */
export function buildPublicMenuPreview(
  sections: PublicMenuSection[],
  options: { maxItems?: number; maxPerSection?: number } = {},
): { sections: PublicMenuSection[]; hiddenItemCount: number } {
  const maxItems = Math.max(1, options.maxItems ?? 6);
  const maxPerSection = Math.max(1, options.maxPerSection ?? 3);
  const totalItems = sections.reduce(
    (total, section) => total + section.items.length,
    0,
  );
  let remaining = maxItems;
  const selectedItems = sections.map(() => [] as PublicMenuItem[]);

  for (
    let itemIndex = 0;
    itemIndex < maxPerSection && remaining > 0;
    itemIndex += 1
  ) {
    for (
      let sectionIndex = 0;
      sectionIndex < sections.length && remaining > 0;
      sectionIndex += 1
    ) {
      const item = sections[sectionIndex]?.items[itemIndex];
      if (!item) continue;
      selectedItems[sectionIndex].push(item);
      remaining -= 1;
    }
  }

  const previewSections = sections
    .map((section, index) => ({ ...section, items: selectedItems[index] }))
    .filter((section) => section.items.length > 0);
  const shownItems = previewSections.reduce(
    (total, section) => total + section.items.length,
    0,
  );

  return {
    sections: previewSections,
    hiddenItemCount: Math.max(0, totalItems - shownItems),
  };
}
