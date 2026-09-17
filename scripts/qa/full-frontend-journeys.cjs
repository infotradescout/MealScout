/** Full built MealScout frontend, real installed React/Wouter/Query/Radix.
 * Synthetic accounts/API and a Stripe simulator; never live backend/payment proof.
 * Run after build:client. The server only listens on loopback. Every API call is
 * intercepted; external HTTP, websockets and service workers are blocked.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, expect } = require('@playwright/test');
const { createTestWorld } = require('./test-world.cjs');
const root = path.resolve(__dirname, '../..');
const dist = path.join(root, 'client/dist');
const evidence = path.resolve(process.env.QA_EVIDENCE_DIR || path.join(root, '.qa-evidence'));
require('./parking-return-policy.test.cjs');
require('./parking-calendar-date.test.cjs');
const results = [];
const simulator = () => {
  function Stripe() {
    return {
      _registerWrapper() {}, registerAppInfo() {},
      createToken: async () => ({}), createPaymentMethod: async () => ({}), confirmCardPayment: async () => ({}),
      elements(options) {
        return { _qaSecret: options.clientSecret, update() {}, submit: async () => ({}),
          create() {
            const handlers = {}; let node;
            return { on(name, fn) { handlers[name] = fn; }, off(name) { delete handlers[name]; }, update() {},
              mount(target) {
                node = document.createElement('p'); node.textContent = 'QA payment simulator — no real charge';
                (typeof target === 'string' ? document.querySelector(target) : target).appendChild(node);
                setTimeout(() => handlers.ready?.({}), 0);
              }, unmount() { node?.remove(); }, destroy() { node?.remove(); } };
          } };
      },
      async confirmPayment({ elements }) {
        const id = elements._qaSecret.replace(/^pi_/, '').replace(/_secret_fixture$/, '');
        const outcome = window.__qaPaymentOutcome || 'succeeded';
        if (outcome === 'declined') return { error: { type: 'card_error', message: 'QA declined card' } };
        await window.__qaSettle(id, outcome === 'succeeded' ? 'confirmed' : 'pending');
        return { paymentIntent: { id: `pi_${id}`, status: outcome } };
      } };
  }
  Stripe.version = 'fixture'; window.Stripe = Stripe;
};

async function run() {
  assert.ok(fs.existsSync(path.join(dist, 'index.html')), 'Actual built frontend is required; no UI substitutes');
  fs.mkdirSync(evidence, { recursive: true });
  const servedApi = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) {
      servedApi.push(url.pathname); res.writeHead(503); res.end('QA API interception missing'); return;
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let file = path.resolve(dist, relative);
    if (!file.startsWith(dist + path.sep) && file !== dist) { res.writeHead(403); res.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.UI_CHROMIUM_EXECUTABLE || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      async function scenario(name, callback) {
        const world = createTestWorld(); const contexts = []; const errors = [];
        const openActor = async (actor, route) => {
          const identity = { actorId: actor?.id || null };
          const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
          contexts.push(context); context.setDefaultTimeout(12_000);
          await context.routeWebSocket('**/*', (socket) => socket.close());
          await context.exposeBinding('__qaSettle', (_source, id, status) => world.settle(id, status));
          await context.addInitScript(simulator);
          await context.route('**/*', async (route) => {
            const request = route.request(), url = new URL(request.url());
            if (url.pathname.startsWith('/api/')) {
              let body = {}; try { body = request.postDataJSON() || {}; } catch {}
              const response = world.handle(identity, url.href, request.method(), body, request.headers());
              return route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
            }
            if (url.hostname === 'js.stripe.com') return route.fulfill({ contentType: 'application/javascript', body: `(${simulator.toString()})();` });
            if (url.origin !== origin || url.pathname.startsWith('/socket.io')) return route.abort();
            return route.continue();
          });
          const page = await context.newPage();
          page.on('pageerror', (error) => errors.push(error.message));
          await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
          return page;
        };
        const buy = async (outcome = 'succeeded') => {
          const page = await openActor(world.actors.customer, `/menu/${world.restaurant.id}`);
          await page.getByRole('button', { name: 'Add QA test tacos to cart' }).click();
          await page.getByRole('dialog').getByRole('button', { name: /Add to Cart/i }).click();
          await page.getByRole('button', { name: /View Cart/ }).click();
          await page.getByRole('button', { name: /Proceed to Checkout/ }).click();
          await page.locator('#customer-name').fill('QA ONLY Customer');
          await page.locator('#customer-email').fill(world.actors.customer.email);
          await page.getByRole('radio', { name: 'Pickup', exact: true }).click();
          await page.getByRole('button', { name: 'Continue to secure payment' }).click();
          await expect(page.getByRole('heading', { name: 'Payment', exact: true })).toBeVisible();
          await page.evaluate((value) => { window.__qaPaymentOutcome = value; }, outcome);
          await page.getByRole('button', { name: 'Confirm Payment', exact: true }).click();
          await expect(page).toHaveURL(/\/order-confirmation\//);
          const id = [...world.orders.keys()][0]; assert.ok(id); assert.equal(world.orders.size, 1);
          return { page, id };
        };
        const started = Date.now();
        try {
          await callback({ world, openActor, buy, origin });
          assert.equal(world.unexpected.filter((r) => r.method !== 'GET').length, 0, `Unhandled writes: ${JSON.stringify(world.unexpected)}`);
          assert.equal(errors.length, 0, `Browser exceptions: ${errors.join('; ')}`);
          results.push({ name, viewport, outcome: 'pass', elapsedMs: Date.now() - started, syntheticUsers: world.users.size,
            requests: world.requests.length, unspecifiedReads: [...new Set(world.unexpected.map((r) => r.path))] });
          console.log(`QA PASS ${viewport.width} ${name}`);
        } catch (error) {
          const pages = contexts.flatMap((context) => context.pages());
          const page = pages.at(-1);
          const visible = page ? await page.locator('body').innerText().catch(() => '') : '';
          if (page) await page.screenshot({ path: path.join(evidence, `${viewport.width}-${results.length}.png`), fullPage: true }).catch(() => {});
          results.push({ name, viewport, outcome: 'fail', error: error.message, visible: visible.slice(0, 4500), errors,
            requests: world.requests.slice(-18), unspecifiedReads: world.unexpected.slice(-12) });
          console.log(`QA FAIL ${viewport.width} ${name}: ${error.message.slice(0, 1800)}\nVISIBLE: ${visible.slice(0, 2200)}\nREQUESTS: ${JSON.stringify(world.requests.slice(-10))}`);
        } finally { await Promise.all(contexts.map((context) => context.close())); }
      }
      await scenario('menu → cart → checkout → status → kitchen → completion', async ({ world, openActor, buy }) => {
        const { page, id } = await buy();
        await expect(page.getByRole('heading', { name: 'Payment Confirmed', exact: true })).toBeVisible();
        const owner = await openActor(world.actors.owner, `/kitchen?restaurantId=${world.restaurant.id}`);
        await owner.locator(`#prep-estimate-${id}`).selectOption('15');
        await owner.getByTestId(`button-advance-order-${id}`).click();
        await expect.poll(() => world.orders.get(id).order.status).toBe('preparing');
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Being Prepared', exact: true })).toBeVisible();
        await owner.getByTestId(`button-advance-order-${id}`).click();
        await expect.poll(() => world.orders.get(id).order.status).toBe('ready');
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Ready for Pickup!', exact: true })).toBeVisible();
        await owner.getByTestId(`button-advance-order-${id}`).click();
        await expect.poll(() => world.orders.get(id).order.status).toBe('completed');
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Order Complete', exact: true })).toBeVisible();
        assert.equal(world.orders.size, 1);
      });
      await scenario('processing payment retains recovery and cannot start kitchen preparation', async ({ world, openActor, buy }) => {
        const { page, id } = await buy('processing');
        await expect(page.getByRole('heading', { name: 'Order Received', exact: true })).toBeVisible();
        const saved = await page.evaluate((id) => ({ cart: localStorage.getItem('mealscout_cart'), recovery: sessionStorage.getItem(`mealscout:pickup-checkout:${encodeURIComponent(id)}`) }), world.restaurant.id);
        assert.ok(saved.cart && JSON.parse(saved.cart).length > 0); assert.ok(saved.recovery);
        const owner = await openActor(world.actors.owner, `/kitchen?restaurantId=${world.restaurant.id}`);
        await expect(owner.getByText('Payment / review', { exact: true })).toBeVisible();
        await expect(owner.getByTestId(`button-advance-order-${id}`)).toHaveCount(0);
      });
      await scenario('second business and second customer cannot see first customer order', async ({ world, openActor, buy }) => {
        const { id } = await buy();
        const other = await openActor(world.actors.otherCustomer, `/order-confirmation/${id}`);
        await expect(other.getByRole('heading', { name: 'Order status unavailable', exact: true })).toBeVisible();
        await expect(other.getByText('QA ONLY Customer', { exact: true })).toHaveCount(0);
        const owner = await openActor(world.actors.otherOwner, `/orders?restaurantId=${world.otherRestaurant.id}`);
        await expect(owner.getByTestId(`button-advance-order-${id}`)).toHaveCount(0);
        await expect.poll(() => world.requests.some((r) => r.path === `/api/owner/orders/${world.otherRestaurant.id}`)).toBe(true);
      });
      await scenario('transient status-read failure shows stale data and retry recovers', async ({ world, buy }) => {
        const { page, id } = await buy();
        await expect(page.getByRole('heading', { name: 'Payment Confirmed', exact: true })).toBeVisible();
        world.faults.set(`/api/pickup-orders/${id}`, { status: 503, body: { message: 'QA offline' } });
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await expect(page.getByText('Status update interrupted', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Retry status', exact: true }).click();
        await expect(page.getByText('Status update interrupted', { exact: true })).toHaveCount(0);
        assert.equal(world.orders.size, 1);
      });
      await scenario('Parking Pass failed return keeps its reference and recovers with a read-only retry', async ({ world, openActor }) => {
        const intent = `pi_qa_${world.runId}_return`;
        const endpoint = `/api/bookings/payment-intent/${intent}`;
        world.faults.set(endpoint, { status: 503, body: { message: 'QA interrupted lookup' } });
        const page = await openActor(world.actors.truck, `/parking-pass?booking=success&payment_intent=${intent}&payment_intent_client_secret=qa_secret&truckId=${world.truck.id}`);
        await expect(page.getByRole('heading', { name: 'Booking status could not be verified', exact: true })).toBeVisible();
        await expect(page.getByText('Payment received', { exact: true })).toHaveCount(0);
        const pendingUrl = new URL(page.url());
        assert.equal(pendingUrl.searchParams.get('payment_intent'), intent);
        assert.equal(pendingUrl.searchParams.get('booking'), 'success');
        assert.equal(pendingUrl.searchParams.has('payment_intent_client_secret'), false);
        world.faults.set(endpoint, { status: 200, body: { status: 'confirmed' } });
        await page.getByRole('button', { name: 'Check booking status', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Your booking is confirmed', exact: true })).toBeVisible();
        assert.equal(world.requests.filter((r) => r.path === endpoint).length, 2);
        assert.equal(world.requests.filter((r) => r.method !== 'GET').length, 0);
      });
      await scenario('Parking Pass pending return survives reload without claiming a reservation', async ({ world, openActor }) => {
        const intent = `pi_qa_${world.runId}_pending`, endpoint = `/api/bookings/payment-intent/${intent}`;
        const pending = { status: 200, body: { status: 'pending' } };
        world.faults.set(endpoint, pending);
        const page = await openActor(world.actors.truck, `/parking-pass?booking=success&payment_intent=${intent}`);
        await expect(page.getByRole('heading', { name: 'Booking confirmation pending', exact: true })).toBeVisible();
        world.faults.set(endpoint, pending);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: 'Booking confirmation pending', exact: true })).toBeVisible();
        await expect(page.getByText('Payment received', { exact: true })).toHaveCount(0);
        assert.equal(new URL(page.url()).searchParams.get('payment_intent'), intent);
        assert.equal(world.requests.filter((r) => r.method !== 'GET').length, 0);
      });
      await scenario('Parking Pass credited return remains distinct from a confirmed spot', async ({ world, openActor }) => {
        const intent = `pi_qa_${world.runId}_credited`;
        world.faults.set(`/api/bookings/payment-intent/${intent}`, { status: 200, body: { status: 'credited' } });
        const page = await openActor(world.actors.truck, `/parking-pass?booking=success&payment_intent=${intent}`);
        await expect(page.getByRole('heading', { name: 'Booking unavailable — credits issued', exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Your booking is confirmed', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'View My Schedule', exact: true })).toBeVisible();
        assert.equal(world.requests.filter((r) => r.method !== 'GET').length, 0);
      });
      await scenario('Parking Pass missing reference does not turn a redirect flag into payment proof', async ({ world, openActor }) => {
        const page = await openActor(world.actors.truck, '/parking-pass?booking=success');
        await expect(page.getByRole('heading', { name: 'Booking reference missing', exact: true })).toBeVisible();
        assert.equal(world.requests.filter((r) => r.path.startsWith('/api/bookings/payment-intent/')).length, 0);
        assert.equal(world.requests.filter((r) => r.method !== 'GET').length, 0);
      });
      await scenario('Parking Pass wrong account cannot query an unavailable truck intent', async ({ world, openActor }) => {
        const page = await openActor(world.actors.otherOwner, `/parking-pass?booking=success&payment_intent=pi_qa_wrong_account&truckId=${world.truck.id}`);
        await expect(page.getByText('No food truck is attached to this account. Check the account used for the booking.', { exact: true })).toBeVisible();
        assert.equal(world.requests.filter((r) => r.path.startsWith('/api/bookings/payment-intent/')).length, 0);
        assert.equal(world.requests.filter((r) => r.method !== 'GET').length, 0);
      });
      await scenario('Parking Pass multiple trucks require explicit selection before status lookup', async ({ world, openActor }) => {
        const intent = `pi_qa_${world.runId}_choose`, endpoint = `/api/bookings/payment-intent/${intent}`;
        world.businesses.set(`${world.truck.id}-second`, { ...world.truck, id: `${world.truck.id}-second`, name: 'QA ONLY second truck' });
        const page = await openActor(world.actors.truck, `/parking-pass?booking=success&payment_intent=${intent}`);
        await expect(page.getByRole('heading', { name: 'Choose the truck used for checkout', exact: true })).toBeVisible();
        assert.equal(world.requests.filter((r) => r.path === endpoint).length, 0);
        world.faults.set(endpoint, { status: 200, body: { status: 'confirmed' } });
        const request = page.waitForRequest((r) => new URL(r.url()).pathname === endpoint);
        await page.getByLabel('Truck for this booking').selectOption(world.truck.id);
        assert.equal(new URL((await request).url()).searchParams.get('truckId'), world.truck.id);
        await expect(page.getByRole('heading', { name: 'Your booking is confirmed', exact: true })).toBeVisible();
      });
      await scenario('Parking Pass gas controls include host prices when provider results are empty', async ({ world, openActor }) => {
        world.faults.set('/api/map/locations', { status: 200, body: {
          hostLocations: [{ id: 'qa-fuel-only', hostId: 'qa-fuel-host', type: 'host_location', name: 'QA ONLY host fuel',
            latitude: '30.0', longitude: '-90.0', address: 'QA fixture address', city: 'QA town', state: 'LA',
            showFuelPrices: true, fuelPrices: { regularCents: 329 } }], eventLocations: [], supplierLocations: [],
        } });
        world.faults.set('/api/map/operator-support', { status: 200, body: {
          available: true, categories: { gas: [], propane: [], supply: [], support: [] },
        } });
        const page = await openActor(world.actors.truck, '/parking-pass');
        await page.getByRole('button', { name: 'Map', exact: true }).click();
        await page.locator('summary').filter({ hasText: 'Map tools' }).click();
        const gas = page.getByRole('button', { name: 'Gas (1)', exact: true });
        await expect(gas).toBeEnabled();
        await gas.click();
        await expect(gas).toBeEnabled();
        assert.equal(world.requests.filter((r) => r.method !== 'GET').length, 0);
      });
      await require('./parking-continuation-journeys.cjs')(scenario);
      await require('./parking-schedule-reliability-journeys.cjs')(scenario);
      await scenario('guest can browse an active menu without account or payment mutations', async ({ world, openActor }) => {
        const guest = await openActor(null, `/menu/${world.restaurant.id}`);
        await expect(guest.getByRole('heading', { name: world.restaurant.name, exact: true })).toBeVisible();
        await expect(guest.getByRole('button', { name: 'Add QA test tacos to cart' })).toBeVisible();
        assert.equal(world.orders.size, 0);
      });
    }
    assert.equal(servedApi.length, 0, 'An API request escaped fixture interception');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
  const report = { scope: 'Full compiled frontend, real installed UI/router/query libraries; synthetic API/auth/Stripe, not production E2E',
    react: require('react/package.json').version, playwright: require('@playwright/test/package.json').version,
    results, pass: results.filter((r) => r.outcome === 'pass').length, fail: results.filter((r) => r.outcome === 'fail').length };
  fs.writeFileSync(path.join(evidence, 'full-frontend-journeys.json'), JSON.stringify(report, null, 2));
  console.log('QA FULL FRONTEND SUMMARY ' + JSON.stringify({ ...report, results: report.results.map(({ name, viewport, outcome }) => ({ name, viewport, outcome })) }));
  if (report.fail) process.exitCode = 1;
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
