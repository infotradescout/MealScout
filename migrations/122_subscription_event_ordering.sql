ALTER TABLE restaurant_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_event_id VARCHAR,
  ADD COLUMN IF NOT EXISTS stripe_event_created_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_restaurant_subscriptions_stripe_event_created
  ON restaurant_subscriptions(stripe_subscription_id, stripe_event_created_at);
