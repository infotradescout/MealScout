-- Preserve the quantity actually decremented from tracked inventory for each
-- order line. Legacy/null rows fail closed and are never restored implicitly.
ALTER TABLE pickup_order_items
  ADD COLUMN IF NOT EXISTS inventory_reserved_quantity INTEGER;
