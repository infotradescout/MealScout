import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { menuItems, pickupOrderItems, pickupOrders } from "@shared/schema";

type InventoryReservationLine = {
  menuItemId: string;
  quantity: number;
};

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
    .map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
}

async function applyInventoryDelta(
  tx: any,
  menuItemId: string,
  deltaQuantity: number,
  operation: "reserve" | "restore",
) {
  if (deltaQuantity <= 0) return;

  if (operation === "reserve") {
    const [row] = await tx
      .update(menuItems)
      .set({
        inventoryQty: sql`${menuItems.inventoryQty} - ${deltaQuantity}`,
        isAvailable: sql`${menuItems.inventoryQty} - ${deltaQuantity} > 0`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(menuItems.id, menuItemId),
          eq(menuItems.trackInventory, true),
          isNotNull(menuItems.inventoryQty),
          gte(menuItems.inventoryQty, deltaQuantity),
        ),
      )
      .returning({ id: menuItems.id });
    if (!row) {
      throw Object.assign(
        new Error(`Insufficient inventory for menu item ${menuItemId}`),
        { statusCode: 409, menuItemId },
      );
    }
    return;
  }

  await tx
    .update(menuItems)
    .set({
      inventoryQty: sql`${menuItems.inventoryQty} + ${deltaQuantity}`,
      isAvailable: sql`${menuItems.inventoryQty} + ${deltaQuantity} > 0`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(menuItems.id, menuItemId),
        eq(menuItems.trackInventory, true),
        isNotNull(menuItems.inventoryQty),
      ),
    );
}

export async function reserveTrackedInventoryForPickupOrder(
  tx: any,
  items: InventoryReservationLine[],
) {
  const reservations = normalizeInventoryReservations(items);
  for (const { menuItemId, quantity } of reservations) {
    await applyInventoryDelta(tx, menuItemId, quantity, "reserve");
  }
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
) {
  const reservedRows = await tx
    .select({
      menuItemId: pickupOrderItems.menuItemId,
      quantity: sql<number>`sum(${pickupOrderItems.quantity})`,
    })
    .from(pickupOrderItems)
    .where(eq(pickupOrderItems.orderId, orderId))
    .groupBy(pickupOrderItems.menuItemId);

  const reservedItems: InventoryReservationLine[] = reservedRows
    .map((row: { menuItemId: string; quantity: number | string | null }) => ({
      menuItemId: row.menuItemId,
      quantity: Number(row.quantity || 0),
    }))
    .filter((row: InventoryReservationLine) => row.quantity > 0);

  if (reservedItems.length === 0) return;

  await restoreTrackedInventoryForPickupOrder(tx, reservedItems);
}

export async function cleanupPendingPickupOrderAfterPaymentSetupFailure(
  database: any,
  orderId: string,
): Promise<boolean> {
  return database.transaction(async (tx: any) => {
    const reservedRows = await tx
      .select({
        menuItemId: pickupOrderItems.menuItemId,
        quantity: sql<number>`sum(${pickupOrderItems.quantity})`,
      })
      .from(pickupOrderItems)
      .where(eq(pickupOrderItems.orderId, orderId))
      .groupBy(pickupOrderItems.menuItemId);

    const [deleted] = await tx
      .delete(pickupOrders)
      .where(
        and(
          eq(pickupOrders.id, orderId),
          eq(pickupOrders.status, "pending"),
        ),
      )
      .returning({ id: pickupOrders.id });

    if (!deleted) return false;

    const reservedItems: InventoryReservationLine[] = reservedRows
      .map((row: { menuItemId: string; quantity: number | string | null }) => ({
        menuItemId: row.menuItemId,
        quantity: Number(row.quantity || 0),
      }))
      .filter((row: InventoryReservationLine) => row.quantity > 0);

    await restoreTrackedInventoryForPickupOrder(tx, reservedItems);
    return true;
  });
}
