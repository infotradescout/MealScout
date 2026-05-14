-- Keep affiliate share analytics compatible across the old `source_path`
-- implementation and the newer resource/destination shape.
ALTER TABLE affiliate_share_events
  ADD COLUMN IF NOT EXISTS source_path text;

ALTER TABLE affiliate_share_events
  ALTER COLUMN resource_type SET DEFAULT 'page';

ALTER TABLE affiliate_share_events
  ALTER COLUMN destination_url SET DEFAULT '';

UPDATE affiliate_share_events
SET source_path = destination_url
WHERE source_path IS NULL
  AND destination_url IS NOT NULL
  AND destination_url <> '';

UPDATE affiliate_share_events
SET destination_url = source_path
WHERE (destination_url IS NULL OR destination_url = '')
  AND source_path IS NOT NULL
  AND source_path <> '';

