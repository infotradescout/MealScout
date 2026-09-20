-- Preserve expired/cancelled booking history while allowing a later booking.
-- Install the active-row constraint before dropping the old all-history constraint.
-- Existing pending/confirmed duplicates must fail this migration, not be deleted.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_bookings_event_truck_active"
  ON "event_bookings" ("event_id", "truck_id")
  WHERE "status" IN ('pending', 'confirmed');

-- IF NOT EXISTS proves only the index name, not its protection. A stale,
-- non-unique, invalid, or differently filtered index must never cause us to
-- remove the all-history guard. Compare against PostgreSQL's own parsed form
-- using matching column types, rather than hard-coding version-specific casts.
DO $parking_active_index$
BEGIN
  IF to_regclass('pg_temp.ms_m142_expected') IS NOT NULL
    OR to_regclass('pg_temp.ms_m142_expected_active') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 142 index verification workspace is occupied'
      USING ERRCODE = '55000';
  END IF;

  CREATE TEMP TABLE ms_m142_expected ON COMMIT DROP AS
    SELECT event_id, truck_id, status FROM event_bookings WITH NO DATA;
  CREATE UNIQUE INDEX ms_m142_expected_active
    ON ms_m142_expected(event_id, truck_id)
    WHERE status IN ('pending', 'confirmed');

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index actual
    JOIN pg_index expected
      ON expected.indexrelid = 'pg_temp.ms_m142_expected_active'::regclass
    JOIN pg_class actual_class ON actual_class.oid = actual.indexrelid
    JOIN pg_class expected_class ON expected_class.oid = expected.indexrelid
    WHERE actual.indexrelid = to_regclass('uq_bookings_event_truck_active')
      AND actual.indrelid = 'event_bookings'::regclass
      AND actual.indisunique AND actual.indisvalid
      AND actual.indisready AND actual.indislive AND actual.indimmediate
      AND actual.indnkeyatts = 2 AND actual.indnatts = 2
      AND actual.indexprs IS NULL
      AND actual_class.relam = expected_class.relam
      AND actual.indclass = expected.indclass
      AND actual.indcollation = expected.indcollation
      AND actual.indoption = expected.indoption
      AND ARRAY(
        SELECT attribute.attname::text
        FROM unnest(actual.indkey) WITH ORDINALITY AS key(attnum, position)
        JOIN pg_attribute attribute
          ON attribute.attrelid = actual.indrelid
          AND attribute.attnum = key.attnum
        ORDER BY key.position
      ) = ARRAY['event_id', 'truck_id']::text[]
      AND pg_get_expr(actual.indpred, actual.indrelid)
        = pg_get_expr(expected.indpred, expected.indrelid)
  ) THEN
    RAISE EXCEPTION 'Migration 142 requires a valid unique pending/confirmed event-truck index; the previous guard is retained'
      USING ERRCODE = '55000';
  END IF;
  DROP TABLE pg_temp.ms_m142_expected;
END
$parking_active_index$;

ALTER TABLE "event_bookings"
  DROP CONSTRAINT IF EXISTS "uq_bookings_event_truck";
DROP INDEX IF EXISTS "uq_bookings_event_truck";
