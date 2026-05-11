-- Store owner-connected social publishing destinations.
-- Access tokens are required for true platform publishing. In production,
-- restrict DB access and rotate/revoke these tokens through platform OAuth.

CREATE TABLE IF NOT EXISTS social_publishing_connections (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  platform varchar NOT NULL,
  display_name varchar,
  external_account_id varchar,
  external_account_url text,
  access_token text,
  refresh_token text,
  token_expires_at timestamp,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar NOT NULL DEFAULT 'active',
  last_publish_at timestamp,
  last_error text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_publish_connections_restaurant
  ON social_publishing_connections(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_social_publish_connections_platform
  ON social_publishing_connections(platform);

CREATE INDEX IF NOT EXISTS idx_social_publish_connections_status
  ON social_publishing_connections(status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_publish_connection_restaurant_platform
  ON social_publishing_connections(restaurant_id, platform);
