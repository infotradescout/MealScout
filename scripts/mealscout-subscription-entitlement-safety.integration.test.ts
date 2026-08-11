import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";

const REQUIRED_OPT_IN = "MEALSCOUT_SUBSCRIPTION_ENTITLEMENT_SAFETY";
const REQUIRED_BRANCH = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_BRANCH_ID";
const REQUIRED_HOST = "MEALSCOUT_STRIPE_WEBHOOK_STATEFUL_EXPECTED_HOST";

function requireDisposableDatabase() {
  assert.equal(process.env[REQUIRED_OPT_IN], "1", `${REQUIRED_OPT_IN}=1 is required`);
  assert.match(String(process.env[REQUIRED_BRANCH] || ""), /^br-/);
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  const expectedHost = String(process.env[REQUIRED_HOST] || "").trim().toLowerCase();
  assert.ok(databaseUrl, "DATABASE_URL is required");
  assert.ok(expectedHost, `${REQUIRED_HOST} is required`);
  assert.equal(new URL(databaseUrl).hostname.toLowerCase(), expectedHost);
}

async function run() {
  requireDisposableDatabase();
  process.env.NODE_ENV = "development";
  process.env.STRIPE_WEBHOOK_DEV_ALLOW_UNSIGNED = "true";
  delete process.env.STRIPE_WEBHOOK_FORCE_VERIFY;

  const [{ default: express }, { registerStripeWebhookRoutes }, { pool }] =
    await Promise.all([
      import("express"),
      import("../server/routes/stripeWebhookRoutes"),
      import("../server/db"),
    ]);
  assert.ok(pool, "Disposable PostgreSQL pool is required");

  const fixture = randomUUID().replaceAll("-", "");
  const subscriptionId = `sub_safety_${fixture}`;
  const customerId = `cus_safety_${fixture}`;
  const subscriptionRowId = `subscription_safety_${fixture}`;
  const orderId = `subscription_order_${fixture}`;
  const paymentIntentId = `pi_subscription_safety_${fixture}`;

  const source = await pool.query(
    `select u.id as user_id, u.stripe_subscription_id, u.stripe_customer_id,
            r.id as restaurant_id
       from users u cross join restaurants r
      order by u.created_at nulls last, r.created_at nulls last
      limit 1`,
  );
  assert.equal(source.rowCount, 1, "A user and restaurant fixture are required");
  const userId = String(source.rows[0].user_id);
  const restaurantId = String(source.rows[0].restaurant_id);
  const previousSubscriptionId = source.rows[0].stripe_subscription_id;
  const previousCustomerId = source.rows[0].stripe_customer_id;

  const app = express();
  app.use(express.json());
  registerStripeWebhookRoutes(app, { notifyHostCapacityWarning: async () => undefined });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;

  async function sendEvent(event: Record<string, object | string | number>) {
    const response = await fetch(`http://127.0.0.1:${port}/api/stripe/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    assert.equal(response.status, 200, await response.text());
  }

  function subscriptionEvent(id: string, created: number, status: string) {
    return {
      id,
      created,
      type: "customer.subscription.updated",
      data: { object: { id: subscriptionId, customer: customerId, status } },
    };
  }

  try {
    await pool.query(
      `update users set stripe_subscription_id = $1, stripe_customer_id = $2 where id = $3`,
      [subscriptionId, customerId, userId],
    );
    await pool.query(
      `insert into restaurant_subscriptions
         (id, restaurant_id, tier, status, stripe_customer_id, stripe_subscription_id)
       values ($1, $2, 'monthly', 'active', $3, $4)`,
      [subscriptionRowId, restaurantId, customerId, subscriptionId],
    );
    await pool.query(
      `insert into pickup_orders
         (id, restaurant_id, customer_name, status, subtotal_cents,
          platform_fee_cents, total_cents, payment_method, stripe_payment_intent_id)
       values ($1, $2, 'Subscription safety', 'pending', 1000, 100, 1100, 'card', $3)`,
      [orderId, restaurantId, paymentIntentId],
    );

    await sendEvent(subscriptionEvent(`evt_active_${fixture}`, 200, "active"));
    await sendEvent(subscriptionEvent(`evt_old_cancel_${fixture}`, 100, "canceled"));
    let state = await pool.query(
      `select u.stripe_subscription_id, s.status, s.stripe_event_id,
              o.status as order_status
         from users u
         join restaurant_subscriptions s on s.id = $1
         join pickup_orders o on o.id = $2
        where u.id = $3`,
      [subscriptionRowId, orderId, userId],
    );
    assert.equal(state.rows[0].stripe_subscription_id, subscriptionId);
    assert.equal(state.rows[0].status, "active");
    assert.equal(state.rows[0].stripe_event_id, `evt_active_${fixture}`);
    assert.equal(state.rows[0].order_status, "pending");

    const terminal = subscriptionEvent(`evt_terminal_${fixture}`, 300, "canceled");
    await sendEvent(terminal);
    await sendEvent(terminal);
    state = await pool.query(
      `select u.stripe_subscription_id, s.status, s.stripe_event_id
         from users u join restaurant_subscriptions s on s.id = $1
        where u.id = $2`,
      [subscriptionRowId, userId],
    );
    assert.equal(state.rows[0].stripe_subscription_id, null);
    assert.equal(state.rows[0].status, "canceled");
    assert.equal(state.rows[0].stripe_event_id, `evt_terminal_${fixture}`);

    for (const status of ["incomplete", "past_due"]) {
      await sendEvent(subscriptionEvent(`evt_${status}_${fixture}`, 400, status));
      const entitlement = await pool.query(
        `select stripe_subscription_id from users where id = $1`,
        [userId],
      );
      assert.equal(entitlement.rows[0].stripe_subscription_id, null);
    }

    await pool.query(
      `update users set stripe_subscription_id = $1 where id = $2`,
      [subscriptionId, userId],
    );
    await sendEvent({
      id: `evt_food_failure_${fixture}`,
      created: 500,
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: paymentIntentId,
          metadata: { pickupOrderId: orderId },
        },
      },
    });
    const separation = await pool.query(
      `select u.stripe_subscription_id, o.status as order_status
         from users u join pickup_orders o on o.id = $1
        where u.id = $2`,
      [orderId, userId],
    );
    assert.equal(separation.rows[0].stripe_subscription_id, subscriptionId);
    assert.equal(separation.rows[0].order_status, "cancelled");

    console.log("mealscout-subscription-entitlement-safety: PASS (8/8)");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await pool.query(`delete from pickup_orders where id = $1`, [orderId]);
    await pool.query(`delete from restaurant_subscriptions where id = $1`, [subscriptionRowId]);
    await pool.query(
      `update users set stripe_subscription_id = $1, stripe_customer_id = $2 where id = $3`,
      [previousSubscriptionId, previousCustomerId, userId],
    );
    await pool.end();
  }
}

run().catch((error) => {
  console.error("mealscout-subscription-entitlement-safety: FAIL", error);
  process.exit(1);
});
