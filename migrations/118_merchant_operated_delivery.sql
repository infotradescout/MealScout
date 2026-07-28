CREATE TABLE IF NOT EXISTS merchant_delivery_settings (
  restaurant_id VARCHAR PRIMARY KEY REFERENCES restaurants(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  minimum_order_cents INTEGER NOT NULL DEFAULT 0 CHECK (minimum_order_cents >= 0),
  estimated_minutes INTEGER NOT NULL DEFAULT 45 CHECK (estimated_minutes BETWEEN 10 AND 240),
  max_concurrent_orders INTEGER NOT NULL DEFAULT 5 CHECK (max_concurrent_orders BETWEEN 1 AND 100),
  postal_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivery_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  instructions TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merchant_delivery_enabled
  ON merchant_delivery_settings(enabled);

ALTER TABLE pickup_orders
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS delivery_city VARCHAR,
  ADD COLUMN IF NOT EXISTS delivery_state VARCHAR,
  ADD COLUMN IF NOT EXISTS delivery_postal_code VARCHAR,
  ADD COLUMN IF NOT EXISTS delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_estimate_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS delivery_instructions TEXT,
  ADD COLUMN IF NOT EXISTS out_for_delivery_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

ALTER TABLE pickup_orders
  DROP CONSTRAINT IF EXISTS pickup_orders_delivery_fee_nonnegative;
ALTER TABLE pickup_orders
  ADD CONSTRAINT pickup_orders_delivery_fee_nonnegative
  CHECK (delivery_fee_cents >= 0);
