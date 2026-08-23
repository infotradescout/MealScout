import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  menuCategories,
  menuItems,
  pickupOrderItems,
  pickupOrders,
} from "@shared/schema";

type InventoryReservationLine = {
  menuItemId: string;
  quantity: number;
};

export function isPickupInventoryReservationRestorable(input: {
  merchantAcknowledgedAt?: unknown;
  readyAt?: unknown;
  outForDeliveryAt?: unknown;
  deliveredAt?: unknown;
  completedAt?: unknown;
}): boolean {
  return ![
    input.merchantAcknowledgedAt,
    input.readyAt,
    input.outForDeliveryAt,
    input.deliveredAt,
    input.completedAt,
  ].some((value) => value !== null && value !== undefined);
}

function normalizeInventoryReservations(
  items: InventoryReservationLine[],
): InventoryReservationLine[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (item.quantity <= 0) continue;
    const current = totals.get(item.menuItemId) ?? 0;
    totals.set(item.menuItemId, current + item.quantity);
  }
  return Array.from(totals.entries())
    .filter(([, quantity]) => quantity > 0)
    .map(([menuItemId, quantity]) => ({ menuItemId, quantity }))
    .sort((left, right) => left.menuItemId.localeCompare(right.menuItemId));
}

async function applyInventoryDelta(
  tx: any,
  menuItemId: string,
  deltaQuantity: number,
  operation: "reserve" | "restore",
): Promise<boolean> {
  if (deltaQuantity <= 0) return false;

  if (operation === "reserve") {
    // Serialize every item, including untracked items. Untracked inventory is
    // a valid configuration and needs no quantity mutation, but the item must
    // still be currently visible through an active category.
    const [current] = await tx
      .select({
        id: menuItems.id,
        categoryId: menuItems.categoryId,
        categoryActive: menuCategories.isActive,
        isAvailable: menuItems.isAvailable,
        trackInventory: menuItems.trackInventory,
        inventoryQty: menuItems.inventoryQty,
      })
      .from(menuItems)
      .leftJoin(
        menuCategories,
        and(
          eq(menuCategories.id, menuItems.categoryId),
          eq(menuCategories.menuId, menuItems.menuId),
          eq(menuCategories.restaurantId, menuItems.restaurantId),
        ),
      )
      .where(eq(menuItems.id, menuItemId))
      .limit(1)
      .for("update", { of: menuItems });
    const categoryOrderable = Boolean(
      current && (!current.categoryId || current.categoryActive === true),
    );
    if (!current || current.isAvailable !== true || !categoryOrderable) {
      throw Object.assign(
        new Error(`Menu item ${menuItemId} is no longer available`),
        { statusCode: 409, menuItemId },
      );
    }
    if (current.trackInventory !== true) return false;
    if (current.inventoryQty === null || current.inventoryQty < deltaQuantity) {
      throw Object.assign(
        new Error(`Insufficient inventory for menu item ${menuItemId}`),
        { statusCode: 409, menuItemId },
      );
    }

    const [row] = await tx
      .update(menuItems)
      .set({
        inventoryQty: sql`${menuItems.inventoryQty} - ${deltaQuantity}`,
        isAvailable: sql`case
          when ${menuItems.inventoryQty} - ${deltaQuantity} = 0 then false
          else ${menuItems.isAvailable}
        end`,
        inventoryAutoUnavailable: sql`${menuItems.inventoryQty} - ${deltaQuantity} = 0`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(menuItems.id, menuItemId),
          eq(menuItems.trackInventory, true),
          eq(menuItems.isAvailable, true),
          isNotNull(menuItems.inventoryQty),
          eq(menuItems.inventoryQty, current.inventoryQty),
        ),
      )
      .returning({ id: menuItems.id });
    if (!row) {
      throw Object.assign(
        new Error(`Insufficient inventory for menu item ${menuItemId}`),
        { statusCode: 409, menuItemId },
      );
    }
    return true;
  }

  const [restored] = await tx
    .update(menuItems)
    .set({
      inventoryQty: sql`${menuItems.inventoryQty} + ${deltaQuantity}`,
      isAvailable: sql`case
        when ${menuItems.inventoryAutoUnavailable}
          and ${menuItems.inventoryQty} + ${deltaQuantity} > 0 then true
        else ${menuItems.isAvailable}
      end`,
      inventoryAutoUnavailable: sql`case
        when ${menuItems.inventoryAutoUnavailable}
          and ${menuItems.inventoryQty} + ${deltaQuantity} > 0 then false
        else ${menuItems.inventoryAutoUnavailable}
      end`,
      updatedAt: new Date(),
    })
    .where(and(eq(menuItems.id, menuItemId), isNotNull(menuItems.inventoryQty)))
    .returning({ id: menuItems.id });
  return Boolean(restored);
}

