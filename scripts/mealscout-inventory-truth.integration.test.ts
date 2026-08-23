import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  cleanupPendingPickupOrderAfterPaymentSetupFailure,
  reserveTrackedInventoryForPickupOrder,
  restoreTrackedInventoryForPickupOrderByOrderId,
} from "../server/services/pickupInventoryService";

const OPT_IN = "MEALSCOUT_INVENTORY_TRUTH";
const BRANCH = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_BRANCH_ID";
const HOST = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_EXPECTED_HOST";

function requireDisposableDatabase() {
  assert.equal(process.env[OPT_IN], "1", `${OPT_IN}=1 is required`);
  assert.match(String(process.env[BRANCH] || ""), /^br-/);
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  const expectedHost = String(process.env[HOST] || "")
    .trim()
    .toLowerCase();
  assert.ok(databaseUrl, "DATABASE_URL is required");
  assert.ok(expectedHost, `${HOST} is required`);
  assert.equal(new URL(databaseUrl).hostname.toLowerCase(), expectedHost);
}

function fixtureId(label: string) {
  return `inventory_truth_${label}_${randomUUID()}`;
}

async function run() {
  requireDisposableDatabase();
  const { db, pool } = await import("../server/db");
  assert.ok(pool, "Disposable PostgreSQL pool is required");

  const columns = await pool.query(`
    select table_name, column_name
      from information_schema.columns
     where (table_name = 'menu_items' and column_name = 'inventory_auto_unavailable')
        or (table_name = 'pickup_orders' and column_name = 'inventory_restored_at')
        or (table_name = 'pickup_order_items' and column_name = 'inventory_reserved_quantity')
  `);
  assert.equal(
    columns.rowCount,
    3,
    "Migrations 119, 121, and 133 must be applied",
  );

  const source = await pool.query(
    `select menu_id, restaurant_id from menu_items order by created_at nulls last limit 1`,
  );
  assert.equal(source.rowCount, 1, "A source menu fixture is required");
  const menuId = String(source.rows[0].menu_id);
  const restaurantId = String(source.rows[0].restaurant_id);
  const itemIds: string[] = [];
  const orderIds: string[] = [];

  async function insertItem(
    label: string,
    quantity: number,
    isAvailable = true,
    inventoryAutoUnavailable = false,
    trackInventory = true,
  ) {
    const itemId = fixtureId(`item_${label}`);
    itemIds.push(itemId);
    await pool!.query(
      `insert into menu_items
        (id, menu_id, restaurant_id, name, price_cents, track_inventory,
         inventory_qty, is_available, inventory_auto_unavailable)
       values ($1, $2, $3, $4, 1200, $5, $6, $7, $8)`,
      [
        itemId,
        menuId,
        restaurantId,
        `Inventory truth ${label}`,
        trackInventory,
        quantity,
        isAvailable,
        inventoryAutoUnavailable,
      ],
    );
    return itemId;
  }

  async function state(itemId: string) {
    const result = await pool!.query(
      `select inventory_qty, is_available, inventory_auto_unavailable
         from menu_items where id = $1`,
      [itemId],
    );
    const row = result.rows[0];
    return {
      quantity: Number(row.inventory_qty),
      isAvailable: Boolean(row.is_available),
      autoUnavailable: Boolean(row.inventory_auto_unavailable),
    };
  }

  async function insertOrderWithLine(
    tx: any,
    label: string,
    itemId: string,
    quantity: number,
    status = "pending",
    inventoryReservedQuantity = quantity,
  ) {
    const orderId = fixtureId(`order_${label}`);
    orderIds.push(orderId);
    await tx.execute(sql`
      insert into pickup_orders
        (id, restaurant_id, customer_name, status, subtotal_cents,
         platform_fee_cents, total_cents, payment_method)
      values
        (${orderId}, ${restaurantId}, ${`Inventory ${label}`}, ${status},
         1200, 100, 1300, 'card')
    `);
    await tx.execute(sql`
      insert into pickup_order_items
        (order_id, menu_item_id, item_name, base_price_cents, quantity,
         inventory_reserved_quantity, line_total_cents)
      values
        (${orderId}, ${itemId}, ${`Inventory ${label}`}, 1200,
         ${quantity}, ${inventoryReservedQuantity}, ${1200 * quantity})
    `);
    return orderId;
  }

  async function reserveOrder(label: string, itemId: string, quantity: number) {
    return db.transaction(async (tx: any) => {
      const orderId = await insertOrderWithLine(tx, label, itemId, quantity);
      await reserveTrackedInventoryForPickupOrder(tx, [
        { menuItemId: itemId, quantity },
      ]);
      return orderId;
    });
  }

  async function cancelAndRestore(orderId: string) {
    return db.transaction(async (tx: any) => {
      const result = await tx.execute(sql`
        update pickup_orders
           set status = 'cancelled', cancelled_at = now(), updated_at = now()
         where id = ${orderId} and status = 'pending'
         returning id
      `);
      if (result.rowCount !== 1) return false;
      return restoreTrackedInventoryForPickupOrderByOrderId(tx, orderId);
    });
  }

  try {
    const untracked = await insertItem("untracked", 0, true, false, false);
    await db.transaction((tx: any) =>
      reserveTrackedInventoryForPickupOrder(tx, [
        { menuItemId: untracked, quantity: 2 },
      ]),
    );
    assert.deepEqual(await state(untracked), {
      quantity: 0,
      isAvailable: true,
      autoUnavailable: false,
    });

    const provenanceItem = await insertItem(
      "untracked_then_tracked",
      4,
      true,
      false,
      false,
    );
    const provenanceOrder = await db.transaction(async (tx: any) => {
      const orderId = await insertOrderWithLine(
        tx,
        "untracked_then_tracked",
        provenanceItem,
        2,
        "pending",
        0,
      );
      const reservations = await reserveTrackedInventoryForPickupOrder(tx, [
        { menuItemId: provenanceItem, quantity: 2 },
      ]);
      assert.deepEqual(reservations, []);
      return orderId;
    });
    await pool.query(
      `update menu_items set track_inventory = true where id = $1`,
      [provenanceItem],
    );
    assert.equal(await cancelAndRestore(provenanceOrder), true);
    assert.equal(
      (await state(provenanceItem)).quantity,
      4,
      "An untracked sale must not become restockable after tracking is enabled",
    );

    const reserved = await insertItem("atomic_reservation", 5);
    await db.transaction((tx: any) =>
      reserveTrackedInventoryForPickupOrder(tx, [
        { menuItemId: reserved, quantity: 2 },
      ]),
    );
    assert.deepEqual(await state(reserved), {
      quantity: 3,
      isAvailable: true,
      autoUnavailable: false,
    });

    const rollbackFirst = await insertItem("rollback_first", 5);
    const rollbackInsufficient = await insertItem("rollback_insufficient", 1);
    const rollbackOrder = fixtureId("order_rollback");
    orderIds.push(rollbackOrder);
    await assert.rejects(
      db.transaction(async (tx: any) => {
        await tx.execute(sql`
          insert into pickup_orders
            (id, restaurant_id, customer_name, status, subtotal_cents,
             platform_fee_cents, total_cents, payment_method)
          values
            (${rollbackOrder}, ${restaurantId}, 'Inventory rollback', 'pending',
             2400, 100, 2500, 'card')
        `);
        await tx.execute(sql`
          insert into pickup_order_items
            (order_id, menu_item_id, item_name, base_price_cents, quantity,
             line_total_cents)
          values
            (${rollbackOrder}, ${rollbackFirst}, 'Rollback first',
             1200, 2, 2400),
            (${rollbackOrder}, ${rollbackInsufficient}, 'Rollback insufficient',
             1200, 2, 2400)
        `);
        await reserveTrackedInventoryForPickupOrder(tx, [
          { menuItemId: rollbackFirst, quantity: 2 },
          { menuItemId: rollbackInsufficient, quantity: 2 },
        ]);
      }),
      (error: any) => error?.statusCode === 409,
    );
    const rollbackRows = await pool.query(
      `select
         (select count(*)::int from pickup_orders where id = $1) as orders,
         (select count(*)::int from pickup_order_items where order_id = $1) as items`,
      [rollbackOrder],
    );
    assert.deepEqual(rollbackRows.rows[0], { orders: 0, items: 0 });
    assert.equal((await state(rollbackFirst)).quantity, 5);
    assert.equal((await state(rollbackInsufficient)).quantity, 1);

    const soldOut = await insertItem("sold_out", 2);
    const soldOutOrder = await reserveOrder("sold_out", soldOut, 2);
    assert.deepEqual(await state(soldOut), {
      quantity: 0,
      isAvailable: false,
      autoUnavailable: true,
    });
    assert.equal(await cancelAndRestore(soldOutOrder), true);
    assert.deepEqual(await state(soldOut), {
      quantity: 2,
      isAvailable: true,
      autoUnavailable: false,
    });

    const concurrent = await insertItem("concurrent", 3);
    const attempts = await Promise.allSettled([
      db.transaction((tx: any) =>
        reserveTrackedInventoryForPickupOrder(tx, [
          { menuItemId: concurrent, quantity: 2 },
        ]),
      ),
      db.transaction((tx: any) =>
        reserveTrackedInventoryForPickupOrder(tx, [
          { menuItemId: concurrent, quantity: 2 },
        ]),
      ),
    ]);
    assert.equal(
      attempts.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      attempts.filter((result) => result.status === "rejected").length,
      1,
    );
    assert.deepEqual(await state(concurrent), {
      quantity: 1,
      isAvailable: true,
      autoUnavailable: false,
    });

    const setupFailure = await insertItem("setup_failure", 4);
    const setupFailureOrder = await reserveOrder(
      "setup_failure",
      setupFailure,
      2,
    );
    assert.equal(
      await cleanupPendingPickupOrderAfterPaymentSetupFailure(
        db,
        setupFailureOrder,
      ),
      true,
    );
    assert.equal(
      await cleanupPendingPickupOrderAfterPaymentSetupFailure(
        db,
        setupFailureOrder,
      ),
      false,
    );
    assert.equal((await state(setupFailure)).quantity, 4);

    const rejected = await insertItem("merchant_rejection", 4);
    const rejectedOrder = await reserveOrder("merchant_rejection", rejected, 2);
    assert.equal(await cancelAndRestore(rejectedOrder), true);
    assert.equal(await cancelAndRestore(rejectedOrder), false);
    assert.equal((await state(rejected)).quantity, 4);

    const replayed = await insertItem("restore_replay", 5);
    const replayedOrder = await reserveOrder("restore_replay", replayed, 2);
    await pool.query(
      `update pickup_orders set status = 'cancelled', cancelled_at = now() where id = $1`,
      [replayedOrder],
    );
    const restoreAttempts = await Promise.all([
      db.transaction((tx: any) =>
        restoreTrackedInventoryForPickupOrderByOrderId(tx, replayedOrder),
      ),
      db.transaction((tx: any) =>
        restoreTrackedInventoryForPickupOrderByOrderId(tx, replayedOrder),
      ),
    ]);
    assert.deepEqual(restoreAttempts.sort(), [false, true]);
    assert.equal(
      await db.transaction((tx: any) =>
        restoreTrackedInventoryForPickupOrderByOrderId(tx, replayedOrder),
      ),
      false,
    );
    assert.equal((await state(replayed)).quantity, 5);

    const ownerDisabled = await insertItem("owner_disabled_after_sale", 1);
    const ownerDisabledOrder = await reserveOrder(
      "owner_disabled_after_sale",
      ownerDisabled,
      1,
    );
    await pool.query(
      `update menu_items
          set is_available = false, inventory_auto_unavailable = false
        where id = $1`,
      [ownerDisabled],
    );
    assert.equal(await cancelAndRestore(ownerDisabledOrder), true);
    assert.deepEqual(await state(ownerDisabled), {
      quantity: 1,
      isAvailable: false,
      autoUnavailable: false,
    });

    const pending = await insertItem("pending_no_restore", 3);
    const pendingOrder = await reserveOrder("pending_no_restore", pending, 1);
    assert.equal(
      await db.transaction((tx: any) =>
        restoreTrackedInventoryForPickupOrderByOrderId(tx, pendingOrder),
      ),
      false,
    );
    assert.equal((await state(pending)).quantity, 2);

    const preparing = await insertItem("preparation_consumed", 1);
    const preparingOrder = await reserveOrder(
      "preparation_consumed",
      preparing,
      1,
    );
    await pool.query(
      `update pickup_orders
          set status = 'cancelled', merchant_acknowledged_at = now(),
              cancelled_at = now(), updated_at = now()
        where id = $1`,
      [preparingOrder],
    );
    assert.equal(
      await db.transaction((tx: any) =>
        restoreTrackedInventoryForPickupOrderByOrderId(tx, preparingOrder),
      ),
      false,
      "Consumed preparation inventory must not return to sellable stock",
    );
    assert.equal((await state(preparing)).quantity, 0);

    const unknownLegacy = await insertItem("legacy_unknown_provenance", 2);
    const unknownLegacyOrder = await db.transaction(async (tx: any) => {
      const orderId = await insertOrderWithLine(
        tx,
        "legacy_unknown_provenance",
        unknownLegacy,
        1,
        "cancelled",
        null as unknown as number,
      );
      await tx.execute(sql`
        update pickup_order_items
           set inventory_reserved_quantity = null
         where order_id = ${orderId}
      `);
      return orderId;
    });
    assert.equal(
      await db.transaction((tx: any) =>
        restoreTrackedInventoryForPickupOrderByOrderId(tx, unknownLegacyOrder),
      ),
      false,
      "Null legacy provenance requires explicit stock audit",
    );
    assert.equal((await state(unknownLegacy)).quantity, 2);

    console.log("mealscout-inventory-truth: PASS (12/12)");
  } finally {
    if (orderIds.length > 0) {
      await pool.query(
        `delete from pickup_orders where id = any($1::varchar[])`,
        [orderIds],
      );
    }
    if (itemIds.length > 0) {
      await pool.query(`delete from menu_items where id = any($1::varchar[])`, [
        itemIds,
      ]);
    }
    await pool.end();
  }
}

run().catch((error: any) => {
  console.error(
    "mealscout-inventory-truth: FAIL",
    error?.stack || error?.message || error,
  );
  process.exit(1);
});
