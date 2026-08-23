ALTER TABLE pickup_orders
  ADD COLUMN IF NOT EXISTS pickup_directions_url_snapshot TEXT;
