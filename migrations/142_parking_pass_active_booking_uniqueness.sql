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

-- Migration 016 used unnamed UNIQUE(event_id, truck_id), which PostgreSQL
-- names event_bookings_event_id_truck_id_key. Later schema paths used the
-- explicit uq_bookings_event_truck name, sometimes as a standalone index.
-- Verify both legacy definitions before removing either. Do not drop an
-- unrelated object merely because its name matches. The replacement active
-- index above has already been verified; no booking rows are changed here.
DO $parking_legacy_guards$
DECLARE
  guard_name text;
  guard_index regclass;
  target_schema text;
BEGIN
  SELECT namespace.nspname INTO STRICT target_schema
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE relation.oid = 'event_bookings'::regclass;

  FOREACH guard_name IN ARRAY ARRAY[
    'uq_bookings_event_truck',
    'event_bookings_event_id_truck_id_key'
  ] LOOP
    guard_index := to_regclass(format('%I.%I', target_schema, guard_name));

    IF EXISTS (
      SELECT 1 FROM pg_constraint legacy_constraint
      WHERE legacy_constraint.conrelid = 'event_bookings'::regclass
        AND legacy_constraint.conname = guard_name
        AND (
          legacy_constraint.contype <> 'u'
          OR legacy_constraint.conindid <> COALESCE(guard_index::oid, 0::oid)
        )
    ) THEN
      RAISE EXCEPTION 'Migration 142 found an unexpected legacy constraint definition: %', guard_name
        USING ERRCODE = '55000';
    END IF;

    IF guard_index IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_index legacy_index
      WHERE legacy_index.indexrelid = guard_index
        AND legacy_index.indrelid = 'event_bookings'::regclass
        AND legacy_index.indisunique AND NOT legacy_index.indisprimary
        AND legacy_index.indisvalid AND legacy_index.indisready
        AND legacy_index.indislive AND legacy_index.indimmediate
        AND legacy_index.indnkeyatts = 2 AND legacy_index.indnatts = 2
        AND legacy_index.indexprs IS NULL AND legacy_index.indpred IS NULL
        AND ARRAY(
          SELECT attribute.attname::text
          FROM unnest(legacy_index.indkey) WITH ORDINALITY AS key(attnum, position)
          JOIN pg_attribute attribute
            ON attribute.attrelid = legacy_index.indrelid
            AND attribute.attnum = key.attnum
          ORDER BY key.position
        ) = ARRAY['event_id', 'truck_id']::text[]
    ) THEN
      RAISE EXCEPTION 'Migration 142 found an unexpected legacy index definition: %', guard_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  FOREACH guard_name IN ARRAY ARRAY[
    'uq_bookings_event_truck',
    'event_bookings_event_id_truck_id_key'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint legacy_constraint
      WHERE legacy_constraint.conrelid = 'event_bookings'::regclass
        AND legacy_constraint.conname = guard_name
    ) THEN
      EXECUTE format('ALTER TABLE %I.event_bookings DROP CONSTRAINT %I', target_schema, guard_name);
    ELSIF to_regclass(format('%I.%I', target_schema, guard_name)) IS NOT NULL THEN
      EXECUTE format('DROP INDEX %I.%I', target_schema, guard_name);
    END IF;
  END LOOP;
END
$parking_legacy_guards$;
