import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { neonConfig } from "@neondatabase/serverless";
import express from "express";
import Stripe from "stripe";
import ws from "ws";

const REQUIRED_OPT_IN = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_REPLAY";
const REQUIRED_HOST = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_EXPECTED_HOST";
const LOCAL_EPHEMERAL_OPT_IN =
  "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_LOCAL_EPHEMERAL";
const REQUIRED_DATABASE = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_EXPECTED_DATABASE";
const REQUIRED_LOCAL_WS_PROXY =
  "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_LOCAL_WS_PROXY";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const LOCAL_PROXY_TARGET_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "host.docker.internal",
]);
let replayPool: Awaited<typeof import("../server/db")>["pool"] | undefined;

function requireDisposableDatabase(): string {
  assert.equal(
    process.env[REQUIRED_OPT_IN],
    "true",
    `${REQUIRED_OPT_IN}=true is required`,
  );
  assert.equal(
    process.env[LOCAL_EPHEMERAL_OPT_IN],
    "true",
    `${LOCAL_EPHEMERAL_OPT_IN}=true is required; remote database replay is disabled`,
  );

  const expectedHost = String(process.env[REQUIRED_HOST] || "")
    .trim()
    .toLowerCase();
  assert.ok(expectedHost, `${REQUIRED_HOST} is required`);

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  assert.ok(databaseUrl, "DATABASE_URL is required");
  const parsedDatabaseUrl = new URL(databaseUrl);
  assert.equal(
    parsedDatabaseUrl.hostname.toLowerCase(),
    expectedHost,
    "DATABASE_URL does not target the explicitly approved disposable host",
  );

  assert.ok(
    LOOPBACK_HOSTS.has(expectedHost),
    `${LOCAL_EPHEMERAL_OPT_IN}=true requires a loopback database host`,
  );

  const expectedDatabase = String(process.env[REQUIRED_DATABASE] || "").trim();
  assert.match(
    expectedDatabase,
    /(?:test|replay|ephemeral|disposable)/i,
    `${REQUIRED_DATABASE} must identify a disposable test database`,
  );
  assert.equal(
    decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, "")),
    expectedDatabase,
    "DATABASE_URL does not target the explicitly approved disposable database",
  );
  return expectedDatabase;
}

function configureLocalWebSocketProxy() {
  const proxyAddress = String(
    process.env[REQUIRED_LOCAL_WS_PROXY] || "",
  ).trim();
  assert.ok(proxyAddress, `${REQUIRED_LOCAL_WS_PROXY} is required`);

  const proxyUrl = new URL(`ws://${proxyAddress}`);
  assert.ok(
    LOOPBACK_HOSTS.has(proxyUrl.hostname.toLowerCase()),
    `${REQUIRED_LOCAL_WS_PROXY} must use a loopback proxy`,
  );
  assert.equal(
    proxyUrl.pathname,
    "/v1",
    `${REQUIRED_LOCAL_WS_PROXY} must target the wsproxy /v1 endpoint`,
  );

  const targetAddress = String(proxyUrl.searchParams.get("address") || "");
  const targetUrl = new URL(`tcp://${targetAddress}`);
  assert.ok(
    LOCAL_PROXY_TARGET_HOSTS.has(targetUrl.hostname.toLowerCase()),
    `${REQUIRED_LOCAL_WS_PROXY} must route only to the local test host`,
  );
  assert.ok(
    targetUrl.port,
    `${REQUIRED_LOCAL_WS_PROXY} target port is required`,
  );

  neonConfig.webSocketConstructor = ws;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineConnect = false;
  neonConfig.wsProxy = () => proxyAddress;
}

async function postWebhookEvent(params: {
  stripe: Stripe;
  webhookSecret: string;
  apiBase: string;
  eventType: string;
  object: Record<string, unknown>;
}) {
  const payload = JSON.stringify({
    id: `evt_pr300_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    object: "event",
    type: params.eventType,
    data: { object: params.object },
  });
  const signature = params.stripe.webhooks.generateTestHeaderString({
    payload,
    secret: params.webhookSecret,
  });

  const response = await fetch(`${params.apiBase}/api/stripe/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });
  const responseBody = await response.text();
  assert.equal(
    response.status,
    200,
    `${params.eventType} failed: ${response.status} ${responseBody}`,
  );
}

