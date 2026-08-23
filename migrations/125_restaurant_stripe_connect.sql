ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id VARCHAR,
  ADD COLUMN IF NOT EXISTS stripe_connect_status VARCHAR NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS stripe_onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurants_stripe_connect_account
  ON restaurants (stripe_connect_account_id)
  WHERE stripe_connect_account_id IS NOT NULL;
