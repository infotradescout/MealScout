import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readPublicProfileJson, PublicProfileReadError, isMissingPublicProfile, isPrivatePublicProfile, publicProfileLoginHref } from "../../client/src/lib/public-profile-recovery";
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
for (const status of [401, 403, 404, 410, 429, 500, 503]) {
  test(`profile read retains HTTP ${status} without converting all failures to missing`, async () => {
    globalThis.fetch = async () => new Response('{}', { status });
    await assert.rejects(readPublicProfileJson('/api/fixture'), (error: unknown) => {
      assert.ok(error instanceof PublicProfileReadError);
      assert.equal(error.status, status);
      assert.equal(isMissingPublicProfile(error), [404, 410].includes(status));
      assert.equal(isPrivatePublicProfile(error), [401, 403].includes(status));
      return true;
    });
  });
}
for (const body of ['null', '[]', '{}', '{"id":12}', 'not json']) {
  test(`malformed success is retryable, not proof of a missing profile: ${body}`, async () => {
    globalThis.fetch = async () => new Response(body, { status: 200 });
    await assert.rejects(readPublicProfileJson('/api/fixture'), (error: unknown) => {
      assert.ok(error instanceof PublicProfileReadError);
      assert.equal(error.status, null); return true;
    });
  });
}
test('successful read preserves data and passes a bounded, cancellable credentialed request', async () => {
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.credentials, 'include'); assert.ok(init?.signal);
    return Response.json({ id: 'qa-profile', displayName: 'QA Only' });
  };
  assert.deepEqual(await readPublicProfileJson('/api/fixture'), { id: 'qa-profile', displayName: 'QA Only' });
});
test('network failure remains retryable', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(readPublicProfileJson('/api/fixture'), (error: unknown) => error instanceof PublicProfileReadError && error.status === null);
});
test('query cancellation reaches fetch rather than continuing a stale profile read', async () => {
  const source = new AbortController(); source.abort();
  globalThis.fetch = async (_url, init) => { assert.equal(init?.signal?.aborted, true); throw new DOMException('Aborted', 'AbortError'); };
  await assert.rejects(readPublicProfileJson('/api/fixture', source.signal), { name: 'AbortError' });
});
test('login uses the actual supported redirect and keeps profile query/hash context', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { pathname: '/truck/qa--id', search: '?ref=qa&message=1', hash: '#menu' } } });
  const url = new URL(publicProfileLoginHref('/truck/old'), 'https://fixture.invalid');
  assert.equal(url.pathname, '/login'); assert.equal(url.searchParams.has('continuation'), false);
  assert.equal(url.searchParams.get('redirect'), '/truck/qa--id?ref=qa&message=1#menu');
});
for (const fallback of ['//evil.invalid', 'https://evil.invalid', 'javascript:alert(1)']) {
  test(`unsafe fallback cannot become an external login destination: ${fallback}`, () => {
    assert.equal(new URL(publicProfileLoginHref(fallback), 'https://fixture.invalid').searchParams.get('redirect'), '/scout');
  });
}
