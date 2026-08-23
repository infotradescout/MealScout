ALTER TABLE pickup_orders
  ADD COLUMN IF NOT EXISTS merchant_name_snapshot VARCHAR,
  ADD COLUMN IF NOT EXISTS pickup_address_snapshot TEXT;
