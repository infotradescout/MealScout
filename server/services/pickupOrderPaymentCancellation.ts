import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  menuItems,
  pickupOrderItems,
  pickupOrders,
  promotedOrderCommissions,
} from "@shared/schema";
import { db } from "../db";

const TERMINAL_PAYMENT_ORDER_TYPES = ["pickup", "dine_in", "delivery"];

async function restoreReservedInventory(
  tx: any,
  order: { id: string; restaurantId: string },
) {
  const now = new Date();
  const reservedInventory = await tx
    .select({
      menuItemId: pickupOrderItems.menuItemId,
      quantity: sql<number>`sum(${pickupOrderItems.quantity})`.mapWith(Number),
    })
    .from(pickupOrderItems)
    .innerJoin(menuItems, eq(menuItems.id, pickupOrderItems.menuItemId))
    .where(
      and(
        eq(pickupOrderItems.orderId, order.id),
        eq(menuItems.restaurantId, order.restaurantId),
        eq(menuItems.trackInventory, true),
        isNotNull(menuItems.inventoryQty),
      ),
    )
    .groupBy(pickupOrderItems.menuItemId);

  for (const reservation of reservedInventory) {
    if (!reservation.menuItemId || reservation.quantity <= 0) {
      continue;
    }
    const [currentItem] = await tx
      .select({
        inventoryQty: menuItems.inventoryQty,
        isAvailable: menuItems.isAvailable,
        inventoryAutoUnavailable: menuItems.inventoryAutoUnavailable,
      })
      .from(menuItems)
      .where(
        and(
          eq(menuItems.id, reservation.menuItemId),
          eq(menuItems.restaurantId, order.restaurantId),
          eq(menuItems.trackInventory, true),
          isNotNull(menuItems.inventoryQty),
        ),
      )
      .limit(1)
      .for("update");
    if (!currentItem || currentItem.inventoryQty === null) continue;

    const restoreAutomaticAvailability =
      currentItem.inventoryQty === 0 &&
      currentItem.isAvailable === false &&
      currentItem.inventoryAutoUnavailable === true;
    await tx
      .update(menuItems)
      .set({
        inventoryQty: sql`${menuItems.inventoryQty} + ${reservation.quantity}`,
        isAvailable: restoreAutomaticAvailability
          ? true
          : currentItem.isAvailable,
        inventoryAutoUnavailable: restoreAutomaticAvailability
          ? false
          : currentItem.inventoryAutoUnavailable,
        updatedAt: now,
      })
      .where(
        and(
          eq(menuItems.id, reservation.menuItemId),
          eq(menuItems.restaurantId, order.restaurantId),
          eq(menuItems.trackInventory, true),
          isNotNull(menuItems.inventoryQty),
        ),
      );
  }
}

async function reversePendingPromotionCommission(tx: any, orderId: string) {
  const now = new Date();
  await tx
    .update(promotedOrderCommissions)
    .set({
      status: "reversed",
      reversedAt: now,
      reversalReason: "order_cancelled",
      updatedAt: now,
    })
    .where(
      and(
        eq(promotedOrderCommissions.orderId, orderId),
        eq(promotedOrderCommissions.status, "pending"),
      ),
    );
}

export async function cancelPendingPickupOrderForCanceledPaymentIntent(params: {
  paymentIntentId: string;
  metadataOrderId: string;
  cancellationReason?: string;
}) {
  return db.transaction(async (tx: any) => {
    const now = new Date();
    const cancellationReason =
      String(params.cancellationReason || "").trim() ||
      "Card payment cancelled";
    const [order] = await tx
      .select({
        id: pickupOrders.id,
        restaurantId: pickupOrders.restaurantId,
      })
      .from(pickupOrders)
      .where(
        and(
          eq(pickupOrders.id, params.metadataOrderId),
          eq(pickupOrders.stripePaymentIntentId, params.paymentIntentId),
          eq(pickupOrders.status, "pending"),
          eq(pickupOrders.paymentMethod, "card"),
          inArray(pickupOrders.orderType, TERMINAL_PAYMENT_ORDER_TYPES),
        ),
      )
      .limit(1)
      .for("update");
    if (!order) return false;

    const [cancelledOrder] = await tx
      .update(pickupOrders)
      .set({
        status: "cancelled",
        cancellationReason,
        cancelledAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(pickupOrders.id, params.metadataOrderId),
          eq(pickupOrders.stripePaymentIntentId, params.paymentIntentId),
          eq(pickupOrders.status, "pending"),
          eq(pickupOrders.paymentMethod, "card"),
          inArray(pickupOrders.orderType, TERMINAL_PAYMENT_ORDER_TYPES),
        ),
      )
      .returning({
        id: pickupOrders.id,
        restaurantId: pickupOrders.restaurantId,
      });

    if (!cancelledOrder) {
      return false;
    }

    await restoreReservedInventory(tx, cancelledOrder);

    await tx
      .update(promotedOrderCommissions)
      .set({
        status: "reversed",
        reversedAt: now,
        reversalReason: "payment_intent_canceled",
        updatedAt: now,
      })
      .where(
        and(
          eq(promotedOrderCommissions.orderId, cancelledOrder.id),
          eq(promotedOrderCommissions.status, "pending"),
        ),
      );

    return true;
  });
}

export async function cancelCashPickupOrderByOwner(params: {
  orderId: string;
  cancellationReason?: string;
}) {
  return db.transaction(async (tx: any) => {
    const now = new Date();
    const cancellationReason =
      String(params.cancellationReason || "").trim() ||
      "Cancelled by restaurant";
    const [order] = await tx
      .select({
        id: pickupOrders.id,
        restaurantId: pickupOrders.restaurantId,
      })
      .from(pickupOrders)
      .where(
        and(
          eq(pickupOrders.id, params.orderId),
          eq(pickupOrders.paymentMethod, "cash"),
          inArray(pickupOrders.orderType, TERMINAL_PAYMENT_ORDER_TYPES),
          eq(pickupOrders.status, "confirmed"),
        ),
      )
      .limit(1)
      .for("update");
    if (!order) return null;

    const [cancelledOrder] = await tx
      .update(pickupOrders)
      .set({
        status: "cancelled",
        cancellationReason,
        cancelledAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(pickupOrders.id, order.id),
          eq(pickupOrders.paymentMethod, "cash"),
          eq(pickupOrders.status, "confirmed"),
        ),
      )
      .returning();
    if (!cancelledOrder) return null;

    await restoreReservedInventory(tx, order);
    await reversePendingPromotionCommission(tx, order.id);
    return cancelledOrder;
  });
}
