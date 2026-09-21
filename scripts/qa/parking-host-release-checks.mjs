/** Exact-source release verification on owned loopback infrastructure.
 * Uses the real deploy migration runner with only the Postgres wire transport
 * adapted from Neon WebSockets to native pg. No SQL edits or skipped migrations.
 * This is not a production drain, live provider transaction, or deployment.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { build } from 'esbuild';
const ownFile = fileURLToPath(import.meta.url);
const digest = data => createHash('sha256').update(data).digest('hex');
const toolingEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|HOME|TMPDIR|TMP|TEMP|LANG|LC_ALL|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS)$/.test(k)));
const git = (root, ...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
function manifest(root) {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  return { files: paths.length, sha256: digest(paths.map(p => p + '\0' + digest(fs.readFileSync(path.join(root, p)))).join('\n')) };
}
async function execute(root, out, name, command, args, env = {}, timeout = 600000) {
  const step = { name, command: [command, ...args], startedAt: new Date().toISOString(), result: 'running' };
  const logPath = path.join(out, name + '.log');
  const stream = fs.createWriteStream(logPath);
  const checksum = createHash('sha256');
  let tail = '';
  console.log('HOST_RELEASE_STEP_START ' + name);
  try {
    const result = await new Promise(resolve => {
      const child = spawn(command, args, { cwd: root, env: { ...toolingEnv(), CI: 'true', TZ: 'UTC', ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout });
      const output = data => { checksum.update(data); stream.write(data); tail = (tail + String(data)).slice(-12000); };
      child.stdout.on('data', output); child.stderr.on('data', output);
      child.once('error', error => resolve({ error: String(error) }));
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    Object.assign(step, result);
    step.result = result.code === 0 ? 'pass' : 'fail';
  } finally {
    await new Promise(resolve => stream.end(resolve));
    step.logSha256 = checksum.digest('hex');
    step.finishedAt = new Date().toISOString();
    if (step.result !== 'pass') step.failureTail = tail;
    console.log('HOST_RELEASE_STEP_END ' + JSON.stringify(step));
  }
  return step;
}
export async function runReleaseChecks({ root, out, source }) {
  assert.equal(process.env.MEALSCOUT_HOST_ROUTE_PROOF, '1');
  assert.equal(process.env.MEALSCOUT_HOST_ROUTE_RELEASE_CHECKS, '1');
  assert.equal(git(root, 'rev-parse', 'HEAD'), source);
  assert.equal(git(root, 'status', '--porcelain'), '');
  const report = { source, tree: git(root, 'rev-parse', 'HEAD^{tree}'), node: process.version, startedAt: new Date().toISOString(), sourceBefore: manifest(root), steps: [], passed: false, scope: 'Exact integrated source: type/build, affected existing regressions and native full migration-chain rehearsal. No live payment, production data or old-worker drain.' };
  const emptyEnv = path.join(out, 'release-empty.env'); fs.writeFileSync(emptyEnv, '');
  const env = { DOTENV_CONFIG_PATH: emptyEnv, NODE_OPTIONS: '--max-old-space-size=4096' };
  const checks = [
    ['typecheck', 'npm', ['run', 'check']],
    ['parking-expiry-compatibility', process.execPath, ['scripts/qa/parking-hold-expiry.integration.test.mjs']],
    ['parking-durable-compatibility', process.execPath, ['scripts/qa/parking-durability.integration.test.mjs']],
    ['parking-recovery-compatibility', process.execPath, ['scripts/qa/parking-reconciliation.integration.test.mjs']],
    ['parking-client-request-policy', process.execPath, ['--test', 'scripts/qa/parking-booking-request.test.cjs']],
    ['stripe-webhook-safety', 'npm', ['run', 'test:stripe-webhook-safety']],
    ['migration-deploy-contract', process.execPath, ['--import', 'tsx', 'scripts/mealscout-render-migration-gate.contract.test.ts']],
    ['frozen-cleanup-safety', process.execPath, ['--import', 'tsx', 'scripts/frozen-cleanup-safety.contract.test.ts']],
    ['preserved-acquisition-routing', process.execPath, ['--test', 'scripts/acquisition-edge-routing.contract.test.mjs']],
    ['production-build', 'npm', ['run', 'build:platform']],
  ];
  // Resolve the next dependency first. A failed migration is retained, and the
  // untouched broader checks are explicitly not run rather than called passing.
  report.steps.push(await execute(root, out, 'native-deploy-migrations', process.execPath, [ownFile, '--migrations'], {
    ...env, MEALSCOUT_MIGRATION_REHEARSAL: '1', MEALSCOUT_NATIVE_PG_BIN: process.env.MEALSCOUT_NATIVE_PG_BIN,
    MEALSCOUT_REHEARSAL_SOURCE: source,
  }));
  const migrationReport = path.join(out, 'migration-rehearsal.json');
  if (fs.existsSync(migrationReport)) report.migrations = JSON.parse(fs.readFileSync(migrationReport, 'utf8'));
  if (report.steps[0].result === 'pass') {
    for (const [name, command, args] of checks) report.steps.push(await execute(root, out, name, command, args, env));
  } else {
    report.notRun = checks.map(([name]) => ({ name, reason: 'Native migration prerequisite failed; prior receipts retain their original source' }));
  }
  report.sourceAfter = manifest(root);
  report.finalSourceClean = git(root, 'rev-parse', 'HEAD') === source && git(root, 'status', '--porcelain') === '' && report.sourceBefore.sha256 === report.sourceAfter.sha256;
  report.passed = report.steps.length === checks.length + 1 && report.steps.every(s => s.result === 'pass') && report.finalSourceClean && report.migrations?.passed === true;
  report.result = report.passed ? 'pass' : 'fail'; report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'release-checks.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
async function freePort() {
  const server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function closedPort(port) {
  return new Promise(resolve => { const socket = net.createConnection({ host: '127.0.0.1', port }); let done = false;
    const finish = error => { if (done) return; done = true; socket.destroy(); resolve({ port, closed: error === 'ECONNREFUSED', error }); };
    socket.once('connect', () => finish('STILL_OPEN')); socket.once('error', e => finish(e.code)); socket.setTimeout(2000, () => finish('TIMEOUT'));
  });
}
async function rehearseMigrations() {
  const root = path.resolve(path.dirname(ownFile), '../..'), out = path.join(root, '.qa-evidence/host-route-native');
  assert.equal(process.env.MEALSCOUT_MIGRATION_REHEARSAL, '1'); assert.notEqual(process.getuid?.(), 0);
  for (const [k, v] of Object.entries(process.env)) if (/DATABASE_URL|^PG(?:HOST|PORT|USER|PASSWORD|DATABASE)$|STRIPE.*(?:KEY|SECRET)|BREVO|SENDGRID|SMTP|SESSION_SECRET/.test(k)) assert.ok(!v, 'No inherited credentials: ' + k);
  assert.equal(git(root, 'rev-parse', 'HEAD'), process.env.MEALSCOUT_REHEARSAL_SOURCE);
  const bin = process.env.MEALSCOUT_NATIVE_PG_BIN; assert.ok(bin && path.isAbsolute(bin));
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'mealscout-migration-rehearsal-')), data = path.join(owned, 'data');
  const report = { source: process.env.MEALSCOUT_REHEARSAL_SOURCE, startedAt: new Date().toISOString(), passed: false, scope: 'Actual runDeployMigrations and all canonical SQL on a new owned native cluster; only Neon-to-native connection transport is adapted. Does not run against production.', files: {}, cleanup: {} };
  let started = false, pool, port;
  try {
    port = await freePort();
    execFileSync(path.join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'qa_owner', '--no-locale', '-E', 'UTF8'], { stdio: 'pipe' });
    execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(owned, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${owned} -c timezone=UTC -c max_connections=24`, '-w', 'start'], { stdio: 'pipe' }); started = true;
    const database = 'mealscout_release_' + randomUUID().replaceAll('-', '');
    const admin = new pg.Client({ connectionString: `postgresql://qa_owner@127.0.0.1:${port}/postgres` });
    await admin.connect(); try { await admin.query('CREATE DATABASE ' + database); } finally { await admin.end(); }
    const url = `postgresql://qa_owner@127.0.0.1:${port}/${database}`; assert.equal(new URL(url).hostname, '127.0.0.1');
    pool = new pg.Pool({ connectionString: url, max: 4 });
    assert.equal((await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n, 0);
    report.database = { version: (await pool.query('SELECT version() v')).rows[0].v, port, listen: '127.0.0.1', initialPublicTables: 0 };
    const bundle = path.join(out, 'deploy-migrations.cjs');
    const buildResult = await build({ stdin: { contents: 'export * from "./scripts/runDeployMigrations"; export {splitSqlStatements} from "./scripts/sqlMigrationStatements";', resolveDir: root, loader: 'ts' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external', metafile: true,
      define: { 'import.meta.url': JSON.stringify(pathToFileURL(path.join(root, 'scripts/runDeployMigrations.ts')).href) },
      plugins: [{ name: 'native-postgres-transport-only', setup(b) { b.onResolve({ filter: /^@neondatabase\/serverless$/ }, () => ({ path: 'native-pg', namespace: 'qa' })); b.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: 'export { Pool } from "pg"; export const neonConfig = {};', loader: 'js', resolveDir: root })); } }],
    });
    for (const p of Object.keys(buildResult.metafile.inputs)) if (!p.startsWith('qa:') && p !== '<stdin>') report.files[p] = digest(fs.readFileSync(path.resolve(root, p)));
    for (const p of fs.readdirSync(path.join(root, 'migrations')).filter(p => /^\d.*\.sql$/.test(p)).sort()) report.files['migrations/' + p] = digest(fs.readFileSync(path.join(root, 'migrations', p)));
    for (const p of ['scripts/qa/parking-migration-legacy-guards.mjs', 'scripts/qa/fixtures/migration142-before-legacy-guard.sql']) report.files[p] = digest(fs.readFileSync(path.join(root, p)));
    assert.ok(report.files['scripts/runDeployMigrations.ts']); assert.ok(report.files['scripts/sqlMigrationStatements.ts']);
    process.env.MIGRATION_DATABASE_URL = url;
    const api = createRequire(import.meta.url)(bundle);
    const { verifyMigration142LegacyGuards } = await import('./parking-migration-legacy-guards.mjs');
    report.legacyGuards = await verifyMigration142LegacyGuards({ pool, root, splitSqlStatements: api.splitSqlStatements });
    assert.equal(report.legacyGuards.passed, true, 'Native historical guard regressions must pass');
    assert.equal((await pool.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n, 0);
    await api.runDeployMigrations();
    const bootstrap = api.discoverBootstrapMigrations(), release = api.discoverDeployMigrations();
    const ledger = async () => ({ bootstrap: (await pool.query('SELECT filename,migration_number,sha256 FROM mealscout_schema_bootstrap_migrations ORDER BY filename')).rows, release: (await pool.query('SELECT filename,migration_number,sha256 FROM mealscout_release_migrations ORDER BY filename')).rows });
    const applied = await ledger(); assert.equal(applied.bootstrap.length, bootstrap.length); assert.equal(applied.release.length, release.length);
    assert.equal((await pool.query('SELECT status FROM mealscout_schema_bootstrap WHERE bootstrap_key=$1', [api.EMPTY_DATABASE_BOOTSTRAP_KEY])).rows[0].status, 'complete');
    report.chain = { bootstrap: bootstrap.length, release: release.length, lastMigration: release.at(-1).filename, complete: true };
    report.foreignKeys = (await pool.query("SELECT count(*)::int n FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace")).rows[0].n;
    assert.ok(report.foreignKeys > 0);
    report.bookingConstraints = (await pool.query("SELECT conname,contype,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='event_bookings'::regclass ORDER BY conname")).rows;
    const schema = createRequire(import.meta.url)(path.join(out, 'schema.cjs')), db = drizzle(pool);
    async function seed(table, values) {
      const payload = { ...values }; for (const [k, c] of Object.entries(table)) {
        if (!c?.notNull || c.default !== undefined || c.defaultFn || Object.hasOwn(payload, k)) continue;
        payload[k] = c.primary ? randomUUID() : c.dataType === 'date' ? new Date() : c.dataType === 'number' ? 0 : c.dataType === 'boolean' ? false : c.dataType === 'json' ? {} : c.enumValues?.[0] || 'qa_fixture';
      }
      return (await db.insert(table).values(payload).returning())[0];
    }
    const user = await seed(schema.users, { id: randomUUID(), email: 'qa-' + randomUUID() + '@example.invalid', userType: 'food_truck', emailVerified: true });
    const truck = await seed(schema.restaurants, { id: randomUUID(), ownerId: user.id, name: 'QA migration truck', businessType: 'food_truck', isFoodTruck: true });
    const host = await seed(schema.hosts, { id: randomUUID(), userId: user.id, businessName: 'QA migration host', city: 'Chicago', state: 'IL' });
    const event = await seed(schema.events, { id: randomUUID(), hostId: host.id, name: 'QA migration history', date: new Date(Date.now() + 14 * 86400000), eventType: 'parking_pass', status: 'open', requiresPayment: true, maxTrucks: 1 });
    const amounts = { eventId: event.id, truckId: truck.id, hostId: host.id, hostPriceCents: 1500, platformFeeCents: 1000, totalCents: 2500 };
    await seed(schema.eventBookings, { id: randomUUID(), ...amounts, status: 'cancelled', stripePaymentStatus: 'cancelled', cancellationReason: 'QA retained history', cancelledAt: new Date() });
    await seed(schema.eventBookings, { id: randomUUID(), ...amounts, status: 'pending', stripePaymentStatus: 'pending' });
    const snapshots = async () => (await pool.query('SELECT row_to_json(b) row FROM event_bookings b ORDER BY id')).rows;
    const before = await snapshots();
    await assert.rejects(seed(schema.eventBookings, { id: randomUUID(), ...amounts, status: 'confirmed' }), error => error?.code === '23505' || error?.cause?.code === '23505');
    await api.runDeployMigrations();
    assert.deepEqual(await ledger(), applied); assert.deepEqual(await snapshots(), before);
    const index = (await pool.query("SELECT indisunique,indisvalid,indisready,pg_get_expr(indpred,indrelid) predicate FROM pg_index WHERE indexrelid='uq_bookings_event_truck_active'::regclass")).rows[0];
    assert.equal(index.indisunique, true); assert.equal(index.indisvalid, true); assert.equal(index.indisready, true);
    report.history = { rowsPreserved: before.length, terminalAndActiveCoexist: true, activeDuplicateRejected: true, rerunLedgerUnchanged: true, activeIndex: index };
    report.passed = true;
  } catch (error) {
    report.error = String(error.stack || error);
    report.databaseError = { code: error.code, constraint: error.constraint, cause: error.cause ? { message: error.cause.message, code: error.cause.code, constraint: error.cause.constraint } : undefined };
    console.error(report.error, report.databaseError);
  } finally {
    delete process.env.MIGRATION_DATABASE_URL;
    if (pool) await pool.end();
    if (started) { try { execFileSync(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' }); report.cleanup.postgresStopped = true; } catch (error) { report.cleanup.stopFailure = String(error); report.passed = false; } }
    if (fs.existsSync(path.join(owned, 'postgres.log'))) fs.copyFileSync(path.join(owned, 'postgres.log'), path.join(out, 'migration-postgres.log'));
    if (!report.cleanup.stopFailure) { fs.rmSync(owned, { recursive: true, force: true }); report.cleanup.ownedDirectoryRemoved = true; }
    if (started && !report.cleanup.stopFailure) { report.cleanup.port = await closedPort(port); if (!report.cleanup.port.closed) report.passed = false; }
    report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(out, 'migration-rehearsal.json'), JSON.stringify(report, null, 2) + '\n');
    const summary = { ...report, files: undefined, filesManifest: { count: Object.keys(report.files).length, sha256: digest(JSON.stringify(report.files)) } };
    console.log('HOST_MIGRATION_REHEARSAL ' + JSON.stringify(summary)); process.exitCode = report.passed ? 0 : 1;
  }
}
if (process.argv.includes('--migrations') && path.resolve(process.argv[1] || '') === ownFile) await rehearseMigrations();
