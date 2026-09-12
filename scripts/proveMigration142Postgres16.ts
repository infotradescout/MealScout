import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { startNativePostgres16 } from "./nativePostgres16Fixture";

const nativeBinDirectory = process.argv.find(arg => arg.startsWith("--native-pg-bin="))?.slice("--native-pg-bin=".length);
let nativeFixture: Awaited<ReturnType<typeof startNativePostgres16>> | undefined;

const dockerCandidates = [
  process.env.DOCKER_BIN,
  "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
  "docker",
].filter((candidate): candidate is string => Boolean(candidate));

const dockerBin =
  dockerCandidates.find((candidate) =>
    candidate === "docker" ? true : existsSync(candidate),
  ) || "docker";
const containerName = `mealscout-m142-${process.pid}-${Date.now()}`.toLowerCase();
const password = "migration142-disposable-proof";
const migration = readFileSync(
  resolve("migrations/142_integrated_marketplace_purchase_review_arrival.sql"),
  "utf8",
);

type DockerResult = ReturnType<typeof spawnSync>;

const nativeCommand = (args: string[]) => {
  assert.equal(args[0], "exec", "Native fixture only accepts database commands");
  const containerIndex = args.indexOf(containerName);
  assert.ok(containerIndex > 0, "Missing owned fixture command target");
  const applicationName = args.find(arg => arg.startsWith("PGAPPNAME="))?.slice("PGAPPNAME=".length);
  return { program: args[containerIndex + 1], args: args.slice(containerIndex + 2), applicationName };
};

const fixture = (args: string[], input?: string): DockerResult => {
  if (nativeFixture) {
    const command = nativeCommand(args);
    return nativeFixture.run(command.program, command.args, input, command.applicationName);
  }
  return spawnSync(dockerBin, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    input,
    maxBuffer: 20 * 1024 * 1024,
  });
};

const fixtureAsync = (args: string[], input: string) => {
  if (nativeFixture) {
    const command = nativeCommand(args);
    return nativeFixture.runAsync(command.program, command.args, input, command.applicationName);
  }
  return new Promise<{ status: number; stdout: string; stderr: string }>((resolveRun) => {
    const child = spawn(dockerBin, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      resolveRun({ status: status ?? 1, stdout, stderr });
    });
    child.stdin.end(input);
  });
};

const describeFailure = (label: string, result: DockerResult) => {
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  throw new Error(
    `${label} failed with exit ${String(result.status)}${
      output ? `:\n${output}` : ""
    }`,
  );
};

const sql = (statement: string, label: string) => {
  const result = fixture(
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    statement,
  );
  if (result.status !== 0) describeFailure(label, result);
  return String(result.stdout || "").trim();
};

const scalar = (statement: string, label: string) => {
  const result = fixture(
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    statement,
  );
  if (result.status !== 0) describeFailure(label, result);
  return String(result.stdout || "").trim();
};

const expectSqlFailure = (
  label: string,
  statement: string,
  expected: RegExp,
) => {
  const result = fixture(
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    statement,
  );
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
  assert.match(output, expected, `${label} failed for the wrong reason`);
  console.log(`migration142 containment: ${label} blocked`);
};

