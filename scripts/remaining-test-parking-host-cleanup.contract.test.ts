import { readFileSync } from "node:fs";

const migration = readFileSync(
  "migrations/114_cleanup_remaining_test_parking_hosts.sql",
  "utf8",
).replace(/\r\n/g, "\n");

const targetBlock = migration.match(
  /target_ids varchar\[\] := ARRAY\[([\s\S]*?)\]::varchar\[\];/,
);
if (!targetBlock) throw new Error("Could not isolate the remaining cleanup target IDs.");

const targetIds =
  targetBlock[1].match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
  ) ?? [];

if (targetIds.length !== 3 || new Set(targetIds).size !== 3) {
  throw new Error("The remaining cleanup must contain exactly 3 unique target host IDs.");
}

for (const expectedId of [
  "e8b250d0-2f7c-408b-8f1a-229fc87af6a0",
  "3e0dde93-cf8d-440a-9a3c-50b31073975d",
  "ecfea009-4ac2-416b-92bb-608145b19e27",
]) {
  if (!targetIds.includes(expectedId)) {
    throw new Error(`Missing approved test host target: ${expectedId}`);
  }
}

for (const retainedId of [
  "6c8795d9-5856-4f18-8db4-706d6aa5c453",
  "94ceabcf-6a0a-42f8-b849-b203f5b5fc1c",
  "a5d30bff-1318-4d7a-8ee2-96190bbf378f",
  "03371aca-2439-4a58-8269-4599e57279f4",
]) {
  if (!migration.includes(retainedId) || targetIds.includes(retainedId)) {
    throw new Error(`Retained real host guard is missing or unsafe: ${retainedId}`);
  }
}

for (const requiredGuard of [
  "IF target_count <> 3",
  "IF identity_count <> 3",
  "IF protected_reference_count <> 0",
  "series_type = 'parking_pass'",
  "status = 'published'",
  "default_host_price_cents = 4500",
  "event_count <> 2",
  "FROM event_bookings WHERE host_id = ANY (target_ids)",
  "FROM host_earnings_ledger WHERE host_id = ANY (target_ids)",
  "FROM host_location_claims WHERE host_id = ANY (target_ids)",
  "FROM event_interests WHERE event_id IN (SELECT id FROM target_events)",
  "DELETE FROM hosts",
  "GET DIAGNOSTICS deleted_count = ROW_COUNT",
]) {
  if (!migration.includes(requiredGuard)) {
    throw new Error(`Missing remaining cleanup safety requirement: ${requiredGuard}`);
  }
}

if (/DELETE\s+FROM\s+users/i.test(migration)) {
  throw new Error("The remaining cleanup must retain every owner user account.");
}

console.log("remaining-test-parking-host-cleanup.contract: PASS");
