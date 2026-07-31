/**
 * Retired compatibility entry point.
 *
 * Profile access is now included for every merchant through the canonical
 * non-expiring free trial. Creating special access rows would reintroduce a
 * tier distinction, so this historical backfill intentionally performs no
 * reads or writes.
 */

console.error(
  "backfillEarlyAccountTrials is retired: all business profiles already have complete profile access.",
);
process.exitCode = 1;
