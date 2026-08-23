import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import Stripe from "stripe";
import { pool } from "../server/db";
import { registerStripeWebhookRoutes } from "../server/routes/stripeWebhookRoutes";

const REQUIRED_OPT_IN = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_REPLAY";
const REQUIRED_BRANCH = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_BRANCH_ID";
const REQUIRED_HOST = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_EXPECTED_HOST";

function requireDisposableDatabase() {
  assert.equal(
    process.env[REQUIRED_OPT_IN],
    "true",
    `${REQUIRED_OPT_IN}=true is required`,
  );

  const branchId = String(process.env[REQUIRED_BRANCH] || "").trim();
  assert.match(
    branchId,
    /^br-/,
    `${REQUIRED_BRANCH} must identify the disposable Neon branch`,
  );

  const expectedHost = String(process.env[REQUIRED_HOST] || "")
    .trim()
    .toLowerCase();
  assert.ok(expectedHost, `${REQUIRED_HOST} is required`);

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  assert.ok(databaseUrl, "DATABASE_URL is required");
  assert.equal(
    new URL(databaseUrl).hostname.toLowerCase(),
    expectedHost,
    "DATABASE_URL does not target the explicitly approved disposable host",
  );
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
    created: Math.floor(Date.now() / 1000),
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
  requireDisposableDatabase();

  const stripeSecret = String(process.env.STRIPE_SECRET_KEY || "").trim();
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  assert.ok(stripeSecret, "STRIPE_SECRET_KEY is required");
  assert.ok(webhookSecret, "STRIPE_WEBHOOK_SECRET is required");

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const id = (name: string) => `pr300_${suffix}_${name}`;
  const fixtures = {
    staleOwner: id("stale_owner"),
    currentOwner: id("current_owner"),
    hostUser: id("host_user"),
    supplierUser: id("supplier_user"),
    truck: id("truck"),
    currentRestaurant: id("current_restaurant"),
    pickupMenu: id("pickup_menu"),
    pickupInventoryItem: id("pickup_inventory_item"),
    pickupTransferGroup: id("tg_pickup_pending"),
    host: id("host"),
    event: id("event"),
    booking: id("booking"),
    pickupPending: id("pickup_pending"),
    pickupCancelled: id("pickup_cancelled"),
    pickupFailurePending: id("pickup_failure_pending"),
    pickupFailureMismatch: id("pickup_failure_mismatch"),
    pickupCompleted: id("pickup_completed"),
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
    pickupFailureIntent: id("pi_pickup_failure"),
    pickupMismatchIntent: id("pi_pickup_mismatch_stored"),
    pickupCompletedIntent: id("pi_pickup_completed"),
    supplierIntent: id("pi_supplier"),
    staleCustomer: id("cus_stale"),
    currentCustomer: id("cus_current"),
  };
  const pickupInventoryItemId = fixtures.pickupInventoryItem;

  await pool.query("BEGIN");
  try {
    await pool.query(
      `
        insert into users
          (id, user_type, email, email_verified, is_disabled,
           stripe_customer_id, stripe_subscription_id, public_profile_settings)
        values
          ($1, 'food_truck', $9, true, false, $2, $3, '{"showAddress":true}'::jsonb),
          ($4, 'restaurant_owner', $10, true, false, $5, $6, '{"showAddress":true}'::jsonb),
          ($7, 'host', $11, true, false, null, null, '{}'::jsonb),
          ($8, 'supplier', $12, true, false, null, null, '{}'::jsonb)
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
        `truck-${suffix}@example.test`,
        `restaurant-${suffix}@example.test`,
        `host-${suffix}@example.test`,
        `supplier-${suffix}@example.test`,
      ],
    );
    await pool.query(
      `
        insert into restaurants
          (id, owner_id, name, address, city, state, business_type,
           is_food_truck, is_verified, is_active, operating_hours,
           stripe_connect_account_id, stripe_connect_status,
           stripe_onboarding_completed, stripe_charges_enabled,
           stripe_payouts_enabled, ordering_approved_at,
           ordering_approved_by_user_id, ordering_approval_evidence_url,
           pickup_acknowledgement_minutes)
        values
          ($1, $2, 'PR300 replay truck', 'Disposable branch only', 'Pensacola', 'FL', 'food_truck', true, false, true, '{}'::jsonb, null, 'pending', false, false, false, null, null, null, null),
          ($3, $4, 'PR300 current subscription restaurant', '101 Test St', 'Pensacola', 'FL', 'restaurant', false, true, true,
           '{"sun":[{"open":"00:00","close":"23:59"}],"mon":[{"open":"00:00","close":"23:59"}],"tue":[{"open":"00:00","close":"23:59"}],"wed":[{"open":"00:00","close":"23:59"}],"thu":[{"open":"00:00","close":"23:59"}],"fri":[{"open":"00:00","close":"23:59"}],"sat":[{"open":"00:00","close":"23:59"}]}'::jsonb,
           'acct_disposable_fixture', 'active', true, true, true, now(), $4,
           'https://example.test/evidence/disposable-ordering-approval', 10)
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
        insert into menus
          (id, restaurant_id, name, is_active, prices_include_tax)
        values ($1, $2, 'Disposable pickup menu', true, true)
      `,
      [fixtures.pickupMenu, fixtures.currentRestaurant],
    );
    await pool.query(
      `
        insert into menu_items
          (id, menu_id, restaurant_id, name, price_cents, track_inventory,
           inventory_qty, is_available)
        values ($1, $2, $3, 'Disposable pickup item', 1200, true, 47, true)
      `,
      [
        fixtures.pickupInventoryItem,
        fixtures.pickupMenu,
        fixtures.currentRestaurant,
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
           stripe_payment_intent_id, stripe_transfer_group_id, payout_status,
           merchant_name_snapshot, merchant_owner_id_snapshot,
           stripe_connect_account_id_snapshot,
           merchant_acknowledgement_minutes_snapshot, pickup_address_snapshot,
           pickup_directions_url_snapshot, ordering_contract_version,
           prices_include_tax)
        values
          ($1, $2, 'PR300 pending pickup', 'pending', 1200, 100, 1300, 'card', $3, $4, 'pending', $13, $18, $19, $20, $14, $15, $16, true),
          ($5, $2, 'PR300 cancelled pickup', 'cancelled', 1200, 100, 1300, 'card', $6, $7, 'pending', $13, $18, $19, $20, $14, $15, $16, true),
          ($8, $2, 'PR300 failed-pending pickup', 'pending', 1200, 100, 1300, 'card', $9, null, 'pending', $13, $18, $19, $20, $14, $15, $16, true),
          ($10, $2, 'PR300 mismatch pickup', 'pending', 1200, 100, 1300, 'card', $11, null, 'pending', $13, $18, $19, $20, $14, $15, $16, true),
          ($12, $2, 'PR300 completed pickup', 'completed', 1200, 100, 1300, 'card', $17, null, 'pending', $13, $18, $19, $20, $14, $15, $16, true)
      `,
      [
        fixtures.pickupPending,
        fixtures.currentRestaurant,
        fixtures.pickupPendingIntent,
        fixtures.pickupTransferGroup,
        fixtures.pickupCancelled,
        fixtures.pickupCancelledIntent,
        id("tg_cancelled"),
        fixtures.pickupFailurePending,
        fixtures.pickupFailureIntent,
        fixtures.pickupFailureMismatch,
        fixtures.pickupMismatchIntent,
        fixtures.pickupCompleted,
        "PR300 current subscription restaurant",
        "101 Test St, Pensacola, FL",
        "https://maps.google.com/?q=101%20Test%20St%2C%20Pensacola%2C%20FL",
        "2026-08-23-v1",
        fixtures.pickupCompletedIntent,
        fixtures.currentOwner,
        "acct_disposable_fixture",
        10,
      ],
    );
    await pool.query(
      `insert into pickup_order_items
         (order_id, menu_item_id, item_name, base_price_cents, quantity,
          inventory_reserved_quantity, line_total_cents)
       values
         ($1, $6, 'Pending item', 1200, 1, 1, 1200),
         ($2, $6, 'Cancelled item', 1200, 1, 0, 1200),
         ($3, $6, 'Failed item', 1200, 1, 1, 1200),
         ($4, $6, 'Mismatch item', 1200, 1, 1, 1200),
         ($5, $6, 'Completed item', 1200, 1, 0, 1200)`,
      [
        fixtures.pickupPending,
        fixtures.pickupCancelled,
        fixtures.pickupFailurePending,
        fixtures.pickupFailureMismatch,
        fixtures.pickupCompleted,
        pickupInventoryItemId,
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

  const stripeTransport = new Stripe(stripeSecret);
  const transfersByIdempotencyKey = new Map<string, any>();
  const refundsByIdempotencyKey = new Map<string, any>();
  const pickupOrderByIntent = new Map([
    [fixtures.pickupPendingIntent, fixtures.pickupPending],
    [fixtures.pickupCancelledIntent, fixtures.pickupCancelled],
    [fixtures.pickupFailureIntent, fixtures.pickupFailurePending],
    [fixtures.pickupMismatchIntent, fixtures.pickupFailureMismatch],
    [fixtures.pickupCompletedIntent, fixtures.pickupCompleted],
  ]);
  const pickupSettlementMetadata = (orderId: string) => ({
    pickupOrderId: orderId,
    orderId,
    restaurantId: fixtures.currentRestaurant,
    merchantOwnerId: fixtures.currentOwner,
    stripeConnectAccountId: "acct_disposable_fixture",
  });
  const stripeStub = {
    webhooks: stripeTransport.webhooks,
    transfers: {
      create: async (params: any, options?: any) => {
        const key = String(options?.idempotencyKey || "");
        const existing = transfersByIdempotencyKey.get(key);
        if (existing) return existing;
        const transfer = {
          id: id(`tr_${transfersByIdempotencyKey.size + 1}`),
          amount: params.amount,
          amount_reversed: 0,
          reversed: false,
          currency: params.currency,
          destination: params.destination,
          transfer_group: params.transfer_group,
          metadata: { ...(params.metadata || {}) },
        };
        transfersByIdempotencyKey.set(key, transfer);
        return transfer;
      },
      list: async (params: any) => ({
        data: [...transfersByIdempotencyKey.values()].filter(
          (transfer) => transfer.transfer_group === params.transfer_group,
        ),
        has_more: false,
      }),
      createReversal: async (transferId: string, params: any) => {
        const transfer = [...transfersByIdempotencyKey.values()].find(
          (candidate) => candidate.id === transferId,
        );
        assert.ok(transfer, `Unknown transfer ${transferId}`);
        transfer.amount_reversed += Number(params.amount || 0);
        transfer.reversed = transfer.amount_reversed >= transfer.amount;
        return { id: id("trr_fixture"), amount: params.amount };
      },
    },
    paymentIntents: {
      retrieve: async (intentId: string) => {
        const orderId = pickupOrderByIntent.get(intentId);
        return {
          id: intentId,
          status: "succeeded",
          amount: 1300,
          amount_received: 1300,
          currency: "usd",
          transfer_group:
            intentId === fixtures.pickupPendingIntent
              ? fixtures.pickupTransferGroup
              : null,
          metadata: orderId ? pickupSettlementMetadata(orderId) : {},
        };
      },
      cancel: async (intentId: string) => ({
        id: intentId,
        status: "canceled",
      }),
    },
    refunds: {
      create: async (params: any, options?: any) => {
        const key = String(options?.idempotencyKey || "");
        const existing = refundsByIdempotencyKey.get(key);
        if (existing) return existing;
        const refund = {
          id: id(`re_${refundsByIdempotencyKey.size + 1}`),
          status: "succeeded",
          payment_intent: params.payment_intent,
          amount: Number(params.amount),
          currency: "usd",
          created: Math.floor(Date.now() / 1000),
          metadata: { ...(params.metadata || {}) },
        };
        refundsByIdempotencyKey.set(key, refund);
        return refund;
      },
      retrieve: async (refundId: string) =>
        [...refundsByIdempotencyKey.values()].find(
          (refund) => refund.id === refundId,
        ) || { id: refundId, status: "succeeded" },
      list: async (params: any) => ({
        data: [...refundsByIdempotencyKey.values()].filter(
          (refund) => refund.payment_intent === params.payment_intent,
        ),
        has_more: false,
      }),
    },
  } as unknown as Stripe;

  const app = express();
  app.use(express.raw({ type: "application/json" }));
  registerStripeWebhookRoutes(app, {
    notifyHostCapacityWarning: async () => undefined,
    stripeClient: stripeStub,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const address = server.address() as AddressInfo;
  const apiBase = `http://127.0.0.1:${address.port}`;
  const send = (eventType: string, object: Record<string, unknown>) =>
    postWebhookEvent({
      stripe: stripeTransport,
      webhookSecret,
      apiBase,
      eventType,
      object,
    });
  const paymentIntent = (
    intentId: string,
    metadata: Record<string, string>,
    amount = 1500,
    transferGroup?: string,
  ) => ({
    id: intentId,
    object: "payment_intent",
    amount,
    amount_received: amount,
    currency: "usd",
    status: "succeeded",
    transfer_group: transferGroup || null,
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
      pickupSettlementMetadata(fixtures.pickupPending),
      1300,
      fixtures.pickupTransferGroup,
    );
    await send("payment_intent.succeeded", pickupPendingObject);
    await send("payment_intent.succeeded", pickupPendingObject);

    const pickupCancelledObject = paymentIntent(
      fixtures.pickupCancelledIntent,
      pickupSettlementMetadata(fixtures.pickupCancelled),
      1300,
    );
    await send("payment_intent.succeeded", pickupCancelledObject);
    const pickupFailurePendingObject = paymentIntent(
      fixtures.pickupFailureIntent,
      pickupSettlementMetadata(fixtures.pickupFailurePending),
      1300,
    );
    await send("payment_intent.payment_failed", pickupFailurePendingObject);
    await send("payment_intent.payment_failed", pickupFailurePendingObject);
    await send("payment_intent.payment_failed", pickupPendingObject);
    await send("payment_intent.payment_failed", pickupCancelledObject);
    await send(
      "payment_intent.payment_failed",
      paymentIntent(
        id("pi_pickup_mismatch_event"),
        pickupSettlementMetadata(fixtures.pickupFailureMismatch),
        1300,
      ),
    );
    await send(
      "payment_intent.payment_failed",
      paymentIntent(
        fixtures.pickupCompletedIntent,
        pickupSettlementMetadata(fixtures.pickupCompleted),
        1300,
      ),
    );

    const pickups = await pool.query(
      `
        select id, status, payout_status,
               merchant_acknowledgement_due_at is not null as acknowledgement_due
          from pickup_orders
         where id = any($1::varchar[])
         order by id
      `,
      [[
        fixtures.pickupCancelled,
        fixtures.pickupPending,
        fixtures.pickupFailurePending,
        fixtures.pickupFailureMismatch,
        fixtures.pickupCompleted,
      ]],
    );
    const pickupById = new Map(
      pickups.rows.map((row) => [String(row.id), row]),
    );
    assert.deepEqual(pickupById.get(fixtures.pickupPending), {
      id: fixtures.pickupPending,
      status: "confirmed",
      payout_status: "transferred",
      acknowledgement_due: true,
    });
    assert.equal(
      transfersByIdempotencyKey.size,
      1,
      "Duplicate succeeded webhooks must create exactly one merchant transfer",
    );
    assert.deepEqual(pickupById.get(fixtures.pickupCancelled), {
      id: fixtures.pickupCancelled,
      status: "cancelled",
      payout_status: "pending",
      acknowledgement_due: false,
    });
    assert.deepEqual(pickupById.get(fixtures.pickupFailurePending), {
      id: fixtures.pickupFailurePending,
      status: "pending",
      payout_status: "pending",
      acknowledgement_due: false,
    });
    assert.deepEqual(pickupById.get(fixtures.pickupFailureMismatch), {
      id: fixtures.pickupFailureMismatch,
      status: "pending",
      payout_status: "pending",
      acknowledgement_due: false,
    });
    assert.deepEqual(pickupById.get(fixtures.pickupCompleted), {
      id: fixtures.pickupCompleted,
      status: "completed",
      payout_status: "pending",
      acknowledgement_due: false,
    });

    const manualRefund = {
      id: id("re_manual_pickup"),
      object: "refund",
      status: "succeeded",
      payment_intent: fixtures.pickupPendingIntent,
      amount: 1300,
      currency: "usd",
      created: Math.floor(Date.now() / 1000),
      metadata: {},
    };
    refundsByIdempotencyKey.set("manual-pickup-refund", manualRefund);
    await send("refund.updated", manualRefund);
    const refundedPickup = await pool.query(
      `select status, payout_status, stripe_refund_id,
              inventory_restored_at is not null as inventory_restored
         from pickup_orders where id = $1`,
      [fixtures.pickupPending],
    );
    assert.deepEqual(refundedPickup.rows[0], {
      status: "cancelled",
      payout_status: "reversed",
      stripe_refund_id: manualRefund.id,
      inventory_restored: true,
    });
    const [settledTransfer] = [...transfersByIdempotencyKey.values()];
    assert.equal(settledTransfer.reversed, true);
    assert.equal(settledTransfer.amount_reversed, settledTransfer.amount);

    const pickupInventory = await pool.query(
      `select inventory_qty from menu_items where id = $1`,
      [pickupInventoryItemId],
    );
    assert.equal(
      Number(pickupInventory.rows[0]?.inventory_qty),
      48,
      "The refunded order restores once while retryable failed attempts keep their reservations",
    );

    if (process.env.MEALSCOUT_STRIPE_WEBHOOK_PICKUP_ONLY === "true") {
      console.log(
        JSON.stringify({
          status: "PASS",
          branchId: process.env[REQUIRED_BRANCH],
          checks: {
            pickupSettledBeforeConfirmationReplay: true,
            pickupFailureReservationRetained: true,
            pickupFailureMetadataFallback: true,
            pickupFailureIntentMismatchGuard: true,
            pickupFailureNonPendingGuard: true,
            cancelledPickupNonRegression: true,
            completedPickupNonRegression: true,
            manualFullRefundConverged: true,
          },
        }),
      );
      return;
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
      deal_active: true,
    });

    console.log(
      JSON.stringify({
        status: "PASS",
        branchId: process.env[REQUIRED_BRANCH],
        checks: {
          parkingPassLedgerReplay: true,
          committedCreditDebitReplay: true,
          pickupOrderReplay: true,
          pickupFailureReplay: true,
          pickupFailureInventoryExactlyOnce: true,
          pickupFailureMetadataFallback: true,
          pickupFailureIntentMismatchGuard: true,
          pickupFailureNonPendingGuard: true,
          cancelledPickupNonRegression: true,
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
    await pool.end().catch(() => undefined);
  });
