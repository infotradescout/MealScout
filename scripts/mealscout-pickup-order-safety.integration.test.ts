import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  cleanupPendingPickupOrderAfterPaymentSetupFailure,
  reserveTrackedInventoryForPickupOrder,
  restoreTrackedInventoryForPickupOrderByOrderId,
} from "../server/services/pickupInventoryService";

const REQUIRED_OPT_IN = "MEALSCOUT_PICKUP_ORDER_SAFETY";
const REQUIRED_BRANCH = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_BRANCH_ID";
const REQUIRED_HOST = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_EXPECTED_HOST";

function requireDisposableDatabase() {
  assert.equal(
    process.env[REQUIRED_OPT_IN],
    "1",
    `${REQUIRED_OPT_IN}=1 is required`,
  );
  assert.match(
    String(process.env[REQUIRED_BRANCH] || ""),
    /^br-/,
    `${REQUIRED_BRANCH} must identify the disposable Neon branch`,
  );
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  const expectedHost = String(process.env[REQUIRED_HOST] || "")
    .trim()
    .toLowerCase();
  assert.ok(databaseUrl, "DATABASE_URL is required");
  assert.ok(expectedHost, `${REQUIRED_HOST} is required`);
  assert.equal(
    new URL(databaseUrl).hostname.toLowerCase(),
    expectedHost,
    "DATABASE_URL does not target the explicitly approved disposable host",
  );
}

function fixtureId(label: string) {
  return `pickup_safety_${label}_${randomUUID()}`;
}

