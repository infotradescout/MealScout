import { and, eq, inArray } from "drizzle-orm";
import { menuItems } from "@shared/schema";

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
    .select()
    .from(menuItems)
    .where(
      and(
        inArray(menuItems.id, input.menuItemIds),
        eq(menuItems.restaurantId, input.restaurantId),
        eq(menuItems.menuId, input.menuId),
        eq(menuItems.isAvailable, true),
      ),
    );
}
