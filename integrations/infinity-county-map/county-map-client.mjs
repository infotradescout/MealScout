const PROFILE = Object.freeze({
  "canRead": true,
  "canWrite": true,
  "canonicalId": "mealscout",
  "displayName": "MealScout",
  "eventNamespaces": [
    "mealscout"
  ],
  "productId": "mealscout",
  "protocolVersion": "1.0.0",
  "readPurpose": "Resolve venue-local day, service area, capacity, demand, and fulfillment context.",
  "sample": {
    "data": {
      "serviceMode": "pickup",
      "state": "verified"
    },
    "eventType": "mealscout.venue.updated",
    "subjectType": "food-venue"
  },
  "schemaVersion": "infinity.county-map-adoption.v1",
  "sensitivityRule": "Never publish customer addresses, order contents tied to identity, payment data, or unsupported operating claims.",
  "writePurpose": "Publish governed venue, menu, schedule, demand, order-state, and outcome signals."
});

const FIPS_PATTERN = /^\d{5}$/;
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9-]{0,62}(?:\.[a-z][a-z0-9-]{0,62})+$/;
const SUBJECT_TYPE_PATTERN = /^[a-z][a-z0-9-]{0,62}(?:\.[a-z][a-z0-9-]{0,62})*$/;
const PRODUCT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const countyMapAdoption = PROFILE;

export class CountyMapClientError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CountyMapClientError';
    this.status = details.status ?? null;
    this.code = details.code ?? 'county_map_client_error';
    this.retryable = details.retryable === true;
  }
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value, label, maxLength = 512) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new CountyMapClientError(label + ' is invalid', { code: 'invalid_' + label.replaceAll('.', '_') });
  }
  return value;
}

function countyFips(value) {
  if (typeof value !== 'string' || !FIPS_PATTERN.test(value)) {
    throw new CountyMapClientError('countyFips must contain five digits', { code: 'invalid_county_fips' });
  }
  return value;
}

function timestamp(value) {
  requiredText(value, 'occurredAt', 64);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new CountyMapClientError('occurredAt requires an ISO-8601 timezone', { code: 'invalid_occurred_at' });
  }
  return new Date(value).toISOString();
}

function visibility(value) {
  const source = value ?? { level: 'source-product' };
  if (!plainObject(source) || !['ecosystem', 'source-product', 'restricted'].includes(source.level)) {
    throw new CountyMapClientError('visibility is invalid', { code: 'invalid_visibility' });
  }
  const productIds = source.productIds ?? [];
  if (!Array.isArray(productIds) || productIds.length > 50) {
    throw new CountyMapClientError('visibility.productIds is invalid', { code: 'invalid_visibility_products' });
  }
  const normalized = Array.from(new Set(productIds.map((productId) => {
    if (typeof productId !== 'string' || !PRODUCT_ID_PATTERN.test(productId)) {
      throw new CountyMapClientError('visibility product id is invalid', { code: 'invalid_visibility_product' });
    }
    return productId;
  }))).sort();
  if (source.level === 'restricted' && normalized.length === 0) {
    throw new CountyMapClientError('restricted visibility requires productIds', { code: 'missing_visibility_products' });
  }
  if (source.level !== 'restricted' && normalized.length > 0) {
    throw new CountyMapClientError('productIds require restricted visibility', { code: 'unexpected_visibility_products' });
  }
  return normalized.length ? { level: source.level, productIds: normalized } : { level: source.level };
}

function namespacedEventType(value) {
  if (typeof value !== 'string' || !EVENT_TYPE_PATTERN.test(value)) {
    throw new CountyMapClientError('eventType is invalid', { code: 'invalid_event_type' });
  }
  if (!PROFILE.eventNamespaces.some((namespace) => value === namespace || value.startsWith(namespace + '.'))) {
    throw new CountyMapClientError('eventType is outside this product namespace', { code: 'event_namespace_forbidden' });
  }
  return value;
}

function evidenceRefs(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 25) {
    throw new CountyMapClientError('evidenceRefs must contain 1 to 25 references', { code: 'invalid_evidence_refs' });
  }
  return Array.from(new Set(value.map((reference) => requiredText(reference, 'evidenceRef', 512))));
}

function eventId(value, label = 'eventId') {
  if (typeof value !== 'string' || !EVENT_ID_PATTERN.test(value)) {
    throw new CountyMapClientError(label + ' is invalid', { code: 'invalid_' + label.replaceAll('.', '_') });
  }
  return value;
}

