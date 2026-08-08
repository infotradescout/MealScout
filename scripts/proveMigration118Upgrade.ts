import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { db, pool } from "../server/db";
import { reserveTrackedInventoryForPickupOrder } from "../server/services/pickupInventoryService";
import { runMigrationFile } from "./runSqlMigration";

const OPT_IN = "MEALSCOUT_MIGRATION_118_UPGRADE_PROOF";
const BRANCH = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_BRANCH_ID";
const HOST = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_EXPECTED_HOST";
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

function requireDisposableDatabase() {
  assert.equal(process.env[OPT_IN], "1", `${OPT_IN}=1 is required`);
  assert.match(String(process.env[BRANCH] || ""), /^br-/);
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  const expectedHost = String(process.env[HOST] || "").trim().toLowerCase();
  assert.ok(databaseUrl, "DATABASE_URL is required");
  assert.ok(expectedHost, `${HOST} is required`);
  assert.equal(new URL(databaseUrl).hostname.toLowerCase(), expectedHost);
}

async function run() {
  requireDisposableDatabase();
  const databasePool = pool;
  assert.ok(databasePool, "Disposable PostgreSQL pool is required");

  let checks = 0;
  const check = (condition: unknown, message: string) => {
    assert.ok(condition, message);
    checks += 1;
  };
  const fixture = randomUUID().replaceAll("-", "");
  const ids = {
    claimedOwner: `upgrade_owner_claimed_${fixture}`,
    otherOwner: `upgrade_owner_other_${fixture}`,
    claimedListing: `upgrade_listing_claimed_${fixture}`,
    unclaimedListing: `upgrade_listing_unclaimed_${fixture}`,
    restaurant: `upgrade_restaurant_${fixture}`,
    menu: `upgrade_menu_${fixture}`,
    category: `upgrade_category_${fixture}`,
    disabledItem: `upgrade_item_disabled_${fixture}`,
    availableItem: `upgrade_item_available_${fixture}`,
    soldOutItem: `upgrade_item_sold_out_${fixture}`,
    pickupOrder: `upgrade_order_pickup_${fixture}`,
    deliveryOrder: `upgrade_order_delivery_${fixture}`,
    ownership: `upgrade_ownership_${fixture}`,
  };

  const before = await databasePool.query(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'menu_items' and column_name = 'inventory_auto_unavailable')
          or (table_name = 'pickup_orders' and column_name in
              ('checkout_request_id', 'customer_access_token_hash', 'tax_cents',
               'tip_cents', 'discount_cents', 'inventory_restored_at')))` ,
  );
  assert.equal(before.rowCount, 0, "Database must be at migration 118 before proof");
  checks += 1;

  await databasePool.query("begin");
  try {
    await databasePool.query(
      `insert into users (id, user_type, email, first_name, last_name)
       values ($1, 'restaurant_owner', $3, 'Claimed', 'Owner'),
              ($2, 'restaurant_owner', $4, 'Other', 'Owner')`,
      [
        ids.claimedOwner,
        ids.otherOwner,
        `claimed-${fixture}@example.test`,
        `other-${fixture}@example.test`,
      ],
    );
    await databasePool.query(
      `insert into truck_import_listings
         (id, source, external_id, name, address, city, state, status, raw_data)
       values
         ($1, 'upgrade-proof', $3, 'Claimed Upgrade Profile', '10 Claim Ave',
          'Pensacola', 'FL', 'claimed', '{"visibility":"claimed"}'::jsonb),
         ($2, 'upgrade-proof', $4, 'Unclaimed Upgrade Profile', '20 Open Ave',
          'Pensacola', 'FL', 'unclaimed', '{"visibility":"unclaimed"}'::jsonb)`,
      [ids.claimedListing, ids.unclaimedListing, `claimed-${fixture}`, `unclaimed-${fixture}`],
    );
    await databasePool.query(
      `insert into restaurants
         (id, owner_id, name, address, business_type, city, state, is_active,
          is_verified, claimed_from_import_id)
       values ($1, $2, 'Claimed Upgrade Merchant', '10 Claim Ave', 'restaurant',
               'Pensacola', 'FL', true, true, $3)`,
      [ids.restaurant, ids.claimedOwner, ids.claimedListing],
    );
    await databasePool.query(
      `insert into menus (id, restaurant_id, name, is_active)
       values ($1, $2, 'Upgrade Menu', true)`,
      [ids.menu, ids.restaurant],
    );
    await databasePool.query(
      `insert into menu_categories (id, menu_id, restaurant_id, name)
       values ($1, $2, $3, 'Upgrade Items')`,
      [ids.category, ids.menu, ids.restaurant],
    );
    await databasePool.query(
      `insert into menu_items
         (id, menu_id, category_id, restaurant_id, name, price_cents,
          track_inventory, inventory_qty, is_available)
       values
         ($1, $4, $5, $6, 'Merchant Disabled', 1200, true, 5, false),
         ($2, $4, $5, $6, 'Tracked Available', 1500, true, 7, true),
         ($3, $4, $5, $6, 'Historical Sold Out', 1800, true, 0, false)`,
      [
        ids.disabledItem,
        ids.availableItem,
        ids.soldOutItem,
        ids.menu,
        ids.category,
        ids.restaurant,
      ],
    );
    await databasePool.query(
      `insert into pickup_orders
         (id, restaurant_id, customer_name, customer_email, order_type, status,
          subtotal_cents, platform_fee_cents, total_cents, payment_method,
          delivery_address, delivery_city, delivery_state, delivery_postal_code,
          delivery_fee_cents)
       values
         ($1, $3, 'Pickup Customer', 'pickup@example.test', 'pickup', 'paid',
          2400, 100, 2500, 'card', null, null, null, null, 0),
         ($2, $3, 'Delivery Customer', 'delivery@example.test', 'delivery', 'paid',
          3000, 100, 3600, 'card', '30 Delivery Rd', 'Pensacola', 'FL', '32501', 500)`,
      [ids.pickupOrder, ids.deliveryOrder, ids.restaurant],
    );
    await databasePool.query(
      `insert into pickup_order_items
         (order_id, menu_item_id, item_name, base_price_cents, quantity, line_total_cents)
       values ($1, $3, 'Merchant Disabled', 1200, 2, 2400),
              ($2, $4, 'Tracked Available', 1500, 2, 3000)`,
      [ids.pickupOrder, ids.deliveryOrder, ids.disabledItem, ids.availableItem],
    );
    await databasePool.query(
      `insert into merchant_delivery_settings
         (restaurant_id, enabled, fee_cents, minimum_order_cents,
          estimated_minutes, max_concurrent_orders, postal_codes, delivery_hours)
       values ($1, true, 500, 2000, 45, 5, '["32501"]'::jsonb,
               '{"mon":[{"open":"09:00","close":"17:00"}]}'::jsonb)`,
      [ids.restaurant],
    );
    await databasePool.query(
      `insert into public_business_slug_ownerships
         (id, slug, entity_type, entity_id, preferred_slug, source_name, assignment_status)
       values ($1, 'claimed-upgrade-merchant', 'restaurant', $2,
               'claimed-upgrade-merchant', 'Claimed Upgrade Merchant', 'assigned')`,
      [ids.ownership, ids.restaurant],
    );
    await databasePool.query("commit");
  } catch (error) {
    await databasePool.query("rollback");
    throw error;
  }

  for (const migration of [
    "119_menu_inventory_auto_availability.sql",
    "120_merchant_delivery_checkout_safety.sql",
    "121_inventory_truth.sql",
  ]) {
    await runMigrationFile(path.join(migrationsDirectory, migration), { quiet: true });
  }

  const migratedColumns = await databasePool.query(
    `select table_name, column_name, is_nullable, column_default
       from information_schema.columns
      where table_schema = 'public'
        and ((table_name = 'menu_items' and column_name = 'inventory_auto_unavailable')
          or (table_name = 'pickup_orders' and column_name in
              ('checkout_request_id', 'customer_access_token_hash', 'tax_cents',
               'tip_cents', 'discount_cents', 'inventory_restored_at'))
          or (table_name = 'order_notifications' and column_name = 'dedupe_key'))`,
  );
  check(migratedColumns.rowCount === 8, "Migrations 119-121 must add all expected columns");

  const historicalItems = await databasePool.query(
    `select id, inventory_qty, is_available, inventory_auto_unavailable
       from menu_items where id = any($1::varchar[]) order by id`,
    [[ids.disabledItem, ids.availableItem, ids.soldOutItem]],
  );
  check(historicalItems.rowCount === 3, "All historical inventory rows must remain");
  const disabled = historicalItems.rows.find((row) => row.id === ids.disabledItem);
  const soldOut = historicalItems.rows.find((row) => row.id === ids.soldOutItem);
  check(disabled?.is_available === false && disabled?.inventory_auto_unavailable === false,
    "Merchant-disabled state must not be labeled as automatic sold out");
  check(soldOut?.inventory_qty === 0 && soldOut?.inventory_auto_unavailable === false,
    "Historical sold-out state must not be destructively reclassified");

  await db.transaction(async (tx) => {
    await reserveTrackedInventoryForPickupOrder(tx, [
      { menuItemId: ids.availableItem, quantity: 7 },
    ]);
  });
  const autoSoldOut = await databasePool.query(
    `select inventory_qty, is_available, inventory_auto_unavailable
       from menu_items where id = $1`,
    [ids.availableItem],
  );
  check(
    autoSoldOut.rows[0]?.inventory_qty === 0 &&
      autoSoldOut.rows[0]?.is_available === false &&
      autoSoldOut.rows[0]?.inventory_auto_unavailable === true,
    "Runtime automatic sold-out state must remain distinct from merchant-disabled state",
  );

  const orders = await databasePool.query(
    `select id, order_type, subtotal_cents, platform_fee_cents, delivery_fee_cents,
            total_cents, tax_cents, tip_cents, discount_cents, inventory_restored_at
       from pickup_orders where id = any($1::varchar[]) order by id`,
    [[ids.pickupOrder, ids.deliveryOrder]],
  );
  check(orders.rowCount === 2, "Historical pickup and delivery orders must remain");
  const pickup = orders.rows.find((row) => row.id === ids.pickupOrder);
  const delivery = orders.rows.find((row) => row.id === ids.deliveryOrder);
  check(
    pickup?.order_type === "pickup" && pickup?.subtotal_cents === 2400 &&
      pickup?.platform_fee_cents === 100 && pickup?.delivery_fee_cents === 0 &&
      pickup?.total_cents === 2500,
    "Historical pickup fulfillment and totals must remain intact",
  );
  check(
    delivery?.order_type === "delivery" && delivery?.subtotal_cents === 3000 &&
      delivery?.platform_fee_cents === 100 && delivery?.delivery_fee_cents === 500 &&
      delivery?.total_cents === 3600,
    "Historical delivery fulfillment and totals must remain intact",
  );
  check(
    orders.rows.every((row) =>
      row.tax_cents === 0 && row.tip_cents === 0 && row.discount_cents === 0 &&
      row.inventory_restored_at === null),
    "New safety columns must use non-destructive defaults",
  );

  const ownership = await databasePool.query(
    `select o.id, o.slug, o.entity_type, o.entity_id, o.assignment_status,
            r.owner_id, r.claimed_from_import_id
       from public_business_slug_ownerships o
       left join restaurants r on r.id = o.entity_id
      where o.id = $1`,
    [ids.ownership],
  );
  check(ownership.rowCount === 1, "Claimed profile ownership must not be duplicated");
  check(
    ownership.rows[0]?.entity_id === ids.restaurant &&
      ownership.rows[0]?.owner_id === ids.claimedOwner &&
      ownership.rows[0]?.claimed_from_import_id === ids.claimedListing &&
      ownership.rows[0]?.assignment_status === "assigned",
    "Claimed profile ownership must not be reassigned",
  );
  const unclaimed = await databasePool.query(
    `select l.status,
            count(o.id)::int as ownership_count,
            count(r.id)::int as claimed_restaurant_count
       from truck_import_listings l
       left join public_business_slug_ownerships o on o.entity_id = l.id
       left join restaurants r on r.claimed_from_import_id = l.id
      where l.id = $1
      group by l.status`,
    [ids.unclaimedListing],
  );
  check(
    unclaimed.rows[0]?.status === "unclaimed" &&
      unclaimed.rows[0]?.ownership_count === 0 &&
      unclaimed.rows[0]?.claimed_restaurant_count === 0,
    "Unclaimed profile must not gain ownership or public claimed state",
  );

  const indexes = await databasePool.query(
    `select indexname from pg_indexes
      where schemaname = 'public' and indexname in
        ('uq_pickup_orders_checkout_request', 'uq_order_notifications_dedupe_key',
         'idx_pickup_orders_delivery_active')`,
  );
  check(indexes.rowCount === 3, "Migration 120 indexes must exist");

  const preserved = await databasePool.query(
    `select
       (select count(*)::int from users where id = any($1::varchar[])) as users,
       (select count(*)::int from truck_import_listings where id = any($2::varchar[])) as listings,
       (select count(*)::int from pickup_order_items where order_id = any($3::varchar[])) as order_items,
       (select count(*)::int from merchant_delivery_settings where restaurant_id = $4) as delivery_settings`,
    [
      [ids.claimedOwner, ids.otherOwner],
      [ids.claimedListing, ids.unclaimedListing],
      [ids.pickupOrder, ids.deliveryOrder],
      ids.restaurant,
    ],
  );
  check(
    preserved.rows[0]?.users === 2 && preserved.rows[0]?.listings === 2 &&
      preserved.rows[0]?.order_items === 2 && preserved.rows[0]?.delivery_settings === 1,
    "Upgrade must preserve representative pre-119 data without a reset",
  );

  console.log(`Migration 118 upgrade PASS (${checks} checks, applied 119 -> 120 -> 121)`);
}

run()
  .catch((error) => {
    console.error("Migration 118 upgrade FAIL", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end();
  });
