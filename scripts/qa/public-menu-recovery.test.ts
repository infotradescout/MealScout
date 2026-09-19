import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicMenuPayload, readPublicMenuJson, PublicMenuReadError, menuRecoveryMessage } from '../../client/src/lib/public-menu-recovery';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const payload = () => ({ orderingEnabled: true, menus: [{ id: 'menu', name: 'Dinner', isActive: true, orderingEnabled: true, categories: [{ id: 'category', name: 'Food', items: [{ id: 'dish', name: 'Tacos', priceCents: 1500, isAvailable: true, variants: [], modifiers: [] }] }] }] });
for (const status of [401, 403, 404, 410, 429, 500, 503]) test(`public menu retains HTTP ${status}`, async () => {
  globalThis.fetch = async () => new Response('{}', { status });
  await assert.rejects(readPublicMenuJson('/api/fixture'), (error: unknown) => error instanceof PublicMenuReadError && error.status === status);
});
for (const data of [null, {}, { menus: {} }, { menus: [], orderingEnabled: 'true' }, { menus: [null], orderingEnabled: true }]) test(`malformed menu response fails closed ${JSON.stringify(data)}`, async () => {
  globalThis.fetch = async () => Response.json(data);
  await assert.rejects(readPublicMenuJson('/api/fixture'), (error: unknown) => error instanceof PublicMenuReadError && error.status === null);
});
test('valid and genuinely empty menu responses remain distinct from errors', async () => {
  for (const data of [payload(), { orderingEnabled: false, menus: [] }]) {
    globalThis.fetch = async (_url, options) => { assert.equal(options?.credentials, 'include'); assert.ok(options?.signal); return Response.json(data); };
    assert.deepEqual(await readPublicMenuJson('/api/fixture'), data);
  }
});
test('invalid item identity, negative prices and malformed choices are rejected', () => {
  for (const patch of [{ id: '' }, { priceCents: -1 }, { variants: {} }, { modifiers: [null] }, { isAvailable: 'yes' }]) {
    const data = payload(); Object.assign(data.menus[0].categories[0].items[0], patch); assert.equal(isPublicMenuPayload(data), false);
  }
});
test('query cancellation reaches the in-flight menu fetch', async () => {
  const controller = new AbortController(); controller.abort();
  globalThis.fetch = async (_url, options) => { assert.equal(options?.signal?.aborted, true); throw new DOMException('Aborted', 'AbortError'); };
  await assert.rejects(readPublicMenuJson('/api/fixture', controller.signal), { name: 'AbortError' });
});
test('network failures are retryable, not proof that a menu is missing', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(readPublicMenuJson('/api/fixture'), (error: unknown) => error instanceof PublicMenuReadError && error.status === null);
});
test('access, missing and temporary menu messages remain distinct', () => {
  assert.equal(menuRecoveryMessage(new PublicMenuReadError(403)).title, 'Menu access unavailable');
  assert.equal(menuRecoveryMessage(new PublicMenuReadError(404)).title, 'Menu not found');
  assert.equal(menuRecoveryMessage(new PublicMenuReadError(503)).title, 'Menu could not be loaded');
});
test('menu return keeps this merchant profile, attribution and section but not tokens', async () => {
  const { menuProfileReturnPath } = await import('../../client/src/lib/public-menu-recovery');
  assert.equal(menuProfileReturnPath('/truck/tacos--merchant?ref=qa&token=secret&code=secret#menu', 'merchant'), '/truck/tacos--merchant?ref=qa#menu');
  for (const target of ['https://evil.invalid', '//evil.invalid', '/admin', '/truck/tacos--other', '/truck/%ZZ', '/login?redirect=/admin']) assert.equal(menuProfileReturnPath(target, 'merchant'), null);
});