export function buildCountyMapEvent(input) {
  if (!plainObject(input)) throw new CountyMapClientError('event input must be an object', { code: 'invalid_event_input' });
  if (!plainObject(input.subject) || !SUBJECT_TYPE_PATTERN.test(input.subject.type ?? '')) {
    throw new CountyMapClientError('subject is invalid', { code: 'invalid_subject' });
  }
  if (!plainObject(input.actor) || !['system', 'user', 'admin'].includes(input.actor.type)) {
    throw new CountyMapClientError('actor is invalid', { code: 'invalid_actor' });
  }
  if (!plainObject(input.data)) throw new CountyMapClientError('data must be an object', { code: 'invalid_data' });
  if (Buffer.byteLength(JSON.stringify(input.data), 'utf8') > 128 * 1024) {
    throw new CountyMapClientError('data exceeds 128 KiB', { code: 'event_data_too_large' });
  }
  const event = {
    eventId: eventId(input.eventId),
    eventType: namespacedEventType(input.eventType),
    sourceRecordId: requiredText(input.sourceRecordId, 'sourceRecordId', 160),
    subject: { type: input.subject.type, id: requiredText(input.subject.id, 'subject.id', 200) },
    actor: { type: input.actor.type, id: requiredText(input.actor.id, 'actor.id', 160) },
    occurredAt: timestamp(input.occurredAt),
    visibility: visibility(input.visibility),
    data: input.data,
    evidenceRefs: evidenceRefs(input.evidenceRefs),
  };
  if (input.correctsEventId !== undefined) {
    event.correctsEventId = eventId(input.correctsEventId, 'correctsEventId');
    if (event.correctsEventId === event.eventId) throw new CountyMapClientError('an event cannot correct itself', { code: 'invalid_correction' });
  }
  return { countyFips: countyFips(input.countyFips), event };
}

function normalizeGatewayUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new CountyMapClientError('baseUrl is invalid', { code: 'invalid_base_url' }); }
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1';
  const testHarness = parsed.hostname.endsWith('.test') || parsed.hostname.endsWith('.example');
  const appsScript = parsed.hostname === 'script.google.com' || parsed.hostname.endsWith('.googleusercontent.com');
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new CountyMapClientError('baseUrl must use HTTPS except for localhost', { code: 'insecure_base_url' });
  }
  if (!appsScript && !local && !testHarness) {
    throw new CountyMapClientError('production baseUrl must be a Google Apps Script endpoint', { code: 'invalid_gateway_host' });
  }
  parsed.search = '';
  parsed.hash = '';
  return {
    endpoint: parsed.toString().replace(/\/+$/, ''),
    transport: appsScript ? 'apps-script' : 'local-rest',
  };
}

function validateSecret(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 512 || /\s/.test(value)) {
    throw new CountyMapClientError('productSecret is invalid', { code: 'invalid_product_secret' });
  }
  return value;
}

function positiveInteger(value, label, fallback, maximum) {
  const source = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(source) || source < 1 || source > maximum) {
    throw new CountyMapClientError(label + ' is invalid', { code: 'invalid_' + label });
  }
  return source;
}

function normalizeReadInput(input) {
  if (!plainObject(input)) throw new CountyMapClientError('read input is required', { code: 'missing_read_input' });
  const query = {
    countyFips: countyFips(input.countyFips),
    limit: positiveInteger(input.limit, 'limit', 100, 500),
  };
  if (input.afterSequence !== undefined) {
    if (!Number.isSafeInteger(input.afterSequence) || input.afterSequence < 0) throw new CountyMapClientError('afterSequence is invalid', { code: 'invalid_after_sequence' });
    query.afterSequence = input.afterSequence;
  }
  for (const [key, value] of [['sourceProduct', input.sourceProduct], ['eventType', input.eventType], ['subjectType', input.subjectType], ['subjectId', input.subjectId]]) {
    if (value !== undefined) query[key] = requiredText(value, key, 255);
  }
  return query;
}

function nonNegativeInteger(value, label, fallback) {
  const source = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(source) || source < 0) {
    throw new CountyMapClientError(label + ' is invalid', { code: 'invalid_' + label });
  }
  return source;
}

function normalizeDirectoryReadInput(input) {
  if (!plainObject(input)) throw new CountyMapClientError('directory read input is required', { code: 'missing_directory_read_input' });
  const query = {
    limit: positiveInteger(input.limit, 'limit', 100, 500),
    offset: nonNegativeInteger(input.offset, 'offset', 0),
  };
  if (input.countyFips !== undefined) query.countyFips = countyFips(input.countyFips);
  for (const [key, value] of [
    ['state', input.state],
    ['county', input.county],
    ['city', input.city],
    ['entityType', input.entityType],
    ['recordId', input.recordId],
    ['sourceSystem', input.sourceSystem],
  ]) {
    if (value !== undefined) query[key] = requiredText(value, key, 255);
  }
  return query;
}

