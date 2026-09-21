/** Read-only return/login/schedule navigation through the actual built UI.
 * API/auth are synthetic. Existing booking rows are immutable fixtures;
 * no booking creation, payment confirmation or cancellation is exercised.
 */
const assert = require('node:assert/strict');
const { expect } = require('@playwright/test');
module.exports = async function parkingContinuationJourneys(scenario) {
  function installReads(world) {
    const original = world.handle;
    const date = new Date(); date.setMonth(date.getMonth() + 1, 18);
    const day = date.toISOString().slice(0, 10);
    const hostName = 'QA ONLY confirmed schedule host';
    const schedule = ['confirmed', 'pending', 'credited'].map((status) => ({
      type: 'booking', status, bookingId: `qa-${world.runId}-${status}`, slotType: 'lunch',
      event: { id: `qa-${world.runId}-${status}-pass`, date: day, startTime: '11:00', endTime: '14:00', status: 'open', requiresPayment: true },
      host: { id: `qa-${world.runId}-host`, businessName: status === 'confirmed' ? hostName : `QA ONLY ${status} not reserved`, address: 'QA fixture location', locationType: 'other' },
    }));
    const reads = new Map([
      [`/api/bookings/truck/${world.truck.id}/schedule`, { schedule }],
      [`/api/trucks/${world.truck.id}/manual-schedule`, []],
      [`/api/trucks/${world.truck.id}/parking-reports`, []],
      [`/api/restaurants/${world.truck.id}/social-connections/status`, { restaurantId: world.truck.id, connections: [] }],
      ['/api/map/locations', { hostLocations: [], eventLocations: [], supplierLocations: [] }],
    ]);
    world.handle = (identity, url, method = 'GET', body = {}, headers = {}) => {
      const pathname = new URL(url).pathname;
      if (method === 'GET' && reads.has(pathname)) {
        world.requests.push({ actor: identity.actorId || 'guest', method, path: pathname });
        return { status: 200, body: reads.get(pathname) };
      }
      if (method === 'POST' && pathname === '/api/telemetry/track') {
        assert.ok(typeof body.eventName === 'string');
        world.requests.push({ actor: identity.actorId || 'guest', method, path: pathname });
        return { status: 200, body: { success: true } };
      }
      return original(identity, url, method, body, headers);
    };
    return { day, hostName, reads, scheduleEndpoint: `/api/bookings/truck/${world.truck.id}/schedule` };
  }
  function noTransactionWrites(world) {
    assert.deepEqual(world.requests.filter((r) => r.method !== 'GET' &&
      !['/api/auth/login', '/api/telemetry/track'].includes(r.path)), []);
    assert.equal(world.orders.size, 0);
  }
  await scenario('Parking Pass signed-out return survives failed login and resumes the same booking', async ({ world, openActor, origin }) => {
    const { day, reads } = installReads(world);
    const intent = `pi_qa_${world.runId}_login`, endpoint = `/api/bookings/payment-intent/${intent}`;
    const params = new URLSearchParams({ booking: 'success', payment_intent: intent,
      payment_intent_client_secret: 'qa_secret_do_not_forward', truckId: world.truck.id,
      hostId: 'qa-retained-host', date: day, source: 'scout', redirect: 'https://example.invalid/not-allowed' });
    const page = await openActor(null, `/parking-pass?${params}`);
    await expect(page.getByRole('heading', { name: 'Sign in to check this booking', exact: true })).toBeVisible();
    assert.equal(world.requests.filter((r) => r.path === endpoint).length, 0);
    await page.getByRole('link', { name: 'Sign in', exact: true }).click();
    const login = new URL(page.url()); assert.equal(login.pathname, '/login');
    const destination = new URL(login.searchParams.get('redirect'), origin);
    assert.equal(destination.origin, origin); assert.equal(destination.pathname, '/parking-pass');
    for (const key of ['booking', 'payment_intent', 'truckId', 'hostId', 'date', 'source']) assert.equal(destination.searchParams.get(key), params.get(key));
    assert.equal(login.href.includes('qa_secret_do_not_forward'), false);
    await page.getByTestId('button-email-login').click();
    await page.getByTestId('input-email').fill(world.actors.truck.email);
    await page.getByTestId('input-password').fill('QA wrong password');
    await page.getByTestId('button-login-submit').click();
    await expect(page.getByTestId('login-recovery-help')).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get('redirect'), login.searchParams.get('redirect'));
    assert.equal(world.requests.filter((r) => r.path === endpoint).length, 0);
    reads.set(endpoint, { status: 'confirmed' });
    await page.getByTestId('input-password').fill(world.password);
    await page.getByTestId('button-login-submit').click();
    await expect(page.getByRole('heading', { name: 'Your booking is confirmed', exact: true })).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get('payment_intent'), intent);
    assert.equal(world.requests.filter((r) => r.path === '/api/auth/login').length, 2);
    noTransactionWrites(world);
  });
  await scenario('Parking Pass signed-out return cannot discard its reference through My Schedule', async ({ world, openActor }) => {
    const page = await openActor(null, '/parking-pass?booking=success&payment_intent=pi_qa_guest_reference');
    await expect(page.getByRole('heading', { name: 'Sign in to check this booking', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'View My Schedule', exact: true })).toBeDisabled();
    assert.equal(new URL(page.url()).searchParams.get('payment_intent'), 'pi_qa_guest_reference');
    noTransactionWrites(world);
  });
  await scenario('Parking Pass confirmed return opens the selected truck schedule and survives reload', async ({ world, openActor }) => {
    const { day, hostName, scheduleEndpoint } = installReads(world);
    const intent = `pi_qa_${world.runId}_schedule`;
    world.faults.set(`/api/bookings/payment-intent/${intent}`, { status: 200, body: { status: 'confirmed' } });
    const page = await openActor(world.actors.truck, `/parking-pass?booking=success&payment_intent=${intent}&truckId=${world.truck.id}&date=${day}&hostId=qa-retained-host&source=scout`);
    await expect(page.getByRole('heading', { name: 'Your booking is confirmed', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View My Schedule', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'My Schedule', exact: true })).toHaveAttribute('data-state', 'active');
    await expect(page.getByText(hostName, { exact: true }).last()).toBeVisible();
    const destination = new URL(page.url());
    assert.equal(destination.searchParams.get('truckId'), world.truck.id);
    assert.equal(destination.searchParams.get('date'), day);
    assert.equal(destination.searchParams.get('source'), 'scout');
    assert.equal(destination.searchParams.has('payment_intent'), false);
    await expect(page.getByText('QA ONLY pending not reserved', { exact: true })).toHaveCount(0);
    await expect(page.getByText('QA ONLY credited not reserved', { exact: true })).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: 'My Schedule', exact: true })).toHaveAttribute('data-state', 'active');
    await expect(page.getByText(hostName, { exact: true }).last()).toBeVisible();
    assert.ok(world.requests.filter((r) => r.path === scheduleEndpoint).length >= 2);
    noTransactionWrites(world);
  });
  await scenario('Parking Pass truck access retry retains the booking and does not invent confirmation', async ({ world, openActor }) => {
    const intent = `pi_qa_${world.runId}_access`, endpoint = `/api/bookings/payment-intent/${intent}`;
    world.faults.set('/api/restaurants/my-restaurants', { status: 503, body: { message: 'QA unavailable' } });
    const page = await openActor(world.actors.truck, `/parking-pass?booking=success&payment_intent=${intent}&truckId=${world.truck.id}`);
    await expect(page.getByRole('heading', { name: 'Truck access could not be loaded', exact: true })).toBeVisible();
    assert.equal(world.requests.filter((r) => r.path === endpoint).length, 0);
    world.faults.set(endpoint, { status: 200, body: { status: 'pending' } });
    await page.getByRole('button', { name: 'Retry truck access', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Booking confirmation pending', exact: true })).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get('payment_intent'), intent);
    noTransactionWrites(world);
  });
};
