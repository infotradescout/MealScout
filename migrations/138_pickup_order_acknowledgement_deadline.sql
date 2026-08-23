ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS pickup_acknowledgement_minutes INTEGER;

ALTER TABLE restaurants
  DROP CONSTRAINT IF EXISTS restaurants_pickup_acknowledgement_minutes_check;

ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_pickup_acknowledgement_minutes_check
  CHECK (
    pickup_acknowledgement_minutes IS NULL
    OR pickup_acknowledgement_minutes BETWEEN 5 AND 30
  );

ALTER TABLE pickup_orders
  ADD COLUMN IF NOT EXISTS merchant_acknowledgement_minutes_snapshot INTEGER,
  ADD COLUMN IF NOT EXISTS merchant_acknowledgement_due_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS merchant_acknowledged_at TIMESTAMP;

ALTER TABLE pickup_orders
  DROP CONSTRAINT IF EXISTS pickup_orders_merchant_acknowledgement_minutes_check;

ALTER TABLE pickup_orders
  ADD CONSTRAINT pickup_orders_merchant_acknowledgement_minutes_check
  CHECK (
    merchant_acknowledgement_minutes_snapshot IS NULL
    OR merchant_acknowledgement_minutes_snapshot BETWEEN 5 AND 30
  );

CREATE INDEX IF NOT EXISTS idx_pickup_orders_acknowledgement_deadline
  ON pickup_orders (merchant_acknowledgement_due_at, confirmed_at)
  WHERE status = 'confirmed';

COMMENT ON COLUMN restaurants.pickup_acknowledgement_minutes IS
  'Evidence-approved maximum minutes for the merchant to start preparation after card payment confirmation.';

COMMENT ON COLUMN pickup_orders.merchant_acknowledgement_minutes_snapshot IS
  'Merchant acknowledgement window captured when checkout was created.';

COMMENT ON COLUMN pickup_orders.merchant_acknowledgement_due_at IS
  'Deadline after payment confirmation; still-confirmed orders are cancelled and refunded after this time.';

COMMENT ON COLUMN pickup_orders.merchant_acknowledged_at IS
  'Time the merchant started preparation and supplied a preparation estimate.';
