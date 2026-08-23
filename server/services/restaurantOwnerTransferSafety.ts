import { and, eq, notInArray } from "drizzle-orm";

import { pickupOrders, restaurants } from "@shared/schema";
import { RESTAURANT_OWNER_TRANSFER_TERMINAL_ORDER_STATUSES } from "./restaurantOrderingAuthorityReset";

export function resolveRestaurantOwnershipInviteAction(input: {
  currentOwnerId: unknown;
  importSystemUserId: unknown;
  inviteUserId: unknown;
}): "transfer" | "idempotent" | "conflict" {
  const currentOwnerId = String(input.currentOwnerId || "").trim();
  const importSystemUserId = String(input.importSystemUserId || "").trim();
  const inviteUserId = String(input.inviteUserId || "").trim();
  if (!currentOwnerId || !inviteUserId) return "conflict";
  if (currentOwnerId === inviteUserId) return "idempotent";
  return currentOwnerId === importSystemUserId ? "transfer" : "conflict";
}

export async function lockRestaurantForOwnerTransfer(
  tx: any,
  input: { restaurantId: string; nextOwnerId: string },
) {
  const [restaurant] = await tx
    .select()
    .from(restaurants)
    .where(eq(restaurants.id, input.restaurantId))
    .limit(1)
    .for("update", { of: restaurants });
  if (!restaurant) return { outcome: "missing" } as const;

  const ownerChanged =
    String(restaurant.ownerId || "") !== String(input.nextOwnerId || "");
  if (ownerChanged) {
    const [blockingOrder] = await tx
      .select({ id: pickupOrders.id, status: pickupOrders.status })
      .from(pickupOrders)
      .where(
        and(
          eq(pickupOrders.restaurantId, input.restaurantId),
          notInArray(pickupOrders.status, [
            ...RESTAURANT_OWNER_TRANSFER_TERMINAL_ORDER_STATUSES,
          ]),
        ),
      )
      .limit(1);
    if (blockingOrder) {
      return {
        outcome: "active_order",
        restaurant,
        ownerChanged,
        orderId: blockingOrder.id,
        orderStatus: blockingOrder.status,
      } as const;
    }
  }

  return { outcome: "ready", restaurant, ownerChanged } as const;
}
