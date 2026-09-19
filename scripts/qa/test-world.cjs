/** Disposable, synthetic API state for FULL FRONTEND browser journeys.
 * This is deliberately NOT the production auth, booking, payment or database
 * implementation. No database URL, provider key, mail or external API is used.
 */
const { randomUUID } = require('node:crypto');
const clone = (value) => JSON.parse(JSON.stringify(value));
const ok = (body, status = 200) => ({ status, body: clone(body) });
const denied = () => ok({ message: 'QA actor has no access' }, 403);

function createTestWorld() {
  const runId = randomUUID().slice(0, 8);
  const users = new Map(), businesses = new Map(), orders = new Map(), receipts = new Map();
  const requests = [], unexpected = [], faults = new Map();
  const makeActor = (name, userType) => {
    const id = `qa-${runId}-${name}`;
    const actor = { id, email: `${id}@example.invalid`, firstName: 'QA ONLY', lastName: name,
      userType, roles: [], emailVerified: true, businessOnboardingRequired: false,
      continuationPath: null, isTestFixture: true };
    users.set(id, actor);
    return actor;
  };
  const actors = {
    customer: makeActor('customer', 'customer'),
    otherCustomer: makeActor('other-customer', 'customer'),
    owner: makeActor('restaurant-owner', 'restaurant_owner'),
    otherOwner: makeActor('other-owner', 'restaurant_owner'),
    truck: makeActor('truck-owner', 'food_truck'),
    host: makeActor('host', 'customer'),
    supplier: makeActor('supplier', 'supplier'),
    coordinator: makeActor('coordinator', 'event_coordinator'),
  };
  const makeBusiness = (name, owner, isFoodTruck = false) => {
    const id = `qa-${runId}-${name}`;
    const business = { id, ownerId: owner.id, name: `QA ONLY ${name}`, isFoodTruck,
      businessType: isFoodTruck ? 'food_truck' : 'restaurant', isActive: true,
      isVerified: true, insuranceVerified: true, insuranceExpiresAt: '2099-12-31T00:00:00Z',
      city: 'Test City', state: 'LA', address: 'QA fixture pickup location',
      phone: null, isTestFixture: true, noIndex: true };
    businesses.set(id, business); owner.restaurantId = id; return business;
  };
  const restaurant = makeBusiness('restaurant-a', actors.owner);
  const otherRestaurant = makeBusiness('restaurant-b', actors.otherOwner);
  const truck = makeBusiness('truck', actors.truck, true);
  const dishFor = (id) => ({ id: `${id}-dish`, name: 'QA test tacos', description: 'Synthetic test item; not for sale',
    priceCents: 1200, itemType: 'food', imageUrl: null, isAvailable: true, calories: null,
    dietaryTags: [], allergens: [], variants: [], modifiers: [] });
  const menuFor = (id) => {
    const business = businesses.get(id);
    if (!business) return null;
    return { restaurantName: business.name, restaurantCity: business.city, isFoodTruck: business.isFoodTruck,
      orderingEnabled: true, readiness: { orderingEnabled: true, blockingReasons: [], checks: [],
        restaurantName: business.name, pickupAddressLabel: business.address, paymentMethods: { card: true, cash: false } },
      menus: [{ id: `${id}-menu`, name: 'QA Lunch', serviceType: 'lunch', isActive: true, acceptsCash: false,
        hidePlatformFee: false, pricesIncludeTax: true, orderingEnabled: true, orderingBlockingReasons: [],
        paymentMethods: { card: true, cash: false },
        categories: [{ id: `${id}-category`, name: 'QA food', description: null, items: [dishFor(id)] }] }] };
  };
  const owned = (actor, id) => Boolean(actor && businesses.get(id)?.ownerId === actor.id);
  function handle(identity, url, method = 'GET', body = {}, headers = {}) {
    const parsed = new URL(url, 'http://127.0.0.1');
    const path = decodeURIComponent(parsed.pathname);
    const actor = users.get(identity.actorId);
    requests.push({ actor: actor?.id || 'guest', method, path });
    if (faults.has(path)) {
      const fault = faults.get(path); faults.delete(path); return fault;
    }
    if (path === '/api/auth/user') return actor ? ok(actor) : ok({ message: 'Unauthorized' }, 401);
    if (['/api/auth/login', '/api/login'].includes(path) && method === 'POST') {
      const match = [...users.values()].find((user) => user.email === body.email);
      if (!match || body.password !== `QA-${runId}-only`) return ok({ message: 'Invalid test credentials' }, 401);
      identity.actorId = match.id; return ok({ ...match, user: match, success: true });
    }
    if (['/api/auth/logout', '/api/logout'].includes(path)) { identity.actorId = null; return ok({ success: true }); }
    if (path === '/api/restaurants/my-restaurants') return actor ? ok([...businesses.values()].filter((b) => owned(actor, b.id))) : denied();
    if (path === '/api/business-access/me') {
      const list = [...businesses.values()].filter((b) => owned(actor, b.id));
      const permissions = { manageDeals: !!list.length, manageParkingPass: !!list.length, viewAnalytics: !!list.length, manageProfile: !!list.length };
      return ok({ hasAnyAccess: !!list.length, permissions, restaurants: list.map((b) => ({ ...b, isOwner: true, permissions })) });
    }
    if (path.startsWith('/api/menus/') && method === 'GET') {
      const menu = menuFor(path.slice('/api/menus/'.length));
      return menu ? ok(menu) : ok({ message: 'Menu not found' }, 404);
    }
    if (path === '/api/pickup-orders' && method === 'POST') {
      const existing = receipts.get(body.checkoutRequestId);
      if (existing) {
        if (existing.fingerprint !== JSON.stringify(body)) return ok({ code: 'CHECKOUT_REQUEST_MISMATCH' }, 409);
        return ok(existing.response);
      }
      if (!businesses.has(body.restaurantId) || body.menuId !== `${body.restaurantId}-menu` || !body.customerName || !body.customerAccessToken) {
        return ok({ message: 'Invalid synthetic checkout' }, 400);
      }
      const id = `qa-${runId}-order-${orders.size + 1}`;
      const subtotalCents = body.items.reduce((sum, item) => sum + 1200 * item.quantity, 0);
      const order = { id, restaurantId: body.restaurantId, customerId: actor?.id ?? null,
        status: 'pending', customerName: body.customerName, customerEmail: body.customerEmail ?? null,
        customerPhone: body.customerPhone ?? null, orderType: 'pickup', paymentMethod: 'card',
        payoutStatus: 'pending', subtotalCents, mealscoutFeeCents: 100, processingFeeCents: 69,
        platformFeeCents: 169, totalCents: subtotalCents + 169, feePaidByBusiness: false, pricesIncludeTax: true,
        createdAt: new Date().toISOString(), confirmedAt: null, readyAt: null, completedAt: null,
        scheduledFor: null, prepTimeMinutes: null, merchantNameSnapshot: businesses.get(body.restaurantId).name,
        pickupAddressSnapshot: 'QA fixture pickup location', merchantAcknowledgementDueAt: null,
        items: body.items.map((item, index) => ({ id: `${id}-item-${index}`, menuItemId: item.menuItemId,
          itemName: 'QA test tacos', quantity: item.quantity, variantLabel: null, lineTotalCents: 1200 * item.quantity })) };
      orders.set(id, { order, token: body.customerAccessToken });
      const response = { order, customerAccessToken: body.customerAccessToken, clientSecret: `pi_${id}_secret_fixture` };
      receipts.set(body.checkoutRequestId, { fingerprint: JSON.stringify(body), response });
      return ok(response);
    }
    const ownerRead = path.match(/^\/api\/owner\/(?:orders|kitchen-queue)\/([^/]+)$/);
    if (ownerRead && method === 'GET') {
      if (!owned(actor, ownerRead[1])) return denied();
      return ok({ orders: [...orders.values()].map((entry) => entry.order).filter((o) => o.restaurantId === ownerRead[1]), page: 1, hasMore: false, total: orders.size });
    }
    const ownerWrite = path.match(/^\/api\/owner\/orders\/([^/]+)\/status$/);
    if (ownerWrite && method === 'PATCH') {
      const entry = orders.get(ownerWrite[1]); if (!entry || !owned(actor, entry.order.restaurantId)) return denied();
      const next = { confirmed: 'preparing', preparing: 'ready', ready: 'completed' }[entry.order.status];
      if (body.status !== next || entry.order.payoutStatus !== 'transferred') return ok({ message: 'Synthetic transition blocked' }, 409);
      Object.assign(entry.order, { status: body.status, prepTimeMinutes: body.prepTimeMinutes ?? entry.order.prepTimeMinutes });
      return ok({ order: entry.order });
    }
    const customerRead = path.match(/^\/api\/pickup-orders\/([^/]+)$/);
    if (customerRead && method === 'GET') {
      const entry = orders.get(customerRead[1]); if (!entry) return ok({ message: 'Order not found' }, 404);
      const token = headers['x-order-access-token'];
      if (actor?.id !== entry.order.customerId && token !== entry.token && !owned(actor, entry.order.restaurantId)) return denied();
      return ok({ order: entry.order, items: entry.order.items });
    }
    if (path === '/api/payments/stripe-config') return ok({ publishableKey: 'pk_test_qa_fixture', paymentsReady: true });
    if (path === '/api/hosts') return ok(actor?.id === actors.host.id ? [{ id: `qa-${runId}-host`, userId: actor.id, businessName: 'QA ONLY host' }] : []);
    if (path === '/api/payout/balance') return ok({ balance: 0 });
    if (path === '/api/subscription/status') return ok({ isSubscribed: true, status: 'active', tier: 'premium' });
    const emptyCollections = ['/api/notifications', '/api/notifications/unread', '/api/favorites', '/api/parking-pass', '/api/parking-pass/host-ids', '/api/suppliers', '/api/events', '/api/deals'];
    if (emptyCollections.includes(path) && method === 'GET') return ok([]);
    if (method === 'GET') { unexpected.push({ method, path }); return ok({}); }
    // Unknown writes NEVER receive a fake success or escape to the live API.
    unexpected.push({ method, path }); return ok({ code: 'QA_UNHANDLED_WRITE', message: `Unhandled QA write: ${method} ${path}` }, 501);
  }
  function settle(id, status = 'confirmed') {
    const entry = orders.get(id); if (!entry) throw new Error('Unknown QA order');
    entry.order.status = status;
    entry.order.payoutStatus = status === 'confirmed' ? 'transferred' : 'pending';
    if (status === 'confirmed') entry.order.confirmedAt = new Date().toISOString();
  }
  return { runId, actors, restaurant, otherRestaurant, truck, users, businesses, orders, receipts,
    requests, unexpected, faults, handle, settle, menuFor, password: `QA-${runId}-only` };
}
module.exports = { createTestWorld };
