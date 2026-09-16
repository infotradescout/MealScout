// Actual middleware + Express HTTP + migration 058 in fresh PGlite.
// Authentication/permissions and the downstream action are explicit fixtures.
// No Stripe, production credentials, live bookings or external requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import express from 'express';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as orm from 'drizzle-orm';
import { PgDialect, pgTable, text } from 'drizzle-orm/pg-core';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
for (const key of Object.keys(process.env)) assert.ok(!/DATABASE_URL|STRIPE.*KEY|BREVO.*KEY/i.test(key), 'Provider credentials forbidden');
const baseline = process.env.QA_DURABILITY_BASELINE === 'true';
const pg = new PGlite(); const database = drizzle(pg); const dialect = new PgDialect();
await pg.exec(fs.readFileSync(path.join(root, 'migrations/058_idempotency_keys.sql'), 'utf8'));
let intercept = async (_query, run) => run();
const adapter = { execute(query) { const compiled = dialect.sqlToQuery(query); return intercept(compiled, () => pg.query(compiled.sql, compiled.params.map(value => value && typeof value.toISOString === "function" ? value.toISOString() : value))); } };
function load(file) {
  const source = baseline && file === 'server/middleware/idempotency.ts' ? execFileSync('git',['show','ecb9a3d188ed225ccb9b445858e00c7e103bbd40:'+file], {cwd:root,encoding:'utf8'}) : fs.readFileSync(path.join(root, file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, console, process,
    require(id) {
      if (id === '../db' || id === './db') return { db: adapter };
      if (id === 'drizzle-orm') return orm;
      if (id === 'crypto' || id === 'node:crypto') return crypto;
      throw new Error('Unexpected runtime import: ' + id);
    } });
  return mod.exports;
}
const isReceiptWrite = text => /UPDATE\s+idempotency_keys\s+SET\b/i.test(text) && /\bstatus_code\s*=/.test(text) && /\bresponse_body\s*=/.test(text) && /\bstate\s*=\s*(?:'completed'|CASE\b)/i.test(text);
let executions = 0, allowed = true, resultCode = 200;
const receipt = { paymentIntentId: 'pi_qa_only', clientSecret: 'qa-not-a-real-secret', totalCents: 2500 };
const route = '/api/parking-pass/qa-listing/book';
const servers = [], origins = [];
for (let worker = 0; worker < 2; worker++) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.get('x-qa-actor') !== 'guest') req.user = { id: req.get('x-qa-actor') || 'qa-owner' }; next(); });
  const mod = load(baseline ? 'server/middleware/idempotency.ts' : 'server/middleware/durableIdempotency.ts');
  const guard = (mod.requireDurableIdempotencyKey || mod.requireIdempotencyKey)({ scope: 'parking_pass_booking', authorizeReplay: async () => allowed });
  app.post(route, guard, (_req, res) => { executions++; res.status(resultCode).json(receipt); });
  const general = load('server/middleware/idempotency.ts').requireIdempotencyKey({scope:'qa_general'});
  app.post('/__qa/general', general, (_req,res) => { executions++; res.status(202).json({pending:true}); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  servers.push(server); origins.push('http://127.0.0.1:' + server.address().port);
}
async function request(key, body = { truckId: 'qa-truck', slotTypes: ['lunch'] }, worker = 0, actor = 'qa-owner', signal) {
  const response = await fetch(origins[worker] + route, { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-qa-actor': actor, ...(key == null ? {} : { 'Idempotency-Key': key }) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
const legacyUnhandled = [];
if (baseline) process.on('unhandledRejection', error => legacyUnhandled.push(String(error?.message || error).slice(0,300)));
const results = [];
async function check(name, fn) {
  intercept = async (_query, run) => run(); allowed = true; resultCode = 200;
  await pause(30); await pg.exec('DELETE FROM idempotency_keys'); executions = 0;
  try { await fn(); results.push({ name, status: 'pass' }); }
  catch (error) { results.push({ name, status: 'fail', error: error.message }); }
  console.log('QA DURABILITY ' + JSON.stringify(results.at(-1)));
}
const rows = async key => (await pg.query('SELECT * FROM idempotency_keys WHERE idem_key = $1', [key])).rows;
const waitFor = async fn => { for (let i = 0; i < 200; i++) { if (await fn()) return; await pause(10); } throw new Error('Condition timed out'); };
try {
  await check('expired processing lock never reexecutes the operation on another worker', async () => {
    const key = crypto.randomUUID();
    const hash = crypto.createHash('sha256').update(route + '|{"slotTypes":["lunch"],"truckId":"qa-truck"}').digest('hex');
    await pg.query("INSERT INTO idempotency_keys(scope,identity_key,idem_key,request_hash,state,locked_until,expires_at) VALUES ($1,'qa-owner',$2,$3,'processing',now()-interval '2 minutes',now()+interval '23 hours')", ['parking_pass_booking:' + route, key, hash]);
    executions = 1; // The persisted processing record represents an interrupted admitted operation.
    const again = await request(key, undefined, 1);
    assert.equal(again.status, 409); assert.equal(executions, 1);
  });
  await check('database outage fails closed rather than executing a memory-only request', async () => {
    intercept = async () => { throw new Error('QA database unavailable'); };
    const response = await request(crypto.randomUUID());
    assert.equal(response.status, 503); assert.equal(executions, 0);
  });
  if (!baseline) {
    await check('anonymous request never reaches receipt storage or the operation', async () => {
      let reads = 0; intercept = async (_q, run) => { reads++; return run(); };
      assert.equal((await request(crypto.randomUUID(), undefined, 0, 'guest')).status, 401);
      assert.equal(executions, 0); assert.equal(reads, 0);
    });
    await check('missing and oversized keys fail without an operation', async () => {
      assert.equal((await request(null)).status, 400); assert.equal((await request('x'.repeat(256))).status, 400); assert.equal(executions, 0);
    });
    await check('shared middleware persists and replays its real JSON response without SQL type errors', async () => {
      const key = crypto.randomUUID();
      const send = async () => { const response = await fetch(origins[0] + '/__qa/general', {method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:'{}'}); return {status:response.status,body:await response.json()}; };
      const first = await send(); assert.equal(first.status,202);
      await waitFor(async () => (await rows(key))[0]?.state === 'completed');
      assert.deepEqual(await send(), first); assert.equal(executions,1);
    });
    await check('shared response recorder handles an asynchronous store failure', async () => {
      const unexpected=[]; const catchUnexpected=error=>unexpected.push(error); process.on('unhandledRejection',catchUnexpected);
      const key=crypto.randomUUID();
      intercept=async(q,run)=>{if(isReceiptWrite(q.sql))throw new Error('QA completion failure');return run();};
      try {
        const response=await fetch(origins[0]+'/__qa/general',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:'{}'});
        assert.equal(response.status,202); await response.json(); await pause(60);
        assert.equal((await rows(key))[0].state,'processing'); assert.equal(unexpected.length,0);
      } finally {process.removeListener('unhandledRejection',catchUnexpected);}
    });
    await check('response is durable before acknowledgement and replays across workers', async () => {
      const key = crypto.randomUUID(); const first = await request(key);
      assert.equal(first.status, 200); assert.equal((await rows(key))[0].state, 'completed');
      const second = await request(key, { slotTypes: ['lunch'], truckId: 'qa-truck' }, 1);
      assert.deepEqual(second, first); assert.equal(executions, 1);
    });
    await check('different input with the same reference cannot replay or execute', async () => {
      const key = crypto.randomUUID(); await request(key);
      assert.equal((await request(key, { truckId: 'different' }, 1)).body.code, 'idempotency_key_reuse_mismatch');
      assert.equal(executions, 1);
    });
    await check('concurrent requests admitted by two middleware instances execute once', async () => {
      const key = crypto.randomUUID(); const responses = await Promise.all(Array.from({ length: 8 }, (_, n) => request(key, undefined, n % 2)));
      assert.equal(executions, 1); assert.ok(responses.every(r => [200, 409].includes(r.status)));
      assert.equal((await rows(key)).length, 1); assert.equal((await request(key)).status, 200);
    });
    await check('receipt persistence delay prevents an early successful response', async () => {
      let release; const gate = new Promise(resolve => { release = resolve; }); let entered = false, settled = false;
      intercept = async (q, run) => { if (isReceiptWrite(q.sql)) { entered = true; await gate; } return run(); };
      const pending = request(crypto.randomUUID()).then(r => { settled = true; return r; });
      try { await waitFor(() => entered); await pause(40); assert.equal(settled, false); }
      finally { release(); }
      assert.equal((await pending).status, 200);
    });
    await check('failed receipt write exposes uncertainty and cannot reexecute after lock expiry', async () => {
      const key = crypto.randomUUID(); intercept = async (q, run) => { if (isReceiptWrite(q.sql)) throw new Error('QA save failed'); return run(); };
      assert.equal((await request(key)).status, 503); assert.equal((await rows(key))[0].state, 'processing');
      await pg.query("UPDATE idempotency_keys SET locked_until=now()-interval '2 minutes' WHERE idem_key=$1", [key]);
      assert.equal((await request(key, undefined, 1)).status, 409); assert.equal(executions, 1);
    });
    await check('lost database commit acknowledgement recovers the persisted result', async () => {
      const key = crypto.randomUUID(); let fail = true;
      intercept = async (q, run) => { const value = await run(); if (fail && isReceiptWrite(q.sql)) { fail = false; throw new Error('QA lost commit acknowledgement'); } return value; };
      assert.equal((await request(key)).status, 503); assert.equal((await request(key, undefined, 1)).status, 200); assert.equal(executions, 1);
    });
    await check('uncertain admission acknowledgement cannot fall back into a second execution', async () => {
      const key = crypto.randomUUID(); let fail = true;
      intercept = async (q, run) => { const value = await run(); if (fail && q.sql.includes('INSERT INTO')) { fail = false; throw new Error('QA lost admission acknowledgement'); } return value; };
      assert.equal((await request(key)).status, 503); assert.equal((await request(key, undefined, 1)).status, 409); assert.equal(executions, 0);
    });
    await check('revoked access cannot read a saved payment response', async () => {
      const key = crypto.randomUUID(); await request(key); allowed = false;
      const denied = await request(key, undefined, 1); assert.equal(denied.status, 403);
      assert.equal(JSON.stringify(denied).includes(receipt.clientSecret), false); assert.equal(executions, 1);
    });
    await check('account identities isolate receipt replay', async () => {
      const key = crypto.randomUUID(); await request(key); await request(key, undefined, 1, 'qa-other-owner');
      assert.equal(executions, 2); assert.equal((await rows(key)).length, 2);
    });
    await check('expired completed result never becomes a fresh execution', async () => {
      const key = crypto.randomUUID(); await request(key);
      await pg.query("UPDATE idempotency_keys SET expires_at=now()-interval '1 hour' WHERE idem_key=$1", [key]);
      assert.equal((await request(key, undefined, 1)).status, 409); assert.equal(executions, 1);
    });
    await check('missing saved body is never fabricated as successful replay', async () => {
      const key = crypto.randomUUID(); await request(key);
      await pg.query('UPDATE idempotency_keys SET response_body=NULL WHERE idem_key=$1', [key]);
      assert.equal((await request(key, undefined, 1)).status, 409); assert.equal(executions, 1);
    });
    for (const status of [202, 400, 500]) await check(`recorded HTTP ${status} is replayed unchanged, not promoted to success`, async () => {
      resultCode = status; const key = crypto.randomUUID(); const first = await request(key);
      assert.equal(first.status, status); assert.deepEqual(await request(key, undefined, 1), first); assert.equal(executions, 1);
    });
    await check('disconnected client does not prevent recording and recovering the original result', async () => {
      let release; const gate = new Promise(resolve => { release = resolve; }); let entered = false;
      intercept = async (q, run) => { if (isReceiptWrite(q.sql)) { entered = true; await gate; } return run(); };
      const key = crypto.randomUUID(), controller = new AbortController();
      const pending = request(key, undefined, 0, 'qa-owner', controller.signal).catch(() => null);
      try { await waitFor(() => entered); controller.abort(); await pending; } finally { release(); }
      await waitFor(async () => (await rows(key))[0]?.state === 'completed');
      assert.equal((await request(key, undefined, 1)).status, 200); assert.equal(executions, 1);
    });
    await check('cleanup erases expired response secrets but retains the duplicate-prevention record', async () => {
      const key = crypto.randomUUID(); await request(key);
      await pg.exec("CREATE TABLE IF NOT EXISTS rate_limit_counters(updated_at timestamp); CREATE TABLE IF NOT EXISTS report_download_tokens(expires_at timestamp)");
      await pg.query("UPDATE idempotency_keys SET expires_at=now()-interval '3 days' WHERE idem_key=$1", [key]);
      await pg.exec("INSERT INTO idempotency_keys(scope,identity_key,idem_key,request_hash,expires_at) VALUES ('ordinary:qa','qa','old','hash',now()-interval '3 days')");
      const result = await load('server/opsCleanup.ts').runOpsDataCleanup(); assert.equal(result.ok, true); assert.equal(result.idempotencyDeleted, 1);
      const row = (await rows(key))[0]; assert.ok(row); assert.equal(row.state, 'expired'); assert.equal(row.response_body, null);
      assert.equal((await request(key, undefined, 1)).status, 409); assert.equal(executions, 1);
    });
  }
  const routeSource = baseline ? execFileSync('git',['show','ecb9a3d188ed225ccb9b445858e00c7e103bbd40:server/routes/hostRoutes.ts'], {cwd:root,encoding:'utf8'}) : fs.readFileSync(path.join(root, 'server/routes/hostRoutes.ts'), 'utf8');
  const routeAst = ts.createSourceFile('hostRoutes.ts', routeSource, ts.ScriptTarget.Latest, true);
  let querySource;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(routeAst) === 'existingBooking') querySource = node.initializer.getText(routeAst);
    ts.forEachChild(node, visit);
  }
  visit(routeAst); assert.ok(querySource);
  const columns = { id: text('id'), eventId: text('event_id'), truckId: text('truck_id'), status: text('status') };
  const bookings = pgTable('qa_booking_predicates', columns);
  await pg.exec('CREATE TABLE qa_booking_predicates(id text,event_id text,truck_id text,status text)');
  const compiledQuery = ts.transpileModule('async function query(db,eventBookings,eq,inArray,and,passId,truckId,event){ return ' + querySource + '; }', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const query = vm.runInNewContext(compiledQuery + '; query;');
  await check('existing-booking query matches only the selected truck and materialized listing', async () => {
    await pg.exec("INSERT INTO qa_booking_predicates VALUES ('foreign','unrelated','other-truck','pending'),('other-date','different-event','qa-truck','confirmed'),('match','real-event','qa-truck','pending')");
    const matched = await query(database, bookings, orm.eq, orm.inArray, orm.and, 'virtual-request-id', 'qa-truck', { id: 'real-event' });
    assert.deepEqual(matched.map(row => row.id), ['match']);
  });
  await check('unrelated and cancelled bookings do not block another listing', async () => {
    await pg.exec("UPDATE qa_booking_predicates SET status='cancelled' WHERE id='match'");
    assert.deepEqual(await query(database, bookings, orm.eq, orm.inArray, orm.and, 'virtual-request-id', 'qa-truck', { id: 'real-event' }), []);
  });
  if (!baseline) await check('provider key is stable, scoped, opaque and attached to unchanged intent parameters', async () => {
    const helper = load('server/middleware/durableIdempotency.ts').parkingBookingProviderKey;
    const key = helper('qa-owner', route, 'qa-reference');
    assert.equal(helper('qa-owner', route, 'qa-reference'), key);
    assert.match(key, /^parking-pass:[a-f0-9]{64}$/);
    assert.notEqual(helper('other-owner', route, 'qa-reference'), key);
    assert.notEqual(helper('qa-owner', route + '-other', 'qa-reference'), key);
    assert.notEqual(helper('qa-owner', route, 'other-reference'), key);
    assert.throws(() => helper('', route, 'qa-reference'));
    let call;
    const locate = node => { if (ts.isCallExpression(node) && node.expression.getText(routeAst) === 'stripe.paymentIntents.create') call = node.getText(routeAst); ts.forEachChild(node, locate); };
    locate(routeAst); assert.ok(call);
    const seen = [], intentParams = { amount: 2500, currency: 'usd', metadata: { qa: 'fixture' } };
    const invoke = vm.runInNewContext('(async (stripe,intentParams,parkingBookingProviderKey,userId,req) => ' + call + ')');
    await invoke({paymentIntents:{create:async (...args)=>{seen.push(args);return {id:'pi_qa'};}}}, intentParams, helper, 'qa-owner', {path:route,get:()=> 'qa-reference'});
    assert.equal(seen[0][0], intentParams); assert.equal(seen[0][1].idempotencyKey, key);
  });
  if (!baseline) await check('booking route authenticates before durable admission and rechecks replay ownership', async () => {
    const start = routeSource.indexOf('"/api/parking-pass/:passId/book"');
    const entry = routeSource.slice(start, start + 850);
    assert.match(entry, /isAuthenticated,[\s\S]*requireDurableIdempotencyKey/);
    assert.match(entry, /authorizeReplay:[\s\S]*verifyRestaurantOwnership[\s\S]*manageParkingPass/);
    for (const gate of ['assessParkingPassTruckEligibility', 'storedInsuranceValid', 'truck_verification_required', 'hostPriceCents <= 0', 'for update']) assert.ok(routeSource.includes(gate));
  });
} finally {
  intercept = async (_q, run) => run();
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  await pause(30); await pg.close();
}
const report = { scope: 'Real middleware/Express + PGlite SQL; synthetic auth, downstream action and booking-query table; no Stripe/full booking/native PostgreSQL proof',
  baseline, legacyUnhandled, pass: results.filter(r => r.status === 'pass').length, fail: results.filter(r => r.status === 'fail').length, results };
if (process.env.QA_EVIDENCE_DIR) {
  fs.mkdirSync(process.env.QA_EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.QA_EVIDENCE_DIR, 'parking-durability.json'), JSON.stringify(report, null, 2));
}
console.log('QA DURABILITY SUMMARY ' + JSON.stringify(report));
if (report.fail) process.exitCode = 1;
