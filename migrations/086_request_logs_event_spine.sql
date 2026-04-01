ALTER TABLE request_logs
  ADD COLUMN IF NOT EXISTS session_id varchar,
  ADD COLUMN IF NOT EXISTS anonymous_actor_id varchar,
  ADD COLUMN IF NOT EXISTS actor_type varchar,
  ADD COLUMN IF NOT EXISTS source_type varchar,
  ADD COLUMN IF NOT EXISTS event_type varchar,
  ADD COLUMN IF NOT EXISTS surface varchar,
  ADD COLUMN IF NOT EXISTS entity_id varchar,
  ADD COLUMN IF NOT EXISTS entity_type varchar,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

CREATE INDEX IF NOT EXISTS idx_request_logs_session ON request_logs (session_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_actor ON request_logs (actor_type, source_type);
CREATE INDEX IF NOT EXISTS idx_request_logs_event_type ON request_logs (event_type);
