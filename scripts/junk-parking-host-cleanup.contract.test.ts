import { readFileSync } from "node:fs";

const migration = readFileSync(
  "migrations/111_cleanup_junk_parking_pass_hosts.sql",
  "utf8",
).replace(/\r\n/g, "\n");

const targetBlock = migration.match(
  /target_ids varchar\[\] := ARRAY\[([\s\S]*?)\]::varchar\[\];/,
);
if (!targetBlock) throw new Error("Could not isolate the cleanup target IDs.");

const targetIds =
  targetBlock[1].match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
  ) ?? [];
if (targetIds.length !== 11 || new Set(targetIds).size !== 11) {
  throw new Error("The cleanup must contain exactly 11 unique target host IDs.");
}

for (const retainedId of [
  "6c8795d9-5856-4f18-8db4-706d6aa5c453",
  "94ceabcf-6a0a-42f8-b849-b203f5b5fc1c",
  "a5d30bff-1318-4d7a-8ee2-96190bbf378f",
  "03371aca-2439-4a58-8269-4599e57279f4",
]) {
  if (!migration.includes(retainedId)) {
    throw new Error(`Missing retained real host guard: ${retainedId}`);
  }
  if (targetIds.includes(retainedId)) {
    throw new Error(`A retained real host appears in the deletion set: ${retainedId}`);
  }
}

for (const requiredGuard of [
  "IF target_count <> 11",
  "IF identity_count <> 11",
  "IF protected_reference_count <> 0",
  "series_type = 'parking_pass'",
  "status = 'draft'",
  "event_count <> 33",
  "FROM event_bookings WHERE host_id = ANY (target_ids)",
  "FROM host_earnings_ledger WHERE host_id = ANY (target_ids)",
  "FROM host_location_claims WHERE host_id = ANY (target_ids)",
  "FROM event_interests WHERE event_id IN (SELECT id FROM target_events)",
  "DELETE FROM hosts",
  "GET DIAGNOSTICS deleted_count = ROW_COUNT",
]) {
  if (!migration.includes(requiredGuard)) {
    throw new Error(`Missing cleanup safety requirement: ${requiredGuard}`);
  }
}

if (/DELETE\s+FROM\s+users/i.test(migration)) {
  throw new Error("The cleanup must retain every owner user account.");
}

console.log("junk-parking-host-cleanup.contract: PASS");
