-- Native pickup remains disabled until the merchant explicitly confirms that
-- displayed menu prices already include applicable tax. Snapshot that promise
-- on each order so receipts do not change with later menu settings.
ALTER TABLE menus
  ADD COLUMN IF NOT EXISTS prices_include_tax BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE pickup_orders
  ADD COLUMN IF NOT EXISTS prices_include_tax BOOLEAN NOT NULL DEFAULT FALSE;
