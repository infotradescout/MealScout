import assert from 'node:assert/strict';
import test from 'node:test';
import { CountyMapClientError, buildCountyMapEvent, countyMapAdoption, createCountyMapClient } from './county-map-client.mjs';

function packet(changes = {}) {
  return buildCountyMapEvent({
    countyFips: '17031',
    eventId: countyMapAdoption.productId + '.adoption.0001',
    eventType: countyMapAdoption.sample.eventType,
    sourceRecordId: 'adoption-proof-0001',
    subject: { type: countyMapAdoption.sample.subjectType, id: 'adoption-proof-0001' },
    actor: { type: 'system', id: countyMapAdoption.productId + '-county-adapter' },
    occurredAt: '2026-09-02T12:00:00.000Z',
    visibility: { level: 'source-product' },
    data: countyMapAdoption.sample.data,
    evidenceRefs: ['urn:infinity:county-map-adoption:' + countyMapAdoption.productId],
    ...changes,
  });
}

test('declares a secret-free bidirectional product profile', () => {
  assert.equal(countyMapAdoption.canRead, true);
  assert.equal(countyMapAdoption.canWrite, true);
  assert.ok(countyMapAdoption.eventNamespaces.length > 0);
  assert.equal(JSON.stringify(countyMapAdoption).includes('secret'), false);
});

test('builds only valid namespaced and evidenced events', () => {
  const built = packet();
  assert.equal(built.countyFips, '17031');
  assert.equal(built.event.eventType, countyMapAdoption.sample.eventType);
  assert.equal(built.event.evidenceRefs.length, 1);
  assert.throws(() => packet({ countyFips: '17' }), /five digits/);
  assert.throws(() => packet({ eventType: 'another-product.event.updated' }), (error) => error instanceof CountyMapClientError && error.code === 'event_namespace_forbidden');
  assert.throws(() => packet({ evidenceRefs: [] }), /1 to 25/);
  assert.throws(() => packet({ visibility: { level: 'restricted' } }), /requires productIds/);
});

test('uses one authenticated Apps Script envelope without putting secrets in URLs or headers', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const envelope = JSON.parse(init.body);
    calls.push({ url, init, envelope });
    const result = envelope.operation === 'writeCountyEvent'
      ? { created: true, event: envelope.payload.packet }
      : { items: [] };
    return { ok: true, status: 200, async json() { return { ok: true, result }; } };
  };
  const secret = 'local-contract-secret-0001';
  const endpoint = 'https://script.google.com/macros/s/county-map-proof/exec';
  const client = createCountyMapClient({ baseUrl: endpoint, productSecret: secret, fetchImpl });
  await client.readCountyRecords({ countyFips: '17031', limit: 25 });
  await client.readDirectoryRecords({ countyFips: '17031', entityType: countyMapAdoption.sample.subjectType, limit: 25, offset: 0 });
  await client.writeCountyEvent(packet());
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, endpoint);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].envelope.operation, 'readCountyRecords');
  assert.equal(calls[0].envelope.productId, countyMapAdoption.productId);
  assert.equal(calls[0].envelope.productSecret, secret);
  assert.equal(calls[0].url.includes(secret), false);
  assert.equal(JSON.stringify(calls[0].init.headers).includes(secret), false);
  assert.equal(calls[1].envelope.operation, 'readDirectoryRecords');
  assert.deepEqual(calls[1].envelope.payload.query, {
    countyFips: '17031', entityType: countyMapAdoption.sample.subjectType, limit: 25, offset: 0,
  });
  assert.equal(calls[2].envelope.operation, 'writeCountyEvent');
  assert.equal(JSON.stringify(countyMapAdoption).includes(secret), false);
});

test('fails closed on insecure endpoints and gateway rejections', async () => {
  assert.throws(() => createCountyMapClient({ baseUrl: 'http://county-map.example', productSecret: 'long-enough-secret' }), /HTTPS/);
  const client = createCountyMapClient({
    baseUrl: 'https://script.google.com/macros/s/county-map-proof/exec',
    productSecret: 'long-enough-secret',
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { ok: false, error: { code: 'event_namespace_forbidden' } }; } }),
  });
  await assert.rejects(client.writeCountyEvent(packet()), (error) => error instanceof CountyMapClientError && error.code === 'event_namespace_forbidden');
  const local = createCountyMapClient({
    baseUrl: 'http://127.0.0.1:5000',
    productSecret: 'long-enough-secret',
    fetchImpl: async () => { throw new Error('local directory reads must not fetch'); },
  });
  await assert.rejects(local.readDirectoryRecords({ countyFips: '17031' }), (error) => error instanceof CountyMapClientError && error.code === 'directory_read_requires_apps_script_gateway');
});
