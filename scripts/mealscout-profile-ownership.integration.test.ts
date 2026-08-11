import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const OPT_IN = "MEALSCOUT_PROFILE_OWNERSHIP_SAFETY";
const BRANCH = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_BRANCH_ID";
const HOST = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_EXPECTED_HOST";

function requireDisposableDatabase() {
  assert.equal(process.env[OPT_IN], "1", `${OPT_IN}=1 is required`);
  assert.match(String(process.env[BRANCH] || ""), /^br-/);
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  const expectedHost = String(process.env[HOST] || "").trim().toLowerCase();
  assert.ok(databaseUrl, "DATABASE_URL is required");
  assert.ok(expectedHost, `${HOST} is required`);
  assert.equal(new URL(databaseUrl).hostname.toLowerCase(), expectedHost);
}

const id = (label: string) => `profile_ownership_${label}_${randomUUID()}`;

async function run() {
  requireDisposableDatabase();
  const { db, pool } = await import("../server/db");
  const { storage } = await import("../server/storage");
  const { buildPublicMenuPayload } = await import("../server/routes/publicDiscoveryRoutes");
  const { toPublicRestaurantProfile } = await import("../server/publicProfiles/toPublicRestaurantProfile");
  const { isRestaurantOpenNow } = await import("../server/routes/menuRoutes");
  const { loadAuthoritativePickupOrderItems } = await import("../server/services/pickupOrderIdentityService");
  const { assertPublicResponseSafe } = await import("../server/publicProfiles/assertPublicResponseSafe");
  assert.ok(pool);

  const owners = await pool.query(`select id from users order by created_at nulls last limit 2`);
  assert.equal(owners.rowCount, 2, "Two existing user fixtures are required");
  const ownerId = String(owners.rows[0].id);
  const unrelatedOwnerId = String(owners.rows[1].id);
  const listingId = id("listing");
  const restaurantId = id("restaurant");
  const unrelatedRestaurantId = id("unrelated_restaurant");
  const menuId = id("menu");
  const unrelatedMenuId = id("unrelated_menu");
  const categoryId = id("category");
  const availableItemId = id("available_item");
  const soldOutItemId = id("sold_out_item");
  const unrelatedItemId = id("unrelated_item");

  try {
    await pool.query(
      `insert into truck_import_listings (id, name, address, city, state, status, raw_data)
       values ($1, 'Stale Generic Listing', '1 Import Way', 'Pensacola', 'FL', 'claimed',
         '{"evidenceIngest":{"extracted":{"menuItems":[{"name":"Stale Generic Burger","price":"1.00"}]}}}'::jsonb)`,
      [listingId],
    );
    const hours = JSON.stringify({
      mon: [{ open: "00:00", close: "23:59" }], tue: [{ open: "00:00", close: "23:59" }],
      wed: [{ open: "00:00", close: "23:59" }], thu: [{ open: "00:00", close: "23:59" }],
      fri: [{ open: "00:00", close: "23:59" }], sat: [{ open: "00:00", close: "23:59" }],
      sun: [{ open: "00:00", close: "23:59" }],
    });
    await pool.query(
      `insert into restaurants
         (id, owner_id, name, address, business_type, city, state, operating_hours,
          is_active, is_verified, claimed_from_import_id)
       values ($1,$2,'Canonical Claimed Kitchen','10 Owner Ave','restaurant','Pensacola','FL',$3::jsonb,true,true,$4),
              ($5,$6,'Unrelated Kitchen','20 Other Ave','restaurant','Pensacola','FL',$3::jsonb,true,true,null)`,
      [restaurantId, ownerId, hours, listingId, unrelatedRestaurantId, unrelatedOwnerId],
    );

    assert.ok(await storage.verifyRestaurantOwnership(restaurantId, ownerId, "manageProfile"));
    assert.equal(await storage.verifyRestaurantOwnership(restaurantId, unrelatedOwnerId, "manageProfile"), false);

    const beforeMenu = await buildPublicMenuPayload(restaurantId);
    assert.deepEqual(beforeMenu.menuSections, []);
    assert.equal(beforeMenu.claimedProfile, true);

    await pool.query(
      `insert into menus (id, restaurant_id, name, service_type, is_active, accepts_cash)
       values ($1,$2,'Owner Menu','all',true,true), ($3,$4,'Other Menu','all',true,true)`,
      [menuId, restaurantId, unrelatedMenuId, unrelatedRestaurantId],
    );
    await pool.query(
      `insert into menu_categories (id, menu_id, restaurant_id, name, sort_order, is_active)
       values ($1,$2,$3,'Mains',0,true)`,
      [categoryId, menuId, restaurantId],
    );
    await pool.query(
      `insert into menu_items
         (id, menu_id, category_id, restaurant_id, name, price_cents, is_available, sort_order)
       values ($1,$2,$3,$4,'Owner Plate',1299,true,0),
              ($5,$2,$3,$4,'Sold Out Plate',1599,false,1),
              ($6,$7,null,$8,'Other Plate',999,true,0)`,
      [availableItemId, menuId, categoryId, restaurantId, soldOutItemId,
       unrelatedItemId, unrelatedMenuId, unrelatedRestaurantId],
    );
    await pool.query(
      `insert into merchant_delivery_settings
         (restaurant_id, enabled, fee_cents, minimum_order_cents, estimated_minutes,
          max_concurrent_orders, postal_codes, delivery_hours)
       values ($1,true,500,0,35,5,'["32501"]'::jsonb,'{}'::jsonb)`,
      [restaurantId],
    );

    const payload = await buildPublicMenuPayload(restaurantId);
    const profile = toPublicRestaurantProfile({
      row: {
        id: restaurantId,
        name: "Canonical Claimed Kitchen",
        address: "10 Owner Ave",
        city: "Pensacola",
        state: "FL",
        businessType: "restaurant",
        isVerified: true,
        ...payload,
      },
      baseUrl: "https://mealscout.example",
      showAddress: true,
      showContact: true,
    });
    assert.equal(profile.displayName, "Canonical Claimed Kitchen");
    assert.equal(profile.claimedProfile, true);
    assert.equal(profile.ordering?.path, `/menu/${restaurantId}`);
    const renderedItems = profile.menuSections.flatMap((section) => section.items);
    assert.deepEqual(renderedItems.map((item) => [item.name, item.priceCents, item.isAvailable]), [
      ["Owner Plate", 1299, true], ["Sold Out Plate", 1599, false],
    ]);
    assert.equal(profile.fulfillment?.pickup.enabled, true);
    assert.equal(profile.fulfillment?.delivery.configured, true);
    assert.equal(profile.fulfillment?.delivery.enabled, true);

    assert.equal(
      isRestaurantOpenNow({ sun: [{ open: "00:00", close: "01:00" }] }, "America/Chicago", new Date("2026-08-09T05:30:00.000Z")),
      true,
    );

    await pool.query(`update menu_items set price_cents = 1399, is_available = false where id = $1`, [availableItemId]);
    const edited = await buildPublicMenuPayload(restaurantId);
    const editedItems = edited.menuSections.flatMap((section: any) => section.items);
    assert.equal(editedItems.find((item: any) => item.name === "Owner Plate")?.priceCents, 1399);
    assert.equal(editedItems.find((item: any) => item.name === "Owner Plate")?.isAvailable, false);

    const scopedItems = await loadAuthoritativePickupOrderItems(db, {
      restaurantId,
      menuId,
      menuItemIds: [soldOutItemId, unrelatedItemId],
    });
    assert.deepEqual(scopedItems, []);

    assert.doesNotThrow(() => assertPublicResponseSafe(profile));
    assert.throws(() => assertPublicResponseSafe({ deliveryAddress: "private" }));
    const linked = await pool.query(`select count(*)::int as count from restaurants where claimed_from_import_id = $1`, [listingId]);
    assert.equal(linked.rows[0].count, 1);

    console.log("mealscout-profile-ownership-safety: PASS (10/10)");
  } finally {
    await pool.query(`delete from restaurants where id = any($1::varchar[])`, [[restaurantId, unrelatedRestaurantId]]);
    await pool.query(`delete from truck_import_listings where id = $1`, [listingId]);
    await pool.end();
  }
}

run().catch((error: any) => {
  console.error("mealscout-profile-ownership-safety: FAIL", error?.stack || error);
  if (error?.cause) console.error("database cause:", error.cause);
  process.exit(1);
});
