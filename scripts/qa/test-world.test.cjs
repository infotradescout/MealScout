const assert = require('node:assert/strict');
const { createTestWorld } = require('./test-world.cjs');
let cases = 0;
function check(name, fn) { fn(); cases++; console.log('PASS fixture safety: ' + name); }
const w = createTestWorld();
const identity = (actor) => ({ actorId: actor?.id || null });
check('unique disposable world and eight labeled test actors', () => {
  assert.notEqual(w.runId, createTestWorld().runId);
  assert.equal(w.users.size, 8);
  for (const user of w.users.values()) assert.ok(user.email.endsWith('@example.invalid') && user.isTestFixture);
});
check('guests have no business access', () => {
  assert.equal(w.handle(identity(), '/api/restaurants/my-restaurants').status, 403);
});
check('business identities are isolated', () => {
  const own = w.handle(identity(w.actors.owner), '/api/restaurants/my-restaurants').body;
  assert.equal(own.length, 1); assert.equal(own[0].id, w.restaurant.id);
});
check('unknown writes fail closed rather than pretending success', () => {
  assert.equal(w.handle(identity(w.actors.owner), '/api/unmodeled-charge', 'POST').status, 501);
});
check('test sign-in rejects bad credentials', () => {
  assert.equal(w.handle(identity(), '/api/auth/login', 'POST', { email: w.actors.customer.email, password: 'wrong' }).status, 401);
});
check('test sign-in and sign-out change only their browser identity', () => {
  const session = identity();
  assert.equal(w.handle(session, '/api/auth/login', 'POST', { email: w.actors.customer.email, password: w.password }).status, 200);
  assert.equal(w.handle(session, '/api/auth/user').body.id, w.actors.customer.id);
  w.handle(session, '/api/auth/logout', 'POST'); assert.equal(session.actorId, null);
});
const payload = { restaurantId: w.restaurant.id, menuId: `${w.restaurant.id}-menu`, customerName: 'QA Customer',
  customerAccessToken: 'qa-only-token', checkoutRequestId: 'qa-only-request', items: [{ menuItemId: `${w.restaurant.id}-dish`, quantity: 1 }] };
const first = w.handle(identity(w.actors.customer), '/api/pickup-orders', 'POST', payload).body;
check('same request replays one synthetic order', () => {
  const next = w.handle(identity(w.actors.customer), '/api/pickup-orders', 'POST', payload).body;
  assert.equal(first.order.id, next.order.id); assert.equal(w.orders.size, 1);
});
check('changed request identity is rejected', () => {
  assert.equal(w.handle(identity(w.actors.customer), '/api/pickup-orders', 'POST', { ...payload, customerName: 'Changed' }).status, 409);
});
check('other customer and other owner cannot read or advance an order', () => {
  assert.equal(w.handle(identity(w.actors.otherCustomer), `/api/pickup-orders/${first.order.id}`).status, 403);
  assert.equal(w.handle(identity(w.actors.otherOwner), `/api/owner/orders/${first.order.id}/status`, 'PATCH', { status: 'preparing' }).status, 403);
});
check('unpaid fixture cannot start preparation', () => {
  assert.equal(w.handle(identity(w.actors.owner), `/api/owner/orders/${first.order.id}/status`, 'PATCH', { status: 'preparing' }).status, 409);
});
check('synthetic settlement and owner progression reach the same customer record', () => {
  w.settle(first.order.id);
  for (const status of ['preparing', 'ready', 'completed']) {
    assert.equal(w.handle(identity(w.actors.owner), `/api/owner/orders/${first.order.id}/status`, 'PATCH', { status }).status, 200);
    assert.equal(w.handle(identity(w.actors.customer), `/api/pickup-orders/${first.order.id}`).body.order.status, status);
  }
});
check('one-shot failure can be recovered without changing records', () => {
  const url = `/api/pickup-orders/${first.order.id}`;
  w.faults.set(url, { status: 503, body: {} });
  assert.equal(w.handle(identity(w.actors.customer), url).status, 503);
  assert.equal(w.handle(identity(w.actors.customer), url).body.order.status, 'completed');
});
console.log(`PASS: ${cases} synthetic-world safety checks; not production authorization/payment tests.`);
