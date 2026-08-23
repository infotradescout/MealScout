import {
  and,
  eq,
  getTableColumns,
  gte,
  gt,
  inArray,
  isNull,
  or,
} from "drizzle-orm";
import { menuCategories, menuItems } from "@shared/schema";

export async function loadAuthoritativePickupOrderItems(
  executor: any,
  input: {
    restaurantId: string;
    menuId: string;
    menuItemIds: string[];
  },
) {
  if (input.menuItemIds.length === 0) return [];
  return executor
    .select({ ...getTableColumns(menuItems) })
    .from(menuItems)
    .leftJoin(
      menuCategories,
      and(
        eq(menuCategories.id, menuItems.categoryId),
        eq(menuCategories.menuId, menuItems.menuId),
        eq(menuCategories.restaurantId, menuItems.restaurantId),
      ),
    )
    .where(
      and(
        inArray(menuItems.id, input.menuItemIds),
        eq(menuItems.restaurantId, input.restaurantId),
        eq(menuItems.menuId, input.menuId),
        eq(menuItems.isAvailable, true),
        gte(menuItems.priceCents, 0),
        isNull(menuItems.availableFrom),
        isNull(menuItems.availableTo),
        or(
          eq(menuItems.trackInventory, false),
          and(
            eq(menuItems.trackInventory, true),
            gt(menuItems.inventoryQty, 0),
          ),
        ),
        or(
          isNull(menuItems.categoryId),
          eq(menuCategories.isActive, true),
        ),
      ),
    );
}
