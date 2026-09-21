/** Native regression for the actual migration-016 unnamed unique constraint.
 * The retained pre-repair142 SQL is executed unchanged to reproduce the defect.
 * Every case uses an owned schema; no customer rows or external provider calls.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyMigration142LegacyGuards({ pool, root, splitSqlStatements }) {
  const files = {
    legacy: 'migrations/016_add_stripe_payments.sql',
    baseline: 'scripts/qa/fixtures/migration142-before-legacy-guard.sql',
    candidate: 'migrations/142_parking_pass_active_booking_uniqueness.sql',
  };
  const source = Object.fromEntries(Object.entries(files).map(([key, p]) => [key, fs.readFileSync(path.join(root, p), 'utf8')]));
  assert.equal(digest(source.baseline), 'ff624c99eaf6aeca4f2b994185103820c9c742ea9a7f5e756dab0c8de037310e');
  const report = { cases: [], files: Object.fromEntries(Object.entries(files).map(([key, p]) => [p, digest(source[key])])), passed: false };
  async function test(name, fn) {
    const namespace = 'ms142_' + randomUUID().replaceAll('-', '');
    const client = await pool.connect();
    try {
      await client.query('CREATE SCHEMA ' + namespace);
      await client.query('SET search_path TO ' + namespace + ', public');
      await client.query('CREATE TABLE hosts(id varchar PRIMARY KEY); CREATE TABLE restaurants(id varchar PRIMARY KEY); CREATE TABLE events(id varchar PRIMARY KEY)');
      for (const statement of splitSqlStatements(source.legacy)) await client.query(statement);
      await client.query("INSERT INTO hosts(id) VALUES('host'); INSERT INTO restaurants(id) VALUES('truck'); INSERT INTO events(id) VALUES('event')");
      const apply = async text => {
        await client.query('BEGIN');
        try { for (const statement of splitSqlStatements(text)) await client.query(statement); await client.query('COMMIT'); }
        catch (error) { await client.query('ROLLBACK'); throw error; }
      };
      const seed = status => client.query("INSERT INTO event_bookings(id,event_id,truck_id,host_id,host_price_cents,platform_fee_cents,total_cents,status) VALUES($1,'event','truck','host',1500,1000,2500,$2) RETURNING id", [randomUUID(), status]);
      const snapshot = async () => (await client.query('SELECT row_to_json(b) row FROM event_bookings b ORDER BY id')).rows;
      const constraints = async () => (await client.query("SELECT conname,contype,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE conrelid='event_bookings'::regclass ORDER BY conname")).rows;
      const evidence = await fn({ client, apply, seed, snapshot, constraints });
      report.cases.push({ name, result: 'pass', evidence });
    } catch (error) {
      report.cases.push({ name, result: 'fail', error: String(error.stack || error), code: error.code, constraint: error.constraint, cause: error.cause ? { message: error.cause.message, code: error.cause.code, constraint: error.cause.constraint } : undefined });
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.query('SET search_path TO public');
      await client.query('DROP SCHEMA ' + namespace + ' CASCADE');
      client.release();
    }
    console.log('HOST_LEGACY_GUARD_CASE ' + JSON.stringify(report.cases.at(-1)));
  }
  await test('retained baseline reproduces the generated legacy constraint; repaired142 preserves history and rebooking', async ({ apply, seed, snapshot, constraints }) => {
    const beforeGuards = await constraints();
    assert.ok(beforeGuards.some(c => c.conname === 'event_bookings_event_id_truck_id_key'));
    await seed('cancelled'); const original = await snapshot();
    await apply(source.baseline);
    let baselineError;
    try { await seed('pending'); } catch (error) { baselineError = error; }
    assert.equal(baselineError?.code, '23505');
    assert.equal(baselineError?.constraint, 'event_bookings_event_id_truck_id_key');
    assert.deepEqual(await snapshot(), original);
    await apply(source.candidate); await seed('pending');
    const after = await snapshot(); assert.equal(after.length, 2);
    assert.deepEqual(after.find(r => r.row.id === original[0].row.id), original[0]);
    await assert.rejects(seed('confirmed'), error => error.code === '23505' && error.constraint === 'uq_bookings_event_truck_active');
    await apply(source.candidate); assert.deepEqual(await snapshot(), after);
    return { baselineCode: baselineError.code, baselineConstraint: baselineError.constraint, rowsPreserved: 2, activeDuplicateRejected: true, rerunUnchanged: true };
  });
  await test('both known historical constraints are replaced only after active protection is valid', async ({ client, apply, seed, snapshot, constraints }) => {
    await client.query('ALTER TABLE event_bookings ADD CONSTRAINT uq_bookings_event_truck UNIQUE(event_id,truck_id)');
    await seed('cancelled'); const before = await snapshot();
    await apply(source.candidate); await seed('pending');
    assert.deepEqual((await snapshot()).find(r => r.row.id === before[0].row.id), before[0]);
    assert.ok(!(await constraints()).some(c => ['uq_bookings_event_truck','event_bookings_event_id_truck_id_key'].includes(c.conname)));
    return { terminalRowPreserved: true, activeBookingCreated: true };
  });
  await test('a standalone named legacy unique index is safely replaced', async ({ client, apply, seed, snapshot }) => {
    await client.query('ALTER TABLE event_bookings DROP CONSTRAINT event_bookings_event_id_truck_id_key');
    await client.query('CREATE UNIQUE INDEX uq_bookings_event_truck ON event_bookings(event_id,truck_id)');
    await seed('cancelled'); const before = await snapshot(); await apply(source.candidate); await seed('pending');
    assert.equal((await snapshot()).length, 2);
    assert.deepEqual((await snapshot()).find(r => r.row.id === before[0].row.id), before[0]);
    assert.equal((await client.query("SELECT to_regclass('uq_bookings_event_truck') IS NULL gone")).rows[0].gone, true);
    return { legacyIndexRemoved: true, terminalRowPreserved: true };
  });
  for (const [label, sql] of [
    ['nonunique replacement', 'CREATE INDEX uq_bookings_event_truck_active ON event_bookings(event_id,truck_id)'],
    ['wrong replacement key', "CREATE UNIQUE INDEX uq_bookings_event_truck_active ON event_bookings(event_id,id) WHERE status IN ('pending','confirmed')"],
    ['incomplete replacement predicate', "CREATE UNIQUE INDEX uq_bookings_event_truck_active ON event_bookings(event_id,truck_id) WHERE status='pending'"],
    ['all-history replacement', 'CREATE UNIQUE INDEX uq_bookings_event_truck_active ON event_bookings(event_id,truck_id)'],
  ]) await test(label + ' cannot remove the generated historical guard', async ({ client, apply, constraints }) => {
    await client.query(sql); const before = await constraints();
    await assert.rejects(apply(source.candidate), error => error.code === '55000');
    assert.deepEqual(await constraints(), before); return { rejected: true, oldGuardRetained: true };
  });
  for (const name of ['uq_bookings_event_truck', 'event_bookings_event_id_truck_id_key']) await test('wrong definition under ' + name + ' fails before either old guard is removed', async ({ client, apply, constraints }) => {
    await client.query('ALTER TABLE event_bookings DROP CONSTRAINT event_bookings_event_id_truck_id_key');
    for (const guard of ['uq_bookings_event_truck','event_bookings_event_id_truck_id_key']) {
      await client.query('ALTER TABLE event_bookings ADD CONSTRAINT ' + guard + ' UNIQUE(' + (guard === name ? 'event_id,id' : 'event_id,truck_id') + ')');
    }
    const before = await constraints();
    await assert.rejects(apply(source.candidate), error => error.code === '55000');
    assert.deepEqual(await constraints(), before); return { rejected: true, bothLegacyGuardsRetained: true };
  });
  await test('a same-named legacy index on another table is not removed', async ({ client, apply, constraints }) => {
    await client.query('CREATE TABLE other_bookings(event_id varchar,truck_id varchar); CREATE UNIQUE INDEX uq_bookings_event_truck ON other_bookings(event_id,truck_id)');
    const before = await constraints(); await assert.rejects(apply(source.candidate), error => error.code === '55000');
    assert.deepEqual(await constraints(), before);
    assert.equal((await client.query("SELECT indrelid='other_bookings'::regclass same_owner FROM pg_index WHERE indexrelid='uq_bookings_event_truck'::regclass")).rows[0].same_owner, true);
    return { rejected: true, unrelatedIndexRetained: true, historicalGuardRetained: true };
  });
  await test('existing active duplicates stop migration without deleting history', async ({ client, apply, seed, snapshot }) => {
    await client.query('ALTER TABLE event_bookings DROP CONSTRAINT event_bookings_event_id_truck_id_key');
    await seed('cancelled'); await seed('pending'); await seed('confirmed'); const before = await snapshot();
    await assert.rejects(apply(source.candidate), error => error.code === '23505');
    assert.deepEqual(await snapshot(), before); return { rejected: true, allThreeRowsPreserved: true };
  });
  report.passed = report.cases.length === 11 && report.cases.every(c => c.result === 'pass');
  return report;
}