export async function reserveTrackedInventoryForPickupOrder(
  tx: any,
  items: InventoryReservationLine[],
): Promise<InventoryReservationLine[]> {
  const reservations = normalizeInventoryReservations(items);
  const trackedReservations: InventoryReservationLine[] = [];
  for (const { menuItemId, quantity } of reservations) {
    const reserved = await applyInventoryDelta(
      tx,
      menuItemId,
      quantity,
      "reserve",
    );
    if (reserved) trackedReservations.push({ menuItemId, quantity });
  }
  return trackedReservations;
}

export async function restoreTrackedInventoryForPickupOrder(
  tx: any,
  items: InventoryReservationLine[],
) {
  const reservations = normalizeInventoryReservations(items);
  for (const { menuItemId, quantity } of reservations) {
    await applyInventoryDelta(tx, menuItemId, quantity, "restore");
  }
}

export async function restoreTrackedInventoryForPickupOrderByOrderId(
  tx: any,
  orderId: string,
  eligibleStatuses: string[] = ["cancellation_pending", "cancelled"],
): Promise<boolean> {
  const [candidate] = await tx
    .select({
      id: pickupOrders.id,
      merchantAcknowledgedAt: pickupOrders.merchantAcknowledgedAt,
      readyAt: pickupOrders.readyAt,
      outForDeliveryAt: pickupOrders.outForDeliveryAt,
      deliveredAt: pickupOrders.deliveredAt,
      completedAt: pickupOrders.completedAt,
    })
    .from(pickupOrders)
    .where(
      and(
        eq(pickupOrders.id, orderId),
        inArray(pickupOrders.status, eligibleStatuses),
        isNull(pickupOrders.inventoryRestoredAt),
      ),
    )
    .limit(1)
    .for("update", { of: pickupOrders });

  if (!candidate || !isPickupInventoryReservationRestorable(candidate)) {
    return false;
  }

  // Migration 133 intentionally leaves legacy reservation provenance null.
  // Never guess whether those rows decremented stock; keep the order visible
  // to the legacy inventory audit instead of marking it restored.
  const [unknownReservation] = await tx
    .select({ id: pickupOrderItems.id })
    .from(pickupOrderItems)
    .where(
      and(
        eq(pickupOrderItems.orderId, orderId),
        isNull(pickupOrderItems.inventoryReservedQuantity),
      ),
    )
    .limit(1);
  if (unknownReservation) return false;

  const [claimedOrder] = await tx
    .update(pickupOrders)
    .set({
      inventoryRestoredAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pickupOrders.id, orderId),
        inArray(pickupOrders.status, eligibleStatuses),
        isNull(pickupOrders.inventoryRestoredAt),
      ),
    )
    .returning({ id: pickupOrders.id });

  if (!claimedOrder) return false;

  const reservedRows = await tx
    .select({
      menuItemId: pickupOrderItems.menuItemId,
      quantity: sql<number>`sum(${pickupOrderItems.inventoryReservedQuantity})`,
    })
    .from(pickupOrderItems)
    .where(eq(pickupOrderItems.orderId, orderId))
    .groupBy(pickupOrderItems.menuItemId);

  const reservedItems: InventoryReservationLine[] = reservedRows
    .map(
      (row: {
        menuItemId: string | null;
        quantity: number | string | null;
      }) => ({
        menuItemId: String(row.menuItemId || "").trim(),
        quantity: Number(row.quantity || 0),
      }),
    )
    .filter((row: InventoryReservationLine) => Boolean(row.menuItemId))
    .filter((row: InventoryReservationLine) => row.quantity > 0);

  if (reservedItems.length === 0) return true;

  await restoreTrackedInventoryForPickupOrder(tx, reservedItems);
  return true;
}

export async function cleanupPendingPickupOrderAfterPaymentSetupFailure(
  database: any,
  orderId: string,
): Promise<boolean> {
  return database.transaction(async (tx: any) => {
    const reservedRows = await tx
      .select({
        menuItemId: pickupOrderItems.menuItemId,
        quantity: sql<number>`sum(${pickupOrderItems.inventoryReservedQuantity})`,
      })
      .from(pickupOrderItems)
      .where(eq(pickupOrderItems.orderId, orderId))
      .groupBy(pickupOrderItems.menuItemId);

    const [deleted] = await tx
      .delete(pickupOrders)
      .where(
        and(eq(pickupOrders.id, orderId), eq(pickupOrders.status, "pending")),
      )
      .returning({ id: pickupOrders.id });

    if (!deleted) return false;

    const reservedItems: InventoryReservationLine[] = reservedRows
      .map(
        (row: {
          menuItemId: string | null;
          quantity: number | string | null;
        }) => ({
          menuItemId: String(row.menuItemId || "").trim(),
          quantity: Number(row.quantity || 0),
        }),
      )
      .filter((row: InventoryReservationLine) => Boolean(row.menuItemId))
      .filter((row: InventoryReservationLine) => row.quantity > 0);

    await restoreTrackedInventoryForPickupOrder(tx, reservedItems);
    return true;
  });
}