async function run() {
  requireDisposableDatabase();
  const { db, pool } = await import("../server/db");
  assert.ok(pool, "Disposable PostgreSQL pool is required");

  const source = await pool.query(
    `select menu_id, restaurant_id from menu_items order by created_at nulls last limit 1`,
  );
  assert.equal(source.rowCount, 1, "A source menu and restaurant fixture are required");
  const menuId = String(source.rows[0].menu_id);
  const restaurantId = String(source.rows[0].restaurant_id);
  const menuItemIds: string[] = [];
  const orderIds: string[] = [];

  async function insertMenuItem(label: string, quantity: number) {
    const id = fixtureId(`item_${label}`);
    menuItemIds.push(id);
    await pool!.query(
      `insert into menu_items
         (id, menu_id, restaurant_id, name, price_cents, track_inventory,
          inventory_qty, is_available)
       values ($1, $2, $3, $4, 1200, true, $5, true)`,
      [id, menuId, restaurantId, `Pickup safety ${label}`, quantity],
    );
    return id;
  }

  async function inventoryQuantity(menuItemId: string) {
    const result = await pool!.query(
      `select inventory_qty from menu_items where id = $1`,
      [menuItemId],
    );
    return Number(result.rows[0]?.inventory_qty);
  }

  async function insertOrderWithLine(
    tx: any,
    label: string,
    menuItemId: string,
    quantity: number,
    status = "pending",
  ) {
    const orderId = fixtureId(`order_${label}`);
    orderIds.push(orderId);
    await tx.execute(sql`
      insert into pickup_orders
        (id, restaurant_id, customer_name, status, subtotal_cents,
         platform_fee_cents, total_cents, payment_method)
      values
        (${orderId}, ${restaurantId}, ${`Safety ${label}`}, ${status},
         1200, 100, 1300, 'card')
    `);
    await tx.execute(sql`
      insert into pickup_order_items
        (order_id, menu_item_id, item_name, base_price_cents, quantity,
         line_total_cents)
      values
        (${orderId}, ${menuItemId}, ${`Safety ${label}`}, 1200,
         ${quantity}, ${1200 * quantity})
    `);
    return orderId;
  }

  async function assertOrderRemoved(orderId: string) {
    const result = await pool!.query(
      `select
         (select count(*)::int from pickup_orders where id = $1) as orders,
         (select count(*)::int from pickup_order_items where order_id = $1) as items`,
      [orderId],
    );
    assert.deepEqual(result.rows[0], { orders: 0, items: 0 });
  }

  try {
    const successItem = await insertMenuItem("success", 5);
    await db.transaction(async (tx: any) => {
      await reserveTrackedInventoryForPickupOrder(tx, [
        { menuItemId: successItem, quantity: 2 },
      ]);
    });
    assert.equal(await inventoryQuantity(successItem), 3);

    const rollbackFirst = await insertMenuItem("rollback_first", 5);
    const rollbackInsufficient = await insertMenuItem("rollback_insufficient", 1);
    const rollbackOrderId = fixtureId("order_rollback");
    orderIds.push(rollbackOrderId);
    await assert.rejects(
      db.transaction(async (tx: any) => {
        await tx.execute(sql`
          insert into pickup_orders
            (id, restaurant_id, customer_name, status, subtotal_cents,
             platform_fee_cents, total_cents, payment_method)
          values
            (${rollbackOrderId}, ${restaurantId}, 'Safety rollback', 'pending',
             2400, 100, 2500, 'card')
        `);
        await tx.execute(sql`
          insert into pickup_order_items
            (order_id, menu_item_id, item_name, base_price_cents, quantity,
             line_total_cents)
          values
            (${rollbackOrderId}, ${rollbackFirst}, 'Rollback first', 1200, 2, 2400),
            (${rollbackOrderId}, ${rollbackInsufficient}, 'Rollback insufficient', 1200, 2, 2400)
        `);
        await reserveTrackedInventoryForPickupOrder(tx, [
          { menuItemId: rollbackFirst, quantity: 2 },
          { menuItemId: rollbackInsufficient, quantity: 2 },
        ]);
      }),
      (error: any) => error?.statusCode === 409,
    );
    await assertOrderRemoved(rollbackOrderId);
    assert.equal(await inventoryQuantity(rollbackFirst), 5);
    assert.equal(await inventoryQuantity(rollbackInsufficient), 1);

    for (const label of ["stripe_missing", "stripe_create_failure"]) {
      const itemId = await insertMenuItem(label, 5);
      const orderId = await db.transaction(async (tx: any) => {
        const id = await insertOrderWithLine(tx, label, itemId, 2);
        await reserveTrackedInventoryForPickupOrder(tx, [
          { menuItemId: itemId, quantity: 2 },
        ]);
        return id;
      });
      assert.equal(await inventoryQuantity(itemId), 3);
      assert.equal(
        await cleanupPendingPickupOrderAfterPaymentSetupFailure(db, orderId),
        true,
      );
      assert.equal(
        await cleanupPendingPickupOrderAfterPaymentSetupFailure(db, orderId),
        false,
      );
      await assertOrderRemoved(orderId);
      assert.equal(await inventoryQuantity(itemId), 5);
    }

    const cancellationItem = await insertMenuItem("owner_cancel", 5);
    const cancellationOrder = await db.transaction(async (tx: any) => {
      const id = await insertOrderWithLine(tx, "owner_cancel", cancellationItem, 2);
      await reserveTrackedInventoryForPickupOrder(tx, [
        { menuItemId: cancellationItem, quantity: 2 },
      ]);
      return id;
    });
    async function cancelOnce() {
      return db.transaction(async (tx: any) => {
        const result = await tx.execute(sql`
          update pickup_orders
             set status = 'cancelled', cancelled_at = now(), updated_at = now()
           where id = ${cancellationOrder} and status = 'pending'
           returning id
        `);
        if (result.rowCount !== 1) return false;
        await restoreTrackedInventoryForPickupOrderByOrderId(
          tx,
          cancellationOrder,
        );
        return true;
      });
    }
    const cancellationResults = await Promise.all([cancelOnce(), cancelOnce()]);
    assert.deepEqual(cancellationResults.sort(), [false, true]);
    assert.equal(await inventoryQuantity(cancellationItem), 5);

    const concurrencyItem = await insertMenuItem("concurrency", 3);
    const attempts = await Promise.allSettled([
      db.transaction((tx: any) =>
        reserveTrackedInventoryForPickupOrder(tx, [
          { menuItemId: concurrencyItem, quantity: 2 },
        ]),
      ),
      db.transaction((tx: any) =>
        reserveTrackedInventoryForPickupOrder(tx, [
          { menuItemId: concurrencyItem, quantity: 2 },
        ]),
      ),
    ]);
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
    assert.equal(await inventoryQuantity(concurrencyItem), 1);

    console.log("mealscout-pickup-order-safety: PASS (6/6)");
  } finally {
    if (orderIds.length > 0) {
      await pool.query(`delete from pickup_orders where id = any($1::varchar[])`, [orderIds]);
    }
    if (menuItemIds.length > 0) {
      await pool.query(`delete from menu_items where id = any($1::varchar[])`, [menuItemIds]);
    }
    await pool.end();
  }
}

run().catch((error: any) => {
  console.error(
    "mealscout-pickup-order-safety: FAIL",
    error?.stack || error?.message || error,
  );
  process.exit(1);
});
