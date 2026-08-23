ALTER TABLE pickup_orders
  ADD COLUMN IF NOT EXISTS merchant_owner_id_snapshot VARCHAR,
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id_snapshot VARCHAR;

COMMENT ON COLUMN pickup_orders.merchant_owner_id_snapshot IS
  'Merchant owner identity authorized when checkout eligibility was evaluated.';

COMMENT ON COLUMN pickup_orders.stripe_connect_account_id_snapshot IS
  'Exact Stripe Connect destination authorized when the pickup order was created.';
