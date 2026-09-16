/** Real unifiedAuth + DatabaseStorage + password hashing over loopback HTTP.
 * Fresh in-memory PGlite database; email/SMS sinks and MemoryStore replace only
 * external delivery and the production session-store adapter. No live services.
 * This is backend integration, not OAuth, real email delivery or Stripe proof.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const net = require('node:net');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '../..');
for (const name of Object.keys(process.env)) {
  assert.ok(!/DATABASE_URL|STRIPE.*KEY|BREVO.*KEY|GOOGLE.*SECRET|FACEBOOK.*SECRET/i.test(name), `Provider credentials forbidden: ${name}`);
}
const blocked = [];
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = args[0];
  const opts = Array.isArray(first) ? first[0] : first;
  const host = opts && typeof opts === 'object' ? opts.host : typeof args[1] === 'string' ? args[1] : 'localhost';
  if (!['127.0.0.1', '::1', 'localhost', undefined].includes(host)) {
    blocked.push(String(host)); throw new Error('QA outbound socket blocked');
  }
  if (opts && typeof opts === 'object' && opts.path) throw new Error('QA unix socket blocked');
  return originalConnect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  assert.ok(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname), 'Only loopback HTTP is allowed');
  return originalFetch(input, options);
};
globalThis.__msQaMail = [];
globalThis.__msQaSms = [];
const sink = `export const emailService = new Proxy({}, { get(_target, name) {
  return async (...args) => { globalThis.__msQaMail.push({ name: String(name), args }); return true; };
}});`;
const replacements = {
  [path.join(root, 'server/db.ts')]: `export let db, pool; export function initQaDatabase(value, driver) { db = value; const query = (text, values) => driver.query(text, values); pool = { query, connect: async () => ({ query, release() {} }) }; }`,
  [path.join(root, 'server/emailService.ts')]: sink,
  [path.join(root, 'server/smsService.ts')]: `export async function sendSms(...args) { globalThis.__msQaSms.push(args); return true; }`,
};
const source = `
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import express from 'express';
import bcrypt from 'bcryptjs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { is, SQL, eq } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import * as schema from './shared/schema';
import { initQaDatabase } from './server/db';
import { setupUnifiedAuth, isAuthenticated } from './server/unifiedAuth';
import { storage } from './server/storage';
import { registerMenuRoutes } from './server/routes/menuRoutes';

export async function run() {
  const pg = new PGlite();
  const database = drizzle(pg, { schema });
  initQaDatabase(database, pg);
  const quote = value => '"' + value.replaceAll('"', '""') + '"';
  const dialect = new PgDialect();
  const names = ['users', 'restaurants', 'emailVerificationTokens', 'passwordResetTokens',
    'phoneVerificationTokens', 'accountSetupTokens', 'emailSequenceSends', 'referrals',
    'affiliateLinks', 'affiliateClicks', 'affiliateCommissions', 'affiliateWallet',
    'businessTeamMembers', 'businessTeamInvites', 'restaurantSubscriptions', 'hosts',
    'menus', 'lisaClaims', 'telemetryEvents'];
  for (const name of names) {
    const table = schema[name];
    if (!table) continue;
    const config = getTableConfig(table);
    const definitions = config.columns.map(column => {
      let text = quote(column.name) + ' ' + column.getSQLType();
      if (column.primary) text += ' PRIMARY KEY';
      if (column.notNull) text += ' NOT NULL';
      if (column.isUnique) text += ' UNIQUE';
      if (column.default !== undefined) {
        const val = column.default;
        text += ' DEFAULT ' + (is(val, SQL) ? dialect.sqlToQuery(val).sql
          : typeof val === 'string' ? "'" + val.replaceAll("'", "''") + "'" : String(val));
      }
      return text;
    });
    for (const unique of config.uniqueConstraints) definitions.push('UNIQUE (' + unique.columns.map(c => quote(c.name)).join(',') + ')');
    await pg.exec('CREATE TABLE ' + quote(config.name) + ' (' + definitions.join(',') + ')');
  }
  const app = express(); app.use(express.json());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  process.env.SESSION_SECRET = randomBytes(48).toString('hex');
  process.env.PUBLIC_BASE_URL = origin;
  const results = [];
  async function test(name, body) {
    try { await body(); results.push({ name, status: 'pass' }); console.log('QA AUTH PASS ' + name); }
    catch (error) { results.push({ name, status: 'fail', error: error.message }); console.error('QA AUTH FAIL ' + name + ': ' + error.message); }
  }
  async function request(route, body, cookie, headers = {}) {
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST',
      redirect: 'manual', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data, location: response.headers.get('location'), cookie: response.headers.get('set-cookie')?.split(';')[0], cookieHeader: response.headers.get('set-cookie') };
  }
  try {
    await setupUnifiedAuth(app);
    registerMenuRoutes(app);
    // Test-only probe. Authorization is the actual exported production middleware.
    app.get('/__qa/session', isAuthenticated, (req, res) => res.json({ id: req.user.id, userType: req.user.userType }));
    const registered = app._router.stack.filter(layer => layer.route).map(layer => ({ path: layer.route.path, methods: layer.route.methods }));
    console.log('QA AUTH ROUTES ' + JSON.stringify(registered.filter(r => /register|login|logout|verify-email|reset-password|forgot-password/.test(r.path))));
    const password = 'QA-only-' + randomBytes(16).toString('hex') + '!7aA';
    const actors = [];
    const definitions = [
      ['customer', '/api/auth/customer/register', {}],
      ['other-customer', '/api/auth/customer/register', {}],
      ['restaurant', '/api/auth/restaurant/register', { businessType: 'restaurant', acceptTerms: true }],
      ['other-restaurant', '/api/auth/restaurant/register', { businessType: 'restaurant', acceptTerms: true }],
      ['truck', '/api/auth/restaurant/register', { businessType: 'food_truck', acceptTerms: true }],
      ['host', '/api/auth/customer/register', { accountType: 'host' }],
      ['supplier', '/api/auth/supplier/register', {}],
      ['coordinator', '/api/auth/customer/register', { accountType: 'event_coordinator' }],
    ];
    let sequence = 0;
    for (const [label, endpoint, extra] of definitions) {
      await test('register, verify and authenticate ' + label + ' through production HTTP handlers', async () => {
        const input = { email: 'qa-' + label + '-' + randomUUID() + '@example.invalid',
          firstName: 'QA ONLY', lastName: label, phone: '202555' + String(100 + sequence++).padStart(4, '0'), password, ...extra };
        const created = await request(endpoint, input);
        assert.equal(created.status, 201, JSON.stringify(created.data));
        assert.equal(created.data.requiresEmailVerification, true);
        const user = await storage.getUserByEmail(input.email);
        assert.ok(user?.id); assert.notEqual(user.passwordHash, password);
        assert.equal(await bcrypt.compare(password, user.passwordHash), true);
        assert.equal(Boolean(user.emailVerified), false);
        assert.ok(!['admin', 'super_admin', 'duper_admin', 'staff'].includes(user.userType));
        const unverified = await request('/api/auth/login', { email: input.email, password });
        assert.equal(unverified.status, 403); assert.equal(unverified.data.code, 'email_not_verified');
        // Force the production resend handler to generate a verification link;
        // captured delivery is awaited, never sent to a mailbox.
        const resent = await request('/api/auth/resend-verification', { email: input.email });
        assert.equal(resent.status, 200);
        const mail = globalThis.__msQaMail.filter(m => m.args[0]?.id === user.id).at(-1);
        const verifyLink = mail?.args.find(arg => typeof arg === 'string' && arg.includes('/api/auth/verify-email?'));
        assert.ok(verifyLink, 'Production verification link must reach the email sink');
        const verifyUrl = new URL(verifyLink);
        assert.equal(verifyUrl.origin, origin);
        const verified = await request(verifyUrl.pathname + verifyUrl.search);
        assert.ok([200, 302, 303].includes(verified.status), 'Verification response: ' + verified.status);
        assert.equal((await storage.getUserByEmail(input.email)).emailVerified, true);
        const login = await request('/api/auth/login', { email: input.email, password });
        assert.equal(login.status, 200, JSON.stringify(login.data));
        assert.equal(login.data.user.id, user.id);
        assert.ok(!('passwordHash' in login.data.user), 'Password hash must not be serialized');
        assert.ok(login.cookie); assert.match(login.cookieHeader, /HttpOnly/i);
        const session = await request('/__qa/session', undefined, login.cookie);
        assert.equal(session.status, 200); assert.equal(session.data.id, user.id);
        actors.push({ input, user, cookie: login.cookie, endpoint });
      });
    }
    await test('wrong password does not establish an authenticated session', async () => {
      assert.ok(actors.length); const result = await request('/api/auth/login', { email: actors[0].input.email, password: password + 'wrong' });
      assert.equal(result.status, 401); assert.ok(!result.data.user);
      assert.equal((await request('/__qa/session', undefined, result.cookie)).status, 401);
    });
    await test('separate session cookies resolve separate registered users', async () => {
      assert.ok(actors.length >= 2); const a = await request('/__qa/session', undefined, actors[0].cookie);
      const b = await request('/__qa/session', undefined, actors[1].cookie);
      assert.notEqual(a.data.id, b.data.id); assert.equal(a.data.id, actors[0].user.id); assert.equal(b.data.id, actors[1].user.id);
    });
    await test('duplicate email cannot create a second verified account', async () => {
      assert.ok(actors.length); const count = await pg.query('SELECT count(*)::int AS count FROM users');
      const duplicate = await request(actors[0].endpoint, actors[0].input);
      assert.equal(duplicate.status, 409); assert.equal(duplicate.data.code, 'email_already_verified');
      assert.deepEqual((await pg.query('SELECT count(*)::int AS count FROM users')).rows, count.rows);
    });
    await test('restaurant terms and weak-password checks reject before storage', async () => {
      const input = { email: 'qa-invalid@example.invalid', firstName: 'QA ONLY', lastName: 'Rejected', phone: '2025550189', password };
      assert.equal((await request('/api/auth/restaurant/register', { ...input, acceptTerms: false })).status, 400);
      assert.equal((await request('/api/auth/customer/register', { ...input, password: 'weak' })).status, 400);
      assert.equal(await storage.getUserByEmail(input.email), undefined);
    });
    await test('public registration cannot request an admin role', async () => {
      const input = { email: 'qa-role-injection@example.invalid', firstName: 'QA ONLY', lastName: 'No admin', phone: '2025550190', password, userType: 'admin', roles: ['admin'] };
      const response = await request('/api/auth/customer/register', input);
      assert.equal(response.status, 201); const user = await storage.getUserByEmail(input.email);
      assert.equal(user.userType, 'customer');
    });
    await test('resend verification does not enumerate unknown accounts', async () => {
      const unknown = await request('/api/auth/resend-verification', { email: 'qa-never-created@example.invalid' });
      const known = await request('/api/auth/resend-verification', { email: actors[0]?.input.email });
      assert.equal(unknown.status, 200); assert.deepEqual(unknown.data, known.data);
    });
    await test('logout invalidates the authenticated cookie', async () => {
      const logout = registered.find(r => r.path === '/api/auth/logout' || r.path === '/api/logout');
      assert.ok(logout, 'Production logout route must exist');
      const result = await request(logout.path, logout.methods.post ? {} : undefined, actors[0]?.cookie);
      assert.ok([200, 204, 302, 303].includes(result.status));
      assert.equal((await request('/__qa/session', undefined, actors[0]?.cookie)).status, 401);
    });
    await test('registered restaurant owner creates a persisted menu over authenticated HTTP', async () => {
      const owner = actors.find(actor => actor.input.lastName === 'restaurant');
      const other = actors.find(actor => actor.input.lastName === 'other-restaurant');
      assert.ok(owner && other, 'Registered owners required');
      const restaurantId = randomUUID();
      await database.insert(schema.restaurants).values({ id: restaurantId, ownerId: owner.user.id,
        name: 'QA ONLY isolated restaurant', address: 'QA fixture address, not a public location', isActive: false });
      const body = { restaurantId, name: 'QA ONLY lunch menu', serviceType: 'lunch' };
      const key = randomUUID();
      const endpoint = '/api/owner/menus/create';
      const anonymous = await request(endpoint, body, undefined, { 'Idempotency-Key': key });
      assert.equal(anonymous.status, 401);
      const customer = await request(endpoint, body, actors[1].cookie, { 'Idempotency-Key': key });
      assert.equal(customer.status, 403);
      const denied = await request(endpoint, body, other.cookie, { 'Idempotency-Key': key });
      assert.equal(denied.status, 403);
      const first = await request(endpoint, body, owner.cookie, { 'Idempotency-Key': key });
      assert.equal(first.status, 201, JSON.stringify(first.data));
      const rows = await database.select().from(schema.menus).where(eq(schema.menus.id, key));
      assert.equal(rows.length, 1); assert.equal(rows[0].restaurantId, restaurantId);
      const receipts = await database.select().from(schema.lisaClaims).where(eq(schema.lisaClaims.id, key));
      assert.equal(receipts.length, 1); assert.equal(receipts[0].actorId, owner.user.id);
      const replay = await request(endpoint, body, owner.cookie, { 'Idempotency-Key': key });
      assert.equal(replay.status, 200, JSON.stringify(replay.data));
      const changed = await request(endpoint, { ...body, name: 'Changed request' }, owner.cookie, { 'Idempotency-Key': key });
      assert.equal(changed.status, 409);
      const stolen = await request(endpoint, body, other.cookie, { 'Idempotency-Key': key });
      assert.equal(stolen.status, 403);
      assert.equal((await database.select().from(schema.menus).where(eq(schema.menus.id, key))).length, 1);
    });
    // Drain the explicitly fire-and-forget welcome/email bookkeeping before close.
    await pause(200);
    console.log('QA AUTH SUMMARY ' + JSON.stringify({ scope: 'Real unifiedAuth/DatabaseStorage/bcrypt/Passport HTTP with fresh PGlite; MemoryStore + captured delivery; not production/OAuth',
      actors: actors.length, pass: results.filter(r => r.status === 'pass').length, fail: results.filter(r => r.status === 'fail').length, results }));
    assert.equal(results.filter(r => r.status === 'fail').length, 0, 'Backend auth integration failures');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await pg.close();
  }
}
`;
(async () => {
  const result = await build({ stdin: { contents: source, resolveDir: root, sourcefile: 'qa-auth-entry.ts', loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', packages: 'external', write: false,
    alias: { '@shared': path.join(root, 'shared'), '@': path.join(root, 'client/src') },
    plugins: [{ name: 'isolated-qa-adapters', setup(builder) {
      builder.onResolve({ filter: /^connect-pg-simple$/ }, () => ({ path: 'qa-session-store', namespace: 'qa' }));
      builder.onResolve({ filter: /(?:^|\/)(?:db|emailService|smsService)(?:\.ts)?$/ }, args => {
        if (!args.path.startsWith('.')) return;
        const filename = path.resolve(args.resolveDir, args.path.replace(/\.ts$/, '') + '.ts');
        if (filename in replacements) return { path: filename, namespace: 'qa' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'qa' }, args => ({ contents: args.path === 'qa-session-store'
        ? 'export default function connect(session) { return class QaSessionStore extends session.MemoryStore { constructor() { super(); } }; }'
        : replacements[args.path], loader: 'js', resolveDir: root }));
    }}],
  });
  const module = new Module(path.join(root, 'scripts/qa/.auth-compiled.cjs'));
  module.filename = path.join(root, 'scripts/qa/.auth-compiled.cjs');
  module.paths = Module._nodeModulePaths(root);
  module._compile(result.outputFiles[0].text, module.filename);
  await module.exports.run();
  assert.deepEqual(blocked, [], 'No unexpected outbound sockets');
})().catch(error => { console.error(error); process.exitCode = 1; });
