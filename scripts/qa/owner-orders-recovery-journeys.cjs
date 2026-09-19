/** Orders/Kitchen recovery in the compiled application and real React/Query.
 * Uses the existing isolated frontend runner; API actors and orders are fixtures.
 * No provider, customer data, real payment, or live backend is contacted.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('@playwright/test');

function seed(world) {
  const id = 'recovery-order-100001';
  const order = { id, restaurantId: world.restaurant.id, status: 'confirmed',
    customerName: 'QA Recovery Customer', orderType: 'pickup', paymentMethod: 'card',
    payoutStatus: 'transferred', subtotalCents: 1250, platformFeeCents: 100,
    totalCents: 1350, feePaidByBusiness: false, createdAt: new Date().toISOString(),
    specialInstructions: 'No nuts. Keep item notes.',
    items: [{ id: 'recovery-item', itemName: 'QA Recovery Lunch', quantity: 1,
      lineTotalCents: 1250, specialInstructions: 'No sauce' }] };
  world.orders.set(id, { order, token: 'recovery-fixture-only' });
  return order;
}
const endpoint = (view, world) => '/api/owner/' +
  (view === 'kitchen' ? 'kitchen-queue' : 'orders') + '/' + world.restaurant.id;
const destination = (view, world) => '/' + view + '?restaurantId=' + world.restaurant.id;
const card = (page, order) => page.getByTestId('owner-order-' + order.id);
function noWrites(world) {
  assert.equal(world.requests.filter(r => r.method !== 'GET').length, 0,
    'Recovery must be a read, never a repeated order/payment/status write');
}
async function snapshot(page, view, state) {
  if (!process.env.QA_EVIDENCE_DIR) return;
  const dir = path.resolve(process.env.QA_EVIDENCE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir,
    view + '-' + page.viewportSize().width + '-' + state + '.png'), fullPage: true });
}
async function unverified(page, view, access = false) {
  await expect(page.getByRole('heading', { name: access
    ? 'Order access is unavailable' : 'Orders could not be loaded', exact: true })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: access
    ? 'Order access is unavailable' : 'Orders could not be loaded' })).toBeVisible();
  await expect(page.getByText('No orders yet', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-testid^="owner-order-"]')).toHaveCount(0);
  await expect(page.locator('[data-owner-orders-workspace] section').first()
    .getByText('\u2014', { exact: true })).toHaveCount(4);
  if (view === 'kitchen') {
    await expect(page.getByText('Updates unverified', { exact: true })).toBeVisible();
    await expect(page.getByText('Live updates', { exact: true })).toHaveCount(0);
  }
}

module.exports = async function runOwnerOrdersRecovery(scenario) {
  for (const view of ['orders', 'kitchen']) {
    await scenario(view + ': confirmed empty read is distinct from a failure', async ({ world, openActor }) => {
      const page = await openActor(world.actors.owner, destination(view, world));
      await expect(page.getByText('No orders yet', { exact: true })).toBeVisible();
      await expect(page.getByText('Orders could not be loaded', { exact: true })).toHaveCount(0);
      noWrites(world);
    });

    for (const kind of ['missing list', 'wrong business', 'duplicate identity', 'missing items', 'bad pagination']) {
      await scenario(view + ': ' + kind + ' cannot become a successful empty queue', async ({ world, openActor, origin }) => {
        const order = seed(world);
        const bodies = {
          'missing list': { message: 'Upstream temporary response' },
          'wrong business': { orders: [order, { ...order, id: 'foreign-order', restaurantId: world.otherRestaurant.id }] },
          'duplicate identity': { orders: [order, order] },
          'missing items': { orders: [{ ...order, items: null }] },
          'bad pagination': { orders: [order], page: 0, hasMore: true },
        };
        world.faults.set(endpoint(view, world), { status: 200, body: bodies[kind] });
        const page = await openActor(world.actors.owner, destination(view, world));
        await unverified(page, view);
        await page.getByRole('button', { name: 'Try again', exact: true }).click();
        await expect(card(page, order)).toContainText('QA Recovery Lunch');
        await expect(card(page, order)).toContainText('No sauce');
        await expect(card(page, order)).toContainText('No nuts. Keep item notes.');
        await expect(page).toHaveURL(origin + destination(view, world));
        noWrites(world);
      });
    }

    for (const status of [401, 403]) {
      await scenario(view + ': HTTP ' + status + ' remains access failure until a valid refresh', async ({ world, openActor }) => {
        const order = seed(world);
        world.faults.set(endpoint(view, world), { status, body: 'Non-object upstream access response' });
        const page = await openActor(world.actors.owner, destination(view, world));
        await unverified(page, view, true);
        const signin = page.getByRole('link', { name: 'Sign in again', exact: true });
        if (status === 401) {
          await expect(signin).toHaveAttribute('href', '/login?redirect=' + encodeURIComponent(destination(view, world)));
        } else {
          await expect(signin).toHaveCount(0);
        }
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(card(page, order)).toContainText('QA Recovery Lunch');
        noWrites(world);
      });
    }

    await scenario(view + ': raw HTML after a populated read hides stale actionable orders and recovers', async ({ world, openActor }) => {
      const order = seed(world);
      const page = await openActor(world.actors.owner, destination(view, world));
      await expect(card(page, order)).toBeVisible();
      let broken = true;
      await page.route('**' + endpoint(view, world) + '*', async route => {
        if (!broken) return route.fallback();
        return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Upstream sign-in page</html>' });
      });
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await unverified(page, view);
      await snapshot(page, view, 'failed-refresh');
      broken = false;
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(card(page, order)).toContainText('QA Recovery Lunch');
      await expect(card(page, order)).toContainText('$13.50');
      await expect(page.locator('[data-testid^="owner-order-"]')).toHaveCount(1);
      await snapshot(page, view, 'recovered');
      noWrites(world);
    });

    await scenario(view + ': delayed retry cannot display invented zero counts or accept duplicate retry', async ({ world, openActor }) => {
      const order = seed(world);
      world.faults.set(endpoint(view, world), { status: 503, body: { message: 'QA delayed recovery' } });
      const page = await openActor(world.actors.owner, destination(view, world));
      await unverified(page, view);
      let release, reached;
      const pending = new Promise(resolve => { release = resolve; });
      const intercepted = new Promise(resolve => { reached = resolve; });
      let retries = 0;
      await page.route('**' + endpoint(view, world) + '*', async route => {
        retries++; reached(); await pending; return route.fallback();
      });
      try {
        await page.getByRole('button', { name: 'Try again', exact: true }).click();
        await intercepted;
        await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toHaveAttribute('aria-busy', 'true');
        const refreshBounds = await page.getByRole('button', { name: 'Refresh', exact: true }).boundingBox();
        assert.ok(refreshBounds && refreshBounds.height >= 44, 'Refresh must keep a 44px touch target');
        await expect(page.getByText('No orders yet', { exact: true })).toHaveCount(0);
        await expect(page.locator('[data-owner-orders-workspace] section').first()
          .getByText('\u2014', { exact: true })).toHaveCount(4);
        await expect(page.getByRole('button', { name: /^(All|Needs attention|Completed|Cancelled) [0-9]+$/ })).toHaveCount(0);
        await snapshot(page, view, 'pending-retry');
        assert.equal(retries, 1, 'One read per retry while pending');
        noWrites(world);
      } finally { release(); }
      await expect(card(page, order)).toContainText('QA Recovery Lunch');
      noWrites(world);
    });
  }
};
