ALTER TABLE pickup_orders
  ADD COLUMN IF NOT EXISTS ordering_contract_version VARCHAR;

CREATE INDEX IF NOT EXISTS idx_pickup_orders_ordering_contract_version
  ON pickup_orders (ordering_contract_version);
