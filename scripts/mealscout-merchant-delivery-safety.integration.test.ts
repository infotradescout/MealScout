import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  cleanupPendingPickupOrderAfterPaymentSetupFailure,
  reserveTrackedInventoryForPickupOrder,
  restoreTrackedInventoryForPickupOrderByOrderId,
} from "../server/services/pickupInventoryService";
import {
  calculateAuthoritativeMerchantDeliveryTotals,
  hashCustomerAccessToken,
} from "../server/services/merchantDeliverySafety";

const OPT_IN = "MEALSCOUT_MERCHANT_DELIVERY_SAFETY";
const BRANCH = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_BRANCH_ID";
const HOST = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_EXPECTED_HOST";

function requireDisposableDatabase() {
  assert.equal(process.env[OPT_IN], "1", `${OPT_IN}=1 is required`);
  assert.match(String(process.env[BRANCH] || ""), /^br-/);
  const url = new URL(String(process.env.DATABASE_URL || ""));
  assert.equal(url.hostname.toLowerCase(), String(process.env[HOST] || "").toLowerCase());
}

function id(label: string) { return `merchant_delivery_${label}_${randomUUID()}`; }

async function run() {
  requireDisposableDatabase();
  const { db, pool } = await import("../server/db");
  assert.ok(pool);
  const source = await pool.query(`select menu_id, restaurant_id from menu_items order by created_at nulls last limit 1`);
  assert.equal(source.rowCount, 1, "A source menu fixture is required");
  const menuId = String(source.rows[0].menu_id);
  const restaurantId = String(source.rows[0].restaurant_id);
  const orderIds: string[] = [];
  const itemIds: string[] = [];

  async function item(label: string, quantity: number) {
    const itemId = id(`item_${label}`);
    itemIds.push(itemId);
    await pool.query(`insert into menu_items (id, menu_id, restaurant_id, name, price_cents, track_inventory, inventory_qty, is_available, inventory_auto_unavailable) values ($1,$2,$3,$4,1200,true,$5,true,false)`, [itemId, menuId, restaurantId, `Merchant delivery ${label}`, quantity]);
    return itemId;
  }

  async function createDelivery(tx: any, label: string, itemId: string, quantity: number, requestId = randomUUID()) {
    const orderId = id(`order_${label}`);
    orderIds.push(orderId);
    const totals = calculateAuthoritativeMerchantDeliveryTotals({ subtotalCents: 1200 * quantity, platformFeeCents: 100, deliveryFeeCents: 500 });
    await tx.execute(sql`insert into pickup_orders (id, restaurant_id, customer_name, customer_email, order_type, status, subtotal_cents, platform_fee_cents, total_cents, payment_method, delivery_address, delivery_city, delivery_state, delivery_postal_code, delivery_instructions, delivery_fee_cents, tax_cents, tip_cents, discount_cents, checkout_request_id, customer_access_token_hash) values (${orderId},${restaurantId},'Delivery customer','delivery@example.com','delivery','pending',${totals.subtotalCents},${totals.platformFeeCents},${totals.totalCents},'card','10 Snapshot Ave','Dallas','TX','75201','Side door',${totals.deliveryFeeCents},${totals.taxCents},${totals.tipCents},${totals.discountCents},${requestId},${hashCustomerAccessToken("a".repeat(64))})`);
    await tx.execute(sql`insert into pickup_order_items (order_id, menu_item_id, item_name, base_price_cents, quantity, line_total_cents) values (${orderId},${itemId},${`Snapshot ${label}`},1200,${quantity},${1200 * quantity})`);
    await reserveTrackedInventoryForPickupOrder(tx, [{ menuItemId: itemId, quantity }]);
    return orderId;
  }

  async function quantity(itemId: string) {
    const result = await pool.query(`select inventory_qty from menu_items where id = $1`, [itemId]);
    return Number(result.rows[0].inventory_qty);
  }

  try {
    const columns = await pool.query(`select column_name from information_schema.columns where table_name = 'pickup_orders' and column_name in ('checkout_request_id','customer_access_token_hash','tax_cents','tip_cents','discount_cents')`);
    assert.equal(columns.rowCount, 5);

    const success = await item("success", 5);
    const successOrder = await db.transaction((tx: any) => createDelivery(tx, "success", success, 2));
    assert.equal(await quantity(success), 3);
    const snapshot = await pool.query(`select order_type, delivery_address, delivery_fee_cents, total_cents from pickup_orders where id = $1`, [successOrder]);
    assert.deepEqual(snapshot.rows[0], { order_type: "delivery", delivery_address: "10 Snapshot Ave", delivery_fee_cents: 500, total_cents: 3000 });

    const insufficient = await item("insufficient", 1);
    await assert.rejects(db.transaction((tx: any) => createDelivery(tx, "insufficient", insufficient, 2)), (error: any) => error?.statusCode === 409);
    assert.equal(await quantity(insufficient), 1);

    const setupFailure = await item("setup_failure", 4);
    const setupFailureOrder = await db.transaction((tx: any) => createDelivery(tx, "setup_failure", setupFailure, 2));
    assert.equal(await cleanupPendingPickupOrderAfterPaymentSetupFailure(db, setupFailureOrder), true);
    assert.equal(await cleanupPendingPickupOrderAfterPaymentSetupFailure(db, setupFailureOrder), false);
    assert.equal(await quantity(setupFailure), 4);

    const cancelled = await item("cancelled", 4);
    const cancelledOrder = await db.transaction((tx: any) => createDelivery(tx, "cancelled", cancelled, 2));
    async function cancelOnce() {
      return db.transaction(async (tx: any) => {
        const result = await tx.execute(sql`update pickup_orders set status = 'cancelled', cancelled_at = now() where id = ${cancelledOrder} and status = 'pending' returning id`);
        if (result.rowCount !== 1) return false;
        await restoreTrackedInventoryForPickupOrderByOrderId(tx, cancelledOrder);
        return true;
      });
    }
    assert.deepEqual((await Promise.all([cancelOnce(), cancelOnce()])).sort(), [false, true]);
    assert.equal(await quantity(cancelled), 4);

    const duplicateItem = await item("duplicate", 5);
    const duplicateRequest = randomUUID();
    await db.transaction((tx: any) => createDelivery(tx, "duplicate_first", duplicateItem, 1, duplicateRequest));
    await assert.rejects(
      db.transaction((tx: any) => createDelivery(tx, "duplicate_second", duplicateItem, 1, duplicateRequest)),
      (error: any) => String(error?.code || error?.cause?.code) === "23505",
    );
    assert.equal(await quantity(duplicateItem), 4);

    const dedupeKey = `${successOrder}:email:merchant_new_order:owner@example.com`;
    const notifications = await Promise.allSettled([
      pool.query(`insert into order_notifications (order_id, channel, type, recipient, status, dedupe_key) values ($1,'email','merchant_new_order','owner@example.com','pending',$2)`, [successOrder, dedupeKey]),
      pool.query(`insert into order_notifications (order_id, channel, type, recipient, status, dedupe_key) values ($1,'email','merchant_new_order','owner@example.com','pending',$2)`, [successOrder, dedupeKey]),
    ]);
    assert.equal(notifications.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(notifications.filter((result) => result.status === "rejected").length, 1);

    const concurrentItem = await item("concurrent", 3);
    const concurrent = await Promise.allSettled([
      db.transaction((tx: any) => reserveTrackedInventoryForPickupOrder(tx, [{ menuItemId: concurrentItem, quantity: 2 }])),
      db.transaction((tx: any) => reserveTrackedInventoryForPickupOrder(tx, [{ menuItemId: concurrentItem, quantity: 2 }])),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
    assert.equal(await quantity(concurrentItem), 1);
    console.log("mealscout-merchant-delivery-safety: PASS (10/10)");
  } finally {
    await pool.query(`delete from order_notifications where order_id = any($1::varchar[])`, [orderIds]);
    await pool.query(`delete from pickup_orders where id = any($1::varchar[])`, [orderIds]);
    await pool.query(`delete from menu_items where id = any($1::varchar[])`, [itemIds]);
    await pool.end();
  }
}

run().catch((error: any) => { console.error("mealscout-merchant-delivery-safety: FAIL", error?.stack || error); process.exit(1); });
