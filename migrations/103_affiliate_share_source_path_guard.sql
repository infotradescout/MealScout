-- Defensive compatibility guard for production DBs that missed migration 100.
-- Older deployed evidence code may still read affiliate_share_events.source_path.
ALTER TABLE affiliate_share_events
  ADD COLUMN IF NOT EXISTS source_path text;

UPDATE affiliate_share_events
SET source_path = destination_url
WHERE source_path IS NULL
  AND destination_url IS NOT NULL
  AND destination_url <> '';
