import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { normalizeScoutJourney, readScoutJourney, writeScoutJourney, scoutJourneyRoute, SCOUT_JOURNEY_TTL_MS, type ScoutJourney } from "../../client/src/lib/scout-journey-state";
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => { if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window"); });
const fixture = (): ScoutJourney => ({ route: '/scout?ref=qa', search: { open: true, query: 'tacos', filter: 'restaurants' },
  scene: 'restaurants', craving: 'sit-down', radiusKm: 25, layers: { openNow: true, foodTrucks: false, deals: true, happeningToday: false },
  map: { center: { lat: 30.4, lng: -87.2 }, zoom: 15, expanded: true, selectedMarkerId: 'restaurant-qa' }, scrollY: 120 });
function storage() {
  const rows = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { sessionStorage: {
    getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => rows.set(key, value), removeItem: (key: string) => rows.delete(key),
  } } }); return rows;
}
test('preserves only view preferences; never persists results or availability', () => {
  assert.deepEqual(normalizeScoutJourney({ ...fixture(), results: [{ paid: true }], token: 'do-not-store' }), fixture());
});
test('saved state is scoped to account and survives reload in the same tab', () => {
  storage(); writeScoutJourney('actor-a', fixture(), 1000);
  assert.deepEqual(readScoutJourney('actor-a', 1100), fixture());
  assert.equal(readScoutJourney('actor-b', 1100), null); assert.equal(readScoutJourney('guest', 1100), null);
});
test('unresolved identity cannot read or write a guest snapshot', () => {
  const rows = storage(); writeScoutJourney(null, fixture(), 1000); assert.equal(rows.size, 0); assert.equal(readScoutJourney(null), null);
});
test('expires old state and rejects future timestamps', () => {
  const rows = storage(); writeScoutJourney('actor', fixture(), 1000); assert.equal(readScoutJourney('actor', 1001 + SCOUT_JOURNEY_TTL_MS), null); assert.equal(rows.size, 0);
  writeScoutJourney('actor', fixture(), 1000); assert.equal(readScoutJourney('actor', 999), null);
});
test('attribution survives but auth codes and arbitrary redirect parameters do not', () => {
  assert.equal(scoutJourneyRoute('/scout?ref=qa&code=secret&token=secret&redirect=%2Fadmin&scoutPreview=pensacola#private'), '/scout?ref=qa&scoutPreview=pensacola');
});
for (const route of ['https://evil.invalid/scout', '//evil.invalid/scout', '/admin', '/scout/../../admin', '/scoutish', 'javascript:alert(1)']) {
  test(`rejects unsafe or unrelated return destination: ${route}`, () => assert.equal(scoutJourneyRoute(route), null));
}
for (const [name, change] of [
  ['invalid coordinates', { map: { ...fixture().map, center: { lat: 91, lng: 0 } } }],
  ['invalid zoom', { map: { ...fixture().map, zoom: Infinity } }],
  ['invalid filter', { search: { ...fixture().search, filter: 'admin' } }],
  ['oversize query', { search: { ...fixture().search, query: 'x'.repeat(301) } }],
  ['unknown scene', { scene: 'admin' }], ['invalid radius', { radiusKm: -1 }],
  ['invalid layer', { layers: { ...fixture().layers, deals: 'true' } }], ['invalid scroll', { scrollY: NaN }],
]) test(`malformed state fails closed: ${name}`, () => assert.equal(normalizeScoutJourney({ ...fixture(), ...change }), null));
test('bad JSON and wrong account records do not crash or restore', () => {
  const rows = storage(); const key = 'mealscout:scout-journey:v1:actor'; rows.set(key, '{broken');
  assert.equal(readScoutJourney('actor'), null);
  rows.set(key, JSON.stringify({ version: 1, account: 'other', savedAt: 1000, state: fixture() }));
  assert.equal(readScoutJourney('actor', 1000), null);
});
test('storage denial and quota never break navigation', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { get sessionStorage() { throw new Error('Denied'); } } });
  assert.equal(readScoutJourney('actor'), null); assert.doesNotThrow(() => writeScoutJourney('actor', fixture()));
});
test('server rendering does not require browser storage', () => {
  Reflect.deleteProperty(globalThis, 'window'); assert.equal(readScoutJourney('actor'), null); assert.doesNotThrow(() => writeScoutJourney('actor', fixture()));
});
