-- Migration 093: exact live-location expiry for food trucks

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS live_until_at timestamp;

CREATE INDEX IF NOT EXISTS idx_restaurants_live_until
  ON restaurants (live_until_at)
  WHERE live_until_at IS NOT NULL;
