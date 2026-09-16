/** Pure return-state and URL policy checks. Browser execution is a separate stage. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const filename = 'client/src/components/parking-pass-booking-return.tsx';
const source = fs.readFileSync(path.join(root, filename), 'utf8');
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
assert.equal(ast.parseDiagnostics.length, 0, 'The complete return component must parse');
const imports = new Set(['react', 'react/jsx-runtime', 'wouter', '@/components/ui/button', '@/components/ui/card', '@/hooks/useAuth', '@/lib/api']);
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { module: mod, exports: mod.exports, URLSearchParams,
  require(name) { assert.ok(imports.has(name), `Unexpected dependency ${name}`); return {}; } });
const { bookingReturnOutcome, parkingReturnQuery, parkingScheduleHref, parkingLoginHref } = mod.exports;
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS parking return policy: ' + name); }
for (const status of ['confirmed', 'credited', 'pending']) {
  test('recognizes only recorded ' + status, () => assert.equal(bookingReturnOutcome({ status }), status));
}
for (const payload of [null, undefined, {}, { status: 'succeeded' }, { status: 'paid' }, { booking: 'success' }, { status: 200 }, { status: 'CONFIRMED' }, 'confirmed']) {
  test('does not invent receipt for ' + JSON.stringify(payload), () => assert.equal(bookingReturnOutcome(payload), 'unknown'));
}
test('strips all client-secret values without losing the retry reference', () => {
  const params = new URLSearchParams(parkingReturnQuery('?booking=success&payment_intent=pi_test&payment_intent_client_secret=first&payment_intent_client_secret=second&q=Test+City&ref=qa'));
  assert.equal(params.has('payment_intent_client_secret'), false);
  assert.equal(params.get('payment_intent'), 'pi_test'); assert.equal(params.get('booking'), 'success');
  assert.equal(params.get('q'), 'Test City'); assert.equal(params.get('ref'), 'qa');
});
test('schedule action retains location and attribution, not payment secrets', () => {
  const href = parkingScheduleHref('booking=success&payment_intent=pi_test&payment_intent_client_secret=private&setup=host&date=2026-09-18&ref=qa&hostId=host&redirect_status=succeeded', 'truck-2');
  const url = new URL(href, 'http://localhost');
  assert.equal(url.pathname, '/parking-pass'); assert.equal(url.searchParams.get('tab'), 'schedule');
  assert.equal(url.searchParams.get('truckId'), 'truck-2'); assert.equal(url.searchParams.get('hostId'), 'host');
  assert.equal(url.searchParams.get('date'), '2026-09-18'); assert.equal(url.searchParams.get('ref'), 'qa');
  for (const key of ['booking', 'payment_intent', 'payment_intent_client_secret', 'setup', 'redirect_status']) assert.equal(url.searchParams.has(key), false);
});
for (const search of ['', '?booking=success&payment_intent=pi_qa&truckId=truck-qa&hostId=host-qa&date=2026-09-18&ref=qa', '?booking=success&payment_intent=pi_qa&payment_intent_client_secret=first&payment_intent_client_secret=second&redirect=https%3A%2F%2Fexample.invalid']) {
  test('login retains a same-origin booking reference without client secrets: ' + search, () => {
    const login = new URL(parkingLoginHref(search), 'http://localhost');
    assert.equal(login.pathname, '/login'); assert.equal(login.origin, 'http://localhost');
    const returnTo = new URL(login.searchParams.get('redirect'), 'http://localhost');
    assert.equal(returnTo.origin, 'http://localhost'); assert.equal(returnTo.pathname, '/parking-pass');
    const expected = new URLSearchParams(parkingReturnQuery(search));
    for (const [key, value] of expected) assert.equal(returnTo.searchParams.get(key), value);
    assert.equal(returnTo.searchParams.has('payment_intent_client_secret'), false);
  });
}
test('the reconciliation component has only read requests', () => {
  let reads = 0;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'fetch') {
      reads++;
      const options = node.arguments[1]; assert.ok(ts.isObjectLiteralExpression(options));
      for (const field of options.properties) {
        const name = field.name?.getText(ast);
        assert.notEqual(name, 'body');
        if (name === 'method') assert.equal(field.initializer.text, 'GET');
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(reads, 2);
});
test('ordinary Parking Pass workspace remains the normal route destination', () => {
  const entry = fs.readFileSync(path.join(root, 'client/src/pages/parking-pass.tsx'), 'utf8');
  assert.equal(ts.createSourceFile('parking-pass.tsx', entry, ts.ScriptTarget.Latest, true).parseDiagnostics.length, 0);
  assert.ok(entry.includes('import ParkingPassContent from "./parking-pass-content"'));
  assert.ok(entry.includes('return <ParkingPassContent />'));
});
console.log(`PASS ${count} Parking Pass return policy checks (pure functions/source contracts, not browser or backend proof).`);
