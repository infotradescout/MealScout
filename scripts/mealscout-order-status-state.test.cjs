/** Actual transpiled order-status code with deterministic hook, route, timer and
 * fetch fixtures. Financial helpers are real. Not React/browser/backend E2E.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const file = process.env.ORDER_STATUS_SOURCE || path.join(root, 'client/src/pages/order-confirmation.tsx');
const source = fs.readFileSync(file, 'utf8');
assert.equal(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true).parseDiagnostics.length, 0, 'Complete TSX must parse');
const compile = (code) => ts.transpileModule(code, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
}}).outputText;
const finance = {exports: {}};
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'shared/pickupOrderFinancialTruth.ts'), 'utf8')), {module: finance, exports: finance.exports});
const compiled = compile(source);
const order = (status = 'pending', extras = {}) => ({
  id: 'order-a', status, customerName: 'Fixture', orderType: 'pickup', paymentMethod: 'card',
  subtotalCents: 1200, totalCents: 1300, platformFeeCents: 100, feePaidByBusiness: false,
  merchantNameSnapshot: 'Fixture Truck A', confirmedAt: status === 'pending' ? null : '2026-09-16T12:00:00Z',
  items: [{id: 'item-a', itemName: 'Fixture tacos', quantity: 2, lineTotalCents: 1200}], ...extras,
});
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object' ? text(tree.props?.children) : '';
}
function harness({id = 'order-a', search = '', blockedStorage = false, blockedRead = false} = {}) {
  const frames = new Map(), effects = [], calls = [], timers = new Map(), intervals = new Map();
  const session = new Map([['mealscout:order-access:order-a', 'access-a'], ['mealscout:order-access:order-b', 'access-b']]);
  let activeFrame, cursor = 0, dirty = true, tree, serial = 0, disposed = false;
  const depsChanged = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const f = activeFrame, i = cursor++;
      if (!(i in f.slots)) f.slots[i] = {value: typeof initial === 'function' ? initial() : initial};
      return [f.slots[i].value, (next) => { if (f.alive) { f.slots[i].value = typeof next === 'function' ? next(f.slots[i].value) : next; dirty = true; } }];
    },
    useRef(initial) { const f = activeFrame, i = cursor++; return f.slots[i] ||= {current: initial}; },
    useCallback(fn, deps) {
      const f = activeFrame, i = cursor++, prev = f.slots[i];
      if (!prev || depsChanged(prev.deps, deps)) f.slots[i] = {value: fn, deps};
      return f.slots[i].value;
    },
    useEffect(fn, deps) {
      const f = activeFrame, i = cursor++, prev = f.slots[i];
      if (!prev || depsChanged(prev.deps, deps)) {
        f.slots[i] = {fn, deps, cleanup: prev?.cleanup, effect: true};
        effects.push(() => { if (f.alive) { f.slots[i].cleanup?.(); f.slots[i].cleanup = fn(); } });
      }
    },
  };
  const jsx = (type, props, key) => ({type, props: props || {}, key});
  const imports = {
    react: hooks, 'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'Fragment'},
    wouter: {Link: 'Link', useParams: () => ({orderId: id}), useSearch: () => search},
    '@/components/public-ordering/PublicOrderingTopBar': {PublicOrderingTopBar: 'TopBar'},
    '@/components/ui/button': {Button: 'Button'}, '@/components/ui/badge': {Badge: 'Badge'},
    '@/components/ui/card': Object.fromEntries(['Card', 'CardContent', 'CardHeader', 'CardTitle'].map(n => [n, n])),
    '@shared/pickupOrderFinancialTruth': finance.exports,
    'lucide-react': Object.fromEntries(['Loader2', 'CheckCircle', 'Clock', 'ChefHat', 'Package', 'XCircle', 'MapPin'].map(n => [n, n])),
  };
  const window = {location: {href: `https://fixture.test/order-confirmation/${id}${search ? '?' + search : ''}`}};
  Object.defineProperty(window, 'sessionStorage', {get() {
    if (blockedStorage) throw new Error('Storage is blocked');
    return {getItem(key) { if (blockedRead) throw new Error('Storage read denied'); return session.get(key) ?? null; }};
  }});
  const mod = {exports: {}};
  vm.runInNewContext(compiled, {
    module: mod, exports: mod.exports,
    require: name => { assert.ok(name in imports, `Unstubbed module: ${name}`); return imports[name]; },
    window, URL, URLSearchParams, AbortController, console,
    setTimeout: (fn, ms) => { const i = ++serial; timers.set(i, {fn, ms}); return i; },
    clearTimeout: i => timers.delete(i),
    setInterval: (fn, ms) => { const i = ++serial; intervals.set(i, {fn, ms}); return i; },
    clearInterval: i => intervals.delete(i),
    fetch: (url, options = {}) => new Promise((resolve, reject) => {
      const call = {url, options, resolve, reject}; calls.push(call);
      options.signal?.addEventListener('abort', () => reject(new Error('Aborted')), {once: true});
    }),
  });
  function destroy(frame) { frame.alive = false; frame.slots.forEach(s => { if (s?.effect) s.cleanup?.(); }); }
  function renderNode(node, address, used) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((child, i) => renderNode(child, `${address}/${i}`, used));
    if (typeof node.type !== 'function') return {...node, props: {...node.props, children: renderNode(node.props.children, `${address}/children`, used)}};
    const frameKey = address + ':' + (node.key ?? '');
    let frame = frames.get(frameKey);
    if (!frame) { frame = {slots: [], alive: true}; frames.set(frameKey, frame); }
    used.add(frameKey); activeFrame = frame; cursor = 0;
    return renderNode(node.type(node.props), frameKey + '/render', used);
  }
  function render() {
    if (disposed) return;
    dirty = false; const used = new Set();
    tree = renderNode(jsx(mod.exports.default, {}), 'root', used);
    for (const [key, frame] of frames) if (!used.has(key)) { destroy(frame); frames.delete(key); }
  }
  async function flush() {
    for (let i = 0; i < 30; i++) { if (dirty) render(); while (effects.length) effects.shift()(); await Promise.resolve(); }
    if (dirty) render();
  }
  const find = predicate => { const found = nodes(tree).find(predicate); assert.ok(found, 'Expected UI element'); return found; };
  const button = label => find(n => n.type === 'Button' && text(n).trim() === label);
  async function respond(call, body, status = 200) { call.resolve({ok: status >= 200 && status < 300, status, json: async () => body}); await flush(); }
  render();
  return {calls, session, timers, intervals, flush, respond, button, find,
    text: () => text(tree), nodes: () => nodes(tree),
    async reject(call) { call.reject(new Error('Network failure')); await flush(); },
    async click(label) { button(label).props.onClick(); await flush(); },
    async poll() { [...intervals.values()].forEach(t => t.fn()); await flush(); },
    async timeout() { [...timers.values()].forEach(t => t.fn()); await flush(); },
    async navigate(next, nextSearch = '') { id = next; search = nextSearch; window.location.href = `https://fixture.test/order-confirmation/${id}?${search}`; render(); await flush(); },
    async replayEffects() { for (const f of frames.values()) for (const s of f.slots) if (s?.effect) s.cleanup?.();
      for (const f of frames.values()) for (const s of f.slots) if (s?.effect) s.cleanup = s.fn(); await flush(); },
    unmount() { disposed = true; for (const f of frames.values()) destroy(f); },
  };
}
async function run() {
  const results = [];
  async function test(name, check) {
    try { await check(); results.push({name, status: 'pass'}); }
    catch (error) { results.push({name, status: 'fail', error: error.message}); }
  }
  async function loaded(value = order(), options) { const h = harness(options); await h.flush(); await h.respond(h.calls[0], value); return h; }
  await test('blocked sessionStorage property does not crash and keeps authenticated lookup', async () => {
    const h = harness({blockedStorage: true}); assert.match(h.text(), /Loading order status/); await h.flush();
    assert.equal(h.calls[0].options.credentials, 'include'); assert.deepEqual({...h.calls[0].options.headers}, {});
    await h.respond(h.calls[0], order('confirmed')); assert.match(h.text(), /Payment Confirmed/);
  });
  await test('blocked getItem shows recovery guidance when lookup fails', async () => {
    const h = harness({blockedRead: true}); await h.flush(); await h.respond(h.calls[0], {}, 403);
    assert.match(h.text(), /Browser storage is blocked/); assert.ok(h.button('Retry status'));
  });
  await test('query access token takes precedence without touching blocked storage', async () => {
    const h = harness({blockedStorage: true, search: 'accessToken=query-token'}); await h.flush();
    assert.equal(h.calls[0].options.headers['X-Order-Access-Token'], 'query-token');
  });
  await test('initial network failure has read-only retry and successful retry clears error', async () => {
    const h = harness(); await h.flush(); await h.reject(h.calls[0]); await h.click('Retry status');
    assert.equal(h.calls.length, 2); assert.equal(h.calls[1].options.method, undefined);
    await h.respond(h.calls[1], order('ready')); assert.match(h.text(), /Ready for Pickup!/);
    assert.doesNotMatch(h.text(), /unavailable|could not be refreshed/);
  });
  await test('repeated retry clicks produce one active read request', async () => {
    const h = harness(); await h.flush(); await h.reject(h.calls[0]);
    const click = h.button('Retry status').props.onClick; click(); click(); await h.flush();
    assert.equal(h.calls.length, 2); assert.equal(h.button('Checking order status…').props.disabled, true);
  });
  await test('transient polling failure retains visibly stale details and auto-recovers', async () => {
    const h = await loaded(order('preparing')); await h.poll(); await h.reject(h.calls[1]);
    assert.match(h.text(), /last known status/); assert.match(h.text(), /Fixture tacos/);
    await h.poll(); await h.respond(h.calls[2], order('ready'));
    assert.match(h.text(), /Ready for Pickup!/); assert.doesNotMatch(h.text(), /Status update interrupted/);
  });
  for (const status of [401, 403, 404]) await test(`${status} during refresh removes previously visible order details`, async () => {
    const h = await loaded(); await h.poll(); await h.respond(h.calls[1], {}, status);
    assert.doesNotMatch(h.text(), /Fixture tacos|Fixture Truck A/); assert.match(h.text(), /Order status unavailable/);
  });
  await test('changing order immediately resets displayed data and isolates the access token', async () => {
    const h = await loaded(order('ready')); await h.navigate('order-b');
    assert.doesNotMatch(h.text(), /Fixture Truck A|Ready for Pickup/);
    assert.equal(h.calls.at(-1).options.headers['X-Order-Access-Token'], 'access-b');
    await h.respond(h.calls.at(-1), order('preparing', {id: 'order-b', merchantNameSnapshot: 'Truck B'}));
    assert.match(h.text(), /Truck B/); assert.doesNotMatch(h.text(), /Fixture Truck A/);
  });
  await test('late response from previous order cannot replace new order', async () => {
    const h = harness(); await h.flush(); const first = h.calls[0]; await h.navigate('order-b');
    await h.respond(h.calls.at(-1), order('ready', {id: 'order-b', merchantNameSnapshot: 'Truck B'}));
    await h.respond(first, order('confirmed')); assert.match(h.text(), /Truck B/); assert.doesNotMatch(h.text(), /Fixture Truck A/);
  });
  await test('same-order access-token change resets stale authorization and re-fetches', async () => {
    const h = await loaded(); await h.navigate('order-a', 'accessToken=replacement');
    assert.doesNotMatch(h.text(), /Fixture tacos/); assert.equal(h.calls.at(-1).options.headers['X-Order-Access-Token'], 'replacement');
  });
  await test('same-order Stripe-return changes cannot retain older intent lookup', async () => {
    const h = harness({search: 'payment_intent=pi_old'}); await h.flush();
    await h.respond(h.calls[0], {}, 404); const oldFallback = h.calls[1];
    await h.navigate('order-a', 'payment_intent=pi_new'); await h.respond(h.calls.at(-1), {}, 404);
    assert.match(h.calls.at(-1).url, /by-intent\/pi_new$/);
    await h.respond(h.calls.at(-1), order('ready')); await h.respond(oldFallback, order('pending'));
    assert.match(h.text(), /Ready for Pickup!/);
  });
  await test('authenticated by-intent fallback remains available and clears earlier error', async () => {
    const h = harness({search: 'payment_intent=pi_fixture'}); await h.flush();
    await h.respond(h.calls[0], {}, 404); await h.respond(h.calls[1], {}, 404); await h.click('Retry status');
    await h.respond(h.calls[2], {}, 404); assert.equal(h.calls[3].options.credentials, 'include');
    assert.equal(h.calls[3].options.headers, undefined);
    await h.respond(h.calls[3], {order: order('confirmed'), items: order().items});
    assert.match(h.text(), /Payment Confirmed/); assert.doesNotMatch(h.text(), /Order status unavailable/);
  });
  await test('malformed successful response is recoverable, not a rendered empty order', async () => {
    const h = harness(); await h.flush(); await h.respond(h.calls[0], {}); assert.ok(h.button('Retry status'));
  });
  await test('slow request timeout releases spinner and permits retry', async () => {
    const h = harness(); await h.flush(); assert.equal([...h.timers.values()][0].ms, 15000);
    await h.timeout(); assert.match(h.text(), /timed out/); await h.click('Retry status'); assert.equal(h.calls.length, 2);
  });
  await test('poll and refresh share one in-flight lookup', async () => {
    const h = await loaded(); await h.click('Refresh'); await h.poll(); await h.poll(); assert.equal(h.calls.length, 2);
  });
  await test('effect cleanup/setup can recover without a permanently busy request', async () => {
    const h = harness(); await h.flush(); await h.replayEffects();
    await h.respond(h.calls.at(-1), order('ready')); assert.match(h.text(), /Ready for Pickup!/);
  });
  await test('unmount aborts active read and clears interval on next settled cycle', async () => {
    const h = await loaded(); await h.poll(); const call = h.calls.at(-1); h.unmount(); await h.flush();
    assert.equal(call.options.signal.aborted, true); assert.equal(h.intervals.size, 0); assert.equal(h.timers.size, 0);
  });
  for (const [status, label] of [['pending', 'Order Received'], ['confirmed', 'Payment Confirmed'], ['preparing', 'Being Prepared'], ['ready', 'Ready for Pickup!'], ['completed', 'Order Complete']]) {
    await test(`customer fulfillment stage ${status} remains truthful`, async () => {
      const h = await loaded(order(status)); assert.match(h.text(), new RegExp(label));
      assert.equal(h.intervals.size, status === 'completed' ? 0 : 1);
    });
  }
  for (const [name, extras, label, polling] of [
    ['pending refund', {status: 'cancelled', stripeRefundStatus: 'pending', stripeRefundAmountCents: 0}, 'Payment Reconciliation Open', true],
    ['failed refund', {status: 'cancelled', stripeRefundStatus: 'failed', stripeRefundAmountCents: 0}, 'Payment Reconciliation Open', true],
    ['successful full refund', {status: 'cancelled', stripeRefundStatus: 'succeeded', stripeRefundAmountCents: 1300}, 'Order Cancelled · Refunded', false],
    ['partial refund', {status: 'cancelled', stripeRefundStatus: 'succeeded', stripeRefundAmountCents: 300}, 'Payment Reconciliation Open', true],
    ['no captured charge', {status: 'cancelled', stripeRefundStatus: 'not_required_payment_not_captured'}, 'No Card Charge', false],
    ['completed but disputed', {status: 'completed', stripeDisputeStatus: 'under_review', stripeDisputeAmountCents: 1300}, 'Order Complete · Payment Under Review', true],
    ['issuer plus refund recovery', {status: 'cancelled', stripeDisputeStatus: 'lost', stripeDisputeAmountCents: 1000, stripeRefundStatus: 'succeeded', stripeRefundAmountCents: 300}, 'Customer Recovered', false],
  ]) await test(`${name} preserves financial description and polling policy`, async () => {
    const h = await loaded(order(extras.status, extras)); assert.ok(h.text().includes(label)); assert.equal(h.intervals.size > 0, polling);
  });
  await test('recovery amount changes stop polling after customer is made whole', async () => {
    const value = order('cancelled', {stripeRefundStatus: 'succeeded', stripeRefundAmountCents: 300, stripeDisputeStatus: 'lost', stripeDisputeAmountCents: 500});
    const h = await loaded(value); await h.poll(); await h.respond(h.calls[1], {...value, stripeDisputeAmountCents: 1000});
    assert.equal(h.intervals.size, 0); assert.match(h.text(), /Customer Recovered/);
  });
  await test('amounts, pickup directions, variant labels and order progress remain reachable', async () => {
    const h = await loaded(order('preparing', {pickupAddressSnapshot: '123 Fixture Way', pickupDirectionsUrlSnapshot: 'https://example.test/directions', items: [{...order().items[0], selectedVariant: {label: 'Large'}}]}));
    assert.match(h.text(), /\$13\.00/); assert.match(h.text(), /Large/);
    assert.ok(h.nodes().some(n => n.props.href === 'https://example.test/directions'));
    assert.ok(h.nodes().some(n => n.props['aria-current'] === 'step'));
    assert.ok(h.calls.every(c => !c.options.method || c.options.method === 'GET'));
  });
  console.log(JSON.stringify({scope: 'deterministic hooks and UI; actual financial helpers; no browser or live transactions', results}, null, 2));
  assert.equal(results.filter(r => r.status === 'fail').length, 0, `${results.length} status cases; see failures above`);
}
run().catch(error => {console.error(error); process.exitCode = 1;});
