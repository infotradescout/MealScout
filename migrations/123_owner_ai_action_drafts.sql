-- Model-neutral owner AI drafts. Connector keys may only prepare drafts;
-- an authenticated restaurant owner must approve before canonical writes.

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS restaurant_id VARCHAR REFERENCES restaurants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS purpose VARCHAR NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS "IDX_api_keys_restaurant"
  ON api_keys(restaurant_id, is_active);

CREATE TABLE IF NOT EXISTS owner_ai_action_drafts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id VARCHAR NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_by_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_api_key_id VARCHAR REFERENCES api_keys(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(64),
  request_hash VARCHAR(64),
  status VARCHAR NOT NULL DEFAULT 'draft',
  revision INTEGER NOT NULL DEFAULT 1,
  packet JSONB NOT NULL,
  normalized_plan JSONB NOT NULL,
  current_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  social_drafts JSONB NOT NULL DEFAULT '[]'::jsonb,
  media_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  expected_versions JSONB NOT NULL,
  approved_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP,
  applied_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  result JSONB,
  social_publish_lease_id VARCHAR(64),
  social_publish_lease_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owner_ai_drafts_restaurant_status
  ON owner_ai_action_drafts(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_owner_ai_drafts_creator
  ON owner_ai_action_drafts(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_owner_ai_drafts_expires
  ON owner_ai_action_drafts(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_owner_ai_drafts_connector_idempotency
  ON owner_ai_action_drafts(connector_api_key_id, idempotency_key)
  WHERE connector_api_key_id IS NOT NULL AND idempotency_key IS NOT NULL;

ALTER TABLE social_post_queue
  ADD COLUMN IF NOT EXISTS owner_ai_action_draft_id VARCHAR
    REFERENCES owner_ai_action_drafts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_social_post_queue_owner_ai_draft
  ON social_post_queue(owner_ai_action_draft_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_post_queue_owner_ai_draft_platform
  ON social_post_queue(owner_ai_action_draft_id, platform)
  WHERE owner_ai_action_draft_id IS NOT NULL;
