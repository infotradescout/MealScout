/** Separate-process fixture host for real Parking Pass middleware and expiry.
 * Authentication/downstream actions/provider transport are explicitly synthetic.
 * Database queries, row locks, request persistence and expiry implementation are real.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import express from 'express';
import pg from 'pg';
const { Pool } = pg;
import { drizzle } from 'drizzle-orm/node-postgres';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.env.MEALSCOUT_PARKING_NATIVE_TEST, '1');
const configPath = path.resolve(process.env.MEALSCOUT_PARKING_NATIVE_CONFIG || '');
assert.ok(configPath.startsWith(path.join(root, '.qa-evidence/parking-native') + path.sep));
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
assert.equal(path.resolve(config.root), root);
const url = new URL(config.databaseUrl), providerBase = new URL(config.providerBase);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.pathname, '/mealscout_owner_journey_test');
assert.equal(url.port, String(config.databasePort));
assert.equal(providerBase.hostname, '127.0.0.1');
assert.equal(process.env.DOTENV_CONFIG_PATH, config.emptyEnv);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof first === 'object' ? first.host || 'localhost' : typeof args[1] === 'string' ? args[1] : 'localhost';
  const port = typeof first === 'object' ? first.port : first;
  assert.ok(['127.0.0.1','localhost','::1'].includes(host));
  assert.ok([config.databasePort, Number(providerBase.port)].includes(Number(port)));
  return connect.apply(this, args);
};
const pool = new Pool({ connectionString: config.databaseUrl, max: 8 });
globalThis.__parkingNativeDb = drizzle(pool);
const require = createRequire(import.meta.url);
const { requireDurableIdempotencyKey, expireParkingPassHolds } = require(config.bundle);
const app = express(); app.use(express.json());
app.use((req, _res, next) => { if (req.get('x-qa-actor') !== 'guest') req.user = { id: req.get('x-qa-actor') || 'fixture-owner' }; next(); });
app.post('/api/parking-pass/native-fixture/book', requireDurableIdempotencyKey({
  scope: 'parking_pass_booking', authorizeReplay: async req => req.get('x-qa-denied') !== 'true',
}), async (req, res, next) => {
  try {
    await pool.query('INSERT INTO qa_effects(request_key,actor) VALUES($1,$2)', [req.get('idempotency-key'),req.user.id]);
    if (req.get('x-qa-crash-after-effect') === 'true') {
      process.send?.({ type: 'effect-recorded', key: req.get('idempotency-key'), pid: process.pid });
      return; // Parent deliberately kills this process before JSON persistence.
    }
    res.status(201).json({ fixture: true, requestId: req.get('idempotency-key'), result: 'one admitted synthetic effect' });
  } catch (error) { next(error); }
});
app.use((error, _req, res, _next) => res.status(500).json({ fixtureError: error.code || 'unexpected' }));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
process.send?.({ type: 'ready', pid: process.pid, port: server.address().port });
process.on('message', async message => {
  if (!message || !message.id) return;
  try {
    let result;
    if (message.op === 'insert') {
      const row = message.row;
      await pool.query("INSERT INTO event_bookings(id,event_id,truck_id,host_id,host_price_cents,platform_fee_cents,total_cents,status) VALUES($1,$2,$3,'native-host',1500,1000,2500,'pending')", [row.id,row.event,row.truck]);
      result = { inserted: true };
    } else if (message.op === 'expiry') {
      const providerCall = async (method,id,params,request) => {
        const response = await fetch(providerBase.origin + '/' + method, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id, params, request }) });
        if (!response.ok) throw new Error('Synthetic provider response unavailable');
        const body = await response.json();
        if (method === 'cancel' && message.holdAfterCancel) {
          process.send?.({ type: 'provider-cancelled', id, pid: process.pid });
          await new Promise(() => {}); // Crash leaves the real SQL transaction uncommitted.
        }
        return body;
      };
      result = await expireParkingPassHolds({ retrieve: id => providerCall('retrieve',id), cancel: (id,params,request) => providerCall('cancel',id,params,request) }, { now: new Date(message.now), ttlMs: 7*60000, limit: 100 });
    } else throw new Error('Unknown fixture operation');
    process.send?.({ type: 'result', id: message.id, result });
  } catch (error) { process.send?.({ type: 'result', id: message.id, error: { code: error.code || error.cause?.code, message: error.message } }); }
});
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await pool.end(); process.exit(0);
}
process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('disconnect', stop);
