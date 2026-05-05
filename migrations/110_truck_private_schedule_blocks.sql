ALTER TABLE truck_manual_schedules
  ADD COLUMN IF NOT EXISTS entry_type varchar NOT NULL DEFAULT 'public_stop',
  ADD COLUMN IF NOT EXISTS public_label varchar;

UPDATE truck_manual_schedules
SET entry_type = CASE
  WHEN COALESCE(is_public, true) THEN 'public_stop'
  ELSE 'private_booking'
END
WHERE entry_type IS NULL OR btrim(entry_type) = '';

CREATE INDEX IF NOT EXISTS idx_truck_manual_schedule_entry_type
  ON truck_manual_schedules (truck_id, entry_type, date);
