ALTER TABLE pickup_orders
  ADD COLUMN IF NOT EXISTS checkout_request_id VARCHAR,
  ADD COLUMN IF NOT EXISTS customer_access_token_hash VARCHAR,
  ADD COLUMN IF NOT EXISTS tax_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tip_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pickup_orders_checkout_request
  ON pickup_orders(checkout_request_id);

ALTER TABLE pickup_orders
  DROP CONSTRAINT IF EXISTS pickup_orders_authoritative_totals_nonnegative;
ALTER TABLE pickup_orders
  ADD CONSTRAINT pickup_orders_authoritative_totals_nonnegative
  CHECK (tax_cents >= 0 AND tip_cents >= 0 AND discount_cents >= 0 AND delivery_fee_cents >= 0);

ALTER TABLE order_notifications
  ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR;

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_notifications_dedupe_key
  ON order_notifications(dedupe_key);

CREATE INDEX IF NOT EXISTS idx_pickup_orders_delivery_active
  ON pickup_orders(restaurant_id, status)
  WHERE order_type = 'delivery';