const baseSchema = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id VARCHAR PRIMARY KEY,
  user_type VARCHAR NOT NULL DEFAULT 'customer',
  is_disabled BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE restaurants (
  id VARCHAR PRIMARY KEY,
  ordering_approved_at TIMESTAMP,
  ordering_approved_by_user_id VARCHAR,
  ordering_authority_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE hosts (
  id VARCHAR PRIMARY KEY
);

CREATE TABLE event_series (
  id VARCHAR PRIMARY KEY,
  host_id VARCHAR NOT NULL,
  coordinator_user_id VARCHAR,
  name VARCHAR NOT NULL DEFAULT 'Fixture series',
  description TEXT,
  timezone VARCHAR NOT NULL DEFAULT 'America/Chicago',
  recurrence_rule TEXT,
  start_date TIMESTAMP NOT NULL DEFAULT now(),
  end_date TIMESTAMP NOT NULL DEFAULT now() + interval '30 days',
  default_start_time VARCHAR NOT NULL DEFAULT '09:00',
  default_end_time VARCHAR NOT NULL DEFAULT '17:00',
  default_max_trucks INTEGER NOT NULL DEFAULT 1,
  default_hard_cap_enabled BOOLEAN NOT NULL DEFAULT false,
  series_type VARCHAR NOT NULL DEFAULT 'event',
  parking_pass_days_of_week JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_breakfast_price_cents INTEGER NOT NULL DEFAULT 0,
  default_lunch_price_cents INTEGER NOT NULL DEFAULT 0,
  default_dinner_price_cents INTEGER NOT NULL DEFAULT 0,
  default_daily_price_cents INTEGER NOT NULL DEFAULT 0,
  default_weekly_price_cents INTEGER NOT NULL DEFAULT 0,
  default_monthly_price_cents INTEGER NOT NULL DEFAULT 0,
  default_host_price_cents INTEGER NOT NULL DEFAULT 0,
  status VARCHAR NOT NULL DEFAULT 'draft',
  published_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id VARCHAR PRIMARY KEY,
  host_id VARCHAR,
  coordinator_user_id VARCHAR,
  series_id VARCHAR,
  event_type VARCHAR NOT NULL DEFAULT 'event',
  requires_payment BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE event_bookings (
  id VARCHAR PRIMARY KEY,
  event_id VARCHAR NOT NULL,
  truck_id VARCHAR NOT NULL,
  host_id VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'pending',
  host_price_cents INTEGER NOT NULL DEFAULT 0,
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  refund_amount_cents INTEGER NOT NULL DEFAULT 0,
  stripe_payment_intent_id VARCHAR,
  stripe_payment_status VARCHAR
);

CREATE TABLE host_earnings_ledger (
  id VARCHAR PRIMARY KEY,
  host_id VARCHAR NOT NULL,
  booking_id VARCHAR,
  stripe_payment_intent_id VARCHAR,
  amount_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE host_payout_requests (
  id VARCHAR PRIMARY KEY,
  host_id VARCHAR NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  status VARCHAR NOT NULL DEFAULT 'pending'
);
`;

const migrationTransaction = `
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
${migration}
COMMIT;
`;

const seedDestinationPurchase = `
INSERT INTO users (id, user_type) VALUES
  ('buyer-1', 'customer'),
  ('admin-1', 'admin');
INSERT INTO restaurants (id) VALUES ('truck-1'), ('truck-2');
INSERT INTO hosts (id) VALUES ('host-1'), ('host-2');
INSERT INTO events (id, requires_payment) VALUES
  ('paid-event', true),
  ('free-event', false);

BEGIN;
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO parking_pass_purchases (
  id, purchaser_user_id, truck_id, host_id,
  host_amount_cents, platform_fee_cents, charged_amount_cents,
  credit_applied_cents, stripe_destination_account_id,
  idempotency_key, request_digest, allocation_digest, allocation_line_count
) VALUES (
  'purchase-1', 'buyer-1', 'truck-1', 'host-1',
  1000, 150, 1150, 50, 'acct_host_1',
  'purchase-key-1', 'request-digest-1', 'allocation-digest-1', 1
);
INSERT INTO event_bookings (
  id, event_id, truck_id, host_id, status,
  host_price_cents, platform_fee_cents, total_cents,
  purchase_id, allocation_ordinal, allocation_digest,
  credit_applied_cents, settlement_topology
) VALUES (
  'booking-1', 'paid-event', 'truck-1', 'host-1', 'pending',
  1000, 150, 1150,
  'purchase-1', 1, 'allocation-digest-1', 50, 'destination_charge'
);
INSERT INTO event_bookings (
  id, event_id, truck_id, host_id, status,
  host_price_cents, platform_fee_cents, total_cents
) VALUES (
  'booking-2', 'free-event', 'truck-2', 'host-2', 'confirmed',
  0, 0, 0
);
COMMIT;
`;

const providerAndArrivalSeed = `
INSERT INTO parking_pass_provider_operations (
  id, purchase_id, operation_kind, request_id, idempotency_key,
  request_digest, actor_type, sorted_line_ids, allocation_digest,
  expected_currency, expected_amount_cents, expected_host_amount_cents,
  expected_application_fee_cents, expected_destination_account_id,
  idempotency_expires_at
) VALUES (
  'provider-op-1', 'purchase-1', 'payment_intent_create',
  'provider-request-1', 'provider-key-1', 'request-digest-1',
  'purchaser', '["booking-1"]'::jsonb, 'allocation-digest-1',
  'usd', 1150, 1000, 150, 'acct_host_1', now() + interval '24 hours'
);
INSERT INTO parking_pass_provider_operation_steps (
  id, operation_id, step_type, step_order, idempotency_key,
  request_digest, allocation_digest, expected_currency,
  expected_amount_cents, expected_destination_account_id,
  expected_application_fee_cents
) VALUES (
  'provider-step-1', 'provider-op-1', 'payment_intent_create', 1,
  'provider-step-key-1', 'request-digest-1', 'allocation-digest-1',
  'usd', 1150, 'acct_host_1', 150
);

INSERT INTO parking_pass_arrival_versions (
  id, booking_id, version, state, address, city, state_code,
  latitude, longitude, start_at, end_at, actor_type, reason,
  effective_at, acknowledged_by_user_id, acknowledged_at
) VALUES (
  'arrival-1', 'booking-1', 1, 'current', '10 Protected Way',
  'Austin', 'TX', 30.26720000, -97.74310000,
  '2026-09-01 10:00:00', '2026-09-01 14:00:00',
  'host_owner', 'Booked arrival', '2026-08-24 12:00:00',
  'buyer-1', '2026-08-24 12:05:00'
);
INSERT INTO parking_pass_arrival_versions (
  id, booking_id, version, state, address, city, state_code,
  start_at, end_at, actor_type, reason, effective_at
) VALUES (
  'arrival-2', 'booking-2', 1, 'current', '20 Other Way',
  'Dallas', 'TX', '2026-09-02 10:00:00', '2026-09-02 14:00:00',
  'host_owner', 'Other arrival', '2026-08-24 12:00:00'
);
UPDATE event_bookings
   SET current_arrival_version_id = 'arrival-1',
       arrival_state = 'acknowledged'
 WHERE id = 'booking-1';
`;

const mutationCancellationAndPayoutSeed = `
INSERT INTO event_bookings (
  id, event_id, truck_id, host_id, status,
  host_price_cents, platform_fee_cents, total_cents
) VALUES (
  'booking-mutation-pending', 'free-event', 'truck-2', 'host-2', 'pending',
  0, 0, 0
);

INSERT INTO event_participation_mutations (
  id, scope_kind, event_id, mutation_kind, request_id, idempotency_key,
  request_digest, actor_user_id, actor_type, authority_snapshot,
  expected_participation_version, target_event_ids, target_booking_ids,
  target_set_digest, expected_child_count, provider_required_count,
  requested_changes, status, suppression_reason
) VALUES (
  'mutation-event-1', 'event', 'free-event', 'correction',
  'mutation-request-1', 'mutation-key-1', 'mutation-digest-1',
  'admin-1', 'admin', '{"staff":true}'::jsonb, 0,
  '["free-event"]'::jsonb, '["booking-2"]'::jsonb,
  'mutation-target-digest-1', 2, 0,
  '{"startTime":"11:00"}'::jsonb, 'prepared',
  'Fixture mutation suppression'
);
INSERT INTO event_participation_mutation_children (
  id, mutation_id, event_id, child_kind, action_key, idempotency_key,
  request_digest, target_participation_version, target_facts,
  provider_required, status
) VALUES (
  'mutation-event-apply-1', 'mutation-event-1', 'free-event',
  'event_apply', 'event:free-event', 'mutation-child-key-apply-1',
  'mutation-child-digest-apply-1', 1, '{"eventId":"free-event"}'::jsonb,
  false, 'prepared'
);
INSERT INTO event_participation_mutation_children (
  id, mutation_id, event_id, booking_id, child_kind, action_key,
  idempotency_key, request_digest, target_participation_version,
  target_facts, provider_required, status,
  notification_target_user_id
) VALUES (
  'mutation-notice-1', 'mutation-event-1', 'free-event', 'booking-2',
  'notification', 'notification:booking-2', 'mutation-child-key-notice-1',
  'mutation-child-digest-notice-1', 1,
  '{"bookingId":"booking-2"}'::jsonb, false, 'notification_pending',
  'buyer-1'
);
UPDATE event_participation_mutations
   SET status = 'suppressed', started_at = now()
 WHERE id = 'mutation-event-1';
UPDATE events
   SET active_participation_mutation_id = 'mutation-event-1',
       participation_suppressed_at = now(),
       participation_suppression_reason = 'Fixture mutation suppression'
 WHERE id = 'free-event';
UPDATE event_bookings
   SET active_event_mutation_id = 'mutation-event-1',
       participation_visibility_state = 'suppressed'
 WHERE id = 'booking-2';
UPDATE event_participation_mutation_children
   SET status = 'converged',
       notification_delivery_state = 'provider_confirmed',
       notification_provider_message_id = 'fixture-provider-message-1',
       completed_at = now()
 WHERE id = 'mutation-notice-1';

INSERT INTO event_series (
  id, host_id, coordinator_user_id, series_type
) VALUES ('series-1', 'host-2', 'admin-1', 'event');
INSERT INTO events (
  id, host_id, coordinator_user_id, series_id, event_type, requires_payment
) VALUES (
  'series-event-1', 'host-2', 'admin-1', 'series-1', 'event', false
);
INSERT INTO event_bookings (
  id, event_id, truck_id, host_id, status,
  host_price_cents, platform_fee_cents, total_cents
) VALUES (
  'series-booking-1', 'series-event-1', 'truck-2', 'host-2', 'confirmed',
  0, 0, 0
);
INSERT INTO event_participation_mutations (
  id, scope_kind, series_id, mutation_kind, request_id, idempotency_key,
  request_digest, actor_user_id, actor_type, authority_snapshot,
  expected_participation_version, target_event_ids, target_booking_ids,
  target_set_digest, expected_child_count, provider_required_count,
  requested_changes, status, suppression_reason
) VALUES (
  'mutation-series-1', 'series', 'series-1', 'correction',
  'mutation-series-request-1', 'mutation-series-key-1',
  'mutation-series-digest-1', 'admin-1', 'admin',
  '{"coordinator":true}'::jsonb, 0,
  '["series-event-1"]'::jsonb, '["series-booking-1"]'::jsonb,
  'mutation-series-target-digest-1', 3, 0,
  '{"startTime":"12:00"}'::jsonb, 'prepared',
  'Fixture series mutation suppression'
);
INSERT INTO event_participation_mutation_children (
  id, mutation_id, child_kind, action_key, idempotency_key,
  request_digest, target_facts, status
) VALUES (
  'mutation-series-apply-1', 'mutation-series-1', 'series_apply',
  'series:series-1', 'mutation-series-child-key-1',
  'mutation-series-child-digest-1', '{"seriesId":"series-1"}'::jsonb,
  'prepared'
);
INSERT INTO event_participation_mutation_children (
  id, mutation_id, event_id, child_kind, action_key, idempotency_key,
  request_digest, target_participation_version, target_facts, status
) VALUES (
  'mutation-series-event-apply-1', 'mutation-series-1', 'series-event-1',
  'event_apply', 'event:series-event-1', 'mutation-series-event-key-1',
  'mutation-series-event-digest-1', 1,
  '{"eventId":"series-event-1"}'::jsonb, 'prepared'
);
INSERT INTO event_participation_mutation_children (
  id, mutation_id, event_id, booking_id, child_kind, action_key,
  idempotency_key, request_digest, target_participation_version,
  target_facts, status, notification_target_user_id
) VALUES (
  'mutation-series-notice-1', 'mutation-series-1', 'series-event-1',
  'series-booking-1', 'notification', 'notification:series-booking-1',
  'mutation-series-notice-key-1', 'mutation-series-notice-digest-1', 1,
  '{"bookingId":"series-booking-1"}'::jsonb,
  'notification_pending', 'buyer-1'
);
UPDATE event_participation_mutations
   SET status = 'suppressed', started_at = now()
 WHERE id = 'mutation-series-1';
UPDATE event_series
   SET active_participation_mutation_id = 'mutation-series-1',
       participation_suppressed_at = now(),
       participation_suppression_reason = 'Fixture series mutation suppression'
 WHERE id = 'series-1';
UPDATE events
   SET active_participation_mutation_id = 'mutation-series-1',
       participation_suppressed_at = now(),
       participation_suppression_reason = 'Fixture series mutation suppression'
 WHERE id = 'series-event-1';
UPDATE event_bookings
   SET active_event_mutation_id = 'mutation-series-1',
       participation_visibility_state = 'suppressed'
 WHERE id = 'series-booking-1';

INSERT INTO parking_pass_cancellation_operations (
  id, purchase_id, request_id, idempotency_key, booking_line_ids,
  request_digest, allocation_digest, actor_snapshot, policy_facts,
  actor_type, actor_user_id, reason, policy_trigger, remedy, amount_cents,
  expected_payment_intent_id, expected_charge_id, expected_currency,
  expected_cash_refund_cents, expected_host_reversal_cents,
  expected_application_fee_refund_cents, expected_destination_account_id,
  status
) VALUES (
  'cancellation-1', 'purchase-1', 'cancellation-request-1',
  'cancellation-key-1', '["booking-1"]'::jsonb,
  'cancellation-digest-1', 'allocation-digest-1',
  '{"actorType":"admin","actorUserId":"admin-1"}'::jsonb,
  '{"technicalNonService":false}'::jsonb,
  'admin', 'admin-1', 'Fixture future cancellation',
  'operator_before_start', 'none', 0,
  null, null, 'usd', 0, 0, 0, 'acct_host_1', 'pending'
);

INSERT INTO host_earnings_ledger (
  id, host_id, booking_id, stripe_payment_intent_id,
  settlement_topology, reconciliation_state, amount_cents
) VALUES (
  'legacy-eligible-ledger', 'host-2', null, null,
  'legacy_platform_hold', 'eligible_legacy', 4000
);
INSERT INTO host_payout_requests (
  id, host_id, amount_cents, status, funding_topology,
  eligibility_state, eligible_amount_snapshot_cents
) VALUES (
  'legacy-payout-1', 'host-2', 1000, 'processing',
  'legacy_platform_hold', 'eligible_legacy', 4000
);
INSERT INTO legacy_payout_provider_operations (
  id, payout_request_id, request_id, idempotency_key, request_digest,
  actor_user_id, expected_host_id, expected_amount_cents,
  expected_currency, expected_destination_account_id,
  expected_funding_topology, expected_eligible_amount_snapshot_cents,
  status, idempotency_expires_at
) VALUES (
  'legacy-payout-operation-1', 'legacy-payout-1',
  'legacy-payout-request-1', 'legacy-payout-key-1',
  'legacy-payout-digest-1', 'admin-1', 'host-2', 1000, 'usd',
  'acct_host_2', 'legacy_platform_hold', 4000,
  'prepared', now() + interval '24 hours'
);
`;

let started = false;
let baselineWriterPath = "";
let baselineRunnerPath = "";
try {
  if (nativeBinDirectory) {
    nativeFixture = await startNativePostgres16(nativeBinDirectory, password);
  } else {
    const start = fixture([
      "run", "-d", "--rm", "--name", containerName,
      "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${password}`,
      "postgres:16-alpine",
    ]);
    if (start.status !== 0) describeFailure("start PostgreSQL 16 container", start);
    started = true;
  }

  let stableReadyProbes = 0;
  let observedFinalStartup = false;
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const logs = nativeFixture ? undefined : fixture(["logs", containerName]);
    const logText = `${logs?.stdout || ""}\n${logs?.stderr || ""}`;
    const readyLogCount = (
      logText.match(/database system is ready to accept connections/gi) || []
    ).length;
    observedFinalStartup =
      Boolean(nativeFixture) ||
      (/PostgreSQL init process complete; ready for start up\./i.test(logText) &&
      readyLogCount >= 2);
    const probe = fixture([
      "exec",
      containerName,
      "psql",
      "-X",
      "-qAt",
      "-c",
      "SHOW server_version; SELECT 1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ]);
    const probeLines = String(probe.stdout || "")
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (
      observedFinalStartup &&
      probe.status === 0 &&
      /^16\./.test(probeLines[0] || "") &&
      probeLines.at(-1) === "1"
    ) {
      stableReadyProbes += 1;
      if (stableReadyProbes >= 4) break;
    } else {
      stableReadyProbes = 0;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  assert.equal(
    observedFinalStartup,
    true,
    "PostgreSQL 16 final server startup was not observed",
  );
  assert.equal(
    stableReadyProbes,
    4,
    "PostgreSQL 16 final server was not stable for four consecutive probes",
  );
  assert.match(
    scalar("SHOW server_version;", "read PostgreSQL version"),
    /^16\./,
  );

  sql(baseSchema, "create migration 142 base fixture");
  sql(migrationTransaction, "apply migration 142");
  sql(seedDestinationPurchase, "seed canonical destination purchase");

  const firstConcurrentPurchase = fixtureAsync(
    [
      "exec",
      "-e",
      "PGAPPNAME=migration142-concurrency-first",
      "-i",
      containerName,
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    `BEGIN;
     SET CONSTRAINTS ALL DEFERRED;
     INSERT INTO parking_pass_purchases (
       id, purchaser_user_id, truck_id, host_id,
       host_amount_cents, platform_fee_cents, charged_amount_cents,
       stripe_destination_account_id, idempotency_key, request_digest,
       allocation_digest, allocation_line_count
     ) VALUES (
       'purchase-concurrent-first', 'buyer-1', 'truck-1', 'host-1',
       50, 10, 60, 'acct_host_1', 'concurrent-purchase-key',
       'concurrent-request-digest', 'concurrent-allocation-digest', 1
     );
     INSERT INTO event_bookings (
       id, event_id, truck_id, host_id, status,
       host_price_cents, platform_fee_cents, total_cents,
       purchase_id, allocation_ordinal, allocation_digest, settlement_topology
     ) VALUES (
       'booking-concurrent-first', 'paid-event', 'truck-1', 'host-1', 'pending',
       50, 10, 60, 'purchase-concurrent-first', 1,
       'concurrent-allocation-digest', 'destination_charge'
     );
     SELECT pg_sleep(2);
     COMMIT;`,
  );
  let firstPurchaseHoldingUniqueKey = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    firstPurchaseHoldingUniqueKey =
      scalar(
        `SELECT count(*) FROM pg_stat_activity
          WHERE application_name = 'migration142-concurrency-first'
            AND wait_event = 'PgSleep';`,
        "observe concurrent purchase lock holder",
      ) === "1";
    if (firstPurchaseHoldingUniqueKey) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  assert.equal(
    firstPurchaseHoldingUniqueKey,
    true,
    "first concurrent purchase did not reach its held transaction",
  );
  const secondConcurrentPurchase = fixtureAsync(
    [
      "exec",
      "-e",
      "PGAPPNAME=migration142-concurrency-second",
      "-i",
      containerName,
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    `INSERT INTO parking_pass_purchases (
       id, purchaser_user_id, truck_id, host_id,
       host_amount_cents, platform_fee_cents, charged_amount_cents,
       stripe_destination_account_id, idempotency_key, request_digest,
       allocation_digest, allocation_line_count
     ) VALUES (
       'purchase-concurrent-second', 'buyer-1', 'truck-1', 'host-1',
       50, 10, 60, 'acct_host_1', 'concurrent-purchase-key',
       'different-request-digest', 'different-allocation-digest', 1
     );`,
  );
  const [firstConcurrentResult, secondConcurrentResult] = await Promise.all([
    firstConcurrentPurchase,
    secondConcurrentPurchase,
  ]);
  assert.equal(
    firstConcurrentResult.status,
    0,
    `first concurrent purchase failed: ${firstConcurrentResult.stderr}`,
  );
  assert.notEqual(
    secondConcurrentResult.status,
    0,
    "second concurrent purchase unexpectedly succeeded",
  );
  assert.match(
    secondConcurrentResult.stderr,
    /uq_parking_pass_purchase_idempotency/i,
  );
  assert.equal(
    scalar(
      `SELECT count(*) FROM parking_pass_purchases
        WHERE purchaser_user_id = 'buyer-1'
          AND idempotency_key = 'concurrent-purchase-key';`,
      "verify concurrent purchase convergence",
    ),
    "1",
  );
  console.log("migration142 concurrency: duplicate purchase converged");

  // Simulate a historical row written before the destination ledger guard, then
  // replay the migration so its classification and payout revalidation run.
  sql(
    `
    DROP TRIGGER trigger_guard_destination_legacy_ledger ON host_earnings_ledger;
    INSERT INTO host_earnings_ledger (
      id, host_id, booking_id, stripe_payment_intent_id, amount_cents
    ) VALUES (
      'historical-destination-ledger', 'host-1', 'booking-1', null, 1000
    );
    INSERT INTO host_payout_requests (id, host_id, amount_cents, status)
    VALUES ('historical-payout', 'host-1', 500, 'pending');
    `,
    "seed historical settlement rows",
  );
  sql(migrationTransaction, "replay migration 142 with historical rows");

  assert.equal(
    scalar(
      `SELECT concat_ws(':', purchase_id, settlement_topology, reconciliation_state)
         FROM host_earnings_ledger
        WHERE id = 'historical-destination-ledger';`,
      "verify destination ledger quarantine",
    ),
    "purchase-1:destination_charge:quarantined_destination",
  );
  assert.equal(
    scalar(
      `SELECT concat_ws(':', funding_topology, eligibility_state)
         FROM host_payout_requests WHERE id = 'historical-payout';`,
      "verify payout revalidation",
    ),
    "unclassified:requires_revalidation",
  );

  sql(providerAndArrivalSeed, "seed provider and arrival identities");
  assert.equal(
    scalar(
      `SELECT count(*) FROM parking_pass_provider_operation_steps
        WHERE operation_id = 'provider-op-1' AND status = 'prepared';`,
      "verify durable provider step",
    ),
    "1",
  );
  sql(
    mutationCancellationAndPayoutSeed,
    "seed mutation, cancellation, and legacy payout identities",
  );

  // Import the exact repository writer from the bound base revision and run
  // that old Drizzle path against the migrated disposable database. Live
  // participating supply must be fenced, while the identical old writer may
  // still normalize supply that is proven empty.
  let mappedPort = nativeFixture ? String(nativeFixture.port) : undefined;
  if (!nativeFixture) {
    const portResult = fixture(["port", containerName, "5432/tcp"]);
    if (portResult.status !== 0) {
      describeFailure("read disposable PostgreSQL port", portResult);
    }
    mappedPort = String(portResult.stdout || "").trim().match(/:(\d+)$/)?.[1];
  }
  assert.ok(mappedPort, "Fixture did not expose the disposable PostgreSQL port");
  const baselineSourceResult = spawnSync(
    "git",
    [
      "show",
      "6128fbc9539c27d70f937a7ffa1d619bf819c7b3:server/storage/hostsEventsRepository.ts",
    ],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
  if (baselineSourceResult.status !== 0) {
    throw new Error(
      `read bound baseline writer failed: ${String(baselineSourceResult.stderr || "")}`,
    );
  }
  const baselineSuffix = `${process.pid}-${Date.now()}`;
  baselineWriterPath = resolve(
    "server/storage",
    `.migration142-baseline-writer-${baselineSuffix}.ts`,
  );
  baselineRunnerPath = resolve(
    "server/storage",
    `.migration142-baseline-runner-${baselineSuffix}.ts`,
  );
  writeFileSync(baselineWriterPath, String(baselineSourceResult.stdout), "utf8");
  const baselineImport = `./${baselineWriterPath
    .replace(/\\/g, "/")
    .split("/")
    .at(-1)}`;
  writeFileSync(
    baselineRunnerPath,
    `import { createHostsEventsRepository } from ${JSON.stringify(baselineImport)};\n` +
      `import { pool } from "../db";\n` +
      `const [seriesId, seriesType] = process.argv.slice(2);\n` +
      `try {\n` +
      `  const row = await createHostsEventsRepository().updateEventSeries(seriesId, { seriesType } as any);\n` +
      `  console.log("BASELINE_WRITER_OK:" + row.id + ":" + row.seriesType);\n` +
      `} catch (error) {\n` +
      `  const detail = error instanceof Error ? [error.message, (error as any).cause?.message].filter(Boolean).join(" | ") : String(error);\n` +
      `  console.error("BASELINE_WRITER_BLOCKED:" + detail);\n` +
      `  process.exitCode = 42;\n` +
      `} finally { await pool?.end(); }\n`,
    "utf8",
  );
  const baselineEnv = {
    ...process.env,
    NODE_ENV: "test",
    MEALSCOUT_DISPOSABLE_POSTGRES: "1",
    DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${mappedPort}/postgres`,
  };
  const blockedBaseline = spawnSync(
    process.execPath,
    ["--import", "tsx", baselineRunnerPath, "series-1", "open_call"],
    {
      cwd: process.cwd(),
      env: baselineEnv,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(blockedBaseline.status, 42);
  assert.match(
    `${blockedBaseline.stdout}\n${blockedBaseline.stderr}`,
    /material series supply change requires canonical participation saga proof/i,
  );
  sql(
    `INSERT INTO event_series (id, host_id, series_type)
     VALUES ('empty-series', 'host-2', 'event');`,
    "seed empty series for baseline compatibility",
  );
  const compatibleBaseline = spawnSync(
    process.execPath,
    ["--import", "tsx", baselineRunnerPath, "empty-series", "open_call"],
    {
      cwd: process.cwd(),
      env: baselineEnv,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(
    compatibleBaseline.status,
    0,
    `${compatibleBaseline.stdout}\n${compatibleBaseline.stderr}`,
  );
  assert.match(
    compatibleBaseline.stdout,
    /BASELINE_WRITER_OK:empty-series:open_call/,
  );
  console.log(
    "migration142 containment: bound baseline writer blocked for live supply",
  );
  console.log(
    "migration142 compatibility: bound baseline writer allowed for empty supply",
  );

  expectSqlFailure(
    "old binary paid booking",
    `INSERT INTO event_bookings (
       id, event_id, truck_id, host_id, status,
       host_price_cents, platform_fee_cents, total_cents
     ) VALUES (
       'old-binary-booking', 'paid-event', 'truck-1', 'host-1', 'pending',
       1000, 150, 1150
     );`,
    /paid event booking requires canonical purchase aggregate/i,
  );

  expectSqlFailure(
    "aggregate line mismatch",
    `BEGIN;
     SET CONSTRAINTS ALL DEFERRED;
     INSERT INTO parking_pass_purchases (
       id, purchaser_user_id, truck_id, host_id,
       host_amount_cents, platform_fee_cents, charged_amount_cents,
       stripe_destination_account_id, idempotency_key, request_digest,
       allocation_digest, allocation_line_count
     ) VALUES (
       'purchase-bad', 'buyer-1', 'truck-1', 'host-1',
       1000, 150, 1150, 'acct_host_1', 'purchase-key-bad',
       'request-digest-bad', 'allocation-digest-bad', 1
     );
     INSERT INTO event_bookings (
       id, event_id, truck_id, host_id, status,
       host_price_cents, platform_fee_cents, total_cents,
       purchase_id, allocation_ordinal, allocation_digest, settlement_topology
     ) VALUES (
       'booking-bad', 'paid-event', 'truck-1', 'host-1', 'pending',
       900, 150, 1050, 'purchase-bad', 1,
       'allocation-digest-bad', 'destination_charge'
     );
     SET CONSTRAINTS ALL IMMEDIATE;
     COMMIT;`,
    /aggregate\/allocation identity mismatch/i,
  );

  expectSqlFailure(
    "foreign provider line",
    `INSERT INTO parking_pass_provider_operations (
       id, purchase_id, operation_kind, request_id, idempotency_key,
       request_digest, actor_type, sorted_line_ids, allocation_digest,
       expected_currency, expected_amount_cents,
       expected_destination_account_id, idempotency_expires_at
     ) VALUES (
       'provider-op-foreign', 'purchase-1', 'selected_line_refund',
       'provider-request-foreign', 'provider-key-foreign', 'request-digest-1',
       'purchaser', '["booking-2"]'::jsonb, 'allocation-digest-1',
       'usd', 0, 'acct_host_1', now() + interval '24 hours'
     );`,
    /foreign or stale allocation line/i,
  );

  expectSqlFailure(
    "duplicate provider lines",
    `INSERT INTO parking_pass_provider_operations (
       id, purchase_id, operation_kind, request_id, idempotency_key,
       request_digest, actor_type, sorted_line_ids, allocation_digest,
       expected_currency, expected_amount_cents,
       expected_destination_account_id, idempotency_expires_at
     ) VALUES (
       'provider-op-duplicate', 'purchase-1', 'selected_line_refund',
       'provider-request-duplicate', 'provider-key-duplicate', 'request-digest-1',
       'purchaser', '["booking-1", "booking-1"]'::jsonb, 'allocation-digest-1',
       'usd', 1150, 'acct_host_1', now() + interval '24 hours'
     );`,
    /sorted and unique/i,
  );

  expectSqlFailure(
    "provider operation identity rewrite",
    `UPDATE parking_pass_provider_operations
        SET expected_amount_cents = 1100
      WHERE id = 'provider-op-1';`,
    /financial identity is immutable/i,
  );
  expectSqlFailure(
    "provider confirmation without complete step proof",
    `UPDATE parking_pass_provider_operations
        SET status = 'provider_confirmed',
            provider_payment_intent_id = 'pi_old_binary'
      WHERE id = 'provider-op-1';`,
    /exact confirmed step proof/i,
  );
  expectSqlFailure(
    "provider step deletion",
    `DELETE FROM parking_pass_provider_operation_steps
      WHERE id = 'provider-step-1';`,
    /provider operation steps are append-only/i,
  );
  expectSqlFailure(
    "direct paid-line confirmation",
    `UPDATE event_bookings
        SET status = 'confirmed',
            stripe_payment_intent_id = 'pi_old_binary'
      WHERE id = 'booking-1';`,
    /provider-bound purchase proof/i,
  );
  expectSqlFailure(
    "direct paid-line refund",
    `UPDATE event_bookings
        SET status = 'refunded',
            refund_amount_cents = total_cents,
            cash_refunded_cents = total_cents,
            settlement_state = 'provider_confirmed'
      WHERE id = 'booking-1';`,
    /durable remedy proof/i,
  );
  expectSqlFailure(
    "cancellation request identity rewrite",
    `UPDATE parking_pass_cancellation_operations
        SET reason = 'Old binary replaced the durable reason'
      WHERE id = 'cancellation-1';`,
    /cancellation request identity is immutable/i,
  );
  expectSqlFailure(
    "cancellation selected-line financial mismatch",
    `INSERT INTO parking_pass_cancellation_operations (
       id, purchase_id, request_id, idempotency_key, booking_line_ids,
       request_digest, allocation_digest, actor_snapshot, policy_facts,
       actor_type, actor_user_id, reason, policy_trigger, remedy,
       amount_cents, expected_currency, expected_cash_refund_cents,
       expected_host_reversal_cents,
       expected_application_fee_refund_cents,
       expected_destination_account_id
     ) VALUES (
       'cancellation-bad', 'purchase-1', 'cancellation-request-bad',
       'cancellation-key-bad', '["booking-1"]'::jsonb,
       'cancellation-digest-bad', 'allocation-digest-1', '{}'::jsonb,
       '{}'::jsonb, 'admin', 'admin-1', 'Bad financial request',
       'technical_non_service', 'cash_refund', 1, 'usd', 1, 1, 1,
       'acct_host_1'
     );`,
    /financial identity does not match selected lines/i,
  );
  // Both transactions leave the original fixture intact for restore assertions.
  // Only the provider transfer reversal varies; local host accounting stays net.
  const refundProofTransaction = (reversalCents: number) => `
BEGIN;
UPDATE parking_pass_purchases
   SET stripe_payment_intent_id = 'pi_m142_refund', stripe_charge_id = 'ch_m142_refund'
 WHERE id = 'purchase-1';
INSERT INTO parking_pass_cancellation_operations (
  id, purchase_id, request_id, idempotency_key, booking_line_ids,
  request_digest, allocation_digest, actor_snapshot, policy_facts,
  actor_type, actor_user_id, reason, policy_trigger, remedy,
  amount_cents, expected_payment_intent_id, expected_charge_id,
  expected_currency, expected_cash_refund_cents, expected_host_reversal_cents,
  expected_application_fee_refund_cents, expected_destination_account_id, status
) VALUES (
  'm142-refund-cancellation', 'purchase-1', 'm142-refund-request',
  'm142-refund-cancellation-key', '["booking-1"]'::jsonb,
  'm142-refund-digest', 'allocation-digest-1',
  '{"actorType":"admin","actorUserId":"admin-1"}'::jsonb,
  '{"technicalNonService":true}'::jsonb,
  'admin', 'admin-1', 'Migration gross reversal regression',
  'technical_non_service', 'cash_refund', 1150,
  'pi_m142_refund', 'ch_m142_refund', 'usd', 1150, 1000, 150,
  'acct_host_1', 'processing'
);
INSERT INTO parking_pass_provider_operations (
  id, purchase_id, cancellation_operation_id, operation_kind, request_id,
  idempotency_key, request_digest, policy_trigger, actor_type, actor_user_id,
  sorted_line_ids, allocation_digest, expected_payment_intent_id, expected_charge_id,
  expected_currency, expected_amount_cents, expected_host_amount_cents,
  expected_application_fee_cents, expected_destination_account_id,
  provider_payment_intent_id, provider_charge_id, provider_transfer_id,
  provider_application_fee_id, idempotency_expires_at
) VALUES (
  'm142-refund-provider', 'purchase-1', 'm142-refund-cancellation',
  'selected_line_refund', 'm142-refund-provider-request', 'm142-refund-provider-key',
  'm142-refund-digest', 'technical_non_service', 'admin', 'admin-1',
  '["booking-1"]'::jsonb, 'allocation-digest-1', 'pi_m142_refund', 'ch_m142_refund',
  'usd', 1150, 1000, 150, 'acct_host_1', 'pi_m142_refund', 'ch_m142_refund',
  'tr_m142_refund', 'fee_m142_refund', now() + interval '24 hours'
);
INSERT INTO parking_pass_provider_operation_steps (
  id, operation_id, step_type, step_order, status, idempotency_key,
  request_digest, allocation_digest, policy_trigger, expected_payment_intent_id,
  expected_charge_id, expected_currency, expected_amount_cents,
  expected_destination_account_id, expected_application_fee_cents,
  provider_payment_intent_id, provider_charge_id, provider_transfer_id,
  provider_transfer_reversal_id, provider_application_fee_id,
  provider_application_fee_refund_id, provider_refund_id
)
SELECT 'm142-refund-step-' || fixture.kind, operation.id, fixture.kind,
  fixture.ordinal, 'provider_confirmed', 'm142-refund-step-key-' || fixture.kind,
  operation.request_digest, operation.allocation_digest, operation.policy_trigger,
  operation.expected_payment_intent_id, operation.expected_charge_id,
  operation.expected_currency, fixture.amount, operation.expected_destination_account_id,
  operation.expected_application_fee_cents, operation.provider_payment_intent_id,
  operation.provider_charge_id, operation.provider_transfer_id,
  CASE WHEN fixture.kind = 'transfer_reversal' THEN 'trr_m142_refund' END,
  operation.provider_application_fee_id,
  CASE WHEN fixture.kind = 'application_fee_refund' THEN 'fr_m142_refund' END,
  CASE WHEN fixture.kind = 'cash_refund' THEN 're_m142_refund' END
FROM parking_pass_provider_operations operation
CROSS JOIN (VALUES ('cash_refund', 1, 1150), ('application_fee_refund', 2, 150),
  ('transfer_reversal', 3, ${reversalCents})) AS fixture(kind, ordinal, amount)
WHERE operation.id = 'm142-refund-provider';
UPDATE parking_pass_provider_operations SET status = 'provider_confirmed'
 WHERE id = 'm142-refund-provider';
UPDATE event_bookings SET status = 'refunded', refund_amount_cents = 1150,
  cash_refunded_cents = 1150, host_transfer_reversed_cents = 1000,
  application_fee_refunded_cents = 150, settlement_state = 'provider_confirmed'
 WHERE id = 'booking-1';
DO $assert$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM event_bookings WHERE id = 'booking-1'
    AND status = 'refunded' AND cash_refunded_cents = 1150
    AND host_transfer_reversed_cents = 1000 AND application_fee_refunded_cents = 150
    AND settlement_state = 'provider_confirmed') THEN
    RAISE EXCEPTION 'gross refund proof did not finalize the booking';
  END IF;
END
$assert$;
ROLLBACK;
`;
  expectSqlFailure(
    "net-only transfer reversal cannot finalize cash refund",
    refundProofTransaction(1000),
    /paid-line cancellation\/refund requires durable remedy proof/i,
  );
  sql(refundProofTransaction(1150), "gross transfer reversal finalizes cash refund");
  assert.equal(
    scalar(`SELECT concat_ws(':', status, cash_refunded_cents,
      host_transfer_reversed_cents, application_fee_refunded_cents)
      FROM event_bookings WHERE id = 'booking-1';`, "verify refund regression rollback"),
    "pending:0:0:0",
  );
  console.log("migration142 refund proof: net reversal rejected, gross reversal accepted");

  expectSqlFailure(
    "event mutation target rewrite",
    `UPDATE event_participation_mutations
        SET target_booking_ids = '[]'::jsonb
      WHERE id = 'mutation-event-1';`,
    /target and authority facts are immutable/i,
  );
  expectSqlFailure(
    "event mutation late child",
    `INSERT INTO event_participation_mutation_children (
       id, mutation_id, event_id, child_kind, action_key,
       idempotency_key, request_digest, target_facts
     ) VALUES (
       'mutation-late-child', 'mutation-event-1', 'free-event',
       'event_apply', 'late:event', 'mutation-late-key',
       'mutation-late-digest', '{}'::jsonb
     );`,
    /child set is already frozen/i,
  );
  expectSqlFailure(
    "event mutation notification provider identity rewrite",
    `UPDATE event_participation_mutation_children
        SET notification_provider_message_id = 'replacement-message'
      WHERE id = 'mutation-notice-1';`,
    /child identity is immutable/i,
  );
  expectSqlFailure(
    "event mutation notification confirmation rollback",
    `UPDATE event_participation_mutation_children
        SET notification_delivery_state = 'retry_safe'
      WHERE id = 'mutation-notice-1';`,
    /provider-confirmed notification delivery is immutable/i,
  );
  expectSqlFailure(
    "event mutation new admission",
    `INSERT INTO event_bookings (
       id, event_id, truck_id, host_id, status,
       host_price_cents, platform_fee_cents, total_cents
     ) VALUES (
       'booking-during-mutation', 'free-event', 'truck-2', 'host-2',
       'pending', 0, 0, 0
     );`,
    /participation is suppressed by an active mutation/i,
  );
  expectSqlFailure(
    "event mutation stale confirmation",
    `UPDATE event_bookings SET status = 'confirmed'
      WHERE id = 'booking-mutation-pending';`,
    /confirmation is stale or suppressed/i,
  );
  expectSqlFailure(
    "series mutation new event admission",
    `INSERT INTO events (
       id, host_id, coordinator_user_id, series_id,
       event_type, requires_payment
     ) VALUES (
       'series-event-during-mutation', 'host-2', 'admin-1', 'series-1',
       'event', false
     );`,
    /event series is suppressed by an active participation mutation/i,
  );
  expectSqlFailure(
    "legacy payout request identity rewrite",
    `UPDATE host_payout_requests SET amount_cents = 900
      WHERE id = 'legacy-payout-1';`,
    /payout request facts are immutable/i,
  );
  expectSqlFailure(
    "legacy payout completion without provider proof",
    `UPDATE host_payout_requests
        SET status = 'transferred_to_connect',
            provider_transfer_id = 'tr_old_binary'
      WHERE id = 'legacy-payout-1';`,
    /completion requires exact provider operation proof/i,
  );
  expectSqlFailure(
    "legacy payout provider confirmation without transfer",
    `UPDATE legacy_payout_provider_operations
        SET status = 'provider_confirmed'
      WHERE id = 'legacy-payout-operation-1';`,
    /confirmation requires transfer identity/i,
  );

  expectSqlFailure(
    "arrival factual rewrite",
    `UPDATE parking_pass_arrival_versions
        SET address = 'Leaked replacement address'
      WHERE id = 'arrival-1';`,
    /arrival factual columns are immutable/i,
  );
  expectSqlFailure(
    "arrival factual delete",
    `DELETE FROM parking_pass_arrival_versions WHERE id = 'arrival-1';`,
    /arrival facts are append-only/i,
  );
  expectSqlFailure(
    "arrival acknowledgement rewrite",
    `UPDATE parking_pass_arrival_versions
        SET acknowledged_at = NULL,
            acknowledged_by_user_id = NULL
      WHERE id = 'arrival-1';`,
    /arrival acknowledgement is immutable/i,
  );
  expectSqlFailure(
    "cross-booking current arrival",
    `UPDATE event_bookings
        SET current_arrival_version_id = 'arrival-2'
      WHERE id = 'booking-1';`,
    /fk_event_booking_current_arrival_version/i,
  );
  expectSqlFailure(
    "destination entry in legacy ledger",
    `INSERT INTO host_earnings_ledger (
       id, host_id, booking_id, amount_cents
     ) VALUES ('destination-double-pay', 'host-1', 'booking-1', 1000);`,
    /destination settlement cannot enter legacy payout ledger/i,
  );
  expectSqlFailure(
    "unrevalidated legacy payout",
    `UPDATE host_payout_requests
        SET status = 'approved'
      WHERE id = 'historical-payout';`,
    /payout requires revalidated eligible legacy funds/i,
  );
  expectSqlFailure(
    "ordering approval without current review",
    `UPDATE restaurants
        SET ordering_approved_at = now(),
            ordering_approved_by_user_id = 'admin-1'
      WHERE id = 'truck-1';`,
    /ordering approval requires a current pending review request/i,
  );

  const dumpPath = nativeFixture ? resolve(nativeFixture.directory, "migration142.dump") : "/tmp/mealscout-migration142.dump";
  const dump = fixture([
    "exec",
    containerName,
    "pg_dump",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "--format=custom",
    `--file=${dumpPath}`,
  ]);
  if (dump.status !== 0) describeFailure("dump migration 142 fixture", dump);
  sql("CREATE DATABASE migration142_restore;", "create restore database");
  const restore = fixture([
    "exec",
    containerName,
    "pg_restore",
    "-U",
    "postgres",
    "-d",
    "migration142_restore",
    "--no-owner",
    "--no-privileges",
    dumpPath,
  ]);
  if (restore.status !== 0) describeFailure("restore migration 142 fixture", restore);
  const replayRestored = fixture(
    [
      "exec",
      "-i",
      containerName,
      "psql",
      "-X",
      "-q",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "migration142_restore",
    ],
    migrationTransaction,
  );
  if (replayRestored.status !== 0) {
    describeFailure("replay migration 142 after restore", replayRestored);
  }
  const restoredFacts = fixture([
    "exec",
    containerName,
    "psql",
    "-X",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "migration142_restore",
    "-c",
    `SELECT concat_ws(':',
       (SELECT count(*) FROM parking_pass_purchases),
       (SELECT count(*) FROM event_participation_mutations),
       (SELECT count(*) FROM legacy_payout_provider_operations));`,
  ]);
  if (restoredFacts.status !== 0) {
    describeFailure("read restored migration 142 facts", restoredFacts);
  }
  assert.equal(String(restoredFacts.stdout || "").trim(), "2:2:1");
  const restoredContainment = fixture([
    "exec",
    containerName,
    "psql",
    "-X",
    "-q",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "migration142_restore",
    "-c",
    "UPDATE parking_pass_cancellation_operations SET reason = 'restore bypass' WHERE id = 'cancellation-1';",
  ]);
  assert.notEqual(
    restoredContainment.status,
    0,
    "restored cancellation identity guard unexpectedly allowed a rewrite",
  );
  assert.match(
    `${restoredContainment.stdout || ""}\n${restoredContainment.stderr || ""}`,
    /cancellation request identity is immutable/i,
  );

  console.log("migration142-postgres16: APPLY PASS");
  console.log("migration142-postgres16: REPLAY PASS");
  console.log("migration142-postgres16: CONTAINMENT PASS");
  console.log("migration142-postgres16: RESTORE PASS");
} finally {
  try {
    for (const path of [baselineRunnerPath, baselineWriterPath]) {
      if (path && existsSync(path)) unlinkSync(path);
    }
  } finally {
    if (nativeFixture) {
      nativeFixture.stop();
    } else if (started) {
      const stop = fixture(["stop", "-t", "2", containerName]);
      if (stop.status !== 0) {
        console.warn(
          `warning: disposable PostgreSQL container cleanup failed: ${String(
            stop.stderr || stop.stdout || "unknown Docker error",
          ).trim()}`,
        );
      }
    }
  }
}
