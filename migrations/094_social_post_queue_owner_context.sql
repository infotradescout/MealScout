-- Migration 094: owner social post queue context

ALTER TABLE social_post_queue
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS restaurant_id varchar REFERENCES restaurants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source varchar,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

CREATE INDEX IF NOT EXISTS idx_social_post_queue_restaurant
  ON social_post_queue (restaurant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_social_post_queue_source
  ON social_post_queue (source, created_at);
