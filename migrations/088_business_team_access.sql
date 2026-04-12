CREATE TABLE IF NOT EXISTS business_staff_invites (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email varchar,
  token_hash varchar NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar NOT NULL DEFAULT 'pending',
  expires_at timestamp,
  accepted_by_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  accepted_at timestamp,
  revoked_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_staff_invites_token_hash
  ON business_staff_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_business_staff_invites_restaurant
  ON business_staff_invites(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_business_staff_invites_status
  ON business_staff_invites(status);

CREATE TABLE IF NOT EXISTS business_staff_memberships (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id varchar NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by_user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar NOT NULL DEFAULT 'active',
  revoked_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_staff_memberships_restaurant_user
  ON business_staff_memberships(restaurant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_business_staff_memberships_restaurant
  ON business_staff_memberships(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_business_staff_memberships_user
  ON business_staff_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_business_staff_memberships_status
  ON business_staff_memberships(status);
