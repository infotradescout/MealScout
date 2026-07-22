import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import {
  menuCategories,
  menuItemModifiers,
  menuItems,
  menuItemVariants,
  menus,
} from "@shared/schema";
import { db } from "../db";

export const MENU_REVISION_ALGORITHM = "structured-menu-sha256-v1" as const;

export type MenuRevisionEvidence = {
  revision: string | null;
  publicItemCount: number;
};

type MenuRevisionRows = {
  menus: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  items: Record<string, unknown>[];
  variants: Record<string, unknown>[];
  modifiers: Record<string, unknown>[];
};

const normalizeRestaurantIds = (restaurantIds: string[]) =>
  Array.from(
    new Set(
      restaurantIds
        .map((restaurantId) => String(restaurantId || "").trim())
        .filter(Boolean),
    ),
  );

const normalizeHashValue = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeHashValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeHashValue(entry)]),
    );
  }
  if (value === undefined) return null;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
};

const sortRows = (rows: Record<string, unknown>[]) =>
  [...rows].sort((left, right) =>
    String(left.id || "").localeCompare(String(right.id || "")),
  );

export const isMenuItemOwnedByRestaurantActiveMenu = (
  item: Record<string, unknown>,
  restaurantId: string,
  restaurantMenuIds: ReadonlySet<string>,
) =>
  String(item.restaurantId || "") === restaurantId &&
  restaurantMenuIds.has(String(item.menuId || ""));

/**
 * Fingerprints the exact structured menu rows that can feed the public menu.
 * The revision is deliberately unavailable when there is no active, available
 * item, because an empty menu cannot be owner-approved as current.
 */
export function createStructuredMenuRevision(
  rows: MenuRevisionRows,
): MenuRevisionEvidence {
  const publicItemCount = rows.items.length;
  if (publicItemCount === 0) {
    return { revision: null, publicItemCount: 0 };
  }
  const payload = normalizeHashValue({
    algorithm: MENU_REVISION_ALGORITHM,
    menus: sortRows(rows.menus),
    categories: sortRows(rows.categories),
    items: sortRows(rows.items),
    variants: sortRows(rows.variants),
    modifiers: sortRows(rows.modifiers),
  });
  return {
    revision: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    publicItemCount,
  };
}

export async function loadMenuRevisionEvidenceBatch(
  restaurantIds: string[],
): Promise<Map<string, MenuRevisionEvidence>> {
  const normalizedIds = normalizeRestaurantIds(restaurantIds);
  const result = new Map<string, MenuRevisionEvidence>(
    normalizedIds.map((restaurantId) => [
      restaurantId,
      { revision: null, publicItemCount: 0 },
    ]),
  );
  if (normalizedIds.length === 0) return result;

  const activeMenus = (await db
    .select()
    .from(menus)
    .where(
      and(
        inArray(menus.restaurantId, normalizedIds),
        eq(menus.isActive, true),
      ),
    )) as Array<Record<string, unknown>>;
  const activeMenuIds = activeMenus
    .map((menu) => String(menu.id || "").trim())
    .filter(Boolean);

  const [activeCategories, availableItems] = activeMenuIds.length
    ? await Promise.all([
        db
          .select()
          .from(menuCategories)
          .where(
            and(
              inArray(menuCategories.menuId, activeMenuIds),
              eq(menuCategories.isActive, true),
            ),
          ),
        db
          .select()
          .from(menuItems)
          .where(
            and(
              inArray(menuItems.menuId, activeMenuIds),
              eq(menuItems.isAvailable, true),
            ),
          ),
      ])
    : [[], []];
  const itemIds = (availableItems as Array<Record<string, unknown>>)
    .map((item) => String(item.id || "").trim())
    .filter(Boolean);
  const [variants, modifiers] = itemIds.length
    ? await Promise.all([
        db
          .select()
          .from(menuItemVariants)
          .where(inArray(menuItemVariants.menuItemId, itemIds)),
        db
          .select()
          .from(menuItemModifiers)
          .where(inArray(menuItemModifiers.menuItemId, itemIds)),
      ])
    : [[], []];

  const itemRestaurantById = new Map(
    (availableItems as Array<Record<string, unknown>>).map((item) => [
      String(item.id || ""),
      String(item.restaurantId || ""),
    ]),
  );

  for (const restaurantId of normalizedIds) {
    const restaurantMenus = activeMenus.filter(
      (menu) => String(menu.restaurantId || "") === restaurantId,
    );
    const restaurantMenuIds = new Set(
      restaurantMenus.map((menu) => String(menu.id || "")),
    );
    const restaurantItems = (
      availableItems as Array<Record<string, unknown>>
    ).filter((item) =>
      isMenuItemOwnedByRestaurantActiveMenu(
        item,
        restaurantId,
        restaurantMenuIds,
      ),
    );
    const restaurantItemIds = new Set(
      restaurantItems.map((item) => String(item.id || "")),
    );
    result.set(
      restaurantId,
      createStructuredMenuRevision({
        menus: restaurantMenus,
        categories: (
          activeCategories as Array<Record<string, unknown>>
        ).filter((category) =>
          restaurantMenuIds.has(String(category.menuId || "")),
        ),
        items: restaurantItems,
        variants: (variants as Array<Record<string, unknown>>).filter(
          (variant) =>
            restaurantItemIds.has(String(variant.menuItemId || "")) &&
            itemRestaurantById.get(String(variant.menuItemId || "")) ===
              restaurantId,
        ),
        modifiers: (modifiers as Array<Record<string, unknown>>).filter(
          (modifier) =>
            restaurantItemIds.has(String(modifier.menuItemId || "")) &&
            itemRestaurantById.get(String(modifier.menuItemId || "")) ===
              restaurantId,
        ),
      }),
    );
  }

  return result;
}

export async function loadMenuRevisionEvidence(
  restaurantId: string,
): Promise<MenuRevisionEvidence> {
  const normalizedId = String(restaurantId || "").trim();
  if (!normalizedId) return { revision: null, publicItemCount: 0 };
  const evidence = await loadMenuRevisionEvidenceBatch([normalizedId]);
  return evidence.get(normalizedId) || { revision: null, publicItemCount: 0 };
}
