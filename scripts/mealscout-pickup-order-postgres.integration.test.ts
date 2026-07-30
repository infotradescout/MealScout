import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { neonConfig } from "@neondatabase/serverless";
import express from "express";
import ws from "ws";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const LOCAL_PROXY_TARGET_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "host.docker.internal",
]);
let integrationPool: Awaited<typeof import("../server/db")>["pool"] | undefined;

function requireDisposableTarget() {
  assert.equal(
    process.env.MEALSCOUT_PICKUP_POSTGRES_INTEGRATION,
    "true",
    "MEALSCOUT_PICKUP_POSTGRES_INTEGRATION=true is required",
  );
  assert.equal(
    String(process.env.STRIPE_SECRET_KEY || "").trim(),
    "",
    "This local cash-order proof must not receive a Stripe credential",
  );

  const expectedHost = String(
    process.env.MEALSCOUT_PICKUP_POSTGRES_EXPECTED_HOST || "",
  )
    .trim()
    .toLowerCase();
  assert.ok(LOOPBACK_HOSTS.has(expectedHost), "Expected host must be loopback");

  const expectedDatabase = String(
    process.env.MEALSCOUT_PICKUP_POSTGRES_EXPECTED_DATABASE || "",
  ).trim();
  assert.match(
    expectedDatabase,
    /(?:test|replay|ephemeral|disposable)/i,
    "Expected database must be explicitly disposable",
  );

  const databaseUrl = new URL(String(process.env.DATABASE_URL || ""));
  assert.equal(databaseUrl.hostname.toLowerCase(), expectedHost);
  assert.equal(
    decodeURIComponent(databaseUrl.pathname.replace(/^\//, "")),
    expectedDatabase,
  );

  const proxyAddress = String(
    process.env.MEALSCOUT_PICKUP_POSTGRES_LOCAL_WS_PROXY || "",
  ).trim();
  const proxyUrl = new URL(`ws://${proxyAddress}`);
  assert.ok(LOOPBACK_HOSTS.has(proxyUrl.hostname.toLowerCase()));
  assert.equal(proxyUrl.pathname, "/v1");
  const targetUrl = new URL(
    `tcp://${String(proxyUrl.searchParams.get("address") || "")}`,
  );
  assert.ok(
    LOCAL_PROXY_TARGET_HOSTS.has(targetUrl.hostname.toLowerCase()),
    "WebSocket proxy target must stay local",
  );
  assert.ok(targetUrl.port);

  neonConfig.webSocketConstructor = ws;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineConnect = false;
  neonConfig.wsProxy = () => proxyAddress;
  return expectedDatabase;
}

async function run() {
  const databaseName = requireDisposableTarget();
  const [{ pool }, { registerPickupOrderRoutes }] = await Promise.all([
    import("../server/db"),
    import("../server/routes/pickupOrderRoutes"),
  ]);
  integrationPool = pool;

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const id = (label: string) => `pickup_pg_${suffix}_${label}`;
  const fixtures = {
    owner: id("owner"),
    restaurant: id("restaurant"),
    subscription: id("subscription"),
    menu: id("menu"),
    duplicateItem: id("duplicate_item"),
    lastUnitItem: id("last_unit_item"),
    deliveryItem: id("delivery_item"),
  };

  const fixtureClient = await pool.connect();
  try {
    await fixtureClient.query("BEGIN");
    await fixtureClient.query(
      "delete from rate_limit_counters where scope = 'pickup_orders_create'",
    );
    await fixtureClient.query(
      `
        insert into users (id, user_type)
        values ($1, 'restaurant_owner')
      `,
      [fixtures.owner],
    );
    await fixtureClient.query(
      `
        insert into restaurants
          (id, owner_id, name, address, city, state, business_type, is_active)
        values
          ($1, $2, 'Wave 2 disposable restaurant', 'Local fixture only',
           'Dallas', 'TX', 'restaurant', true)
      `,
      [fixtures.restaurant, fixtures.owner],
    );
    await fixtureClient.query(
      `
        insert into restaurant_subscriptions
          (id, restaurant_id, tier, status, is_lifetime_free)
        values ($1, $2, 'monthly', 'active', false)
      `,
      [fixtures.subscription, fixtures.restaurant],
    );
    await fixtureClient.query(
      `
        insert into menus
          (id, restaurant_id, name, is_active, accepts_cash, hide_platform_fee)
        values ($1, $2, 'Wave 2 disposable menu', true, true, false)
      `,
      [fixtures.menu, fixtures.restaurant],
    );
    await fixtureClient.query(
      `
        insert into menu_items
          (id, menu_id, restaurant_id, name, price_cents, track_inventory,
           inventory_qty, is_available, inventory_auto_unavailable)
        values
          ($1, $2, $3, 'Duplicate item', 500, true, 10, true, false),
          ($4, $2, $3, 'Last unit item', 500, true, 1, true, false),
          ($5, $2, $3, 'Delivery item', 3000, true, 10, true, false)
      `,
      [
        fixtures.duplicateItem,
        fixtures.menu,
        fixtures.restaurant,
        fixtures.lastUnitItem,
        fixtures.deliveryItem,
      ],
    );
    await fixtureClient.query(
      `
        insert into merchant_delivery_settings
          (restaurant_id, enabled, fee_cents, minimum_order_cents,
           estimated_minutes, max_concurrent_orders, postal_codes,
           delivery_hours)
        values ($1, true, 499, 2500, 35, 1, '["75201"]'::jsonb, '{}'::jsonb)
      `,
      [fixtures.restaurant],
    );
    await fixtureClient.query("COMMIT");
  } catch (error) {
    await fixtureClient.query("ROLLBACK");
    throw error;
  } finally {
    fixtureClient.release();
  }

  const app = express();
  app.use(express.json());
  registerPickupOrderRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${address.port}/api/pickup-orders`;

  const postOrder = async (key: string, payload: Record<string, unknown>) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(payload),
    });
    return {
      status: response.status,
      body: await response.json().catch(() => ({})),
    };
  };
  const basePayload = {
    restaurantId: fixtures.restaurant,
    menuId: fixtures.menu,
    customerName: "Wave 2 duplicate diner",
    orderType: "pickup",
    paymentMethod: "cash",
    items: [{ menuItemId: fixtures.duplicateItem, quantity: 1 }],
  };

  try {
    const duplicateKey = id("duplicate_key");
    const concurrentDuplicates = await Promise.all(
      Array.from({ length: 6 }, () => postOrder(duplicateKey, basePayload)),
    );
    assert.ok(
      concurrentDuplicates.every(({ status }) => [201, 409].includes(status)),
    );
    const acceptedDuplicateIds = new Set(
      concurrentDuplicates
        .filter(({ status }) => status === 201)
        .map(({ body }) => String(body?.order?.id || "")),
    );
    assert.deepEqual(acceptedDuplicateIds.size, 1);
    const duplicateOrderId = [...acceptedDuplicateIds][0];
    assert.ok(duplicateOrderId);

    const completedReplay = await postOrder(duplicateKey, basePayload);
    assert.equal(completedReplay.status, 201);
    assert.equal(completedReplay.body?.order?.id, duplicateOrderId);
    const mismatchedReplay = await postOrder(duplicateKey, {
      ...basePayload,
      customerName: "Different payload",
    });
    assert.equal(mismatchedReplay.status, 409);
    assert.equal(mismatchedReplay.body?.code, "idempotency_key_reuse_mismatch");

    const duplicateState = await pool.query(
      `
        select
          (select count(*)::int from pickup_orders where id = $1) as orders,
          (select count(*)::int from pickup_order_items where order_id = $1) as line_items,
          (select inventory_qty from menu_items where id = $2) as inventory_qty,
          (select state from idempotency_keys where idem_key = $3) as ledger_state,
          (select status_code from idempotency_keys where idem_key = $3) as ledger_status
      `,
      [duplicateOrderId, fixtures.duplicateItem, duplicateKey],
    );
    assert.deepEqual(duplicateState.rows[0], {
      orders: 1,
      line_items: 1,
      inventory_qty: 9,
      ledger_state: "completed",
      ledger_status: 201,
    });

    const lastUnitPayload = (customerName: string) => ({
      ...basePayload,
      customerName,
      items: [{ menuItemId: fixtures.lastUnitItem, quantity: 1 }],
    });
    const lastUnitResponses = await Promise.all([
      postOrder(id("last_unit_key_a"), lastUnitPayload("Last unit A")),
      postOrder(id("last_unit_key_b"), lastUnitPayload("Last unit B")),
    ]);
    assert.equal(
      lastUnitResponses.filter(({ status }) => status === 201).length,
      1,
    );
    assert.ok(
      lastUnitResponses
        .filter(({ status }) => status !== 201)
        .every(({ status }) => [400, 409].includes(status)),
    );
    const lastUnitState = await pool.query(
      `
        select inventory_qty, is_available, inventory_auto_unavailable
          from menu_items
         where id = $1
      `,
      [fixtures.lastUnitItem],
    );
    assert.deepEqual(lastUnitState.rows[0], {
      inventory_qty: 0,
      is_available: false,
      inventory_auto_unavailable: true,
    });

    const deliveryPayload = (customerName: string) => ({
      ...basePayload,
      customerName,
      orderType: "delivery",
      deliveryAddress: "100 Local Test Way",
      deliveryCity: "Dallas",
      deliveryState: "TX",
      deliveryPostalCode: "75201",
      items: [{ menuItemId: fixtures.deliveryItem, quantity: 1 }],
    });
    const deliveryResponses = await Promise.all([
      postOrder(id("delivery_key_a"), deliveryPayload("Delivery A")),
      postOrder(id("delivery_key_b"), deliveryPayload("Delivery B")),
    ]);
    assert.equal(
      deliveryResponses.filter(({ status }) => status === 201).length,
      1,
    );
    assert.equal(
      deliveryResponses.filter(({ status }) => status === 409).length,
      1,
    );
    const acceptedDelivery = deliveryResponses.find(
      ({ status }) => status === 201,
    )?.body?.order;
    assert.equal(acceptedDelivery?.deliveryFeeCents, 499);
    assert.equal(acceptedDelivery?.deliveryEstimateMinutes, 35);

    const scheduledResponse = await postOrder(id("scheduled_delivery_key"), {
      ...deliveryPayload("Scheduled delivery"),
      scheduledFor: "2026-07-30T18:00:00.000Z",
    });
    assert.equal(scheduledResponse.status, 400);
    assert.equal(
      scheduledResponse.body?.code,
      "scheduled_delivery_unsupported",
    );

    console.log(
      JSON.stringify({
        status: "PASS",
        databaseTarget: databaseName,
        checks: {
          sameKeyConcurrentDuplicateSingleOrder: true,
          completedResponseReplay: true,
          payloadMismatchRejected: true,
          durableCompletedLedger: true,
          lastUnitDifferentKeyConcurrency: true,
          databaseInventoryDecrement: true,
          inventoryAvailabilityProvenance: true,
          deliveryCapacitySerialized: true,
          deliveryFeeAndEstimatePersisted: true,
          scheduledDeliveryRejected: true,
          providerCredentialAbsent: true,
        },
      }),
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

run()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (integrationPool) {
      await integrationPool.end().catch(() => undefined);
    }
  });
