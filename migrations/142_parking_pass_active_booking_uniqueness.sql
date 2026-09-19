-- Preserve expired/cancelled booking history while allowing a later booking.
-- Install the active-row constraint before dropping the old all-history constraint.
-- Existing pending/confirmed duplicates must fail this migration, not be deleted.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bookings_event_truck_active"
  ON "event_bookings" ("event_id", "truck_id")
  WHERE "status" IN ('pending', 'confirmed');

ALTER TABLE "event_bookings"
  DROP CONSTRAINT IF EXISTS "uq_bookings_event_truck";
DROP INDEX IF EXISTS "uq_bookings_event_truck";