function localReadPath(kind, query) {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit));
  if (query.afterSequence !== undefined) params.set('afterSequence', String(query.afterSequence));
  for (const key of ['sourceProduct', 'eventType', 'subjectType', 'subjectId']) {
    if (query[key] !== undefined) params.set(key, query[key]);
  }
  return 'counties/' + query.countyFips + '/' + kind + '?' + params.toString();
}

function localRequestShape(operation, payload) {
  if (operation === 'readCountyEvents') return { method: 'GET', path: localReadPath('events', payload.query) };
  if (operation === 'readCountyRecords') return { method: 'GET', path: localReadPath('records', payload.query) };
  if (operation === 'readDirectoryRecords') {
    throw new CountyMapClientError('directory reads require an Apps Script County-map gateway', { code: 'directory_read_requires_apps_script_gateway' });
  }
  if (operation === 'writeCountyEvent') {
    return {
      method: 'POST',
      path: 'counties/' + payload.packet.countyFips + '/events',
      body: payload.packet.event,
    };
  }
  if (operation === 'readContract') return { method: 'GET', path: 'contract' };
  if (operation === 'health') return { method: 'GET', path: 'health' };
  throw new CountyMapClientError('unsupported County-map operation', { code: 'unsupported_operation' });
}

export function createCountyMapClient(options) {
  if (!plainObject(options)) throw new CountyMapClientError('client options are required', { code: 'missing_client_options' });
  const connection = normalizeGatewayUrl(options.baseUrl);
  const secret = validateSecret(options.productSecret);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new CountyMapClientError('fetch implementation is required', { code: 'missing_fetch' });
  const timeoutMs = positiveInteger(options.timeoutMs, 'timeout_ms', 10000, 60000);

  async function request(operation, payload = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      if (connection.transport === 'apps-script') {
        response = await fetchImpl(connection.endpoint, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation,
            productId: PROFILE.productId,
            productSecret: secret,
            payload,
          }),
          signal: controller.signal,
        });
      } else {
        const shape = localRequestShape(operation, payload);
        response = await fetchImpl(connection.endpoint + '/' + shape.path, {
          method: shape.method,
          headers: {
            Accept: 'application/json',
            'X-County-Map-Product': PROFILE.productId,
            Authorization: 'Bearer ' + secret,
            ...(shape.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: shape.body === undefined ? undefined : JSON.stringify(shape.body),
          signal: controller.signal,
        });
      }
    } catch (error) {
      if (error instanceof CountyMapClientError) throw error;
      const aborted = error && error.name === 'AbortError';
      throw new CountyMapClientError(aborted ? 'County-map request timed out' : 'County-map request failed', { code: aborted ? 'timeout' : 'network_error', retryable: true });
    } finally {
      clearTimeout(timer);
    }
    let body;
    try { body = await response.json(); } catch {
      throw new CountyMapClientError('County-map returned invalid JSON', { status: response.status, code: 'invalid_response', retryable: response.status >= 500 });
    }
    if (!response.ok || !plainObject(body) || (connection.transport === 'apps-script' && body.ok !== true)) {
      throw new CountyMapClientError('County-map rejected the request', {
        status: response.ok ? null : response.status,
        code: body?.error?.code ?? 'county_map_rejected',
        retryable: body?.error?.retryable === true || response.status >= 500,
      });
    }
    if (connection.transport === 'apps-script') {
      if (!plainObject(body.result)) throw new CountyMapClientError('County-map response must contain a result object', { code: 'invalid_response' });
      return body.result;
    }
    return body;
  }

  return Object.freeze({
    productId: PROFILE.productId,
    readCountyEvents(input) { return request('readCountyEvents', { query: normalizeReadInput(input) }); },
    readCountyRecords(input) { return request('readCountyRecords', { query: normalizeReadInput(input) }); },
    readDirectoryRecords(input) { return request('readDirectoryRecords', { query: normalizeDirectoryReadInput(input) }); },
    writeCountyEvent(packet) {
      if (!plainObject(packet) || !plainObject(packet.event)) throw new CountyMapClientError('a built County-map event packet is required', { code: 'invalid_event_packet' });
      return request('writeCountyEvent', { packet: { countyFips: countyFips(packet.countyFips), event: packet.event } });
    },
    readContract() { return request('readContract'); },
    readHealth() { return request('health'); },
  });
}
