import type { PublicMenuSection } from "@shared/publicProfiles";

export type PublicMenuCompletenessState = "complete" | "partial" | "unavailable";

type MenuEvidenceInput = {
  menuSections?: PublicMenuSection[] | null;
  featuredMenuItems?: string[] | null;
  menuUrl?: string | null;
  menuImageUrl?: string | null;
  menuPdfUrl?: string | null;
};

const ADD_ON_SECTION_PATTERN =
  /\b(extra|extras|add[\s-]?on|topping|toppings|sauce|sauces|condiment|condiments)\b/i;

const normalizeSections = (sections: PublicMenuSection[] | null | undefined): PublicMenuSection[] =>
  Array.isArray(sections)
    ? sections.filter(
        (section) =>
          section &&
          String(section.name || "").trim().length > 0 &&
          Array.isArray(section.items) &&
          section.items.length > 0,
      )
    : [];

export function assessPublicMenuCompleteness(input: MenuEvidenceInput): {
  state: PublicMenuCompletenessState;
  totalItems: number;
  pricedItems: number;
  unpricedItems: number;
  hasMenuLinkEvidence: boolean;
  hasOnlyAddonSections: boolean;
} {
  const sections = normalizeSections(input.menuSections);
  const items = sections.flatMap((section) => section.items || []);
  const totalItems = items.length;
  const pricedItems = items.filter((item) => String(item?.priceLabel || "").trim().length > 0).length;
  const unpricedItems = Math.max(0, totalItems - pricedItems);
  const hasOnlyAddonSections =
    sections.length > 0 &&
    sections.every((section) => ADD_ON_SECTION_PATTERN.test(String(section.name || "")));
  const featuredCount = Array.isArray(input.featuredMenuItems)
    ? input.featuredMenuItems.filter((item) => String(item || "").trim().length > 0).length
    : 0;
  const hasMenuLinkEvidence =
    Boolean(String(input.menuUrl || "").trim()) ||
    Boolean(String(input.menuImageUrl || "").trim()) ||
    Boolean(String(input.menuPdfUrl || "").trim());

  if (totalItems === 0) {
    return {
      state: hasMenuLinkEvidence || featuredCount > 0 ? "partial" : "unavailable",
      totalItems,
      pricedItems,
      unpricedItems,
      hasMenuLinkEvidence,
      hasOnlyAddonSections: false,
    };
  }

  if (hasOnlyAddonSections || totalItems <= 1 || pricedItems === 0) {
    return {
      state: "partial",
      totalItems,
      pricedItems,
      unpricedItems,
      hasMenuLinkEvidence,
      hasOnlyAddonSections,
    };
  }

  return {
    state: "complete",
    totalItems,
    pricedItems,
    unpricedItems,
    hasMenuLinkEvidence,
    hasOnlyAddonSections,
  };
}

export function normalizeBusinessTypeLabel(value: string | null | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "food_truck") return "Food truck";
  if (normalized === "private_chef") return "Private chef";
  if (normalized === "caterer") return "Caterer";
  if (normalized === "supplier") return "Supplier";
  if (normalized === "restaurant") return "Restaurant";
  if (normalized === "bar") return "Bar";
  return normalized
    .split(/[\s_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
