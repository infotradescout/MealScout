// Executes selected real source functions, not a replacement application.
// All inputs, storage and fetch responses are local fixtures; no network access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const baseline = process.env.QA_PARKING_BASELINE_REF;
if (baseline) assert.match(baseline, /^[a-f0-9]{40}$/, 'Use an explicit baseline commit');
const read = file => baseline ? execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' }) : readFileSync(file, 'utf8');
function part(file, name) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  assert.equal(source.parseDiagnostics.length, 0, `${file} parses`);
  const found = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found.push(`const ${name} = ${node.initializer.getText(source)};`);
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found.push(node.getText(source).replace(/^export\s+/, ''));
    ts.forEachChild(node, visit);
  }
  visit(source); assert.equal(found.length, 1, `Unique source declaration: ${name}`); return found[0];
}
function evaluate(file, names, expression, fixtures = {}) {
  const code = names.map(name => part(file, name)).join('\n') + `\nglobalThis.result = (${expression});`;
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = vm.createContext({ URL, URLSearchParams, ...fixtures });
  new vm.Script(compiled).runInContext(context, { timeout: 1000 }); return context.result;
}
const modal = 'client/src/components/booking-payment-modal.tsx';
const page = 'client/src/pages/parking-pass-content.tsx';
function telemetry(raw = '{"routeId":"qa-route"}', options = {}) {
  const calls = []; let caught = false;
  const fn = evaluate(modal, ['recordRouteBookingConfirmed'], 'recordRouteBookingConfirmed', {
    sessionStorage: { getItem() { if (options.blocked) throw new Error('blocked'); return raw; }, removeItem() { raw = null; } },
    apiUrl: value => (options.base || '') + value,
    fetch: (url, init) => { calls.push({ url, init }); return { catch(handler) { caught = true; if (options.reject) handler(new Error('offline')); } }; },
  });
  return { fn, calls, handled: () => caught };
}
test('telemetry uses the configured API base and unchanged event payload', () => {
  const state = telemetry(undefined, { base: 'https://qa-api.example.invalid' }); state.fn('qa-pass');
  assert.equal(state.calls.length, 1); const call = state.calls[0];
  assert.equal(call.url, 'https://qa-api.example.invalid/api/parking-pass/routes/events');
  assert.equal(call.init.credentials, 'include'); assert.equal(call.init.method, 'POST');
  assert.deepEqual(JSON.parse(call.init.body), { eventName: 'route_booking_confirmed', properties: { routeId: 'qa-route', passId: 'qa-pass' } });
});
test('telemetry keeps same-origin routing when no API base is configured', () => {
  const state = telemetry(); state.fn('qa-pass'); assert.equal(state.calls[0].url, '/api/parking-pass/routes/events');
});
test('a rejected telemetry request is caught and cannot interrupt confirmation', () => {
  const state = telemetry(undefined, { reject: true }); assert.doesNotThrow(() => state.fn('qa-pass')); assert.equal(state.handled(), true);
});
for (const [name, raw, options] of [['missing context', null, {}], ['malformed context', '{bad', {}], ['blocked storage', '{}', { blocked: true }]]) {
  test(`telemetry safely ignores ${name}`, () => { const state = telemetry(raw, options); assert.doesNotThrow(() => state.fn('qa-pass')); assert.equal(state.calls.length, 0); });
}
test('consumed route context is not submitted twice', () => {
  const state = telemetry(); state.fn('qa-pass'); state.fn('qa-pass'); assert.equal(state.calls.length, 1);
});
for (const [name, providers, hosts, loading, expected, summary] of [
  ['host fuel only stays usable', 0, 2, false, 2, '2'],
  ['both sources contribute', 3, 2, false, 5, '5'],
  ['provider results alone remain usable', 3, 0, false, 3, '3'],
  ['empty completed lookup is unavailable', 0, 0, false, 0, 'Unavailable'],
  ['empty loading lookup is not a false zero', 0, 0, true, 0, 'Loading'],
]) test(`gas control: ${name}`, () => {
  const result = evaluate(page, ['gasLayerCount', 'gasLayerSummary'], '[gasLayerCount, gasLayerSummary]', {
    supplierLayerCounts: { gas: providers }, gasPricePins: Array(hosts).fill({}), isOperatorSupportFetching: loading,
  });
  assert.equal(result[0], expected); assert.equal(result[1], summary);
  assert.match(read(page), /disabled=\{gasLayerCount === 0\}/);
});
test('host-pin count cannot be inflated by support or fuel pins', () => {
  assert.equal(evaluate(page, ['parkingPassHostPinCount'], 'parkingPassHostPinCount', { mapPins: [{}, {}], unlistedHostPins: [{}], operationalSupportPins: Array(20), gasPricePins: Array(10) }), 3);
});
test('gas pins require enabled sharing, valid coordinates and a valid price', () => {
  const host = { id: 'qa-fuel', name: 'QA ONLY fuel', latitude: '30', longitude: '-90', showFuelPrices: true, fuelPrices: { regularCents: 329 } };
  const pins = evaluate(page, ['parseCoord', 'formatFuelCents', 'gasPricePins'], 'gasPricePins', {
    useMemo: fn => fn(), buildAddressLabel: () => 'QA address', parkingPassMapLocations: { hostLocations: [host, { ...host, showFuelPrices: false }, { ...host, latitude: null }, { ...host, fuelPrices: { regularCents: 0 } }] },
  });
  assert.equal(pins.length, 1); assert.equal(pins[0].regular, '$3.29');
});
const scout = 'server/services/scoutSurfaceService.ts';
const cta = card => evaluate(scout, ['toSlug', 'buildPublicProfilePath', 'getCta'], 'getCta(card)', { card });
test('host details use the canonical profile even when parking is bookable', () => {
  const result = cta({ entityType: 'host_spot', entityId: 'qa/host', title: 'QA Host', metadata: { parkingPassBookable: true } });
  assert.equal(result.label, 'View details'); assert.equal(result.href, '/location/qa-host--qa%2Fhost');
});
test('bookable Scout events retain all booking and menu context', () => {
  const result = cta({ entityType: 'event', entityId: 'qa-event', metadata: { parkingPassBookable: true, parkingPassId: 'qa-pass', hostId: 'qa-host', eventMenuId: 'qa-menu', spotId: '2' } });
  const url = new URL(result.href, 'https://qa.example.invalid'); assert.equal(result.label, 'Book spot');
  assert.equal(url.pathname, '/parking-pass');
  for (const [key, value] of Object.entries({ pass: 'qa-pass', eventId: 'qa-pass', hostId: 'qa-host', locationId: 'qa-host', eventMenuId: 'qa-menu', spotId: '2', source: 'scout' })) assert.equal(url.searchParams.get(key), value);
});
test('ordinary events do not become parking checkout links', () => {
  const result = cta({ entityType: 'event', entityId: 'qa-event' }); assert.equal(result.label, 'View details'); assert.equal(result.href, '/events/qa-event');
});
const navigation = 'client/src/lib/parkingPassOwnerNavigation.ts';
for (const setup of ['schedule', 'truck', 'host', 'location', 'payments']) test(`typed Parking Pass navigation preserves ${setup}`, () => {
  const result = evaluate(navigation, ['parseParkingPassOwnerNavigation'], 'parseParkingPassOwnerNavigation(search)', { search: `?setup=${setup}&truckId=qa-truck` });
  assert.equal(result.requestedTruckId, 'qa-truck'); assert.equal(result.topTab, ['schedule', 'truck'].includes(setup) ? 'schedule' : 'host');
  assert.equal(result.hostToolsTab, ['location', 'payments'].includes(setup) ? setup : 'listings');
});
const picker = 'client/src/components/maps/GoogleMapPicker.tsx';
test('route marker cleanup supports both Google marker APIs', () => {
  let classic = false; const modern = { map: {} };
  const remove = evaluate(picker, ['removeGoogleMarker'], 'removeGoogleMarker');
  remove({ setMap(value) { assert.equal(value, null); classic = true; } }); remove(modern);
  assert.equal(classic, true); assert.equal(modern.map, null); assert.doesNotThrow(() => remove(null));
});
test('route candidates exclude missing, disabled and address-hidden owners', () => {
  const host = { id: 'qa-host', userId: 'qa-owner', businessName: 'QA ONLY host', latitude: '30', longitude: '-90' };
  const result = evaluate('server/routes/publicMapRoutes.ts', ['storedHostRows'], 'storedHostRows', {
    storedHosts: [host, { ...host, id: 'disabled', userId: 'disabled' }, { ...host, id: 'hidden', userId: 'hidden' }, { ...host, id: 'missing', userId: 'missing' }],
    activeStoredHostByUserId: new Map([['qa-owner', { isDisabled: false, publicProfileSettings: { showAddress: true } }], ['disabled', { isDisabled: true }], ['hidden', { isDisabled: false, publicProfileSettings: { showAddress: false } }]]),
    resolvePublicProfileVisibility: settings => settings, isHostProfileMapEligible: () => true,
    toFiniteNumber: value => Number.isFinite(Number(value)) ? Number(value) : null,
  });
  assert.equal(result.length, 1); assert.equal(result[0].hostId, 'qa-host');
});