async function run() {
  const disposableDatabaseName = requireDisposableDatabase();
  configureLocalWebSocketProxy();

  const [databaseModule, routesModule] = await Promise.all([
    import("../server/db"),
    import("../server/routes/stripeWebhookRoutes"),
  ]);
  const { pool } = databaseModule;
  const { registerStripeWebhookRoutes } = routesModule;
  replayPool = pool;

  const stripeSecret = String(process.env.STRIPE_SECRET_KEY || "").trim();
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  assert.ok(stripeSecret, "STRIPE_SECRET_KEY is required");
  assert.ok(webhookSecret, "STRIPE_WEBHOOK_SECRET is required");
  assert.match(
    stripeSecret,
    /^synthetic_[a-z0-9_-]+$/i,
    "stateful replay requires synthetic signing material, never a Stripe API credential",
  );
  assert.match(
    webhookSecret,
    /^synthetic_[a-z0-9_-]+$/i,
    "stateful replay requires synthetic signing material, never a Stripe endpoint secret",
  );

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const id = (name: string) => `pr300_${suffix}_${name}`;
  const fixtures = {
    staleOwner: id("stale_owner"),
    currentOwner: id("current_owner"),
    hostUser: id("host_user"),
    supplierUser: id("supplier_user"),
    truck: id("truck"),
    currentRestaurant: id("current_restaurant"),
    host: id("host"),
    event: id("event"),
    booking: id("booking"),
    pickupPending: id("pickup_pending"),
    pickupCancelled: id("pickup_cancelled"),
    pickupFailed: id("pickup_failed"),
    dineInCanceled: id("dine_in_canceled"),
    deliveryFailed: id("delivery_failed"),
    pickupStaleIntent: id("pickup_stale_intent"),
    pickupIntentMismatch: id("pickup_intent_mismatch"),
    pickupConfirmed: id("pickup_confirmed"),
    pickupCompleted: id("pickup_completed"),
    pickupCash: id("pickup_cash"),
    pickupUnsupportedType: id("pickup_unsupported_type"),
    pickupConcurrentFirst: id("pickup_concurrent_first"),
    pickupConcurrentSecond: id("pickup_concurrent_second"),
    pickupManualUnavailable: id("pickup_manual_unavailable"),
    pickupMenu: id("pickup_menu"),
    pickupInventoryItem: id("pickup_inventory_item"),
    pickupConcurrentInventoryItem: id("pickup_concurrent_inventory_item"),
    pickupManualUnavailableItem: id("pickup_manual_unavailable_item"),
    pickupAttribution: id("pickup_attribution"),
    pickupCommission: id("pickup_commission"),
    supplier: id("supplier"),
    supplierOrder: id("supplier_order"),
    staleSubscription: id("sub_A"),
    replacementSubscription: id("sub_B"),
    currentSubscription: id("sub_C"),
    staleSubscriptionRow: id("subscription_row_A"),
    replacementSubscriptionRow: id("subscription_row_B"),
    currentSubscriptionRow: id("subscription_row_C"),
    staleDeal: id("stale_deal"),
    currentDeal: id("current_deal"),
    parkingIntent: id("pi_parking"),
    pickupPendingIntent: id("pi_pickup_pending"),
    pickupCancelledIntent: id("pi_pickup_cancelled"),
    pickupFailedIntent: id("pi_pickup_failed"),
    dineInCanceledIntent: id("pi_dine_in_canceled"),
    deliveryFailedIntent: id("pi_delivery_failed"),
    pickupStaleCurrentIntent: id("pi_pickup_stale_current"),
    pickupStaleOldIntent: id("pi_pickup_stale_old"),
    pickupIntentMismatchIntent: id("pi_pickup_intent_mismatch"),
    pickupConfirmedIntent: id("pi_pickup_confirmed"),
    pickupCompletedIntent: id("pi_pickup_completed"),
    pickupCashIntent: id("pi_pickup_cash"),
    pickupUnsupportedTypeIntent: id("pi_pickup_unsupported_type"),
    pickupConcurrentFirstIntent: id("pi_pickup_concurrent_first"),
    pickupConcurrentSecondIntent: id("pi_pickup_concurrent_second"),
    pickupManualUnavailableIntent: id("pi_pickup_manual_unavailable"),
    supplierIntent: id("pi_supplier"),
    staleCustomer: id("cus_stale"),
    currentCustomer: id("cus_current"),
  };

  const fixtureClient = await pool.connect();
  try {
    const pool = fixtureClient;
    await pool.query("BEGIN");
    try {
      await pool.query(
        `
        insert into users
          (id, user_type, stripe_customer_id, stripe_subscription_id)
        values
          ($1, 'food_truck', $2, $3),
          ($4, 'restaurant_owner', $5, $6),
          ($7, 'host', null, null),
          ($8, 'supplier', null, null)
      `,
        [
          fixtures.staleOwner,
          fixtures.staleCustomer,
          fixtures.replacementSubscription,
          fixtures.currentOwner,
          fixtures.currentCustomer,
          fixtures.currentSubscription,
          fixtures.hostUser,
          fixtures.supplierUser,
        ],
      );
      await pool.query(
        `
        insert into restaurants
          (id, owner_id, name, address, business_type, is_food_truck)
        values
          ($1, $2, 'PR300 replay truck', 'Disposable branch only', 'food_truck', true),
          ($3, $4, 'PR300 current subscription restaurant', 'Disposable branch only', 'restaurant', false)
      `,
        [
          fixtures.truck,
          fixtures.staleOwner,
          fixtures.currentRestaurant,
          fixtures.currentOwner,
        ],
      );
      await pool.query(
        `
        insert into hosts
          (id, user_id, business_name, address, city, state, location_type)
        values
          ($1, $2, 'PR300 replay host', 'Disposable branch only', 'Pensacola', 'FL', 'business')
      `,
        [fixtures.host, fixtures.hostUser],
      );
      await pool.query(
        `
        insert into events
          (id, host_id, name, event_type, date, start_time, end_time, max_trucks, requires_payment)
        values
          ($1, $2, 'PR300 replay event', 'parking_pass', now() + interval '1 day', '09:00', '10:00', 1, true)
      `,
        [fixtures.event, fixtures.host],
      );
      await pool.query(
        `
        insert into event_bookings
          (id, event_id, truck_id, host_id, host_price_cents, platform_fee_cents,
           slot_type, total_cents, status, stripe_payment_intent_id,
           stripe_payment_status, paid_at, booking_confirmed_at)
        values
          ($1, $2, $3, $4, 500, 1000, 'daily', 1500, 'confirmed', $5,
           'succeeded', now(), now())
      `,
        [
          fixtures.booking,
          fixtures.event,
          fixtures.truck,
          fixtures.host,
          fixtures.parkingIntent,
        ],
      );
      await pool.query(
        `
        insert into pickup_orders
          (id, restaurant_id, customer_name, status, subtotal_cents,
           platform_fee_cents, total_cents, payment_method,
           stripe_payment_intent_id, stripe_transfer_group_id, payout_status)
        values
          ($1, $2, 'PR300 pending pickup', 'pending', 1200, 100, 1300, 'card', $3, null, 'pending'),
          ($4, $2, 'PR300 cancelled pickup', 'cancelled', 1200, 100, 1300, 'card', $5, $6, 'pending')
      `,
        [
          fixtures.pickupPending,
          fixtures.truck,
          fixtures.pickupPendingIntent,
          fixtures.pickupCancelled,
          fixtures.pickupCancelledIntent,
          id("tg_cancelled"),
        ],
      );
      const pickupTerminationFixtures = [
        {
          id: fixtures.pickupFailed,
          customerName: "PR300 failed pickup",
          orderType: "pickup",
          status: "pending",
          paymentMethod: "card",
          paymentIntentId: fixtures.pickupFailedIntent,
          confirmedAt: null,
          completedAt: null,
        },
        {
          id: fixtures.dineInCanceled,
          customerName: "PR300 canceled dine-in",
          orderType: "dine_in",
          status: "pending",
          paymentMethod: "card",
          paymentIntentId: fixtures.dineInCanceledIntent,
          confirmedAt: null,
          completedAt: null,
        },
        {
          id: fixtures.deliveryFailed,
          customerName: "PR300 failed delivery",
          orderType: "delivery",
          status: "pending",
          paymentMethod: "card",
          paymentIntentId: fixtures.deliveryFailedIntent,
          confirmedAt: null,
          completedAt: null,
        },
        {
          id: fixtures.pickupStaleIntent,
          customerName: "PR300 stale pickup intent",
          orderType: "pickup",
          status: "pending",
          paymentMethod: "card",
          paymentIntentId: fixtures.pickupStaleCurrentIntent,
          confirmedAt: null,
          completedAt: null,
        },
        {
          id: fixtures.pickupIntentMismatch,
          customerName: "PR300 mismatched pickup metadata",
          orderType: "pickup",
          status: "pending",
          paymentMethod: "card",
          paymentIntentId: fixtures.pickupIntentMismatchIntent,
          confirmedAt: null,
          completedAt: null,
        },
        {
          id: fixtures.pickupConfirmed,
          customerName: "PR300 confirmed pickup",
          orderType: "pickup",
          status: "confirmed",
          paymentMethod: "card",
          paymentIntentId: fixtures.pickupConfirmedIntent,
          confirmedAt: new Date("2026-07-28T12:00:00.000Z"),
          completedAt: null,
        },
        {
          id: fixtures.pickupCompleted,
          customerName: "PR300 completed pickup",
          orderType: "pickup",
          status: "completed",
          paymentMethod: "card",
          paymentIntentId: fixtures.pickupCompletedIntent,
          confirmedAt: new Date("2026-07-28T12:00:00.000Z"),
          completedAt: new Date("2026-07-28T12:30:00.000Z"),
        },
        {
          id: fixtures.pickupCash,
          customerName: "PR300 pending cash pickup",
          orderType: "pickup",
          status: "pending",
          paymentMethod: "cash",
          paymentIntentId: fixtures.pickupCashIntent,
          confirmedAt: null,
          completedAt: null,
        },
        {
          id: fixtures.pickupUnsupportedType,
          customerName: "PR300 unsupported order type",
          orderType: "curbside",
          status: "pending",
          paymentMethod: "card",
          paymentIntentId: fixtures.pickupUnsupportedTypeIntent,
          confirmedAt: null,
          completedAt: null,
        },
        {
          id: fixtures.pickupConcurrentFirst,
          customerName: "PR300 first concurrent reservation",
          orderType: "pickup",
          status: "pending",
          paymentMethod: "card",
          paymentIntentId: fixtures.pickupConcurrentFirstIntent,
          confirmedAt: null,
          completedAt: null,
        },
        {
          id: fixtures.pickupConcurrentSecond,
          customerName: "PR300 second concurrent reservation",
          orderType: "pickup",
          status: "pending",
          paymentMethod: "card",
          paymentIntentId: fixtures.pickupConcurrentSecondIntent,
          confirmedAt: null,
          completedAt: null,
        },
        {
          id: fixtures.pickupManualUnavailable,
          customerName: "PR300 manual unavailable reservation",
          orderType: "pickup",
          status: "pending",
          paymentMethod: "card",
          paymentIntentId: fixtures.pickupManualUnavailableIntent,
          confirmedAt: null,
          completedAt: null,
        },
      ] as const;
      for (const fixture of pickupTerminationFixtures) {
        await pool.query(
          `
          insert into pickup_orders
            (id, restaurant_id, customer_name, order_type, status,
             subtotal_cents, platform_fee_cents, total_cents, payment_method,
             stripe_payment_intent_id, payout_status, confirmed_at, completed_at)
          values
            ($1, $2, $3, $4, $5, 1200, 100, 1300, $6, $7, 'pending', $8, $9)
        `,
          [
            fixture.id,
            fixtures.truck,
            fixture.customerName,
            fixture.orderType,
            fixture.status,
            fixture.paymentMethod,
            fixture.paymentIntentId,
            fixture.confirmedAt,
            fixture.completedAt,
          ],
        );
      }
      await pool.query(
        `
        insert into menus (id, restaurant_id, name)
        values ($1, $2, 'PR300 cancellation inventory menu')
      `,
        [fixtures.pickupMenu, fixtures.truck],
      );
      await pool.query(
        `
        insert into menu_items
          (id, menu_id, restaurant_id, name, price_cents, track_inventory,
           inventory_qty, is_available, inventory_auto_unavailable)
        values
          ($1, $2, $3, 'PR300 reserved item', 400, true, 0, false, true),
          ($4, $2, $3, 'PR300 concurrent reserved item', 400, true, 0, false, true),
          ($5, $2, $3, 'PR300 manually unavailable item', 400, true, 0, false, false)
      `,
        [
          fixtures.pickupInventoryItem,
          fixtures.pickupMenu,
          fixtures.truck,
          fixtures.pickupConcurrentInventoryItem,
          fixtures.pickupManualUnavailableItem,
        ],
      );
      await pool.query(
        `
        insert into pickup_order_items
          (id, order_id, menu_item_id, item_name, base_price_cents, quantity,
           line_total_cents)
        values ($1, $2, $3, 'PR300 reserved item', 400, 3, 1200)
      `,
        [
          id("pickup_order_item"),
          fixtures.pickupFailed,
          fixtures.pickupInventoryItem,
        ],
      );
      await pool.query(
        `
        insert into pickup_order_items
          (id, order_id, menu_item_id, item_name, base_price_cents, quantity,
           line_total_cents)
        values
          ($1, $2, $3, 'PR300 concurrent reserved item', 400, 1, 400),
          ($4, $5, $3, 'PR300 concurrent reserved item', 400, 1, 400),
          ($6, $7, $8, 'PR300 manually unavailable item', 400, 1, 400)
      `,
        [
          id("pickup_concurrent_first_item"),
          fixtures.pickupConcurrentFirst,
          fixtures.pickupConcurrentInventoryItem,
          id("pickup_concurrent_second_item"),
          fixtures.pickupConcurrentSecond,
          id("pickup_manual_unavailable_order_item"),
          fixtures.pickupManualUnavailable,
          fixtures.pickupManualUnavailableItem,
        ],
      );
      await pool.query(
        `
        insert into promotion_attributions
          (id, token_hash, source_restaurant_id, target_restaurant_id,
           affiliate_user_id, order_id, clicked_at, expires_at, converted_at)
        values ($1, $2, $3, $4, $5, $6, now(), now() + interval '1 day', now())
      `,
        [
          fixtures.pickupAttribution,
          id("pickup_attribution_token_hash"),
          fixtures.currentRestaurant,
          fixtures.truck,
          fixtures.currentOwner,
          fixtures.pickupFailed,
        ],
      );
      await pool.query(
        `
        insert into promoted_order_commissions
          (id, order_id, attribution_id, source_restaurant_id,
           target_restaurant_id, affiliate_user_id, commission_bps,
           eligible_order_cents, amount_cents, status)
        values ($1, $2, $3, $4, $5, $6, 500, 1200, 60, 'pending')
      `,
        [
          fixtures.pickupCommission,
          fixtures.pickupFailed,
          fixtures.pickupAttribution,
          fixtures.currentRestaurant,
          fixtures.truck,
          fixtures.currentOwner,
        ],
      );
      await pool.query(
        `
        insert into suppliers (id, user_id, business_name)
        values ($1, $2, 'PR300 replay supplier')
      `,
        [fixtures.supplier, fixtures.supplierUser],
      );
      await pool.query(
        `
        insert into supplier_orders
          (id, supplier_id, buyer_user_id, truck_restaurant_id, payment_method,
           payment_status, stripe_payment_intent_id, total_cents)
        values
          ($1, $2, $3, $4, 'stripe', 'unpaid', $5, 2500)
      `,
        [
          fixtures.supplierOrder,
          fixtures.supplier,
          fixtures.staleOwner,
          fixtures.truck,
          fixtures.supplierIntent,
        ],
      );
      await pool.query(
        `
        insert into restaurant_subscriptions
          (id, restaurant_id, tier, status, stripe_customer_id, stripe_subscription_id)
        values
          ($1, $2, 'monthly', 'active', $3, $4),
          ($5, $2, 'monthly', 'active', $3, $6),
          ($7, $8, 'monthly', 'active', $9, $10)
      `,
        [
          fixtures.staleSubscriptionRow,
          fixtures.truck,
          fixtures.staleCustomer,
          fixtures.staleSubscription,
          fixtures.replacementSubscriptionRow,
          fixtures.replacementSubscription,
          fixtures.currentSubscriptionRow,
          fixtures.currentRestaurant,
          fixtures.currentCustomer,
          fixtures.currentSubscription,
        ],
      );
      await pool.query(
        `
        insert into deals
          (id, restaurant_id, title, description, deal_type, discount_value,
           image_url, start_date, is_active)
        values
          ($1, $2, 'PR300 stale guard deal', 'Disposable fixture', 'percentage', 10, 'fixture://image', now(), true),
          ($3, $4, 'PR300 current cancellation deal', 'Disposable fixture', 'percentage', 10, 'fixture://image', now(), true)
      `,
        [
          fixtures.staleDeal,
          fixtures.truck,
          fixtures.currentDeal,
          fixtures.currentRestaurant,
        ],
      );
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  } finally {
    fixtureClient.release();
  }

  const app = express();
  app.use(express.raw({ type: "application/json" }));
  registerStripeWebhookRoutes(app, {
    notifyHostCapacityWarning: async () => undefined,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address() as AddressInfo;
  const apiBase = `http://127.0.0.1:${address.port}`;
  const stripe = new Stripe(stripeSecret);
  const send = (eventType: string, object: Record<string, unknown>) =>
    postWebhookEvent({
      stripe,
      webhookSecret,
      apiBase,
      eventType,
      object,
    });
  const paymentIntent = (
    intentId: string,
    metadata: Record<string, string>,
    amount = 1500,
  ) => ({
    id: intentId,
    object: "payment_intent",
    amount,
    metadata,
  });
  const subscription = (
    subscriptionId: string,
    customerId: string,
    status: string,
  ) => ({
    id: subscriptionId,
    object: "subscription",
    customer: customerId,
    status,
  });

  try {
    const parkingObject = paymentIntent(fixtures.parkingIntent, {
      passId: fixtures.event,
      truckId: fixtures.truck,
      creditAppliedCents: "250",
      totalCents: "1500",
    });
    await send("payment_intent.succeeded", parkingObject);
    await send("payment_intent.succeeded", parkingObject);
    await send("payment_intent.payment_failed", parkingObject);
    await send("payment_intent.succeeded", parkingObject);

    const parking = await pool.query(
      `
        select
          (select count(*)::int
             from host_earnings_ledger
            where booking_id = $1 and entry_type = 'booking_earned') as earnings_rows,
          (select count(*)::int
             from credit_ledger
            where user_id = $2 and source_type = 'booking_credit'
              and source_id = $3 and amount = '-2.50') as credit_debit_rows,
          (select status from event_bookings where id = $1) as booking_status,
          (select stripe_payment_status from event_bookings where id = $1) as payment_status
      `,
      [fixtures.booking, fixtures.staleOwner, fixtures.parkingIntent],
    );
    assert.deepEqual(parking.rows[0], {
      earnings_rows: 1,
      credit_debit_rows: 1,
      booking_status: "confirmed",
      payment_status: "succeeded",
    });

    const pickupPendingObject = paymentIntent(
      fixtures.pickupPendingIntent,
      { pickupOrderId: fixtures.pickupPending },
      1300,
    );
    await send("payment_intent.succeeded", pickupPendingObject);
    await send("payment_intent.succeeded", pickupPendingObject);

    const pickupCancelledObject = paymentIntent(
      fixtures.pickupCancelledIntent,
      { orderId: fixtures.pickupCancelled },
      1300,
    );
    await send("payment_intent.succeeded", pickupCancelledObject);

    const pickups = await pool.query(
      `
        select id, status, payout_status
          from pickup_orders
         where id = any($1::varchar[])
         order by id
      `,
      [[fixtures.pickupCancelled, fixtures.pickupPending]],
    );
    const pickupById = new Map(
      pickups.rows.map((row) => [String(row.id), row]),
    );
    assert.deepEqual(pickupById.get(fixtures.pickupPending), {
      id: fixtures.pickupPending,
      status: "confirmed",
      payout_status: "pending",
    });
    assert.deepEqual(pickupById.get(fixtures.pickupCancelled), {
      id: fixtures.pickupCancelled,
      status: "cancelled",
      payout_status: "pending",
    });

    const readPickupTerminationState = async (pickupOrderId: string) => {
      const result = await pool.query(
        `
          select status, order_type, payment_method, stripe_payment_intent_id,
                 cancellation_reason, cancelled_at, confirmed_at, completed_at,
                 updated_at
            from pickup_orders
           where id = $1
        `,
        [pickupOrderId],
      );
      assert.equal(result.rowCount, 1, `Missing pickup order ${pickupOrderId}`);
      return result.rows[0];
    };

    const readPickupCancellationEffects = async () => {
      const [order, inventory, commission, attribution] = await Promise.all([
        readPickupTerminationState(fixtures.pickupFailed),
        pool.query(
          `
            select inventory_qty, is_available, inventory_auto_unavailable
              from menu_items
             where id = $1
          `,
          [fixtures.pickupInventoryItem],
        ),
        pool.query(
          `
            select status, reversed_at, reversal_reason, updated_at
              from promoted_order_commissions
             where id = $1
          `,
          [fixtures.pickupCommission],
        ),
        pool.query(
          `
            select id, order_id, converted_at
              from promotion_attributions
             where id = $1
          `,
          [fixtures.pickupAttribution],
        ),
      ]);
      assert.equal(inventory.rowCount, 1);
      assert.equal(commission.rowCount, 1);
      assert.equal(attribution.rowCount, 1);
      return {
        order,
        inventory: inventory.rows[0],
        commission: commission.rows[0],
        attribution: attribution.rows[0],
      };
    };

    const pickupFailedObject = paymentIntent(
      fixtures.pickupFailedIntent,
      { pickupOrderId: fixtures.pickupFailed },
      1300,
    );
    const beforePickupFailure = await readPickupCancellationEffects();
    await send("payment_intent.payment_failed", pickupFailedObject);
    await send("payment_intent.payment_failed", pickupFailedObject);
    const afterPickupFailure = await readPickupCancellationEffects();
    assert.deepEqual(
      afterPickupFailure,
      beforePickupFailure,
      "a retryable payment failure must not mutate the order, reserved inventory, commission, or attribution",
    );
    assert.equal(afterPickupFailure.order.status, "pending");
    assert.deepEqual(afterPickupFailure.inventory, {
      inventory_qty: 0,
      is_available: false,
      inventory_auto_unavailable: true,
    });
    assert.equal(afterPickupFailure.commission.status, "pending");

    await send("payment_intent.canceled", pickupFailedObject);
    const pickupCanceledOnce = await readPickupCancellationEffects();
    assert.equal(pickupCanceledOnce.order.status, "cancelled");
    assert.equal(
      pickupCanceledOnce.order.cancellation_reason,
      "Card payment cancelled",
    );
    assert.ok(pickupCanceledOnce.order.cancelled_at instanceof Date);
    assert.equal(
      pickupCanceledOnce.order.cancelled_at.getTime(),
      pickupCanceledOnce.order.updated_at.getTime(),
    );
    assert.deepEqual(pickupCanceledOnce.inventory, {
      inventory_qty: 3,
      is_available: true,
      inventory_auto_unavailable: false,
    });
    assert.equal(pickupCanceledOnce.commission.status, "reversed");
    assert.ok(pickupCanceledOnce.commission.reversed_at instanceof Date);
    assert.equal(
      pickupCanceledOnce.commission.reversal_reason,
      "payment_intent_canceled",
    );
    assert.deepEqual(
      pickupCanceledOnce.attribution,
      beforePickupFailure.attribution,
      "terminal cancellation must preserve the converted attribution",
    );

    await send("payment_intent.canceled", pickupFailedObject);
    const pickupCanceledReplay = await readPickupCancellationEffects();
    assert.deepEqual(
      pickupCanceledReplay,
      pickupCanceledOnce,
      "replaying a canceled PaymentIntent must not restore inventory or reverse commission twice",
    );

    const readInventoryAvailability = async (menuItemId: string) => {
      const result = await pool.query(
        `
          select inventory_qty, is_available, inventory_auto_unavailable
            from menu_items
           where id = $1
        `,
        [menuItemId],
      );
      assert.equal(result.rowCount, 1);
      return result.rows[0];
    };

    const concurrentFirstObject = paymentIntent(
      fixtures.pickupConcurrentFirstIntent,
      { pickupOrderId: fixtures.pickupConcurrentFirst },
      400,
    );
    const concurrentSecondObject = paymentIntent(
      fixtures.pickupConcurrentSecondIntent,
      { pickupOrderId: fixtures.pickupConcurrentSecond },
      400,
    );
    await send("payment_intent.canceled", concurrentFirstObject);
    assert.deepEqual(
      await readInventoryAvailability(fixtures.pickupConcurrentInventoryItem),
      {
        inventory_qty: 1,
        is_available: true,
        inventory_auto_unavailable: false,
      },
      "cancelling either reservation must reopen inventory that checkout automatically hid",
    );
    await send("payment_intent.canceled", concurrentSecondObject);
    assert.deepEqual(
      await readInventoryAvailability(fixtures.pickupConcurrentInventoryItem),
      {
        inventory_qty: 2,
        is_available: true,
        inventory_auto_unavailable: false,
      },
      "later cancellation must restore remaining quantity without hiding the item again",
    );

    const manualUnavailableObject = paymentIntent(
      fixtures.pickupManualUnavailableIntent,
      { pickupOrderId: fixtures.pickupManualUnavailable },
      400,
    );
    await send("payment_intent.canceled", manualUnavailableObject);
    assert.deepEqual(
      await readInventoryAvailability(fixtures.pickupManualUnavailableItem),
      {
        inventory_qty: 1,
        is_available: false,
        inventory_auto_unavailable: false,
      },
      "cancellation must preserve a merchant's manual unavailable decision",
    );

    const dineInCanceledObject = paymentIntent(
      fixtures.dineInCanceledIntent,
      { orderId: fixtures.dineInCanceled },
      1300,
    );
    await send("payment_intent.canceled", dineInCanceledObject);
    const dineInCanceledOnce = await readPickupTerminationState(
      fixtures.dineInCanceled,
    );
    assert.equal(dineInCanceledOnce.status, "cancelled");
    assert.equal(dineInCanceledOnce.order_type, "dine_in");
    assert.equal(
      dineInCanceledOnce.cancellation_reason,
      "Card payment cancelled",
    );
    assert.ok(dineInCanceledOnce.cancelled_at instanceof Date);
    assert.equal(
      dineInCanceledOnce.cancelled_at.getTime(),
      dineInCanceledOnce.updated_at.getTime(),
    );
    await send("payment_intent.canceled", dineInCanceledObject);
    const dineInCanceledReplay = await readPickupTerminationState(
      fixtures.dineInCanceled,
    );
    assert.deepEqual(
      dineInCanceledReplay,
      dineInCanceledOnce,
      "replaying a canceled PaymentIntent must not rewrite cancellation state",
    );

    const deliveryFailedObject = paymentIntent(
      fixtures.deliveryFailedIntent,
      { pickupOrderId: fixtures.deliveryFailed },
      1300,
    );
    await send("payment_intent.payment_failed", deliveryFailedObject);
    const deliveryAfterFailure = await readPickupTerminationState(
      fixtures.deliveryFailed,
    );
    assert.equal(deliveryAfterFailure.status, "pending");
    assert.equal(deliveryAfterFailure.order_type, "delivery");
    assert.equal(deliveryAfterFailure.cancellation_reason, null);
    assert.equal(deliveryAfterFailure.cancelled_at, null);
    await send("payment_intent.canceled", deliveryFailedObject);
    const deliveryAfterCancellation = await readPickupTerminationState(
      fixtures.deliveryFailed,
    );
    assert.equal(deliveryAfterCancellation.status, "cancelled");
    assert.equal(
      deliveryAfterCancellation.cancellation_reason,
      "Card payment cancelled",
    );

    // Stripe events can be delayed or delivered out of order. None of these
    // events may regress a newer intent, mismatched metadata, a confirmed or
    // terminal order, a cash order, or an unsupported order type.
    const stalePickupObject = paymentIntent(
      fixtures.pickupStaleOldIntent,
      { pickupOrderId: fixtures.pickupStaleIntent },
      1300,
    );
    await send("payment_intent.payment_failed", stalePickupObject);
    await send("payment_intent.canceled", stalePickupObject);

    const mismatchedPickupObject = paymentIntent(
      fixtures.pickupIntentMismatchIntent,
      { orderId: fixtures.pickupStaleIntent },
      1300,
    );
    await send("payment_intent.payment_failed", mismatchedPickupObject);
    await send("payment_intent.canceled", mismatchedPickupObject);

    await send("payment_intent.payment_failed", pickupPendingObject);
    await send("payment_intent.canceled", pickupPendingObject);

    const confirmedPickupObject = paymentIntent(
      fixtures.pickupConfirmedIntent,
      { pickupOrderId: fixtures.pickupConfirmed },
      1300,
    );
    await send("payment_intent.payment_failed", confirmedPickupObject);
    await send("payment_intent.canceled", confirmedPickupObject);

    const completedPickupObject = paymentIntent(
      fixtures.pickupCompletedIntent,
      { pickupOrderId: fixtures.pickupCompleted },
      1300,
    );
    await send("payment_intent.payment_failed", completedPickupObject);
    await send("payment_intent.canceled", completedPickupObject);

    await send("payment_intent.payment_failed", pickupCancelledObject);
    await send("payment_intent.canceled", pickupCancelledObject);

    const cashPickupObject = paymentIntent(
      fixtures.pickupCashIntent,
      { pickupOrderId: fixtures.pickupCash },
      1300,
    );
    await send("payment_intent.payment_failed", cashPickupObject);
    await send("payment_intent.canceled", cashPickupObject);

    const unsupportedPickupObject = paymentIntent(
      fixtures.pickupUnsupportedTypeIntent,
      { pickupOrderId: fixtures.pickupUnsupportedType },
      1300,
    );
    await send("payment_intent.payment_failed", unsupportedPickupObject);
    await send("payment_intent.canceled", unsupportedPickupObject);

    const pickupTerminationGuardRows = await pool.query(
      `
        select id, status, cancellation_reason, cancelled_at, confirmed_at,
               completed_at, stripe_payment_intent_id
          from pickup_orders
         where id = any($1::varchar[])
      `,
      [
        [
          fixtures.pickupStaleIntent,
          fixtures.pickupIntentMismatch,
          fixtures.pickupPending,
          fixtures.pickupConfirmed,
          fixtures.pickupCompleted,
          fixtures.pickupCancelled,
          fixtures.pickupCash,
          fixtures.pickupUnsupportedType,
        ],
      ],
    );
    const pickupTerminationGuardById = new Map(
      pickupTerminationGuardRows.rows.map((row) => [String(row.id), row]),
    );

    assert.deepEqual(
      pickupTerminationGuardById.get(fixtures.pickupStaleIntent),
      {
        id: fixtures.pickupStaleIntent,
        status: "pending",
        cancellation_reason: null,
        cancelled_at: null,
        confirmed_at: null,
        completed_at: null,
        stripe_payment_intent_id: fixtures.pickupStaleCurrentIntent,
      },
    );
    assert.deepEqual(
      pickupTerminationGuardById.get(fixtures.pickupIntentMismatch),
      {
        id: fixtures.pickupIntentMismatch,
        status: "pending",
        cancellation_reason: null,
        cancelled_at: null,
        confirmed_at: null,
        completed_at: null,
        stripe_payment_intent_id: fixtures.pickupIntentMismatchIntent,
      },
    );
    assert.equal(
      pickupTerminationGuardById.get(fixtures.pickupPending)?.status,
      "confirmed",
    );
    assert.equal(
      pickupTerminationGuardById.get(fixtures.pickupPending)
        ?.cancellation_reason,
      null,
    );
    assert.deepEqual(pickupTerminationGuardById.get(fixtures.pickupConfirmed), {
      id: fixtures.pickupConfirmed,
      status: "confirmed",
      cancellation_reason: null,
      cancelled_at: null,
      confirmed_at: new Date("2026-07-28T12:00:00.000Z"),
      completed_at: null,
      stripe_payment_intent_id: fixtures.pickupConfirmedIntent,
    });
    assert.deepEqual(pickupTerminationGuardById.get(fixtures.pickupCompleted), {
      id: fixtures.pickupCompleted,
      status: "completed",
      cancellation_reason: null,
      cancelled_at: null,
      confirmed_at: new Date("2026-07-28T12:00:00.000Z"),
      completed_at: new Date("2026-07-28T12:30:00.000Z"),
      stripe_payment_intent_id: fixtures.pickupCompletedIntent,
    });
    assert.equal(
      pickupTerminationGuardById.get(fixtures.pickupCancelled)?.status,
      "cancelled",
    );
    assert.equal(
      pickupTerminationGuardById.get(fixtures.pickupCancelled)
        ?.cancellation_reason,
      null,
    );
    for (const untouchedPendingId of [
      fixtures.pickupCash,
      fixtures.pickupUnsupportedType,
    ]) {
      const untouched = pickupTerminationGuardById.get(untouchedPendingId);
      assert.equal(untouched?.status, "pending");
      assert.equal(untouched?.cancellation_reason, null);
      assert.equal(untouched?.cancelled_at, null);
    }

    const supplierObject = paymentIntent(
      fixtures.supplierIntent,
      { supplierOrderId: fixtures.supplierOrder },
      2500,
    );
    await send("payment_intent.succeeded", supplierObject);
    await send("payment_intent.payment_failed", supplierObject);
    await send("payment_intent.succeeded", supplierObject);

    const supplierOrder = await pool.query(
      `
        select payment_status, stripe_payment_intent_id
          from supplier_orders
         where id = $1
      `,
      [fixtures.supplierOrder],
    );
    assert.deepEqual(supplierOrder.rows[0], {
      payment_status: "paid",
      stripe_payment_intent_id: fixtures.supplierIntent,
    });

    const staleCancellation = subscription(
      fixtures.staleSubscription,
      fixtures.staleCustomer,
      "canceled",
    );
    await send("customer.subscription.updated", staleCancellation);
    await send("customer.subscription.deleted", staleCancellation);

    const staleGuard = await pool.query(
      `
        select
          (select stripe_subscription_id from users where id = $1) as current_subscription,
          (select status from restaurant_subscriptions where id = $2) as stale_status,
          (select status from restaurant_subscriptions where id = $3) as replacement_status,
          (select is_active from deals where id = $4) as deal_active
      `,
      [
        fixtures.staleOwner,
        fixtures.staleSubscriptionRow,
        fixtures.replacementSubscriptionRow,
        fixtures.staleDeal,
      ],
    );
    assert.deepEqual(staleGuard.rows[0], {
      current_subscription: fixtures.replacementSubscription,
      stale_status: "canceled",
      replacement_status: "active",
      deal_active: true,
    });

    const currentCancellation = subscription(
      fixtures.currentSubscription,
      fixtures.currentCustomer,
      "canceled",
    );
    await send("customer.subscription.updated", currentCancellation);
    await send("customer.subscription.deleted", currentCancellation);

    const currentGuard = await pool.query(
      `
        select
          (select stripe_subscription_id from users where id = $1) as current_subscription,
          (select status from restaurant_subscriptions where id = $2) as subscription_status,
          (select is_active from deals where id = $3) as deal_active
      `,
      [
        fixtures.currentOwner,
        fixtures.currentSubscriptionRow,
        fixtures.currentDeal,
      ],
    );
    assert.deepEqual(currentGuard.rows[0], {
      current_subscription: null,
      subscription_status: "canceled",
      deal_active: false,
    });

    console.log(
      JSON.stringify({
        status: "PASS",
        databaseTarget: disposableDatabaseName,
        checks: {
          parkingPassLedgerReplay: true,
          committedCreditDebitReplay: true,
          syntheticSigningOnly: true,
          pickupOrderReplay: true,
          cancelledPickupNonRegression: true,
          pickupPaymentFailureRemainsRetryable: true,
          pickupPaymentCanceledCancellation: true,
          pickupCancellationInventoryRestoredOnce: true,
          pickupCancellationAutomaticAvailabilityRestored: true,
          pickupCancellationMultiOrderAvailabilityRestored: true,
          pickupCancellationManualAvailabilityPreserved: true,
          pickupCancellationCommissionReversedOnce: true,
          pickupCancellationAttributionPreserved: true,
          pickupPaymentCancellationReplayIdempotency: true,
          pickupPaymentCancellationStaleIntentGuard: true,
          pickupPaymentCancellationMetadataMismatchGuard: true,
          pickupPaymentCancellationStateAndMethodGuards: true,
          supplierOutOfOrderNonRegression: true,
          staleSubscriptionCancellationGuard: true,
          currentSubscriptionCancellation: true,
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
    if (replayPool) {
      await replayPool.end().catch(() => undefined);
    }
  });
