ALTER TABLE truck_manual_schedules
  ALTER COLUMN start_time DROP NOT NULL,
  ALTER COLUMN end_time DROP NOT NULL,
  ALTER COLUMN address DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS status varchar DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS schedule_type varchar,
  ADD COLUMN IF NOT EXISTS timezone varchar,
  ADD COLUMN IF NOT EXISTS source_type varchar,
  ADD COLUMN IF NOT EXISTS source_artifact varchar,
  ADD COLUMN IF NOT EXISTS source_confidence varchar,
  ADD COLUMN IF NOT EXISTS owner_submitted_equivalent boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurring boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS expires_at timestamp,
  ADD COLUMN IF NOT EXISTS geocode_status varchar,
  ADD COLUMN IF NOT EXISTS map_eligible boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS live_feed_eligible boolean DEFAULT true;

UPDATE truck_manual_schedules
SET status = 'open'
WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_truck_manual_schedule_status
  ON truck_manual_schedules (truck_id, status, date);

CREATE INDEX IF NOT EXISTS idx_truck_manual_schedule_expires
  ON truck_manual_schedules (expires_at);
