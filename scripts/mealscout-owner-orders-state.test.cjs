/** Actual owner/kitchen workspace with deterministic hooks, query and socket
 * fixtures. Financial helpers remain real. Not React/Query/socket/backend E2E.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const file = process.env.OWNER_ORDERS_SOURCE || path.join(root, 'client/src/components/owner-orders-workspace.tsx');
const source = fs.readFileSync(file, 'utf8');
assert.equal(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true).parseDiagnostics.length, 0);
const compile = code => ts.transpileModule(code, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX}}).outputText;
const finance = {exports: {}};
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'shared/pickupOrderFinancialTruth.ts'), 'utf8')), {module: finance, exports: finance.exports});
const responseReader = {exports: {}};
vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'client/src/lib/owner-orders-response.ts'), 'utf8')), {module: responseReader, exports: responseReader.exports, Response});
const compiled = compile(source.replaceAll('import.meta.env.DEV', 'false'));
const order = (id = 'order-a', restaurantId = 'a', status = 'confirmed', extras = {}) => ({
  id, restaurantId, status, customerName: `Customer ${id}`, orderType: 'pickup', paymentMethod: 'card',
  payoutStatus: 'transferred', subtotalCents: 1200, totalCents: 1300, platformFeeCents: 100, feePaidByBusiness: false,
  createdAt: '2026-09-16T12:00:00Z', prepTimeMinutes: 10,
  items: [{id: `item-${id}`, itemName: `Meal ${id}`, quantity: 1, lineTotalCents: 1200, specialInstructions: 'No onions'}], ...extras,
});
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []; }
function text(tree) { return Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : tree && typeof tree === 'object' ? text(tree.props?.children) : ''; }
function harness({view = 'kitchen', authenticated = true, businessError = null, businesses = [{id: 'a', name: 'Business A'}, {id: 'b', name: 'Business B'}], initialOrders = [order()]} = {}) {
  const frames = new Map(), effects = [], sockets = [], patches = [], invalidations = [], toasts = [], refetches = [], pendingTasks = [];
  const queueData = new Map([['a', {orders: initialOrders}], ['b', {orders: [order('order-b', 'b')]}]]);
  const historyData = new Map([...queueData].map(([id, data]) => [id, {pages: [data]}]));
  let activeFrame, cursor = 0, dirty = true, tree, search = 'restaurantId=a', disposed = false;
  let user = authenticated ? {id: 'user-a', userType: 'restaurant_owner', restaurantId: 'a'} : null;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const hooks = {
    useState(initial) { const f = activeFrame, i = cursor++; if (!(i in f.slots)) f.slots[i] = {value: typeof initial === 'function' ? initial() : initial};
      return [f.slots[i].value, next => { if (f.alive) {f.slots[i].value = typeof next === 'function' ? next(f.slots[i].value) : next; dirty = true;} }]; },
    useRef(initial) { const f = activeFrame, i = cursor++; return f.slots[i] ||= {current: initial}; },
    useMemo(fn, deps) { const f = activeFrame, i = cursor++, prev = f.slots[i]; if (!prev || changed(prev.deps, deps)) f.slots[i] = {deps, value: fn()}; return f.slots[i].value; },
    useEffect(fn, deps) { const f = activeFrame, i = cursor++, prev = f.slots[i]; if (!prev || changed(prev.deps, deps)) {f.slots[i] = {deps, fn, effect: true, cleanup: prev?.cleanup}; effects.push(() => {if (f.alive) {f.slots[i].cleanup?.(); f.slots[i].cleanup = fn();}});} },
  };
  const jsx = (type, props, key) => ({type, props: props || {}, key});
  const query = options => {
    const key = options.queryKey, business = key[0] === '/api/restaurants/my-restaurants';
    return {data: business ? businesses : queueData.get(key[1]), isLoading: false, isFetching: false,
      error: business ? businessError : null, refetch: () => {refetches.push(key); return Promise.resolve();}};
  };
  const useMutation = options => {
    const state = hooks.useRef({pending: false}); state.current.options = options;
    return {isPending: state.current.pending, mutate(variables) {
      state.current.pending = true; dirty = true;
      const task = Promise.resolve().then(() => options.mutationFn(variables))
        .then(value => state.current.options.onSuccess?.(value, variables))
        .catch(error => state.current.options.onError?.(error, variables))
        .finally(() => {state.current.pending = false; state.current.options.onSettled?.(); dirty = true;});
      pendingTasks.push(task);
    }};
  };
  const imports = {
    react: hooks, 'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'Fragment'},
    '@tanstack/react-query': {useQuery: query, useInfiniteQuery: options => ({data: historyData.get(options.queryKey[1]), isLoading: false, isFetching: false, isPending: false, hasNextPage: true, isFetchingNextPage: false, fetchNextPage: () => {refetches.push(['next', options.queryKey[1]]);}, refetch: () => {refetches.push(options.queryKey); return Promise.resolve();}, error: null}), useMutation},
    'date-fns': {format: () => '12:00 PM', formatDistanceToNow: () => 'a moment ago'},
    wouter: {Link: 'Link', useSearch: () => search, useLocation: () => [`/${view}?${search}`, next => {search = next.split('?')[1] || ''; dirty = true;}]},
    'socket.io-client': {io: () => {const socket = {handlers: {}, emissions: [], on(name, fn) {this.handlers[name] = fn;}, emit(name, payload) {this.emissions.push({name, payload});}, disconnect() {this.disconnected = true; this.handlers.disconnect?.();}}; sockets.push(socket); return socket;}},
    '@shared/pickupOrderFinancialTruth': finance.exports,
    '@/lib/owner-orders-response': responseReader.exports,
    '@/components/business-workspace-shell': {__esModule: true, default: 'WorkspaceShell'},
    '@/components/ui/badge': {Badge: 'Badge'}, '@/components/ui/button': {Button: 'Button'}, '@/components/ui/card': {Card: 'Card', CardContent: 'CardContent'},
    '@/components/ui/alert-dialog': Object.fromEntries(['AlertDialog', 'AlertDialogAction', 'AlertDialogCancel', 'AlertDialogContent', 'AlertDialogDescription', 'AlertDialogFooter', 'AlertDialogHeader', 'AlertDialogTitle'].map(n => [n, n])),
    '@/hooks/useAuth': {useAuth: () => ({user})}, '@/hooks/use-toast': {useToast: () => ({toast: value => toasts.push(value)})},
    '@/lib/api': {API_BASE_URL: ''}, '@/lib/public-profile-path': {buildPublicProfilePath: ({id}) => `/p/restaurant/${id}`},
    '@/lib/queryClient': {queryClient: {invalidateQueries: async ({queryKey}) => {invalidations.push(queryKey);}}, apiRequest: (method, url, body) => new Promise((resolve, reject) => patches.push({method, url, body, resolve, reject}))},
    'lucide-react': Object.fromEntries(['AlertCircle','Bell','CheckCircle2','ChefHat','Clock3','History','Loader2','PackageCheck','Receipt','RefreshCw','ShoppingBag','Wifi','WifiOff','XCircle'].map(n => [n,n])),
  };
  const mod = {exports: {}};
  vm.runInNewContext(compiled, {module: mod, exports: mod.exports, require: name => {assert.ok(name in imports, `Unstubbed module ${name}`); return imports[name];}, URLSearchParams, console, fetch: () => {throw new Error('Unexpected direct network call');}});
  function destroy(frame) {frame.alive = false; frame.slots.forEach(s => {if (s?.effect) s.cleanup?.();});}
  function walk(node, address, used) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((child, i) => walk(child, `${address}/${i}`, used));
    if (typeof node.type !== 'function') return {...node, props: {...node.props, children: node.type === 'AlertDialog' && !node.props.open ? undefined : walk(node.props.children, `${address}/children`, used)}};
    const key = address + ':' + (node.key ?? ''); let frame = frames.get(key); if (!frame) {frame = {slots: [], alive: true}; frames.set(key, frame);}
    used.add(key); activeFrame = frame; cursor = 0; return walk(node.type(node.props), key + '/render', used);
  }
  function render() {if (disposed) return; dirty = false; const used = new Set(); tree = walk(jsx(mod.exports.default, {view}), 'root', used);
    for (const [key, frame] of frames) if (!used.has(key)) {destroy(frame); frames.delete(key);} }
  async function flush() {for (let i = 0; i < 40; i++) {if (dirty) render(); while (effects.length) effects.shift()(); await Promise.resolve();} if (dirty) render();}
  const find = predicate => {const n = nodes(tree).find(predicate); assert.ok(n, 'Expected element'); return n;};
  render();
  return {patches, invalidations, toasts, refetches, sockets, flush, text: () => text(tree), nodes: () => nodes(tree), find,
    button: label => find(n => n.type === 'Button' && text(n).trim() === label),
    advance: id => find(n => n.props['data-testid'] === `button-advance-order-${id}`),
    async updateQuery(id, orders) {queueData.set(id, {orders}); historyData.set(id, {pages: [{orders}]}); dirty = true; await flush();},
    async emit(value, socket = sockets.at(-1)) {socket.handlers['kitchen:order_update']?.({order: value}); await flush();},
    async navigate(id, nextView = view) {search = `restaurantId=${id}`; view = nextView; render(); await flush();},
    async logout() {user = null; render(); await flush();},
    async settle(index, value) {patches[index].resolve({json: async () => value}); await flush();},
    async fail(index) {patches[index].reject(new Error('network interrupted')); await flush();},
    async setBusinessError(error) {businessError = error; dirty = true; await flush();},
    unmount() {disposed = true; for (const f of frames.values()) destroy(f);},
    assertNoCrossBusiness() {assert.ok(!text(tree).includes('Customer foreign'));},
  };
}
async function run() {
  const results = [];
  async function test(name, fn) {try {await fn(); results.push({name,status:'pass'});} catch(error) {results.push({name,status:'fail',error:error.message});}}
  const ready = async options => {const h = harness(options); await h.flush(); return h;};
  await test('business lookup failure is retryable rather than a new-business prompt', async () => {
    const h = await ready({businesses: [], businessError: new Error('offline')}); assert.match(h.text(), /Business access could not be loaded/); assert.doesNotMatch(h.text(), /Orders need a business/);
    h.button('Retry business access').props.onClick(); assert.equal(h.refetches.length,1); assert.equal(h.patches.length,0);
  });
  await test('confirmed empty business list retains claim path', async () => {
    const h = await ready({businesses: []}); assert.match(h.text(), /Orders need a business/); assert.ok(h.nodes().some(n=>n.props.href==='/claim-business'));
  });
  await test('signed-out workspace cannot expose cached customer orders', async () => {
    const h = await ready({authenticated:false}); assert.match(h.text(),/Sign in to manage orders/); assert.doesNotMatch(h.text(),/Customer order-a/); assert.equal(h.sockets.length,0);
  });
  await test('foreign socket update is ignored, including invalidation', async () => {
    const h = await ready(); await h.emit(order('foreign','b')); h.assertNoCrossBusiness(); assert.equal(h.invalidations.length,0);
  });
  await test('missing business identity on socket update is ignored', async () => {
    const h = await ready(); const incoming = order('foreign'); delete incoming.restaurantId; await h.emit(incoming); h.assertNoCrossBusiness();
  });
  for (const view of ['orders','kitchen']) await test(`${view} filters mixed business rows from read data`, async () => {
    const h=await ready({view,initialOrders:[order(),order('foreign','b')]}); h.assertNoCrossBusiness(); assert.match(h.text(),/Customer order-a/);
  });
  await test('switching businesses cannot display old queue under new heading', async () => {
    const h=await ready(); await h.navigate('b'); assert.match(h.text(),/Customer order-b/); assert.doesNotMatch(h.text(),/Customer order-a/);
  });
  await test('stale socket callback cannot reinsert an order after business switch', async () => {
    const h=await ready(); const socket=h.sockets[0]; await h.navigate('b'); const before=h.invalidations.length;
    await h.emit(order('foreign','a'),socket); h.assertNoCrossBusiness(); assert.equal(h.invalidations.length,before);
  });
  await test('reconnection requests fresh canonical queue', async () => {
    const h=await ready(); h.sockets[0].handlers.connect(); await h.flush(); assert.ok(h.invalidations.some(k=>k[0]==='/api/owner/kitchen-queue'&&k[1]==='a'));
  });
  for (const status of ['pending','payment_disputed']) await test(`${status} is visible in payment/review without preparation action`, async () => {
    const h=await ready({initialOrders:[order('order-a','a',status)]}); assert.match(h.text(),/Payment \/ review/); assert.match(h.text(),/Customer order-a/);
    assert.ok(!h.nodes().some(n=>n.props['data-testid']==='button-advance-order-order-a'));
  });
  await test('same-tick preparation clicks send one unchanged status payload', async () => {
    const h=await ready(); const action=h.advance('order-a').props.onClick; action(); action(); await h.flush(); assert.equal(h.patches.length,1);
    assert.equal(h.patches[0].method,'PATCH'); assert.equal(h.patches[0].url,'/api/owner/orders/order-a/status'); assert.deepEqual({...h.patches[0].body},{status:'preparing',prepTimeMinutes:10});
  });
  await test('failed update unlocks controls and tells operator to verify before retry', async () => {
    const h=await ready(); h.advance('order-a').props.onClick(); await h.flush(); await h.fail(0); assert.equal(h.advance('order-a').props.disabled,false); assert.match(h.toasts[0].description,/Refresh orders before retrying/);
  });
  await test('late mutation invalidates origin business and does not toast in new session', async () => {
    const h=await ready(); h.advance('order-a').props.onClick(); await h.flush(); await h.navigate('b'); await h.settle(0,order('order-a','a','preparing'));
    assert.equal(h.toasts.length,0); assert.ok(h.invalidations.every(k=>k[1]==='a')); assert.doesNotMatch(h.text(),/Customer order-a/);
  });
  for (const responseBusiness of ['a','b']) await test(`unexpected mutation identity in ${responseBusiness} is not displayed or reported as success`, async () => {
    const h=await ready(); h.advance('order-a').props.onClick(); await h.flush();
    await h.settle(0,order('foreign',responseBusiness,'preparing')); h.assertNoCrossBusiness(); assert.equal(h.toasts.length,0);
    assert.ok(h.invalidations.every(k=>k[1]==='a'));
  });
  await test('old advance callback cannot mutate after leaving its business', async () => {
    const h=await ready(); const click=h.advance('order-a').props.onClick;
    await h.navigate('b'); click(); await h.flush(); assert.equal(h.patches.length,0);
  });
  await test('unmounted workspace cannot submit through a retained callback', async () => {
    const h=await ready(); const click=h.advance('order-a').props.onClick;
    h.unmount(); click(); await h.flush(); assert.equal(h.patches.length,0);
  });
  await test('cancellation confirmation cannot follow the operator to another business', async () => {
    const h=await ready(); h.button('Cancel order').props.onClick(); await h.flush(); assert.equal(h.find(n=>n.type==='AlertDialog').props.open,true);
    await h.navigate('b'); assert.equal(h.find(n=>n.type==='AlertDialog').props.open,false); assert.equal(h.patches.length,0);
  });
  await test('cancel confirmation uses current order state and closes when it is no longer cancellable', async () => {
    const h=await ready(); h.button('Cancel order').props.onClick(); await h.flush(); await h.emit(order('order-a','a','ready'));
    assert.equal(h.find(n=>n.type==='AlertDialog').props.open,false); assert.equal(h.patches.length,0);
  });
  await test('repeated cancellation confirmation sends one cancelled PATCH', async () => {
    const h=await ready(); h.button('Cancel order').props.onClick(); await h.flush(); const click=h.find(n=>n.type==='AlertDialogAction').props.onClick;
    click(); click(); await h.flush(); assert.equal(h.patches.length,1); assert.deepEqual({...h.patches[0].body},{status:'cancelled'});
  });
  await test('missing merchant settlement cannot advance even through old callback', async () => {
    const h=await ready({initialOrders:[order('order-a','a','confirmed',{payoutStatus:'pending'})]}); assert.equal(h.advance('order-a').props.disabled,true);
    h.advance('order-a').props.onClick(); await h.flush(); assert.equal(h.patches.length,0);
  });
  for (const [from,to,orderType] of [['preparing','ready','pickup'],['ready','completed','pickup'],['ready','out_for_delivery','delivery'],['out_for_delivery','delivered','delivery'],['delivered','completed','delivery']]) {
    await test(`${orderType}: ${from} retains ${to} transition`, async()=>{const h=await ready({initialOrders:[order('order-a','a',from,{orderType})]}); h.advance('order-a').props.onClick(); await h.flush(); assert.equal(h.patches[0].body.status,to);});
  }
  await test('business lookup error with cached rows hides details and disconnects socket', async()=>{const h=await ready(); await h.setBusinessError(new Error('forbidden')); assert.doesNotMatch(h.text(),/Customer order-a/); assert.equal(h.sockets[0].disconnected,true);});
  await test('logout hides cache and ignores old socket callback',async()=>{const h=await ready(); const old=h.sockets[0]; await h.logout(); await h.emit(order('foreign','a'),old); assert.match(h.text(),/Sign in to manage orders/); h.assertNoCrossBusiness();});
  await test('history, menu setup and filter controls remain present',async()=>{const h=await ready({view:'orders'}); assert.ok(h.nodes().some(n=>n.type==='WorkspaceShell')); assert.ok(h.button('Load older orders')); assert.ok(h.nodes().some(n=>n.props['aria-pressed']===true)); assert.match(h.text(),/No onions/);});
  console.log(JSON.stringify({scope:'deterministic hooks, Query/socket/API fixtures; real financial helpers; no live transactions',results},null,2));
  assert.equal(results.filter(r=>r.status==='fail').length,0,`${results.length} owner/kitchen cases; inspect failures above`);
}
run().catch(error=>{console.error(error);process.exitCode=1;});
